/*
 * 静态数据生成器:把 NWP 管道输出转换为纯静态前端可用的数据包。
 *
 * 用法:
 *   node tools/build-static.js --out dist/data --models gfs_raw [--tiles] [--tile-deg 20]
 *   node tools/build-static.js --out dist/data --index-only
 *
 * 产物结构(per-var 格式,变量按需加载,避免全球单包过大):
 *   {out}/index.json                    最新 run 指针(format: per-var)
 *   {out}/{model}/{runKey}/meta.json    { model, runKey, times[], grid{ni,nj,lon0,dlon,lat0,dlat}, vars{vk:{scale,file}} }
 *   {out}/{model}/{runKey}/v_{var}.json { scale, data: base64 Int16 }(每变量一文件,前端按图层懒加载)
 *
 * 兼容:旧格式(单 global-2.5.json,变量全量打包)仍可被前端读取——meta 无 vars 清单时走旧路径。
 *
 * 前端:先取 index.json → meta(含网格与变量清单)→ 按需取 v_{var}.json。
 * 所有变量布局与 /api/grid 一致(base64 Float32),前端渲染代码零改动。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const gfs = require('../server/gfs');
const waves = require('../server/waves');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const flag = (name) => process.argv.includes('--' + name);

const OUT = arg('out', 'dist/data');
const MODELS = (arg('models', 'gfs_raw') || '').split(',');
const COARSE_DEG = Number(arg('coarse', '2.5'));
const TILE_DEG = Number(arg('tile-deg', '20'));
const WANT_TILES = flag('tiles');

/* 2.5° 全球粗网格参数(wrap:144 列覆盖 360°,无重复列) */
const COARSE = { ni: Math.round(360 / COARSE_DEG), nj: Math.round(180 / COARSE_DEG) + 1, lon0: 0, dlon: COARSE_DEG, lat0: 90, dlat: COARSE_DEG };

/* 变量 scale 直接取引擎的 GRIB 量化配置,保证与管道一致、单处维护 */
function varScale(model, vk) {
  const base = vk.split('@')[0]; // 层级键 u@850 → 取 u 的 scale
  if (model === 'ocean_raw') return base === 'sst' ? 100 : 1;
  if (model === 'gfs_raw') {
    const cfg = gfs.surfaceEngine.varCfg[base];
    if (cfg) return cfg.scale;
  } else {
    if (model === 'waves_raw') {
      const cfg = waves.engine.def.varCfg[base];
      if (cfg && cfg.scale) return cfg.scale;
    }
    const eng = require('../server/nwp').ENGINES[model];
    const cfg = eng && eng.def.varCfg[base];
    if (cfg && cfg.scale) return cfg.scale;
  }
  return 1;
}

async function main() {
  /* --index-only:扫描输出目录,重建 index.json(publish 阶段使用) */
  if (flag('index-only')) {
    const models = {};
    try {
      for (const d of fs.readdirSync(OUT)) {
        const modelDir = path.join(OUT, d);
        let runs = [];
        try { runs = fs.readdirSync(modelDir).filter((r) => /^\d{8}-\d{2}$/.test(r)).sort(); } catch { continue; }
        /* runKey 目录名含时间戳,字典序即时序;取最新且产物齐全的一轮 */
        for (const r of runs.reverse()) {
          const metaPath = path.join(modelDir, r, 'meta.json');
          if (!fs.existsSync(metaPath)) continue;
          let meta = null;
          try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { continue; }
          if (meta.format === 'per-var') {
            models[d] = { runKey: meta.runKey || r, meta: 'meta.json', format: 'per-var' };
            break;
          }
          const globalFile = path.join(modelDir, r, `global-${COARSE_DEG}.json`);
          if (fs.existsSync(globalFile)) {
            models[d] = { runKey: meta.runKey || r, meta: 'meta.json', global: `global-${COARSE_DEG}.json` };
            break;
          }
        }
      }
    } catch { /* 目录不存在 */ }
    fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ generated: Math.floor(Date.now() / 1000), models }, null, 2));
    console.log('index.json 重建完成:', Object.keys(models).join(', '));
    process.exit(0);
  }

  const index = {};
  for (const model of MODELS) {
    let engine;
    if (model === 'gfs_raw') engine = gfs.surfaceEngine;
    else if (model === 'waves_raw') engine = waves.engine;
    else engine = require('../server/nwp').ENGINES[model];
    if (!engine) { console.error(`未知模型 ${model}`); process.exit(1); }
    const rawGridOf = (w, s, e, n, step) =>
      model === 'gfs_raw' ? gfs.rawGrid(w, s, e, n, step, 0) : engine.rawGrid(w, s, e, n, step);

    const run = await engine.ensureLoaded();
    const runKey = run.key.replace('/', '-');
    const outDir = path.join(OUT, model, runKey);
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`\n[${model}] run ${runKey}: 生成静态数据 → ${outDir}`);

    // 全球粗网格(2.5°):Int16 + 每变量 scale(体积较 Float32 减半,浏览器解码快)
    const coarse = await rawGridOf(-180, -90 + COARSE_DEG, 180, 90, COARSE_DEG);

    // meta:网格形状 + 变量清单(前端据此懒加载)
    const varsManifest = {};
    for (const [vk, b64] of Object.entries(coarse.vars)) {
      const scale = varScale(model, vk);
      varsManifest[vk] = { scale, file: `v_${vk}.json` };
    }
    const meta = {
      model, runKey,
      times: coarse.times,
      generated: Math.floor(Date.now() / 1000),
      format: 'per-var',
      grid: { ni: coarse.lons.length, nj: coarse.lats.length, lon0: coarse.lons[0], dlon: COARSE_DEG, lat0: coarse.lats[0], dlat: COARSE_DEG },
      vars: varsManifest,
    };
    fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta));

    // 每变量一个文件:Int16 base64(按需加载,首屏只拉 u/v)
    let total = 0;
    for (const [vk, b64] of Object.entries(coarse.vars)) {
      const f32 = Buffer.from(b64, 'base64');
      const vals = new Float32Array(f32.buffer, f32.byteOffset, f32.length / 4);
      const scale = varScale(model, vk);
      const q = new Int16Array(vals.length);
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        q[i] = Number.isNaN(v) ? -32768 : Math.max(-32767, Math.min(32767, Math.round(v * scale)));
      }
      const file = path.join(outDir, `v_${vk}.json`);
      fs.writeFileSync(file, JSON.stringify({ scale, data: Buffer.from(q.buffer).toString('base64') }));
      total += fs.statSync(file).size;
      console.log(`  v_${vk}.json ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
    }
    console.log(`  ${Object.keys(coarse.vars).length} 个变量,共 ${(total / 1e6).toFixed(1)} MB`);

    // GFS 气压层包:每层 u/v/temp/rh 一个文件(键 u@850 → v_u_L850.json),前端按层级懒加载。
    // 层级数组必须与 meta.times 逐帧对齐(前端按同一时间索引取数),不对齐的层宁缺毋滥;
    // 单层失败只跳过该层,不株连整轮(地面包与已完成层照常发布)
    if (model === 'gfs_raw') {
      let levelKeys = 0;
      for (const level of gfs.LEVELS) {
        let lg;
        try {
          lg = await gfs.levelRawGrid(level, -180, -90 + COARSE_DEG, 180, 90, COARSE_DEG);
        } catch (e) {
          console.error(`  气压层 ${level} hPa 摄取失败,跳过:`, e.message);
          continue;
        }
        if (JSON.stringify(lg.times) !== JSON.stringify(coarse.times)) {
          console.error(`  气压层 ${level} hPa 时间轴与地面不一致(${lg.times.length} vs ${coarse.times.length} 帧),跳过`);
          continue;
        }
        for (const [vk, b64] of Object.entries(lg.vars)) {
          const f32 = Buffer.from(b64, 'base64');
          const vals = new Float32Array(f32.buffer, f32.byteOffset, f32.length / 4);
          const scale = varScale(model, vk);
          const q = new Int16Array(vals.length);
          for (let i = 0; i < vals.length; i++) {
            const v = vals[i];
            q[i] = Number.isNaN(v) ? -32768 : Math.max(-32767, Math.min(32767, Math.round(v * scale)));
          }
          const key = `${vk}@${level}`;
          const file = path.join(outDir, `v_${vk}_L${level}.json`);
          fs.writeFileSync(file, JSON.stringify({ scale, data: Buffer.from(q.buffer).toString('base64') }));
          total += fs.statSync(file).size;
          varsManifest[key] = { scale, file: `v_${vk}_L${level}.json` };
          levelKeys++;
        }
        console.log(`  气压层 ${level} hPa 完成`);
      }
      if (levelKeys) fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta)); // 回写含层级键的 meta
      else console.error('  未写入任何层级包,meta 保持仅地面变量');
    }

    // 0.5° 区域分块(实验性增强包)
    if (WANT_TILES) {
      const nCol = Math.round(360 / TILE_DEG), nRow = Math.round(180 / TILE_DEG);
      let done = 0;
      for (let c = 0; c < nCol; c++) {
        for (let r = 0; r < nRow; r++) {
          const w = -180 + c * TILE_DEG, e = w + TILE_DEG;
          const n = 90 - r * TILE_DEG, s = n - TILE_DEG;
          const tile = await rawGridOf(w, s, e, n, 0.5);
          const tileJson = {
            grid: { ni: tile.lons.length, nj: tile.lats.length, lon0: tile.lons[0], dlon: 0.5, lat0: tile.lats[0], dlat: 0.5 },
            times: tile.times,
            vars: tile.vars,
          };
          fs.writeFileSync(path.join(outDir, `t_${c}_${r}.json`), JSON.stringify(tileJson));
          done++;
          if (done % 12 === 0) console.log(`  tiles ${done}/${nCol * nRow}`);
        }
      }
      console.log(`  tiles 完成(${nCol * nRow} 块)`);
    }

    index[model] = { runKey, meta: 'meta.json', format: 'per-var' };
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ generated: Math.floor(Date.now() / 1000), models: index }, null, 2));
  // Cloudflare Pages / 静态托管:CORS 允许前端站点跨域取数 + 浏览器缓存 10 分钟
  fs.writeFileSync(path.join(OUT, '_headers'), [
    '/*',
    '  Access-Control-Allow-Origin: *',
    '  Cache-Control: public, max-age=600',
  ].join('\n'));
  console.log(`\n全部完成 → ${OUT}/index.json(含 _headers)`);
}

main().catch((e) => { console.error('生成失败:', e); process.exit(1); });
