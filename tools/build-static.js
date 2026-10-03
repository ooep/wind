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
const { icingIndex, catGrid, thunderIndex } = require('../server/derive');

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
const DERIVED_SCALE = { precip24: 10, precip72: 10, fire: 10, wpd: 1, ffmc: 10, gustmax: 100, icing: 10, cat: 100, extprob: 10, thunder: 10 }; // 烘焙端派生量:降水累计/可燃物含水率 0.1、火险 CBI 0.1、风功率密度 W/m²、过程最大阵风 0.01、积冰 0.1%、CAT 0.01、极端概率 0.1%、雷暴复合 0.1
function varScale(model, vk) {
  const base = vk.split('@')[0]; // 层级键 u@850 → 取 u 的 scale
  if (model === 'ocean_raw') return (base === 'sst' || base === 'ssta') ? 100 : 1;
  if (model === 'gfs_raw' || model === 'gfs_snow') {
    if (DERIVED_SCALE[base]) return DERIVED_SCALE[base];
    const cfg = gfs.surfaceEngine.varCfg[base] || (gfs.surfaceEngineX && gfs.surfaceEngineX.varCfg[base]) || (gfs.surfaceEngineW100 && gfs.surfaceEngineW100.varCfg[base]);
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

/* 全空守卫:上游摄取失败(如 ECMWF 503 风暴)时变量几乎全 NaN——拒绝发布,
 * 让工作流失败 → deploy-data 不组装,生产保留上一份好数据(而非静默换上空包) */
function guardEmptyData(vals, label) {
  let finite = 0;
  for (let i = 0; i < vals.length; i++) if (!Number.isNaN(vals[i])) finite++;
  if (finite < vals.length * 0.005) {
    console.error(`✗ ${label} 有效值仅 ${(finite / vals.length * 100).toFixed(2)}%,判定上游摄取失败,拒绝发布(线上保留旧包)`);
    process.exit(1);
  }
}

/* GEFS 扰动成员极端天气概率:逐成员采样 coarse 网格(2.5°),统计
 * 大风(10m ≥ 13.9 m/s)或强降水(≥ 4 mm/h,APCP 按 idx 累积窗换算)的成员占比。
 * 成员引擎串行摄取/采样(控内存),时间轴与控制成员逐帧对齐,不齐则弃该成员。 */
async function bakeExtremes(coarse, nMembers) {
  const { gefsMemberEngine } = require('../server/nwp');
  const nP = coarse.lons.length * coarse.lats.length;
  const P = coarse.times.length;
  const counts = new Float32Array(P * nP);
  let ok = 0;
  for (let n = 1; n <= nMembers; n++) {
    const tag = `gep${String(n).padStart(2, '0')}`;
    let eng;
    try {
      eng = gefsMemberEngine(n);
      const run = await eng.ensureLoaded();
      // run.times 是 plan 原始对象({runKey,step,ms});coarse.times 是 ISO 字符串,按 ms 对齐
      const memberMs = run.times.map((x) => x.ms);
      const idxMap = coarse.times.map((t) => memberMs.indexOf(Date.parse(t + ':00Z')));
      if (idxMap.some((i) => i < 0)) throw new Error('时间轴与控制成员不一致');
      for (let t = 0; t < P; t++) {
        const tt = run.times[idxMap[t]];
        for (let j = 0; j < coarse.lats.length; j++) {
          for (let i = 0; i < coarse.lons.length; i++) {
            const s2 = eng.sampleAll(tt.runKey, tt.step, coarse.lats[j], coarse.lons[i]);
            if (!s2) continue;
            const spd = Number.isFinite(s2.u) && Number.isFinite(s2.v) ? Math.hypot(s2.u, s2.v) : NaN;
            if ((Number.isFinite(spd) && spd >= 13.9) || (Number.isFinite(s2.precip) && s2.precip >= 4)) {
              counts[t * nP + j * coarse.lons.length + i] += 1;
            }
          }
        }
      }
      ok++;
      console.log(`  GEFS 成员 ${tag} 完成(${ok}/${nMembers})`);
    } catch (e) {
      console.error(`  GEFS 成员 ${tag} 失败: ${e.message}`);
    }
  }
  if (ok < 4) return null;
  const out = new Float32Array(P * nP);
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = (counts[i] / ok) * 100;
    if (out[i] > peak) peak = out[i];
  }
  console.log(`  极端天气概率完成(${ok} 成员,峰值 ${peak.toFixed(0)}%)`);
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength).toString('base64');
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
    if (model === 'gfs_raw' || model === 'gfs_snow') engine = gfs.surfaceEngine;
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

    // gfs_snow 高分辨雪包:0.5° 原生分辨率只烘雪变量(2.5° 的雪边缘块状难看)。
    // 纬度带 20-90°N(全球雪基本都在带内)+ 3 小时帧 + 上限 +168h,控制单文件体积。
    if (model === 'gfs_snow') {
      const SNOW_VARS = ['snowd', 'newsnow'];
      const SNOW_S_LAT = 20, SNOW_MAX_H = 168;
      const raw = await engine.gridCore(-180, SNOW_S_LAT, 180, 90, 0.5, SNOW_VARS);
      const msAll = raw.times.map((t) => Date.parse(t + ':00Z'));
      const keep = [];
      for (let t = 0; t < msAll.length; t++) {
        const h = (msAll[t] - msAll[0]) / 3600e3;
        if (h <= SNOW_MAX_H && Math.round(h) % 3 === 0) keep.push(t);
      }
      const times = keep.map((t) => raw.times[t]);
      const meta = {
        model, runKey,
        times,
        generated: Math.floor(Date.now() / 1000),
        format: 'per-var',
        grid: { ni: raw.lons.length, nj: raw.lats.length, lon0: raw.lons[0], dlon: 0.5, lat0: raw.lats[0], dlat: 0.5 },
        vars: {},
      };
      let total = 0;
      for (const vk of SNOW_VARS) {
        const bin = Buffer.from(raw.vars[vk], 'base64');
        const all = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
        const nP = raw.lons.length * raw.lats.length;
        const out = new Float32Array(keep.length * nP);
        keep.forEach((t, ki) => out.set(all.subarray(t * nP, (t + 1) * nP), ki * nP));
        guardEmptyData(out, `${model}.${vk}`);
        const scale = varScale(model, vk);
        const q = new Int16Array(out.length);
        for (let i = 0; i < out.length; i++) {
          const v = out[i];
          q[i] = Number.isNaN(v) ? -32768 : Math.max(-32767, Math.min(32767, Math.round(v * scale)));
        }
        const file = path.join(outDir, `v_${vk}.json`);
        fs.writeFileSync(file, JSON.stringify({ scale, data: Buffer.from(q.buffer).toString('base64') }));
        meta.vars[vk] = { scale, file: `v_${vk}.json` };
        total += fs.statSync(file).size;
        console.log(`  v_${vk}.json ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
      }
      fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta));
      console.log(`  ${SNOW_VARS.length} 个雪变量 × ${keep.length} 帧(0.5°,${SNOW_S_LAT}-90°N),共 ${(total / 1e6).toFixed(1)} MB`);
      index[model] = { runKey, meta: 'meta.json', format: 'per-var' };
      continue;
    }

    // 全球粗网格(2.5°):Int16 + 每变量 scale(体积较 Float32 减半,浏览器解码快)
    const coarse = await rawGridOf(-180, -90 + COARSE_DEG, 180, 90, COARSE_DEG);

    // 已知缺变量的模式:上游产品无 GUST(GEFS pgrb2a 无此字段、ECMWF 开放数据无 10fg),
    // 摄取必失败 → 不发布该变量(前端按"模式不提供"门控),避免全 NaN 被守卫拒绝株连整轮
    const KNOWN_ABSENT = { gefs_raw: ['gust'], ecmwf_raw: ['gust'], aifs_raw: ['gust'] };
    for (const vk of KNOWN_ABSENT[model] || []) delete coarse.vars[vk];

    // 降水累计窗口:由 PRATE(mm/h)按帧距积分得「过去 24/72h 累计」(帧距不均:逐小时 → 3 小时)
    if (model === 'gfs_raw' && coarse.vars.precip) {
      const bin = Buffer.from(coarse.vars.precip, 'base64');
      const rate = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
      const ms = coarse.times.map((t) => Date.parse(t + ':00Z'));
      const nPts = coarse.lons.length * coarse.lats.length;
      const P = ms.length;
      for (const win of [24, 72]) {
      // 每个时刻的回看帧表 [f, dt_h]:dt 按帧区间与窗口 (t-win, t] 的重叠时长裁剪
      // (逐小时→3 小时步长过渡处的帧会跨越窗口边界,整帧计入会高估)
      const frames = [];
      for (let t = 0; t < P; t++) {
        const w0 = ms[t] - win * 3600e3;
        const arr = [];
        for (let f = t; f >= 0 && ms[f] > w0; f--) {
          const o0 = Math.max(f === 0 ? ms[0] : ms[f - 1], w0);
          const dt = (ms[f] - o0) / 3600e3;
          if (dt > 0) arr.push([f, dt]);
        }
        frames.push(arr);
      }
        const out = new Float32Array(P * nPts);
        for (let t = 0; t < P; t++) {
          for (const [f, dt] of frames[t]) {
            if (!dt) continue;
            const base = f * nPts, obase = t * nPts;
            for (let p = 0; p < nPts; p++) {
              const r = rate[base + p];
              if (!Number.isNaN(r)) out[obase + p] += r * dt;
            }
          }
        }
        coarse.vars[`precip${win}`] = Buffer.from(out.buffer, out.byteOffset, out.byteLength).toString('base64');
        let peak = 0;
        for (const v of out) if (Number.isFinite(v) && v > peak) peak = v;
        console.log(`  降水累计 ${win}h 完成(峰值 ${peak.toFixed(1)} mm)`);
      }
    }

    // 雷暴复合:降水强度按 CAPE 加权(CAPE ≥4000 J/kg 时 ×5),雷雨区一目了然(live 端 derive.js 同源)
    if (model === 'gfs_raw' && coarse.vars.precip && coarse.vars.cape) {
      const pb = Buffer.from(coarse.vars.precip, 'base64');
      const PR = new Float32Array(pb.buffer, pb.byteOffset, pb.byteLength / 4);
      const cb = Buffer.from(coarse.vars.cape, 'base64');
      const CA = new Float32Array(cb.buffer, cb.byteOffset, cb.byteLength / 4);
      const out = new Float32Array(PR.length);
      let peak = 0;
      for (let i = 0; i < PR.length; i++) {
        const v = thunderIndex(PR[i], CA[i]);
        out[i] = v;
        if (Number.isFinite(v) && v > peak) peak = v;
      }
      coarse.vars.thunder = Buffer.from(out.buffer, out.byteOffset, out.byteLength).toString('base64');
      console.log(`  雷暴复合完成(峰值 ${peak.toFixed(1)} mm/h)`);
    }

    // 火险指数 CBI(Chandler Burning Index):仅由 2m 温度 + 相对湿度驱动的天气火险,
    // 连续 0-110+;≥50 中 / ≥75 高 / ≥90 很高 / ≥97.5 极端(不含风与可燃物,作快速参考层)
    if (model === 'gfs_raw' && coarse.vars.temp && coarse.vars.rh) {
      const tb = Buffer.from(coarse.vars.temp, 'base64');
      const T = new Float32Array(tb.buffer, tb.byteOffset, tb.byteLength / 4);
      const rb = Buffer.from(coarse.vars.rh, 'base64');
      const R = new Float32Array(rb.buffer, rb.byteOffset, rb.byteLength / 4);
      const out = new Float32Array(T.length);
      let peak = 0;
      for (let i = 0; i < T.length; i++) {
        const t = T[i], r = R[i];
        if (Number.isNaN(t) || Number.isNaN(r)) { out[i] = NaN; continue; }
        const cbi = ((110 - 1.373 * r) - 0.54 * (10.20 - t)) * 124 * Math.pow(10, -0.0274 * r) / 60;
        out[i] = Math.max(0, cbi);
        if (Number.isFinite(cbi) && cbi > peak) peak = cbi;
      }
      coarse.vars.fire = Buffer.from(out.buffer, out.byteOffset, out.byteLength).toString('base64');
      console.log(`  火险 CBI 完成(峰值 ${peak.toFixed(1)})`);
    }

    // 风功率密度 WPD(½ρv³,ρ=1.225 kg/m³):风能资源评估标准量,由 10m 风场派生
    if (model === 'gfs_raw' && coarse.vars.u && coarse.vars.v) {
      const ub = Buffer.from(coarse.vars.u, 'base64');
      const U = new Float32Array(ub.buffer, ub.byteOffset, ub.byteLength / 4);
      const vb = Buffer.from(coarse.vars.v, 'base64');
      const V = new Float32Array(vb.buffer, vb.byteOffset, vb.byteLength / 4);
      const out = new Float32Array(U.length);
      let peak = 0;
      for (let i = 0; i < U.length; i++) {
        const a = U[i], b = V[i];
        if (Number.isNaN(a) || Number.isNaN(b)) { out[i] = NaN; continue; }
        const w = 0.5 * 1.225 * Math.pow(a * a + b * b, 1.5);
        out[i] = w;
        if (w > peak) peak = w;
      }
      coarse.vars.wpd = Buffer.from(out.buffer, out.byteOffset, out.byteLength).toString('base64');
      console.log(`  风功率密度完成(峰值 ${Math.round(peak)} W/m²)`);
    }

    // GEFS 扰动成员极端天气概率(%):10m 风速 ≥ 13.9 m/s(7 级)或降水 ≥ 4 mm/h 的
    // 成员超越率逐帧输出;成员引擎独立缓存,≥4 个成员成功才发布(不足则该层缺失)
    if (model === 'gefs_raw') {
      try {
        const prob = await bakeExtremes(coarse, Number(arg('ens-members', '10')));
        if (prob) coarse.vars.extprob = prob;
        else console.error('  GEFS 有效成员不足 4 个,本轮不发布极端天气概率');
      } catch (e) {
        console.error(`  极端天气概率失败,跳过: ${e.message}`);
      }
    }

    // ECMWF/AIFS 软守卫:503 风暴期个别变量可能整轮取不到——非核心变量全空则本轮
    // 不发布该变量(前端按模式缺变量门控,该图层自动回落其他模式),核心变量(u/v/temp)
    // 全空才整体拒绝(保线上旧包)。把"风暴期整轮白跑"变成"至少更新风温压"
    if (model === 'ecmwf_raw' || model === 'aifs_raw') {
      const CORE = new Set(['u', 'v', 'temp']);
      for (const [vk, b64] of Object.entries(coarse.vars)) {
        const f32 = Buffer.from(b64, 'base64');
        const vals = new Float32Array(f32.buffer, f32.byteOffset, f32.length / 4);
        let finite = 0;
        for (let i = 0; i < vals.length; i++) if (!Number.isNaN(vals[i])) finite++;
        if (finite >= vals.length * 0.005) continue;
        if (CORE.has(vk)) {
          console.error(`✗ ${model}.${vk} 核心变量全空,拒绝发布(线上保留旧包)`);
          process.exit(1);
        }
        delete coarse.vars[vk];
        console.error(`  [软守卫] ${model}.${vk} 全空(上游风暴),本轮剔除该变量,其余照常发布`);
      }
    }

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
      guardEmptyData(vals, `${model}.${vk}`);
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
      /* 跨层派生累积器(2.5° 粗网格,内存占用 ≈ 80 帧 × 1 万点 × 4B,可忽略):
       * icing 各层取最大 / cloudtop 取 RH≥70% 的最高层位势高度 / cat 相邻层对 Ellrod TI 取最大 */
      const nPts = coarse.lons.length * coarse.lats.length;
      const P = coarse.times.length;
      const icing = new Float32Array(P * nPts).fill(NaN);
      const cloudtop = new Float32Array(P * nPts).fill(NaN);
      const cat = new Float32Array(P * nPts).fill(NaN);
      let prev = null; // 上一层的 u/v/h(Float32),供 CAT 层对计算
      let prevLevel = null;
      const ICING_LEVELS = new Set([925, 850, 700, 500]);
      const CLOUDTOP_LEVELS = new Set([925, 850, 700, 500, 300, 250]);
      const CAT_PAIRS = new Set(['500-300', '300-250', '250-200', '200-150']);
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
        const dec = (b64) => {
          const b = Buffer.from(b64, 'base64');
          return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
        };
        const cur = {
          u: lg.vars.u ? dec(lg.vars.u) : null,
          v: lg.vars.v ? dec(lg.vars.v) : null,
          h: lg.vars.h ? dec(lg.vars.h) : null,
          temp: lg.vars.temp ? dec(lg.vars.temp) : null,
          rh: lg.vars.rh ? dec(lg.vars.rh) : null,
        };
        if (ICING_LEVELS.has(level) && cur.temp && cur.rh) {
          for (let i = 0; i < icing.length; i++) {
            const v = icingIndex(cur.temp[i], cur.rh[i]);
            if (!Number.isFinite(v)) continue;
            icing[i] = Number.isNaN(icing[i]) ? v : Math.max(icing[i], v);
          }
        }
        if (CLOUDTOP_LEVELS.has(level) && cur.rh && cur.h) {
          for (let i = 0; i < cloudtop.length; i++) {
            if (Number.isNaN(cur.rh[i]) || cur.rh[i] < 70 || Number.isNaN(cur.h[i])) continue;
            cloudtop[i] = Number.isNaN(cloudtop[i]) ? cur.h[i] : Math.max(cloudtop[i], cur.h[i]);
          }
        }
        if (prev && prev.u && prev.v && prev.h && cur.u && cur.v && cur.h && CAT_PAIRS.has(`${prevLevel}-${level}`)) {
          // 层级按 925→150 顺序处理:prev 为较低高度层,cur 为较高层,dz = h_cur − h_prev > 0
          const g = catGrid(prev.u, prev.v, prev.h, cur.u, cur.v, cur.h, coarse.lons.length, coarse.lats.length, COARSE_DEG);
          for (let i = 0; i < cat.length; i++) {
            if (Number.isNaN(g[i])) continue;
            cat[i] = Number.isNaN(cat[i]) ? g[i] : Math.max(cat[i], g[i]);
          }
        }
        prev = cur; prevLevel = level;
        for (const [vk, b64] of Object.entries(lg.vars)) {
          const f32 = Buffer.from(b64, 'base64');
          const vals = new Float32Array(f32.buffer, f32.byteOffset, f32.length / 4);
          guardEmptyData(vals, `${model}.${vk}@${level}`);
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
      /* 跨层派生包:与层级包同一批发布(任一累积器有数据即写) */
      for (const [vk, arr, scl] of [['icing', icing, 10], ['cat', cat, 100], ['cloudtop', cloudtop, 1]]) {
        if (arr.every(Number.isNaN)) continue;
        guardEmptyData(arr, `${model}.${vk}`);
        const q = new Int16Array(arr.length);
        for (let i = 0; i < arr.length; i++) {
          const v = arr[i];
          q[i] = Number.isNaN(v) ? -32768 : Math.max(-32767, Math.min(32767, Math.round(v * scl)));
        }
        const file = path.join(outDir, `v_${vk}.json`);
        fs.writeFileSync(file, JSON.stringify({ scale: scl, data: Buffer.from(q.buffer).toString('base64') }));
        total += fs.statSync(file).size;
        varsManifest[vk] = { scale: scl, file: `v_${vk}.json` };
        levelKeys++;
        console.log(`  跨层派生 v_${vk}.json 完成`);
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
