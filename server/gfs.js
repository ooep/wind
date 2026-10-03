/*
 * NOAA GFS 原始数据管道(自建,无 key、无配额)
 *
 * 数据源:AWS 开放数据桶 noaa-gfs-bdp-pds(NOAA 官方发布)
 * 结构:地面引擎(21 变量:风/温/湿/气压/降水/云量三层/阵风/能见度/雪深/CAPE/可降水/云水/
 *       土壤湿温/冻结高度/CIN/新雪)
 *       + 气压层引擎(9 层 925–100 hPa 的风/温/湿,按需摄取,时间轴与地面一致)
 * 流程:run 发现 → 索引定位 → Range 下载 → 自研 GRIB2 解码 → 单位换算
 *   → Int16 存储(内存 LRU + 磁盘捆包)→ 格点 / 点位采样接口。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { findMessages, decodeMessage } = require('./grib2');
const { lclHeight, fineFuelMoisture, cumMaxFrames, thunderIndex } = require('./derive');

const S3 = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com';
const RES = '0p50';
const CACHE_DIR = path.join(__dirname, '..', '.cache', 'gfsraw');
const MAX_F = 168;            // 取到 +168h(7 天)
const HOURLY_H = 48;          // 逐小时步长上限(GFS pgrb2 原生逐小时,此处取 48h 平衡体量)
const STEP_H = 3;             // 逐小时段之外的存储步长
const stepCadence = (step) => (step <= HOURLY_H ? 1 : STEP_H);
function buildSteps() {
  /* 地面与气压层共用同一时间轴:静态包的层级文件按 meta.times 逐帧对齐取数,
   * 时间轴一旦分叉,层级数据会错位、尾部越界为空 */
  const a = [];
  for (let s = 0; s <= HOURLY_H; s++) a.push(s);
  for (let s = HOURLY_H + STEP_H; s <= MAX_F; s += STEP_H) a.push(s);
  return a;
}
const CONCURRENCY = 10;
const PAST_H = 24;            // 时间轴向过去延伸的小时数(由上一个 run 补齐)
const NJ = 361, NI = 720;     // 0.5° 全球网格 90..-90 / 0..359.5
const SENTINEL = -32768;

/* 地面变量:idx 匹配 + 单位换算 + Int16 量化 */
const VARS = {
  u: { grib: 'UGRD', level: '10 m above ground', scale: 100, conv: (v) => v },
  v: { grib: 'VGRD', level: '10 m above ground', scale: 100, conv: (v) => v },
  temp: { grib: 'TMP', level: '2 m above ground', scale: 100, conv: (v) => v - 273.15 },
  rh: { grib: 'RH', level: '2 m above ground', scale: 100, conv: (v) => v },
  msl: { grib: 'PRMSL', level: 'mean sea level', scale: 10, conv: (v) => v / 100 },
  precip: { grib: 'PRATE', level: 'surface', scale: 100, conv: (v) => v * 3600 },
  cloud: { grib: 'TCDC', level: 'entire atmosphere', scale: 100, conv: (v) => v },
  gust: { grib: 'GUST', level: 'surface', scale: 100, conv: (v) => v },
  vis: { grib: 'VIS', level: 'surface', scale: 10, conv: (v) => v / 1000 },   // m → km
  snowd: { grib: 'SNOD', level: 'surface', scale: 100, conv: (v) => v * 100 }, // m → cm
  cape: { grib: 'CAPE', level: 'surface', scale: 1, conv: (v) => v },          // J/kg
  pwat: { grib: 'PWAT', level: 'entire atmosphere (considered as a single layer)', scale: 10, conv: (v) => v },    // kg/m² ≡ mm
  cwat: { grib: 'CWAT', level: 'entire atmosphere (considered as a single layer)', scale: 100, conv: (v) => v },   // kg/m² ≡ mm
  lcdc: { grib: 'LCDC', level: 'low cloud layer', scale: 100, conv: (v) => v },
  mcdc: { grib: 'MCDC', level: 'middle cloud layer', scale: 100, conv: (v) => v },
  hcdc: { grib: 'HCDC', level: 'high cloud layer', scale: 100, conv: (v) => v },
  soilw: { grib: 'SOILW', level: '0-0.1 m below ground', scale: 10000, conv: (v) => v },     // 体积含水率 m³/m³(0-1)
  soilt: { grib: 'TSOIL', level: '0-0.1 m below ground', scale: 100, conv: (v) => v - 273.15 },
  frzlvl: { grib: 'HGT', level: '0C isotherm', scale: 1, conv: (v) => v },                   // 0°C 层高度 m
  cin: { grib: 'CIN', level: 'surface', scale: 1, conv: (v) => v },                          // 对流抑制 J/kg(负值)
  newsnow: { grib: 'WEASD', level: 'surface', scale: 10, conv: (v) => v },                   // 新雪:WEASD 差分 ×10(1mm 水 ≈ 1cm 雪),见 ingestOne
};

/* X 变量:辐射/边界层/热通量。独立引擎目录(不与主 VARS 同捆包)——
 * 捆包布局变更会使整个 .done 缓存失效触发全量重摄,拆开只影响新变量自身。
 * DSWRF/SHTFL/LHTFL 是时段平均场(idx 为 "N-M hour ave"),需 ave 匹配。 */
const VARS_X = {
  dswrf: { grib: 'DSWRF', level: 'surface', scale: 1, conv: (v) => v, ave: true },           // 下行短波辐射 W/m²(时段平均)
  hpbl: { grib: 'HPBL', level: 'surface', scale: 1, conv: (v) => v },                        // 边界层厚度 m(瞬时,热气流顶估算)
  shtfl: { grib: 'SHTFL', level: 'surface', scale: 1, conv: (v) => v, ave: true },           // 感热通量 W/m²(向上为正)
  lhtfl: { grib: 'LHTFL', level: 'surface', scale: 1, conv: (v) => v, ave: true },           // 潜热通量 W/m²(向上为正)
};

/* 100 米高度风(GFS pgrb2 原生 "100 m above ground" 层):风电/滑翔/风筝等高度层需求。
 * 独立引擎目录(捆包布局变更会使 .done 全作废,新变量一律拆目录)。 */
const VARS_W100 = {
  u100: { grib: 'UGRD', level: '100 m above ground', scale: 100, conv: (v) => v },
  v100: { grib: 'VGRD', level: '100 m above ground', scale: 100, conv: (v) => v },
};

/* 气压层变量(按需摄取):该层的风/温/湿 + 位势高度 */
const LEVELS = [925, 850, 700, 500, 300, 250, 200, 150, 100, 70, 10]; // 平流层延伸至 10 hPa(nullschool 同款深度)
function levelVars(level) {
  const cfg = {
    u: { grib: 'UGRD', level: `${level} mb`, scale: 100, conv: (v) => v },
    v: { grib: 'VGRD', level: `${level} mb`, scale: 100, conv: (v) => v },
    temp: { grib: 'TMP', level: `${level} mb`, scale: 100, conv: (v) => v - 273.15 },
    h: { grib: 'HGT', level: `${level} mb`, scale: 1, conv: (v) => v },
  };
  if (level >= 100) cfg.rh = { grib: 'RH', level: `${level} mb`, scale: 100, conv: (v) => v }; // GFS 湿度仅到 100 hPa
  return cfg;
}

/* ---------------- HTTP 基础 ---------------- */

async function fetchBuf(url, retries = 5, headers = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await new Promise((s) => setTimeout(s, Math.min(800 * (i + 1) * (i + 1), 10_000)));
    }
  }
  throw lastErr;
}

/* ---------------- run 发现 ---------------- */

function utcStr(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

let runsMemo = null, runsMemoAt = 0;
async function discoverRuns() {
  /* 10 分钟内共享发现结果:同一烘焙进程里地面 + 9 个气压层引擎必须落在同一
   * run 组合上,否则层级与地面时间轴分叉(顺带省掉重复的 idx 探测) */
  if (runsMemo && Date.now() - runsMemoAt < 10 * 60e3) return runsMemo;
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
  const needPast = now - PAST_H * 3600e3;
  for (const d of cands) {
    if (d.getTime() > now) continue;
    const hh2 = String(d.getUTCHours()).padStart(2, '0');
    const key = `${utcStr(d)}/${hh2}`;
    const url = `${S3}/gfs.${key}/atmos/gfs.t${hh2}z.pgrb2.${RES}.f000.idx`;
    try {
      const buf = await fetchBuf(url, 2);
      if (buf.length > 100 && !buf.subarray(0, 5).toString().includes('<')) found.push({ key, init: d.getTime() });
    } catch { /* 不存在,试下一个 */ }
    if (found.length && found[found.length - 1].init <= needPast) break;
  }
  if (!found.length) throw new Error('未找到任何可用的 GFS run(NOAA 数据源不可达?)');
  runsMemo = found; runsMemoAt = Date.now();
  return found;
}

/* ---------------- 索引解析 ---------------- */

function parseIdx(buf) {
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
      timeSpec: f.slice(di + 3).join(':'),
    });
  }
  recs.sort((a, b) => a.start - b.start);
  for (let i = 0; i < recs.length; i++) {
    recs[i].end = i + 1 < recs.length ? recs[i + 1].start : recs[i].start + 8 * 1024 * 1024;
  }
  return recs;
}

function pickMessage(recs, varCfg) {
  for (const r of recs) {
    if (r.var !== varCfg.grib || r.level !== varCfg.level) continue;
    const ts = r.timeSpec;
    if (varCfg.ave) { if (/ave/.test(ts)) return r; continue; } // 辐射/热通量等时段平均场
    if (/ave|acc/.test(ts)) continue; // 只要瞬时场
    return r;
  }
  return null;
}

const idxCache = new Map();
async function getIdx(url) {
  if (idxCache.has(url)) return idxCache.get(url);
  const recs = parseIdx(await fetchBuf(url));
  idxCache.set(url, recs);
  return recs;
}

async function fetchMessage(url, recs, rec) {
  const buf = await fetchBuf(url, 3, { Range: `bytes=${rec.start}-${rec.end - 1}` });
  const total = Number(buf.readBigUInt64BE(8));
  const msgs = findMessages(total <= buf.length ? buf : buf.subarray(0, total));
  if (!msgs.length) throw new Error('Range 内未找到 GRIB 消息');
  return decodeMessage(msgs[0]);
}

/* ---------------- 引擎(地面 / 气压层通用) ---------------- */

class GfsEngine {
  constructor({ varCfg, dirName, levelMode = false }) {
    this.varCfg = varCfg;
    this.varKeys = Object.keys(varCfg);
    this.levelMode = levelMode; // 气压层引擎:粗步长摄取(控量)
    this.dir = path.join(CACHE_DIR, dirName);
    this.run = null;
    this.loadingPromise = null;
    this.mem = new Map();
    this.memOrder = [];
  }

  stepFile(runKey, step) { return path.join(this.dir, runKey.replace('/', '-'), `m${String(step).padStart(3, '0')}.bin`); }
  doneFile(runKey, step) { return path.join(this.dir, runKey.replace('/', '-'), `m${String(step).padStart(3, '0')}.done`); }
  doneVars(runKey, step) {
    // 捆包尺寸必须与当前变量布局一致,否则 .done 是旧布局的残留(变量集变更后失效)
    try {
      const sz = fs.statSync(this.stepFile(runKey, step)).size;
      if (sz !== this.varKeys.length * NJ * NI * 2) return new Set();
    } catch { return new Set(); }
    try { return new Set(JSON.parse(fs.readFileSync(this.doneFile(runKey, step), 'utf8'))); } catch { return new Set(); }
  }

  normalizeToInt16(msg, varKey) {
    const { grid, values } = msg;
    const cfg = this.varCfg[varKey];
    if (grid.ni !== NI || grid.nj !== NJ) throw new Error(`网格尺寸异常 ${grid.ni}x${grid.nj}`);
    const out = new Int16Array(NJ * NI);
    const flipped = grid.la1 < grid.la2;
    for (let j = 0; j < NJ; j++) {
      const srcRow = flipped ? (NJ - 1 - j) : j;
      for (let i = 0; i < NI; i++) {
        const v = cfg.conv(values[srcRow * NI + i]);
        if (Number.isNaN(v)) { out[j * NI + i] = SENTINEL; continue; }
        out[j * NI + i] = Math.max(-32767, Math.min(32767, Math.round(v * cfg.scale)));
      }
    }
    return out;
  }

  _writeLocks = new Map();
  /* 同一步骤的并发写串行化,避免读-改-写竞争丢块 */
  writeVar(runKey, step, varKey, arr) {
    const key = `${runKey}|${step}`;
    const prev = this._writeLocks.get(key) || Promise.resolve();
    const task = prev.then(() => {
      const dir = path.join(this.dir, runKey.replace('/', '-'));
      fs.mkdirSync(dir, { recursive: true });
      const file = this.stepFile(runKey, step);
      let bundle = null;
      try {
        const b = fs.readFileSync(file);
        if (b.length === this.varKeys.length * NJ * NI * 2) {
          bundle = new Int16Array(b.buffer, b.byteOffset, b.length / 2).slice();
        }
      } catch { /* 新文件 */ }
      if (!bundle) bundle = new Int16Array(this.varKeys.length * NJ * NI).fill(SENTINEL);
      bundle.set(arr, this.varKeys.indexOf(varKey) * NJ * NI);
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
      const b = fs.readFileSync(this.stepFile(runKey, step));
      if (b.length !== this.varKeys.length * NJ * NI * 2) return null;
      const all = new Int16Array(b.buffer, b.byteOffset, b.length / 2);
      entry = { _t: Date.now() };
      this.varKeys.forEach((vk, i) => {
        entry[vk] = all.subarray(i * NJ * NI, (i + 1) * NJ * NI);
      });
    } catch {
      return null;
    }
    this.mem.set(key, entry);
    this.memOrder.push(key);
    while (this.memOrder.length > 70) {
      const old = this.memOrder.shift();
      if (old !== key) this.mem.delete(old);
    }
    return entry;
  }

  prune(protect = []) {
    /* 保留最新的 2 个 run + 当前摄取计划引用的 run(历史时间窗的 P run 字典序更小,
     * 若不显式保护会被当作旧目录删掉,导致静态包历史帧全为空) */
    const keep = new Set(protect);
    let dirs = [];
    try { dirs = fs.readdirSync(this.dir).filter((d) => /^\d{8}-\d{2}$/.test(d)); } catch { return; }
    dirs.sort().reverse();
    const kept = [];
    for (const d of dirs) {
      if (kept.length < 2 || keep.has(d)) kept.push(d);
    }
    for (const d of dirs) {
      if (!kept.includes(d)) fs.rmSync(path.join(this.dir, d), { recursive: true, force: true });
    }
  }

  buildRunPlan(runs) {
    const R = runs[0];
    let P = null;
    for (const c of runs.slice(1)) {
      if (c.init <= Date.now() - PAST_H * 3600e3) { P = c; break; }
    }
    const times = [];
    const pastStart = Date.now() - PAST_H * 3600e3;
    const steps = buildSteps();
    if (P) {
      for (const step of steps) {
        const ms = P.init + step * 3600e3;
        if (ms < pastStart || ms >= R.init) continue;
        times.push({ runKey: P.key, step, ms });
      }
    }
    for (const step of steps) {
      times.push({ runKey: R.key, step, ms: R.init + step * 3600e3 });
    }
    return { R, P, times };
  }

  async ensureLoaded() {
    if (this.run && this.run.loaded) {
      // 每 30 分钟重新发现一次:NOAA 发布新时次后自动切换
      if (Date.now() - (this.run.checkedAt || 0) < 30 * 60e3) return this.run;
      try {
        const runs = await discoverRuns();
        const sameR = runs[0].key === this.run.key;
        const sameP = (runs[1] ? runs[1].key : null) === this.run.prevKey;
        if (sameR && sameP) { this.run.checkedAt = Date.now(); return this.run; }
        console.log(`  [GFS${this.dirSuffix()}] 发现新 run ${runs[0].key},自动切换摄取`);
        this.run = null;
      } catch { return this.run; }
    }
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      const runs = await discoverRuns();
      const plan = this.buildRunPlan(runs);
      const runInfo = {
        key: plan.R.key, init: plan.R.init,
        prevKey: plan.P ? plan.P.key : null,
        times: plan.times, loaded: false,
      };
      const tasks = [];
      for (const t of plan.times) {
        const done = this.doneVars(t.runKey, t.step);
        for (const varKey of this.varKeys) {
          if (done.has(varKey)) continue;
          tasks.push({ ...t, varKey });
        }
      }
      let done = 0, cursor = 0;
      const failed = [];
      const worker = async () => {
        while (cursor < tasks.length) {
          const task = tasks[cursor++];
          try {
            await this.ingestOne(task);
          } catch (e) {
            failed.push(`${task.runKey} f${task.step} ${task.varKey}: ${e.message}`);
          }
          done++;
          if (done % 24 === 0) console.log(`  [GFS${this.dirSuffix()}] 摄取进度 ${done}/${tasks.length}`);
        }
      };
      if (tasks.length) {
        console.log(`  [GFS${this.dirSuffix()}] 开始摄取 run ${plan.R.key},共 ${tasks.length} 条消息`);
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
        if (failed.length) console.error(`  [GFS${this.dirSuffix()}] ${failed.length} 条消息失败(将显示为空):`, failed.slice(0, 3));
      }
      this.run = runInfo;
      runInfo.loaded = true;
      runInfo.checkedAt = Date.now();
      this.prune([plan.R.key.replace('/', '-'), plan.P ? plan.P.key.replace('/', '-') : null].filter(Boolean));
      return runInfo;
    })();

    try {
      return await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  dirSuffix() { return path.basename(this.dir) === 'gfsraw' ? '' : ' 气压层'; }

  async ingestOne(task) {
    const { runKey, step, varKey } = task;
    const hh = runKey.split('/')[1];
    const fileTag = `f${String(step).padStart(3, '0')}`;
    const url = `${S3}/gfs.${runKey}/atmos/gfs.t${hh}z.pgrb2.${RES}.${fileTag}`;

    /* 新雪:WEASD 为地面积雪水当量(瞬时场),相邻时次正向差分 × 10 → 每 3h 新增积雪 cm */
    if (varKey === 'newsnow') {
      if (step === 0) {
        this.writeVar(runKey, step, varKey, new Int16Array(NJ * NI));
        return;
      }
      const prevTag = `f${String(step - stepCadence(step)).padStart(3, '0')}`;
      const prevUrl = `${S3}/gfs.${runKey}/atmos/gfs.t${hh}z.pgrb2.${RES}.${prevTag}`;
      const cfgW = this.varCfg.newsnow;
      const [recNow, recPrev] = await Promise.all([
        getIdx(`${url}.idx`).then((recs) => pickMessage(recs, cfgW)),
        getIdx(`${prevUrl}.idx`).then((recs) => pickMessage(recs, cfgW)),
      ]);
      if (!recNow || !recPrev) throw new Error(`idx 中未找到 newsnow(WEASD)@f${step}`);
      const [msgNow, msgPrev] = await Promise.all([
        fetchMessage(url, null, recNow),
        fetchMessage(prevUrl, null, recPrev),
      ]);
      const out = new Int16Array(NJ * NI);
      const vNow = msgNow.values, vPrev = msgPrev.values;
      for (let i = 0; i < vNow.length; i++) {
        const d = cfgW.conv((vNow[i] - vPrev[i]) * 10); // mm 水 → cm 雪
        out[i] = Number.isNaN(d) ? SENTINEL : Math.max(0, Math.min(32767, Math.round(d * cfgW.scale)));
      }
      this.writeVar(runKey, step, varKey, out);
      return;
    }

    const recs = await getIdx(`${url}.idx`);
    const cfg = this.varCfg[varKey];
    const rec = pickMessage(recs, cfg);
    if (!rec) {
      // 分析场个别场缺失时的兜底
      if (step === 0 && (varKey === 'precip' || varKey === 'gust')) {
        this.writeVar(runKey, step, varKey, new Int16Array(NJ * NI).fill(varKey === 'precip' ? 0 : SENTINEL));
        return;
      }
      // 平均量在 f000 无 preceding 窗口(如 DSWRF "0-0 hour" 不存在):分析时刻按 0 通量兜底
      if (step === 0 && this.varCfg[varKey] && this.varCfg[varKey].ave) {
        this.writeVar(runKey, step, varKey, new Int16Array(NJ * NI));
        return;
      }
      throw new Error(`idx 中未找到 ${varKey}(${cfg.grib})`);
    }
    const msg = await fetchMessage(url, recs, rec);
    this.writeVar(runKey, step, varKey, this.normalizeToInt16(msg, varKey));
  }

  sample(entry, varKey, lat, lon) {
    const arr = entry[varKey];
    if (!arr) return NaN;
    const cfg = this.varCfg[varKey];
    let x = (((lon % 360) + 360) % 360) / 0.5;
    const y = (90 - lat) / 0.5;
    x = ((x % NI) + NI) % NI;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = (x0 + 1) % NI, y1 = Math.min(y0 + 1, NJ - 1);
    if (y0 < 0 || y0 >= NJ) return NaN;
    const tx = x - x0, ty = y - y0;
    const a = arr[y0 * NI + x0], b = arr[y0 * NI + x1], c = arr[y1 * NI + x0], d = arr[y1 * NI + x1];
    const s = cfg.scale;
    const top = ((a === SENTINEL || b === SENTINEL) ? NaN : (a + (b - a) * tx) / s);
    const bot = ((c === SENTINEL || d === SENTINEL) ? NaN : (c + (d - c) * tx) / s);
    if (Number.isNaN(top)) return NaN;
    if (Number.isNaN(bot)) return top;
    return top + (bot - top) * ty;
  }

  sampleAll(runKey, step, lat, lon) {
    const entry = this.loadStep(runKey, step);
    if (!entry) return null;
    const out = {};
    for (const vk of this.varKeys) out[vk] = this.sample(entry, vk, lat, lon);
    return out;
  }

  /* 采样整个视场 → { times, lats, lons, vars } */
  /* 采样整个视场 → { times, lats, lons, vars }。varFilter 可只采样部分变量
   * (gfs_snow 高分辨烘焙用:0.5° × 全变量会超内存,只取雪变量) */
  async gridCore(w, s, e, n, stepDeg, varFilter) {
    const run = await this.ensureLoaded();
    const times = run.times;
    const stepOut = stepDeg;
    const wrapLon = (e - w) >= 360 - 1e-6;
    const lonCount = wrapLon ? Math.round(360 / stepOut) : Math.round((e - w) / stepOut) + 1;
    const rows = Math.round((n - s) / stepOut) + 1;
    const lons = [];
    for (let i = 0; i < lonCount; i++) lons.push(Number((w + i * stepOut).toFixed(3)));
    const lats = [];
    for (let j = 0; j < rows; j++) lats.push(Number((n - j * stepOut).toFixed(3)));
    const nP = lons.length * lats.length;
    const vks = varFilter ? this.varKeys.filter((k) => varFilter.includes(k)) : this.varKeys;
    const src = {};
    for (const vk of vks) src[vk] = new Float32Array(times.length * nP).fill(NaN);

    /* t 外层循环:每个步长的捆包整场只加载一次;若 t 内层,全球网格的
     * 步长数会超出 mem 上限,逐列反复回读磁盘 */
    for (let t = 0; t < times.length; t++) {
      const tt = times[t];
      let p = 0;
      for (const lat of lats) {
        for (const lon of lons) {
          const s2 = this.sampleAll(tt.runKey, tt.step, lat, lon);
          if (s2) for (const vk of vks) src[vk][t * nP + p] = s2[vk];
          p++;
        }
      }
    }
    const f32b64 = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
    return {
      times: times.map((t) => isoTime(t.ms)),
      lats, lons,
      vars: Object.fromEntries(vks.map((vk) => [vk, f32b64(src[vk])])),
    };
  }
}

const surface = new GfsEngine({ varCfg: VARS, dirName: 'gfsraw' });
const surfaceX = new GfsEngine({ varCfg: VARS_X, dirName: 'gfsraw-x' });
const wind100 = new GfsEngine({ varCfg: VARS_W100, dirName: 'gfsraw-w100' });
const levelEngines = new Map();
function levelEngine(level) {
  if (!LEVELS.includes(level)) throw new Error(`不支持的气压层 ${level}`);
  if (!levelEngines.has(level)) {
    levelEngines.set(level, new GfsEngine({ varCfg: levelVars(level), dirName: `gfsraw-l${level}`, levelMode: true }));
  }
  return levelEngines.get(level);
}

function isoTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:00`;
}

/* 派生地面量(只用主引擎变量,live 与静态烘焙同源):云底 LCL / 可燃物含水率 /
 * 过程最大阵风(运行最大)。必须在层级变量合并前调用(2m 温湿不受层级覆盖)。 */
function deriveSurfaceGrids(vars, nT, nP) {
  const f32 = (k) => {
    if (!vars[k]) return null;
    const b = Buffer.from(vars[k], 'base64');
    return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  };
  const enc = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
  const T = f32('temp'), R = f32('rh'), PR = f32('precip'), G = f32('gust'), CA = f32('cape');
  if (T && R) {
    const base = new Float32Array(nT * nP), fuel = new Float32Array(nT * nP);
    for (let i = 0; i < base.length; i++) {
      base[i] = lclHeight(T[i], R[i]);
      fuel[i] = fineFuelMoisture(T[i], R[i], PR ? PR[i] : NaN);
    }
    vars.cloudbase = enc(base);
    vars.ffmc = enc(fuel);
  }
  if (G) vars.gustmax = enc(cumMaxFrames(G, nT, nP));
  if (PR && CA) {
    const th = new Float32Array(nT * nP);
    for (let i = 0; i < th.length; i++) th[i] = thunderIndex(PR[i], CA[i]);
    vars.thunder = enc(th);
  }
}

/* ---------------- 对外:格点(地面 / 气压层合并) ---------------- */

async function rawGrid(w, s, e, n, stepDeg, level = 0) {
  const base = await surface.gridCore(w, s, e, n, stepDeg);
  const vars = { ...base.vars };
  deriveSurfaceGrids(vars, base.times.length, base.lons.length * base.lats.length);
  /* X 变量(辐射/边界层):独立引擎,失败或时间轴不齐时跳过、不株连主包 */
  try {
    const xg = await surfaceX.gridCore(w, s, e, n, stepDeg);
    if (xg.times.length === base.times.length && xg.times[0] === base.times[0]) {
      Object.assign(vars, xg.vars);
    } else {
      console.warn(`  [GFS] X 引擎时间轴与地面不一致(${xg.times.length} vs ${base.times.length} 帧),跳过`);
    }
  } catch (e) {
    console.warn(`  [GFS] X 引擎不可用,跳过辐射/边界层变量: ${e.message}`);
  }
  /* 100 米风:独立引擎,容错同上 */
  try {
    const w100 = await wind100.gridCore(w, s, e, n, stepDeg);
    if (w100.times.length === base.times.length && w100.times[0] === base.times[0]) {
      Object.assign(vars, w100.vars);
    } else {
      console.warn(`  [GFS] 100m 风引擎时间轴与地面不一致(${w100.times.length} vs ${base.times.length} 帧),跳过`);
    }
  } catch (e) {
    console.warn(`  [GFS] 100m 风引擎不可用,跳过: ${e.message}`);
  }
  if (level > 0) {
    const lev = await levelEngine(level).gridCore(w, s, e, n, stepDeg);
    for (const vk of ['u', 'v', 'temp', 'rh', 'h']) vars[vk] = lev.vars[vk];
  }
  return {
    model: 'gfs_raw',
    source: 'NOAA GFS 0.5°(AWS 开放数据,原始解码)' + (level > 0 ? ` · ${level} hPa 气压层` : ''),
    step: stepDeg,
    wrapLon: (e - w) >= 360 - 1e-6,
    cols: base.lons.length, rows: base.lats.length, points: base.lons.length * base.lats.length,
    times: base.times,
    lat0: base.lats[0], lat1: base.lats[base.lats.length - 1],
    lon0: base.lons[0], lon1: base.lons[base.lons.length - 1],
    lats: base.lats, lons: base.lons,
    generated: Math.floor(Date.now() / 1000),
    vars,
  };
}

/* ---------------- 点预报(自算,地面) ---------------- */

function apparentTemp(tC, rh, ws) {
  const e = (rh / 100) * 6.105 * Math.exp(17.27 * tC / (tC + 243.5));
  return tC + 0.33 * e - 0.70 * ws - 4.00;
}

function weatherCode(prate, tC, cloud) {
  if (Number.isNaN(prate)) prate = 0;
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
  if (cosH > 1 || cosH < -1) return { sunrise: NaN, sunset: NaN };
  const H = Math.acos(cosH) / rad;
  return { sunrise: solarNoon - 4 * H * 60000, sunset: solarNoon + 4 * H * 60000 };
}

function naiveIso(ms) {
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function rawPoint(lat, lon) {
  const run = await surface.ensureLoaded();
  const times = run.times;

  const series = [];
  const NULLS = { temp: NaN, rh: NaN, precip: NaN, cloud: NaN, msl: NaN, u: NaN, v: NaN, gust: NaN };
  for (const t of times) {
    const s2 = surface.sampleAll(t.runKey, t.step, lat, lon) || NULLS;
    series.push({
      ms: t.ms,
      temp: s2.temp, rh: s2.rh, precip: s2.precip, cloud: s2.cloud,
      msl: s2.msl, u: s2.u, v: s2.v, gust: s2.gust,
    });
  }
  const spd = (x) => Number.isNaN(x?.u) || Number.isNaN(x?.v) ? NaN : Math.hypot(x.u, x.v);
  const dirOf = (x) => Number.isNaN(x?.u) || Number.isNaN(x?.v) ? NaN : (Math.round(((Math.atan2(-x.u, -x.v) * 180) / Math.PI + 360) % 360));

  const now = Date.now();
  let cur = series[0];
  for (const s2 of series) { if (s2.ms <= now + 1800e3) cur = s2; else break; }
  const curSpd = spd(cur);
  const curDir = dirOf(cur);

  const hourly = {
    time: series.map((x) => naiveIso(x.ms)),
    temperature_2m: series.map((x) => +x.temp.toFixed(1)),
    apparent_temperature: series.map((x) => +apparentTemp(x.temp, x.rh, spd(x)).toFixed(1)),
    precipitation: series.map((x) => +(Math.max(0, x.precip) * 3).toFixed(2)),
    precipitation_probability: series.map(() => null),
    weather_code: series.map((x) => weatherCode(x.precip, x.temp, x.cloud)),
    relative_humidity_2m: series.map((x) => Math.round(x.rh)),
    wind_speed_10m: series.map((x) => +spd(x).toFixed(1)),
    wind_direction_10m: series.map((x) => dirOf(x)),
    wind_gusts_10m: series.map((x) => +x.gust.toFixed(1)),
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
    daily.time.push(naiveIso(dayStart).slice(0, 10));
    if (!inDay.length) {
      daily.weather_code.push(null); daily.temperature_2m_max.push(null); daily.temperature_2m_min.push(null);
      daily.precipitation_sum.push(null); daily.precipitation_probability_max.push(null);
      daily.wind_speed_10m_max.push(null); daily.sunrise.push(null); daily.sunset.push(null);
      continue;
    }
    const temps = inDay.map((x) => x.temp);
    const midIdx = inDay[Math.floor(inDay.length / 2)];
    daily.weather_code.push(weatherCode(Math.max(...inDay.map((x) => x.precip || 0)), midIdx.temp, Math.max(...inDay.map((x) => x.cloud || 0))));
    daily.temperature_2m_max.push(+Math.max(...temps).toFixed(1));
    daily.temperature_2m_min.push(+Math.min(...temps).toFixed(1));
    daily.precipitation_sum.push(+inDay.reduce((a, x) => a + Math.max(0, x.precip || 0) * 3, 0).toFixed(1));
    daily.precipitation_probability_max.push(null);
    daily.wind_speed_10m_max.push(+Math.max(...inDay.map((x) => spd(x) || 0)).toFixed(1));
    const st = sunTimes(dayStart, lat, lon);
    daily.sunrise.push(naiveIso(st.sunrise));
    daily.sunset.push(naiveIso(st.sunset));
  }

  return {
    source: 'NOAA GFS 0.5°(AWS 开放数据,原始解码,自算点预报)',
    current: {
      temperature_2m: +cur.temp.toFixed(1),
      relative_humidity_2m: Math.round(cur.rh),
      apparent_temperature: +apparentTemp(cur.temp, cur.rh, curSpd).toFixed(1),
      is_day: (() => { const st = sunTimes(now - 12 * 3600e3, lat, lon); const t = now; return (!Number.isNaN(st.sunrise) && t >= st.sunrise && t <= st.sunset) ? 1 : 0; })(),
      precipitation: Math.max(0, +(cur.precip).toFixed(2)),
      weather_code: weatherCode(cur.precip, cur.temp, cur.cloud),
      cloud_cover: Math.round(cur.cloud),
      pressure_msl: Math.round(cur.msl),
      wind_speed_10m: +curSpd.toFixed(1),
      wind_direction_10m: curDir,
      wind_gusts_10m: +cur.gust.toFixed(1),
    },
    hourly, daily,
  };
}

function status() {
  const levels = {};
  for (const [lv, eng] of levelEngines) {
    levels[lv] = { run: eng.run ? eng.run.key : null, loaded: !!(eng.run && eng.run.loaded) };
  }
  return {
    run: surface.run ? { key: surface.run.key, init: surface.run.init, loaded: surface.run.loaded, prev: surface.run.prevKey, steps: surface.run.times.length } : null,
    loading: !!surface.loadingPromise,
    memSteps: surface.mem.size,
    levels,
  };
}

/* 气压层全球粗网格(静态构建用):该层的 u/v/temp/rh + 位势高度 h */
async function levelRawGrid(level, w, s, e, n, stepDeg) {
  const lev = await levelEngine(level).gridCore(w, s, e, n, stepDeg);
  const out = { ...lev, vars: Object.fromEntries(Object.entries(lev.vars).filter(([k]) => ['u', 'v', 'temp', 'rh', 'h'].includes(k))) };
  lev.mem.clear(); lev.memOrder.length = 0; // 烘焙串行跑 9 层,采样完及时释放内存
  return out;
}

module.exports = { rawGrid, rawPoint, status, LEVELS, surfaceEngine: surface, surfaceEngineX: surfaceX, surfaceEngineW100: wind100, levelRawGrid, buildSteps };
