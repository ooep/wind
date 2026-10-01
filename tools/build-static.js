/*
 * 静态数据生成器:把 NWP 管道输出转换为纯静态前端可用的数据包。
 *
 * 用法:
 *   node tools/build-static.js --out dist/data --models gfs_raw [--tiles] [--tile-deg 20]
 *
 * 产物结构(上传到静态数据仓库 / Pages):
 *   {out}/index.json                    最新 run 指针
 *   {out}/{model}/{runKey}/meta.json    { model, runKey, times[], generated }
 *   {out}/{model}/{runKey}/global.json  全球 2.5° 粗网格(全部变量 × 全部时次,Float32 base64)
 *   {out}/{model}/{runKey}/t_{c}_{r}.json  0.5° 区域分块(--tiles 时生成)
 *
 * 前端:先取 index.json → meta → global(必载)→ 视口覆盖的 tiles(增强精度)。
 * 所有 JSON 均与 /api/grid 的变量布局一致(base64 Float32),前端渲染代码零改动。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const gfs = require('../server/gfs');

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

async function main() {
  const index = {};
  const SCALES = {
    gfs_raw: { u: 100, v: 100, temp: 100, rh: 100, msl: 10, precip: 100, cloud: 100, gust: 100, vis: 10, snowd: 100, cape: 1, pwat: 10, cwat: 100 },
    gefs_raw: { u: 100, v: 100, temp: 100, rh: 100, msl: 10, precip: 100, cloud: 100, gust: 100 },
    ecmwf_raw: { u: 100, v: 100, temp: 100, rh: 100, msl: 10, precip: 100, cloud: 100, gust: 100 },
    aifs_raw: { u: 100, v: 100, temp: 100, rh: 100, msl: 10, precip: 100, cloud: 100, gust: 100 },
  };
  for (const model of MODELS) {
    let engine;
    if (model === 'gfs_raw') engine = require('../server/gfs').surfaceEngine;
    else engine = require('../server/nwp').ENGINES[model];
    if (!engine) { console.error(`未知模型 ${model}`); process.exit(1); }
    const rawGridOf = (w, s, e, n, step) =>
      model === 'gfs_raw' ? require('../server/gfs').rawGrid(w, s, e, n, step, 0) : engine.rawGrid(w, s, e, n, step);

    const run = await engine.ensureLoaded();
    const runKey = run.key.replace('/', '-');
    const outDir = path.join(OUT, model, runKey);
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`\n[${model}] run ${runKey}: 生成静态数据 → ${outDir}`);

    // meta
    const meta = { model, runKey, times: run.times.map((t) => iso(t.ms)), generated: Math.floor(Date.now() / 1000) };
    fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta));

    // 全球粗网格(2.5°):Int16 + 每变量 scale(体积较 Float32 减半,浏览器解码快)
    const coarse = await engine.gridCore(-180, -90 + COARSE_DEG, 180, 90, COARSE_DEG);
    const varsOut = {};
    for (const [vk, b64] of Object.entries(coarse.vars)) {
      const f32 = Buffer.from(b64, 'base64');
      const vals = new Float32Array(f32.buffer, f32.byteOffset, f32.length / 4);
      const scale = SCALES[model][vk] || 1;
      const q = new Int16Array(vals.length);
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        q[i] = Number.isNaN(v) ? -32768 : Math.max(-32767, Math.min(32767, Math.round(v * scale)));
      }
      varsOut[vk] = { scale, data: Buffer.from(q.buffer).toString('base64') };
    }
    const coarseJson = {
      grid: { ni: coarse.lons.length, nj: coarse.lats.length, lon0: coarse.lons[0], dlon: COARSE_DEG, lat0: coarse.lats[0], dlat: COARSE_DEG },
      times: coarse.times,
      int16: true,
      vars: varsOut,
    };
    fs.writeFileSync(path.join(outDir, `global-${COARSE_DEG}.json`), JSON.stringify(coarseJson));
    const mb = (fs.statSync(path.join(outDir, `global-${COARSE_DEG}.json`)).size / 1e6).toFixed(1);
    console.log(`  global-${COARSE_DEG}.json 完成(${mb} MB,变量 ${Object.keys(coarse.vars).join(', ')})`);

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

    index[model] = { runKey, meta: 'meta.json', global: `global-${COARSE_DEG}.json` };
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ generated: Math.floor(Date.now() / 1000), models: index }, null, 2));
  console.log(`\n全部完成 → ${OUT}/index.json`);
}

function iso(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:00`;
}

main().catch((e) => { console.error('生成失败:', e); process.exit(1); });
