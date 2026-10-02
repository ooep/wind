/*
 * 多模式 NWP 引擎框架(server/nwp.js)
 * 与 server/gfs.js 同一套存储/采样/点预报设计,供 GFS 之外的模型适配器使用。
 *
 * 当前接入:
 *  - gefs  : NOAA GEFS 控制成员 gec00(0.5°,同 S3 体系,无 key 无配额)
 *  - ecmwf : ECMWF IFS Open Data(0.25°,CC-BY,S3 直连,有限流需退避)
 *
 * 每个模型定义:变量映射(GRIB 匹配 + 单位换算)、网格常量、run 发现、
 * fetchVarStep(runKey, step, varKey) → 规范 Int16Array(N→S、W→E)。
 * 共享:Int16 捆包存储 + .done 断点续传 + 内存 LRU + 双线性采样 + 点预报。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { findMessages, decodeMessage } = require('./grib2');

const NJ = 361, NI = 720; // GEFS 0.5° 网格;ECMWF 0.25° 使用自己的常量(见模型定义)
const SENTINEL = -32768;

/* ---------------- HTTP 基础(带慢速源退避) ---------------- */

/* 慢速源(ECMWF/Azure 503 slowdown)可整小时持续:耐心重试 + 随机抖动,
 * 抢到零星成功即可写入缓存,下一轮断点续传累积(零成功 = 缓存永远播不上种) */
async function fetchBuf(url, retries = 9, headers = {}, backoffBase = 800) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { headers });
      if (r.status === 503 || r.status === 429) throw new Error(`HTTP ${r.status} (slowdown)`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      lastErr = e;
      const slow = /slowdown|429/i.test(String(e.message));
      const wait = backoffBase * (i + 1) * (slow ? 3 : 1) * (0.5 + Math.random());
      await new Promise((s) => setTimeout(s, Math.min(wait, slow ? 60_000 : 30_000)));
    }
  }
  throw lastErr;
}

/* ---------------- 通用 Int16 捆包存储 ---------------- */

class StepStore {
  constructor(dir, varKeys, ni, nj) {
    this.dir = dir;
    this.varKeys = varKeys;
    this.ni = ni; this.nj = nj;
    this.mem = new Map();
    this.memOrder = [];
  }
  stepFile(runKey, step) { return path.join(this.dir, runKey.replace('/', '-'), `m${String(step).padStart(3, '0')}.bin`); }
  doneFile(runKey, step) { return path.join(this.dir, runKey.replace('/', '-'), `m${String(step).padStart(3, '0')}.done`); }
  doneVars(runKey, step) {
    // 捆包尺寸必须与当前变量布局一致,否则 .done 是旧布局的残留(变量集变更后失效)
    try {
      const sz = fs.statSync(this.stepFile(runKey, step)).size;
      if (sz !== this.varKeys.length * this.ni * this.nj * 2) return new Set();
    } catch { return new Set(); }
    try { return new Set(JSON.parse(fs.readFileSync(this.doneFile(runKey, step), 'utf8'))); } catch { return new Set(); }
  }
  _writeLocks = new Map();
  /* 同一步骤的并发写必须串行,否则读-改-写竞争会丢变量块 */
  writeVar(runKey, step, varKey, arr) {
    const key = `${runKey}|${step}`;
    const prev = this._writeLocks.get(key) || Promise.resolve();
    const task = prev.then(() => {
      const dir = path.join(this.dir, runKey.replace('/', '-'));
      fs.mkdirSync(dir, { recursive: true });
      const file = this.stepFile(runKey, step);
      let bundle = null;
      try {
        const buf = fs.readFileSync(file);
        if (buf.length === this.varKeys.length * this.ni * this.nj * 2) {
          bundle = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2).slice();
        }
      } catch { /* 新文件 */ }
      if (!bundle) bundle = new Int16Array(this.varKeys.length * this.ni * this.nj).fill(SENTINEL);
      bundle.set(arr, this.varKeys.indexOf(varKey) * this.ni * this.nj);
      fs.writeFileSync(file, Buffer.from(bundle.buffer));
      const done = this.doneVars(runKey, step);
      done.add(varKey);
      fs.writeFileSync(this.doneFile(runKey, step), JSON.stringify([...done]));
    });
    this._writeLocks.set(key, task.catch(() => {}));
    return task;
  }
  loadStep(runKey, step) {
    const key = `${runKey}|${step}`;
    if (this.mem.has(key)) {
      const it = this.mem.get(key);
      it._t = Date.now();
      return it;
    }
    let entry = null;
    try {
      const buf = fs.readFileSync(this.stepFile(runKey, step));
      if (buf.length !== this.varKeys.length * this.ni * this.nj * 2) return null;
      const all = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
      entry = { _t: Date.now() };
      this.varKeys.forEach((vk, i) => {
        entry[vk] = all.subarray(i * this.ni * this.nj, (i + 1) * this.ni * this.nj);
      });
    } catch {
      return null;
    }
    this.mem.set(key, entry);
    this.memOrder.push(key);
    while (this.memOrder.length > 80) {
      const old = this.memOrder.shift();
      if (old !== key) this.mem.delete(old);
    }
    return entry;
  }
  prune(keep = 2, protect = []) {
    /* 最新 keep 个 run + 当前摄取计划引用的 run(历史时间窗 P run 需显式保护) */
    const keepSet = new Set(protect);
    let dirs = [];
    try { dirs = fs.readdirSync(this.dir).filter((d) => /^\d{8}-\d{2}$/.test(d)); } catch { return; }
    dirs.sort().reverse();
    const kept = [];
    for (const d of dirs) {
      if (kept.length < keep || keepSet.has(d)) kept.push(d);
    }
    for (const d of dirs) {
      if (!kept.includes(d)) fs.rmSync(path.join(this.dir, d), { recursive: true, force: true });
    }
  }
}

/* ---------------- 通用采样 ---------------- */

function makeSampler(store, grid, scales) {
  // grid: {lon0, dlon, lat0, dlat};lat0 为北边界(第一行),dlat 为正的纬度步长量级
  const { lon0, dlon, lat0, dlat } = grid;
  return function sample(entry, varKey, lat, lon) {
    const arr = entry[varKey];
    if (!arr) return NaN;
    const s = scales ? scales[varKey] || 1 : 1;
    let x = (((lon % 360) + 360) % 360 - ((lon0 % 360) + 360) % 360);
    x = ((x / dlon) % store.ni + store.ni) % store.ni;
    const y = (lat0 - lat) / dlat;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = (x0 + 1) % store.ni, y1 = Math.min(y0 + 1, store.nj - 1);
    if (y0 < 0 || y0 >= store.nj) return NaN;
    const tx = x - x0, ty = y - y0;
    const a = arr[y0 * store.ni + x0], b = arr[y0 * store.ni + x1];
    const c = arr[y1 * store.ni + x0], d = arr[y1 * store.ni + x1];
    const read = (v) => (v === SENTINEL ? NaN : v / s);
    const v00 = read(a), v10 = read(b), v01 = read(c), v11 = read(d);
    if (Number.isNaN(v00) || Number.isNaN(v10)) return NaN;
    const top = v00 + (v10 - v00) * tx;
    if (Number.isNaN(v01) || Number.isNaN(v11)) return top;
    const bot = v01 + (v11 - v01) * tx;
    return top + (bot - top) * ty;
  };
}

/* ---------------- 模型定义 ---------------- */

/* GEFS 控制成员(gec00) */
const GEFS = {
  id: 'gefs_raw',
  label: 'NOAA GEFS 控制成员 0.5°(AWS 开放数据,原始 GRIB2 自解码)',
  varKeys: ['u', 'v', 'temp', 'rh', 'msl', 'precip', 'cloud', 'gust'],
  grid: { ni: 720, nj: 361, lon0: 0, dlon: 0.5, lat0: 90, dlat: 0.5 },
  maxF: 168,
  stepH: 3,
  concurrency: 10,
  store: null,
  init() {
    this.store = new StepStore(path.join(__dirname, '..', '.cache', 'nwp-gefs'), this.varKeys, 720, 361);
  },
  granularity() { return 3; },
  /* GEFS 无 2m/10m 阵风与瞬时降水率:precip 用 3h 累积 APCP 换算,gust 置 NaN */
  async fetchVarStep(runKey, step, varKey) {
    const hh = runKey.split('/')[1];
    const fileTag = `f${String(step).padStart(3, '0')}`;
    const url = `${S3GEFS}/gefs.${runKey}/atmos/pgrb2ap5/gec00.t${hh}z.pgrb2a.0p50.${fileTag}`;
    const recs = parseGfsStyleIdx(await fetchBuf(`${url}.idx`));
    const cfg = GEFS_VARS[varKey];
    const rec = recs.find((x) => x.var === cfg.grib && x.level === cfg.level && (cfg.ave ? /ave/.test(x.ts) : cfg.acc ? /acc/.test(x.ts) : !/ave|acc/.test(x.ts)));
    if (!rec) throw new Error(`idx 中未找到 ${varKey}`);
    const data = await fetchBuf(url, 5, { Range: `bytes=${rec.start}-${rec.end - 1}` });
    const total = Number(data.readBigUInt64BE(8));
    const m = findMessages(total <= data.length ? data : data.subarray(0, total))[0];
    const dec = decodeMessage(m);
    return normalizeGrid(dec, this.grid, cfg);
  },
  gridOf() { return this.grid; },
};

const S3GEFS = 'https://noaa-gefs-pds.s3.amazonaws.com';
const GEFS_VARS = {
  u: { grib: 'UGRD', level: '10 m above ground', scale: 100, conv: (v) => v },
  v: { grib: 'VGRD', level: '10 m above ground', scale: 100, conv: (v) => v },
  temp: { grib: 'TMP', level: '2 m above ground', scale: 100, conv: (v) => v - 273.15 },
  rh: { grib: 'RH', level: '2 m above ground', scale: 100, conv: (v) => v },
  msl: { grib: 'PRMSL', level: 'mean sea level', scale: 10, conv: (v) => v / 100 },
  precip: { grib: 'APCP', level: 'surface', scale: 100, conv: (v) => v / 3, acc: true }, // APCP 单位 kg/m² ≡ mm,3h 累积 → mm/h
  cloud: { grib: 'TCDC', level: 'entire atmosphere', scale: 100, conv: (v) => v, ave: true },
  gust: { grib: 'GUST', level: 'surface', scale: 100, conv: (v) => v },
};

GEFS.varCfg = GEFS_VARS;

/* ---------------- GEFS 扰动成员引擎(极端天气概率用) ----------------
 * 只取 10m 风 + 降水两个变量 × gep01..gepNN;控制成员 pgrb2a 无 GUST,
 * 大风指标由 u/v 合成风速替代。APCP 累积窗口不固定(3h/6h 交替),
 * 按 idx 时间窗动态换算 mm/h(控制成员的固定 /3 在 6h 窗口帧会高估 2 倍)。 */
const MEMBER_VARS = {
  u: { grib: 'UGRD', level: '10 m above ground', scale: 100, conv: (v) => v },
  v: { grib: 'VGRD', level: '10 m above ground', scale: 100, conv: (v) => v },
  precip: { grib: 'APCP', level: 'surface', scale: 100, conv: (v) => v }, // conv 按窗口动态替换
};
function gefsMemberEngine(n) {
  const member = `gep${String(n).padStart(2, '0')}`;
  const def = {
    id: `gefs_m${n}`,
    label: `NOAA GEFS 集合成员 ${member} 0.5°(AWS 开放数据,极端天气概率用)`,
    varKeys: Object.keys(MEMBER_VARS),
    varCfg: MEMBER_VARS,
    grid: { ni: 720, nj: 361, lon0: 0, dlon: 0.5, lat0: 90, dlat: 0.5 },
    maxF: GEFS.maxF, stepH: 3, concurrency: 6,
    store: null,
    init() {
      this.store = new StepStore(path.join(__dirname, '..', '.cache', `nwp-gefs-m${n}`), this.varKeys, 720, 361);
    },
    granularity() { return 3; },
    steps: GEFS.steps,
    discoverRuns: GEFS.discoverRuns,
    async fetchVarStep(runKey, step, varKey) {
      const hh = runKey.split('/')[1];
      const fileTag = `f${String(step).padStart(3, '0')}`;
      const url = `${S3GEFS}/gefs.${runKey}/atmos/pgrb2ap5/${member}.t${hh}z.pgrb2a.0p50.${fileTag}`;
      const recs = parseGfsStyleIdx(await fetchBuf(`${url}.idx`));
      const cfg = MEMBER_VARS[varKey];
      const rec = recs.find((x) => x.var === cfg.grib && x.level === cfg.level && /acc|ave/.test(x.ts) === (varKey === 'precip'));
      if (!rec) throw new Error(`idx 中未找到 ${varKey}`);
      let conv = cfg.conv;
      if (varKey === 'precip') {
        const wm = /(\d+)-(\d+) hour acc/.exec(rec.ts);
        const win = wm ? Math.max(1, Number(wm[2]) - Number(wm[1])) : 3;
        conv = (v) => v / win; // 累积窗口小时数 → mm/h
      }
      const data = await fetchBuf(url, 5, { Range: `bytes=${rec.start}-${rec.end - 1}` });
      const total = Number(data.readBigUInt64BE(8));
      const msg = findMessages(total <= data.length ? data : data.subarray(0, total))[0];
      if (!msg) throw new Error('Range 内未找到 GRIB 消息');
      return normalizeGrid(decodeMessage(msg), this.grid, { ...cfg, conv });
    },
    gridOf() { return this.grid; },
  };
  return new ModelEngine(def);
}

/* 解析 GFS/GEFS 风格 idx(容忍列差异) */
function parseGfsStyleIdx(buf) {
  const text = buf.toString('utf8');
  const recs = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const f = line.split(':');
    const di = f.findIndex((x) => x.startsWith('d='));
    if (di < 2) continue;
    const nums = f.slice(0, di).filter((x) => /^\d+$/.test(x));
    if (!nums.length) continue;
    recs.push({
      start: Number(nums[nums.length - 1]),
      var: f[di + 1],
      level: f[di + 2] || '',
      ts: f.slice(di + 3).join(':'),
    });
  }
  recs.sort((a, b) => a.start - b.start);
  for (let i = 0; i < recs.length; i++) {
    recs[i].end = i + 1 < recs.length ? recs[i + 1].start : recs[i].start + 8 * 1024 * 1024;
  }
  return recs;
}

/* 网格标准化:文件扫描序 → N→S、W→E;单位换算;Int16 量化。
 * 支持 1× 与 2×(0.25° 源降采样到 0.5° 存储)。 */
function normalizeGrid(dec, grid, cfg) {
  const { ni, nj } = grid;
  const src = dec.values;
  const srcW = dec.grid.ni, srcH = dec.grid.nj;
  if (srcW !== ni && srcW !== ni * 2) throw new Error(`源网格宽度异常 ${srcW} vs ${ni}`);
  /* 0.25° 全球网格为 721 行(奇数),2× 降采样按 (nj*2-1) 容忍 */
  if (srcH !== nj && srcH !== nj * 2 && srcH !== nj * 2 - 1) throw new Error(`源网格高度异常 ${srcH} vs ${nj}`);
  /* 0.25° 全球网格 721 行:721/361=1.997,必须四舍五入到 2,整除截断会把场纵向压扁 */
  const sx = Math.round(srcW / ni), sy = Math.round(srcH / nj);
  const out = new Int16Array(nj * ni);
  const flipped = dec.grid.la1 < dec.grid.la2;
  for (let j = 0; j < nj; j++) {
    const srcRow = (flipped ? (srcH - 1 - j * sy) : j * sy) | 0;
    for (let i = 0; i < ni; i++) {
      const v = cfg.conv(src[srcRow * srcW + ((i * sx) | 0)]);
      if (Number.isNaN(v)) { out[j * ni + i] = SENTINEL; continue; }
      out[j * ni + i] = Math.max(-32767, Math.min(32767, Math.round(v * cfg.scale)));
    }
  }
  return out;
}

/* ECMWF Open Data 引擎工厂:IFS(物理模式)与 AIFS(AI 模式)共用同一发布管道 */
function ecmwfLike(id, label, product, concurrency) {
  return {
    id,
    varCfg: null, // ECMWF_VARS 定义后回填
    label,
    product, // 'ifs/0p25/oper' | 'aifs-single/0p25/oper'
    varKeys: ['u', 'v', 'temp', 'rh', 'msl', 'precip', 'cloud', 'gust'],
    grid: { ni: 720, nj: 361, lon0: 0, dlon: 0.5, lat0: 90, dlat: 0.5 }, // 0.25 源降采样到 0.5 存储
    maxF: 168,
    stepH: 3,
    concurrency,
    store: null,
    init() {
      this.store = new StepStore(path.join(__dirname, '..', '.cache', 'nwp-' + id), this.varKeys, 720, 361);
    },
    granularity(R) {
      const hh = R.key.split('/')[1];
      return (hh === '06' || hh === '18') ? 6 : 3; // 06z/18z 仅有 6 小时步长(至 +90h)
    },
    /* ECMWF 无 2m RH(用 2d 露点推算)、无 GUST;tp 为从头累积(m)→ 换算 mm */
    async fetchVarStep(runKey, step, varKey) {
      const [dateStr, hh] = runKey.split('/');
      const base = `${dateStr}${hh}0000`;
      const fileTag = `${String(step).padStart(2, '0')}h`;
      const url = `${S3ECMWF}/${dateStr}/${hh}z/${this.product}/${base}-${fileTag}-oper-fc`;
      const idxText = (await fetchBuf(`${url}.index`, 10, {}, 1500)).toString('utf8');
      const msgs = idxText.trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const cfg = this.varCfg[varKey];
      const target = msgs.find((m) => m.name === cfg.name && Number(m.step) === Number(step));
      if (!target) throw new Error(`index 中未找到 ${varKey}(${cfg.name})@${step}h`);
      const data = await fetchBuf(`${url}.grib2`, 10, { Range: `bytes=${target._offset}-${target._offset + target._length - 1}` }, 1500);
      const m = findMessages(data)[0];
      if (!m) throw new Error('Range 内未找到 GRIB 消息');
      const dec = decodeMessage(m);
      return normalizeGrid(dec, this.grid, cfg);
    },
    gridOf() { return this.grid; },
  };
}

const ECMWF = ecmwfLike('ecmwf_raw', 'ECMWF IFS 0.25°(ECMWF Open Data,CC-BY,原始 GRIB2 自解码)', 'ifs/0p25/oper', 3);

const S3ECMWF = 'https://ecmwf-forecasts.s3.amazonaws.com';
const ECMWF_VARS = {
  u: { name: '10u', scale: 100, conv: (v) => v },
  v: { name: '10v', scale: 100, conv: (v) => v },
  temp: { name: '2t', scale: 100, conv: (v) => v - 273.15 },
  rh: { name: '2d', scale: 100, conv: null }, // 露点 → RH,在 后处理 中计算
  msl: { name: 'msl', scale: 10, conv: (v) => v / 100 },
  precip: { name: 'tp', scale: 100, conv: (v) => v * 1000 }, // m 累积 → mm(3h)
  cloud: { name: 'tcc', scale: 100, conv: (v) => v * 100 },  // 0-1 → %
  gust: { name: '__none__', scale: 100, conv: (v) => v },
};

ECMWF.varCfg = ECMWF_VARS;

/* ---------------- run 管理(每模型一个实例状态) ---------------- */

function utcStr(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

class ModelEngine {
  constructor(def) {
    this.def = def;
    def.init();
    this.run = null;
    this.loadingPromise = null;
    this.sampler = makeSampler(def.store, def.grid, Object.fromEntries(Object.entries(def.varCfg).map(([k, v]) => [k, v.scale])));
  }

  status() {
    return {
      model: this.def.id,
      run: this.run ? { key: this.run.key, init: this.run.init, loaded: this.run.loaded, prev: this.run.prevKey, steps: this.run.times.length } : null,
      loading: !!this.loadingPromise,
      memSteps: this.def.store.mem.size,
    };
  }

  async ensureLoaded() {
    if (this.run && this.run.loaded) {
      // 每 30 分钟重新发现一次:NOAA/ECMWF 发布新时次后自动切换
      if (Date.now() - (this.run.checkedAt || 0) < 30 * 60e3) return this.run;
      try {
        const runs = await this.def.discoverRuns();
        const sameR = runs[0].key === this.run.key;
        const sameP = (runs[1] ? runs[1].key : null) === this.run.prevKey;
        if (sameR && sameP) { this.run.checkedAt = Date.now(); return this.run; }
        console.log(`  [${this.def.id}] 发现新 run ${runs[0].key},自动切换摄取`);
        this.run = null;
      } catch { return this.run; }
    }
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = (async () => {
      const runs = await this.def.discoverRuns();
      const plan = this.buildPlan(runs);
      const runInfo = {
        key: plan.R.key, init: plan.R.init,
        prevKey: plan.P ? plan.P.key : null,
        times: plan.times, loaded: false,
      };
      const tasks = [];
      for (const t of plan.times) {
        const done = this.def.store.doneVars(t.runKey, t.step);
        for (const varKey of this.def.varKeys) {
          if (done.has(varKey)) continue;
          tasks.push({ ...t, varKey });
        }
      }
      let done = 0, cursor = 0;
      const failed = [];
      async function worker(engine) {
        while (cursor < tasks.length) {
          const task = tasks[cursor++];
          try {
            const arr = await engine.def.fetchVarStep(task.runKey, task.step, task.varKey);
            engine.def.store.writeVar(task.runKey, task.step, task.varKey, arr);
          } catch (e) {
            failed.push(`${task.runKey} f${task.step} ${task.varKey}: ${e.message}`);
          }
          done++;
          if (done % 24 === 0) console.log(`  [${engine.def.id}] 摄取进度 ${done}/${tasks.length}`);
        }
      }
      if (tasks.length) {
        console.log(`  [${this.def.id}] 开始摄取 run ${plan.R.key},共 ${tasks.length} 条消息`);
        await Promise.all(Array.from({ length: Math.min(this.def.concurrency || 10, tasks.length) }, () => worker(this)));
        if (failed.length) console.error(`  [${this.def.id}] ${failed.length} 条消息失败(将显示为空):`, failed.slice(0, 3));
      }
      this.run = runInfo;
      runInfo.loaded = true;
      runInfo.checkedAt = Date.now();
      this.def.store.prune(2, [plan.R.key.replace('/', '-'), plan.P ? plan.P.key.replace('/', '-') : null].filter(Boolean));
      return runInfo;
    })();
    try {
      return await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  buildPlan(runs) {
    const R = runs[0];
    let P = null;
    const PAST_H = 24;
    for (const c of runs.slice(1)) {
      if (c.init <= Date.now() - PAST_H * 3600e3) { P = c; break; }
    }
    const times = [];
    const pGran = P ? this.def.granularity(P) : this.def.granularity(R);
    const pastStart = Math.floor((Date.now() - PAST_H * 3600e3) / (pGran * 3600e3)) * pGran * 3600e3;
    if (P) {
      for (let t = pastStart; t < R.init; t += pGran * 3600e3) {
        const step = Math.round((t - P.init) / 3600e3);
        if (step < 0 || step % pGran !== 0) continue;
        times.push({ runKey: P.key, step, ms: t });
      }
    }
    for (const step of this.def.steps(R)) {
      times.push({ runKey: R.key, step, ms: R.init + step * 3600e3 });
    }
    return { R, P, times };
  }

  async rawGrid(w, s, e, n, stepDeg) {
    const run = await this.ensureLoaded();
    const times = run.times;
    let stepOut = stepDeg;
    const wrapLon = (e - w) >= 360 - 1e-6;
    const lonCount = wrapLon ? Math.round(360 / stepOut) : Math.round((e - w) / stepOut) + 1;
    const rows = Math.round((n - s) / stepOut) + 1;
    const lons = [];
    for (let i = 0; i < lonCount; i++) lons.push(Number((w + i * stepOut).toFixed(3)));
    const lats = [];
    for (let j = 0; j < rows; j++) lats.push(Number((n - j * stepOut).toFixed(3)));
    const nP = lons.length * lats.length;
    const varKeys = this.def.varKeys;
    const src = {};
    for (const vk of varKeys) src[vk] = new Float32Array(times.length * nP).fill(NaN);

    let p = 0;
    for (const lat of lats) {
      for (const lon of lons) {
        for (let t = 0; t < times.length; t++) {
          const s2 = this.sampleAll(times[t].runKey, times[t].step, lat, lon);
          if (!s2) continue;
          for (const vk of varKeys) src[vk][t * nP + p] = s2[vk];
        }
        p++;
      }
    }
    // ECMWF rh 由露点后处理(此处 temp/rh 均已采样,rh 存的是露点 → 转换)
    if (this.def.id === 'ecmwf_raw') {
      for (let i = 0; i < src.rh.length; i++) {
        const td = src.rh[i], tt = src.temp[i];
        src.rh[i] = rhFromDewpoint(tt, td);
      }
    }

    const f32b64 = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
    return {
      model: this.def.id,
      source: this.def.label,
      step: stepOut, wrapLon,
      cols: lons.length, rows: lats.length, points: nP,
      times: times.map((t) => isoTimeUtc(t.ms)),
      lat0: lats[0], lat1: lats[lats.length - 1],
      lon0: lons[0], lon1: lons[lons.length - 1],
      lats, lons,
      generated: Math.floor(Date.now() / 1000),
      vars: Object.fromEntries(varKeys.map((vk) => [vk, f32b64(src[vk])])),
    };
  }

  sampleAll(runKey, step, lat, lon) {
    const entry = this.def.store.loadStep(runKey, step);
    if (!entry) return null;
    const out = {};
    for (const vk of this.def.varKeys) out[vk] = this.sampler(entry, vk, lat, lon);
    return out;
  }

  async rawPoint(lat, lon) {
    const run = await this.ensureLoaded();
    const times = run.times;
    const series = [];
    const NULLS = { temp: NaN, rh: NaN, precip: NaN, cloud: NaN, msl: NaN, u: NaN, v: NaN, gust: NaN };
    for (const t of times) {
      const s2 = this.sampleAll(t.runKey, t.step, lat, lon) || NULLS;
      series.push({
        ms: t.ms,
        temp: s2.temp, rh: s2.rh, precip: s2.precip, cloud: s2.cloud,
        msl: s2.msl, u: s2.u, v: s2.v, gust: s2.gust,
      });
    }
    const spd = (x) => Number.isNaN(x?.u) || Number.isNaN(x?.v) ? NaN : Math.hypot(x.u, x.v);
    const dirOf = (x) => Number.isNaN(x?.u) || Number.isNaN(x?.v) ? NaN : Math.round(((Math.atan2(-x.u, -x.v) * 180) / Math.PI + 360) % 360);
    const now = Date.now();
    let cur = series[0];
    for (const s2 of series) { if (s2.ms <= now + 1800e3) cur = s2; else break; }
    const curSpd = spd(cur);

    const hourly = {
      time: series.map((x) => naiveIsoLocal(x.ms)),
      temperature_2m: series.map((x) => +x.temp.toFixed(1)),
      apparent_temperature: series.map((x) => +apparentTemp(x.temp, x.rh, spd(x)).toFixed(1)),
      precipitation: series.map((x) => +(Math.max(0, x.precip) * 3).toFixed(2)),
      precipitation_probability: series.map(() => null),
      weather_code: series.map((x) => weatherCode(x.precip, x.temp, x.cloud)),
      relative_humidity_2m: series.map((x) => Math.round(x.rh)),
      wind_speed_10m: series.map((x) => +spd(x).toFixed(1)),
      wind_direction_10m: series.map((x) => dirOf(x)),
      wind_gusts_10m: series.map((x) => Number.isNaN(x.gust) ? null : +x.gust.toFixed(1)),
      pressure_msl: series.map((x) => Math.round(x.msl)),
      cloud_cover: series.map((x) => Math.round(x.cloud)),
    };

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now + i * 86400e3);
      days.push(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    }
    const daily = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [], precipitation_probability_max: [], wind_speed_10m_max: [], sunrise: [], sunset: [] };
    for (const dayStart of days) {
      const inDay = series.filter((x) => x.ms >= dayStart && x.ms < dayStart + 86400e3 && !Number.isNaN(x.temp));
      daily.time.push(naiveIsoLocal(dayStart).slice(0, 10));
      if (!inDay.length) {
        for (const k of ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'sunrise', 'sunset']) daily[k].push(null);
        continue;
      }
      const temps = inDay.map((x) => x.temp);
      const mid = inDay[Math.floor(inDay.length / 2)];
      daily.weather_code.push(weatherCode(Math.max(...inDay.map((x) => x.precip || 0)), mid.temp, Math.max(...inDay.map((x) => x.cloud || 0))));
      daily.temperature_2m_max.push(+Math.max(...temps).toFixed(1));
      daily.temperature_2m_min.push(+Math.min(...temps).toFixed(1));
      daily.precipitation_sum.push(+inDay.reduce((a, x) => a + Math.max(0, x.precip || 0) * 3, 0).toFixed(1));
      daily.precipitation_probability_max.push(null);
      daily.wind_speed_10m_max.push(+Math.max(...inDay.map((x) => spd(x) || 0)).toFixed(1));
      const st = sunTimes(dayStart, lat, lon);
      daily.sunrise.push(naiveIsoLocal(st.sunrise));
      daily.sunset.push(naiveIsoLocal(st.sunset));
    }

    return {
      source: this.def.label + ',自算点预报',
      current: {
        temperature_2m: +cur.temp.toFixed(1),
        relative_humidity_2m: Math.round(cur.rh),
        apparent_temperature: +apparentTemp(cur.temp, cur.rh, curSpd).toFixed(1),
        is_day: (() => { const st = sunTimes(now - 12 * 3600e3, lat, lon); return (!Number.isNaN(st.sunrise) && now >= st.sunrise && now <= st.sunset) ? 1 : 0; })(),
        precipitation: Math.max(0, +(cur.precip).toFixed(2)),
        weather_code: weatherCode(cur.precip, cur.temp, cur.cloud),
        cloud_cover: Math.round(cur.cloud),
        pressure_msl: Math.round(cur.msl),
        wind_speed_10m: +curSpd.toFixed(1),
        wind_direction_10m: dirOf(cur),
        wind_gusts_10m: Number.isNaN(cur.gust) ? null : +cur.gust.toFixed(1),
      },
      hourly, daily,
    };
  }
}

/* ---------------- 共享小工具 ---------------- */

function rhFromDewpoint(tC, tdC) {
  if (Number.isNaN(tC) || Number.isNaN(tdC)) return NaN;
  const es = 6.112 * Math.exp(17.67 * tC / (tC + 243.5));
  const e = 6.112 * Math.exp(17.67 * tdC / (tdC + 243.5));
  return Math.max(0, Math.min(100, 100 * e / es));
}

function apparentTemp(tC, rh, ws) {
  if (Number.isNaN(tC) || Number.isNaN(rh) || Number.isNaN(ws)) return tC;
  const e = (rh / 100) * 6.105 * Math.exp(17.67 * tC / (237.7 + tC));
  return tC + 0.33 * e - 0.70 * ws - 4.00;
}

function weatherCode(prate, tC, cloud) {
  if (Number.isNaN(prate)) prate = 0;
  if (Number.isNaN(cloud)) cloud = 0;
  const snow = Number.isFinite(tC) && tC <= 0.5;
  if (prate >= 0.1) {
    if (snow) return prate >= 4 ? 75 : prate >= 1 ? 73 : 71;
    return prate >= 7.6 ? 65 : prate >= 2.5 ? 63 : 61;
  }
  if (cloud >= 70) return 3;
  if (cloud >= 40) return 2;
  if (cloud >= 10) return 1;
  return 0;
}

function sunTimes(dayStartUtcMs, lat, lon) {
  const rad = Math.PI / 180;
  const d = new Date(dayStartUtcMs);
  const dayOfYear = Math.floor((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 86400e3) + 1;
  const γ = (2 * Math.PI / 365) * (dayOfYear - 1);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(γ) - 0.032077 * Math.sin(γ)
    - 0.014615 * Math.cos(2 * γ) - 0.040849 * Math.sin(2 * γ));
  const decl = 0.006918 - 0.399912 * Math.cos(γ) + 0.070257 * Math.sin(γ)
    - 0.006758 * Math.cos(2 * γ) + 0.000907 * Math.sin(2 * γ)
    - 0.002697 * Math.cos(3 * γ) + 0.00148 * Math.sin(3 * γ);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  const solarNoon = start + (720 - 4 * lon - eqtime) * 60000;
  if (cosH > 1) return { sunrise: NaN, sunset: NaN };
  if (cosH < -1) return { sunrise: NaN, sunset: NaN };
  const H = Math.acos(cosH) / rad;
  return { sunrise: solarNoon - 4 * H * 60000, sunset: solarNoon + 4 * H * 60000 };
}

function isoTimeUtc(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:00`;
}
function naiveIsoLocal(ms) {
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------------- GEFS run 发现 ---------------- */

GEFS.discoverRuns = async function () {
  const now = Date.now();
  const cands = [];
  for (const dayOff of [0, 1, 2]) {
    for (const hh of [18, 12, 6, 0]) {
      const d = new Date(now - dayOff * 86400e3);
      d.setUTCHours(hh, 0, 0, 0);
      cands.push(d);
    }
  }
  cands.sort((a, b) => b - a);
  const found = [];
  const needPast = now - 24 * 3600e3;
  for (const d of cands) {
    if (d.getTime() > now) continue;
    const hh2 = String(d.getUTCHours()).padStart(2, '0');
    const key = `${utcStr(d)}/${hh2}`;
    const url = `${S3GEFS}/gefs.${key}/atmos/pgrb2ap5/gec00.t${hh2}z.pgrb2a.0p50.f003.idx`;
    try {
      const buf = await fetchBuf(url, 2);
      if (buf.length > 100 && !buf.subarray(0, 5).toString().includes('<')) found.push({ key, init: d.getTime() });
    } catch { /* 不存在 */ }
    if (found.length && found[found.length - 1].init <= needPast) break;
  }
  if (!found.length) throw new Error('未找到可用的 GEFS run');
  return found;
};
GEFS.steps = () => {
  const arr = [];
  for (let s = GEFS.stepH; s <= GEFS.maxF; s += GEFS.stepH) arr.push(s);
  return arr;
};
// GEFS f000 分析场缺失,时间窗起点由上一 run 补齐(与 GFS 管道一致)

/* ---------------- ECMWF run 发现与步长 ---------------- */

ECMWF.discoverRuns = async function () {
  const now = Date.now();
  const cands = [];
  for (const dayOff of [0, 1, 2, 3]) {
    for (const hh of [18, 12, 6, 0]) {
      const d = new Date(now - dayOff * 86400e3);
      d.setUTCHours(hh, 0, 0, 0);
      cands.push(d);
    }
  }
  cands.sort((a, b) => b - a);
  const found = [];
  const needPast = now - 24 * 3600e3;
  for (const d of cands) {
    if (d.getTime() > now) continue;
    const hh2 = String(d.getUTCHours()).padStart(2, '0');
    const dateStr = utcStr(d);
    // 列举该 run 的 0p25 oper 目录,确认已发布
    try {
      const listXml = await fetchBuf(`${S3ECMWF}/?list-type=2&prefix=${dateStr}/${hh2}z/ifs/0p25/oper/&max-keys=3`, 4, {}, 1500);
      const xml = listXml.toString('utf8');
      if (xml.includes('<Key>')) found.push({ key: `${dateStr}/${hh2}`, init: d.getTime() });
    } catch { /* 不存在或限流 */ }
    if (found.length && found[found.length - 1].init <= needPast) break;
  }
  if (!found.length) throw new Error('未找到可用的 ECMWF Open Data run');
  return found;
};
ECMWF.steps = (R) => {
  // 00z/12z:3 小时步长到 +144h 后 6 小时;06z/18z:仅 6 小时步长到 +90h
  const hh = R.key.split('/')[1];
  const arr = [0];
  if (hh === '06' || hh === '18') {
    for (let s = 6; s <= 90; s += 6) arr.push(s);
  } else {
    for (let s = 3; s <= 144; s += 3) arr.push(s);
    for (let s = 150; s <= ECMWF.maxF; s += 6) arr.push(s);
  }
  return arr;
};

/* AIFS:ECMWF 机器学习模式(6 小时步长) */
const AIFS = ecmwfLike('aifs_raw', 'ECMWF AIFS 0.25°(AI 模式,ECMWF Open Data)', 'aifs-single/0p25/oper', 2);
AIFS.varCfg = ECMWF_VARS;
AIFS.discoverRuns = async function () {
  // 借用 IFS listing 做可用性探测,但 AIFS 只发布 00/12Z:
  // 06/18Z 的 AIFS 数据在 S3 上不存在,当选中 R/P 时必然整帧 404
  const runs = (await ECMWF.discoverRuns()).filter((r) => /\/(00|12)$/.test(r.key));
  if (!runs.length) throw new Error('未找到可用的 AIFS Open Data run(00/12Z)');
  return runs;
};
AIFS.steps = () => {
  const arr = [0];
  for (let s = 6; s <= AIFS.maxF; s += 6) arr.push(s); // AIFS 原生 6 小时步长
  return arr;
};

const ENGINES = {
  gefs_raw: new ModelEngine(GEFS),
  ecmwf_raw: new ModelEngine(ECMWF),
  aifs_raw: new ModelEngine(AIFS),
};

function status() {
  return Object.fromEntries(Object.entries(ENGINES).map(([k, e]) => [k, e.status()]));
}

/* 导出内部组件:waves.js 等衍生引擎在同一框架上构建 */
module.exports = {
  ENGINES, status, rhFromDewpoint,
  ModelEngine, fetchBuf, normalizeGrid, StepStore, makeSampler,
  parseGfsStyleIdx, utcStr, ecmwfLike, S3ECMWF, gefsMemberEngine,
};
