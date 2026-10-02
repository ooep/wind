/*
 * NOAA GFS Wave 0.25° 海浪引擎(与大气 GFS 同桶 noaa-gfs-bdp-pds,无 key 无配额)
 *
 * 数据:gfs.YYYYMMDD/HH/wave/gridded/gfswave.tHHz.global.0p25.fXXX.grib2
 *   HTSGW 有效波高(m)/ PERPW 主波周期(s)/ DIRPW 主波方向(度,来向)
 *   WVHGT 风浪高(m)/ WVPER 风浪周期(s)
 *   SWELL/SWPER 涌浪高/周期 — idx level 为 "N in sequence"(第 N 分区),取第 1 分区为主涌浪
 *   DRT 5.40(JPEG2000):由 grib2.js 调 python3+Pillow 解码(见 server/j2k.py)
 *
 * 存储:0.5° 全球网格 Int16 捆包(wvh/wvp/wvd/swvh/swvp/wwh/wwp),u/v 传播矢量与
 *   wve 波浪能量在 rawGrid 输出时现场派生,不落盘。
 */
'use strict';

const path = require('path');
const { findMessages, decodeMessage } = require('./grib2');
const {
  ModelEngine, fetchBuf, normalizeGrid, StepStore, makeSampler, parseGfsStyleIdx, utcStr,
} = require('./nwp');

const S3 = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com';
const GRID = { ni: 720, nj: 361, lon0: 0, dlon: 0.5, lat0: 90, dlat: 0.5 }; // 0.25 源降采样到 0.5 存储
const MAX_F = 180;      // 取到 +180h(GFS Wave 逐小时发布)
const HOURLY_H = 120;   // 逐小时步长上限,其后 3 小时
const CONCURRENCY = 6;

/* u/v 为派生量:仅用于静态包 scale 与前端 Int16 量化,不参与 GRIB 摄取 */
const VARCFG = {
  wvh: { grib: 'HTSGW', level: 'surface', scale: 100, conv: (v) => v },
  wvp: { grib: 'PERPW', level: 'surface', scale: 100, conv: (v) => v },
  wvd: { grib: 'DIRPW', level: 'surface', scale: 10, conv: (v) => v },
  wwh: { grib: 'WVHGT', level: 'surface', scale: 100, conv: (v) => v },
  wwp: { grib: 'WVPER', level: 'surface', scale: 100, conv: (v) => v },
  swvh: { grib: 'SWELL', level: '1 in sequence', scale: 100, conv: (v) => v },
  swvp: { grib: 'SWPER', level: '1 in sequence', scale: 100, conv: (v) => v },
  u: { scale: 100, derived: true },
  v: { scale: 100, derived: true },
  /* 波浪能量通量 kW/m ≈ (ρg²/64π)·Hs²·Te ≈ 0.49·Hs²·Te */
  wve: { scale: 10, derived: true },
};
const VARKEYS = ['wvh', 'wvp', 'wvd', 'wwh', 'wwp', 'swvh', 'swvp'];

const WAVES = {
  id: 'waves_raw',
  label: 'NOAA GFS Wave 0.25°(AWS 开放数据,原始 GRIB2 自解码)',
  varCfg: VARCFG,
  varKeys: VARKEYS,
  grid: GRID,
  maxF: MAX_F,
  stepH: 3,
  concurrency: CONCURRENCY,
  store: null,
  init() {
    this.store = new StepStore(path.join(__dirname, '..', '.cache', 'nwp-waves_raw'), VARKEYS, GRID.ni, GRID.nj);
  },
  granularity() { return 1; },
  async fetchVarStep(runKey, step, varKey) {
    const hh = runKey.split('/')[1];
    const fileTag = `f${String(step).padStart(3, '0')}`;
    const url = `${S3}/gfs.${runKey}/wave/gridded/gfswave.t${hh}z.global.0p25.${fileTag}.grib2`;
    let idxBuf;
    try {
      idxBuf = await fetchBuf(`${url}.idx`, 4);
    } catch (e) {
      throw new Error(`${e.message} @ ${url}.idx`);
    }
    const recs = parseGfsStyleIdx(idxBuf);
    const cfg = VARCFG[varKey];
    const rec = recs.find((x) => x.var === cfg.grib && x.level === cfg.level && !/ave|acc/.test(x.ts));
    if (!rec) throw new Error(`idx 中未找到 ${varKey}(${cfg.grib})@f${step}`);
    const data = await fetchBuf(url, 4, { Range: `bytes=${rec.start}-${rec.end - 1}` });
    const total = Number(data.readBigUInt64BE(8));
    const m = findMessages(total <= data.length ? data : data.subarray(0, total))[0];
    if (!m) throw new Error('Range 内未找到 GRIB 消息');
    const dec = decodeMessage(m);
    return normalizeGrid(dec, GRID, cfg);
  },
  gridOf() { return GRID; },
  steps() {
    const arr = [];
    for (let s = 0; s <= HOURLY_H; s += 1) arr.push(s);
    for (let s = HOURLY_H + 3; s <= MAX_F; s += 3) arr.push(s);
    return arr;
  },
};

/* run 发现:探测 f000 的 idx(NOAA Wave 与大气 GFS 同节奏,00/06/12/18 四次/日) */
WAVES.discoverRuns = async function () {
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
    const url = `${S3}/gfs.${key}/wave/gridded/gfswave.t${hh2}z.global.0p25.f000.grib2.idx`;
    try {
      const buf = await fetchBuf(url, 2);
      if (buf.length > 100 && !buf.subarray(0, 5).toString().includes('<')) found.push({ key, init: d.getTime() });
    } catch { /* 不存在 */ }
    if (found.length && found[found.length - 1].init <= needPast) break;
  }
  if (!found.length) throw new Error('未找到可用的 GFS Wave run');
  return found;
};

/* 海浪引擎:在通用框架上追加 u/v 传播矢量合成与点位海洋系列 */
class WavesEngine extends ModelEngine {
  /* 点预报:海浪模式无大气要素,输出全 null 的标准壳 + 海浪系列
   * (NaN 序列化即 null,前端面板按 null 显示「—」并自动切到海浪视图) */
  async rawPoint(lat, lon) {
    const run = await this.ensureLoaded();
    const series = [];
    for (const t of run.times) {
      const s2 = this.sampleAll(t.runKey, t.step, lat, lon);
      series.push({
        ms: t.ms,
        wvh: s2 && Number.isFinite(s2.wvh) ? +s2.wvh.toFixed(2) : NaN,
        wvp: s2 && Number.isFinite(s2.wvp) ? +s2.wvp.toFixed(1) : NaN,
        wvd: s2 && Number.isFinite(s2.wvd) ? Math.round(s2.wvd) : NaN,
      });
    }
    const iso = (ms) => {
      if (Number.isNaN(ms)) return null;
      const d = new Date(ms);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const cur = series.find((x) => x.ms <= Date.now() + 1800e3 && Number.isFinite(x.wvh)) || series[0];
    return {
      source: this.def.label + ',自算点预报',
      current: {
        temperature_2m: NaN, relative_humidity_2m: NaN, apparent_temperature: NaN,
        is_day: 1, precipitation: NaN, weather_code: null, cloud_cover: NaN,
        pressure_msl: NaN, wind_speed_10m: NaN, wind_direction_10m: NaN, wind_gusts_10m: NaN,
        wave_height: cur.wvh, wave_period: cur.wvp, wave_direction: cur.wvd,
      },
      hourly: {
        time: series.map((x) => iso(x.ms)),
        temperature_2m: series.map(() => NaN),
        wave_height: series.map((x) => x.wvh),
        wave_period: series.map((x) => x.wvp),
        wave_direction: series.map((x) => x.wvd),
      },
      daily: null,
    };
  }

  /* 波高+主波方向 → 海浪传播矢量(东向 u / 北向 v,m/s)。
   * DIRPW 为来向(气象约定),传播去向 = +180;速度按波高视觉化标定。
   * 波浪能量 wve = 0.49·Hs²·Te(kW/m),无波高或周期处为 NaN。 */
  async rawGrid(w, s, e, n, stepDeg) {
    const out = await super.rawGrid(w, s, e, n, stepDeg);
    const f32of = (b64) => {
      const b = Buffer.from(b64, 'base64');
      return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
    };
    const h = f32of(out.vars.wvh);
    const d = f32of(out.vars.wvd);
    const p = f32of(out.vars.wvp);
    const u = new Float32Array(h.length);
    const v = new Float32Array(h.length);
    const wve = new Float32Array(h.length);
    for (let i = 0; i < h.length; i++) {
      if (Number.isNaN(h[i]) || Number.isNaN(d[i])) { u[i] = NaN; v[i] = NaN; continue; }
      const spd = Math.min(10, 0.8 * h[i] + 0.5);
      const to = (d[i] + 180) * Math.PI / 180;
      u[i] = spd * Math.sin(to);
      v[i] = spd * Math.cos(to);
      wve[i] = Number.isNaN(p[i]) ? NaN : 0.49 * h[i] * h[i] * p[i];
    }
    out.vars.u = Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString('base64');
    out.vars.v = Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
    out.vars.wve = Buffer.from(wve.buffer, wve.byteOffset, wve.byteLength).toString('base64');
    return out;
  }
}

const engine = new WavesEngine(WAVES);

module.exports = { engine };
