/* API 客户端:双模式
 *  - 服务端模式(默认):/api/grid /api/point /api/geocode 由 Node 服务提供
 *  - 静态模式:数据来自静态数据仓库(GitHub Actions 定时生成,Cloudflare Pages 同域提供,
 *    零服务器、抗攻击)。per-var 格式:meta.json 带变量清单,变量文件按图层懒加载。
 *
 * 模式探测顺序:
 *  1. window.FY_CONFIG.staticData 或 URL ?data=<路径>(显式指定)
 *  2. 自动探测 /dist/data/index.json(仓库绑定的 Pages 部署存在 → 静态模式)
 *  3. 都不存在 → 服务端模式
 */
import { Grid, b64ToF32 } from './util.js';

let STATIC_BASE = '';
let staticMode = false;
let modePromise = null;

export function isStatic() { return staticMode; }
export function staticBase() { return STATIC_BASE; }

export async function resolveMode() {
  if (modePromise) return modePromise;
  modePromise = (async () => {
    // 1. 显式配置
    const explicit = (window.FY_CONFIG && window.FY_CONFIG.staticData) ||
      new URLSearchParams(location.search).get('data');
    if (explicit) { STATIC_BASE = String(explicit).replace(/\/$/, ''); staticMode = true; return; }
    // 2. 自动探测:同域 /dist/data(Actions 数据提交随站点部署)
    try {
      const r = await fetch('/dist/data/index.json', { method: 'HEAD' });
      if (r.ok) { STATIC_BASE = '/dist/data'; staticMode = true; return; }
    } catch { /* 探测失败按服务端模式 */ }
    // 3. 服务端模式
  })();
  return modePromise;
}

const gridCache = new Map(); // key -> Grid
const GRID_CACHE_MAX = 6;
let GridCtor = null;
export function initApi(GridClass) { GridCtor = GridClass; }

function cacheKey(p) {
  const r = (v, d) => Number(v).toFixed(d);
  return `${p.model}|${r(p.w, 3)},${r(p.s, 3)},${r(p.e, 3)},${r(p.n, 3)}|${r(p.step, 3)}|L${p.level || 0}`;
}

/* ---------------- 静态模式 ---------------- */

const staticIndex = { data: null, fetchedAt: 0, promise: null };
const staticGrids = new Map(); // model -> Grid(已解码;变量按需补齐)
const staticMetas = new Map(); // model -> meta

async function staticIndexGet() {
  if (staticIndex.data && Date.now() - staticIndex.fetchedAt < 10 * 60e3) return staticIndex.data;
  if (!staticIndex.promise) {
    /* no-cache:每次会话协商复验(ETag/304),部署后立即可见新 run,又不必整包重下 */
    staticIndex.promise = fetch(`${STATIC_BASE}/index.json`, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`静态数据索引 ${r.status}`);
      return r.json();
    }).then((d) => { staticIndex.data = d; staticIndex.fetchedAt = Date.now(); return d; })
      .finally(() => { staticIndex.promise = null; });
  }
  return staticIndex.promise;
}

function latsOf(grid) {
  const a = [];
  for (let j = 0; j < grid.nj; j++) a.push(+(grid.lat0 - j * grid.dlat).toFixed(4));
  return a;
}
function lonsOf(grid) {
  const a = [];
  for (let i = 0; i < grid.ni; i++) a.push(+(grid.lon0 + i * grid.dlon).toFixed(4));
  return a;
}
function f32FromI16B64(b64, scale) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(bytes.buffer);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] === -32768 ? NaN : i16[i] / scale;
  return f32;
}

async function staticMetaGet(model) {
  if (staticMetas.has(model)) return staticMetas.get(model);
  const index = await staticIndexGet();
  const entry = index.models && index.models[model];
  if (!entry) throw new Error(`静态数据未包含模式 ${model}`);
  const meta = await fetch(`${STATIC_BASE}/${model}/${entry.runKey}/meta.json`)
    .then((r) => { if (!r.ok) throw new Error(`meta ${r.status}`); return r.json(); });
  staticMetas.set(model, meta);
  return meta;
}

/* 拉取一个变量文件 → Float32Array(per-var 格式) */
async function fetchVarF32(model, runKey, vk, cfg) {
  const r = await fetch(`${STATIC_BASE}/${model}/${runKey}/${cfg.file}`);
  if (!r.ok) throw new Error(`变量 ${vk} 数据尚未生成(${r.status}),等待下一轮数据管道`);
  const pack = await r.json();
  return f32FromI16B64(pack.data, pack.scale);
}

/* 确保静态 Grid 上已加载给定变量(缺失则拉取并注入;并发去重)。
 * 变量键可带层级后缀 u@850 → 注入为 grid.vars.u(渲染层不感知层级)。 */
export async function ensureGridVars(grid, vks) {
  if (!staticMode || !grid) return grid;
  const meta = grid.__staticMeta;
  if (!meta || meta.format !== 'per-var') return grid; // 旧格式已全量加载
  const jobs = [];
  for (const vk of vks || []) {
    const plain = vk.split('@')[0];
    if (grid.vars[plain] || (grid.__loading && grid.__loading[vk])) continue;
    const cfg = meta.vars[vk];
    if (!cfg) continue; // 该模式不提供此变量 → 保持 NaN,由图层门控兜底
    grid.__loading = grid.__loading || {};
    grid.__loading[vk] = fetchVarF32(grid.__model, grid.__runKey, vk, cfg)
      .then((f32) => { grid.vars[plain] = f32; })
      .finally(() => { delete grid.__loading[vk]; });
    jobs.push(grid.__loading[vk]);
  }
  if (jobs.length) await Promise.all(jobs);
  return grid;
}

/* 层级模式的 Grid 缓存键:同一模型不同气压层是不同的变量集 */
const LEVEL_KEYS = ['u', 'v', 'temp', 'rh'];

/* 静态模式数据包 → /api/grid 同构 Grid;needs 为初始急载变量(u/v 供粒子动画) */
async function staticModelGrid(model, needs, level = 0) {
  const cacheKey = level ? `${model}@${level}` : model;
  const needKeys = (needs || []).map((vk) => (level && LEVEL_KEYS.includes(vk.split('@')[0]) ? `${vk.split('@')[0]}@${level}` : vk));
  if (staticGrids.has(cacheKey)) {
    const g = staticGrids.get(cacheKey);
    if (needKeys) await ensureGridVars(g, needKeys);
    return g;
  }
  const index = await staticIndexGet();
  const entry = index.models[model];
  if (!entry) throw new Error(`静态数据未包含模式 ${model}`);
  let gridObj = null;
  // 首选 per-var 格式;meta 未就绪(无 grid 字段)或缺文件时回退旧 global 全量包
  try {
    const meta = await staticMetaGet(model);
    if (meta && meta.grid) {
      const grid = meta.grid;
      const shape = {
        model, source: `静态数据包(${model})` + (level ? ` · ${level} hPa` : ''),
        step: grid.dlon, wrapLon: true,
        cols: grid.ni, rows: grid.nj,
        times: meta.times, generated: meta.generated,
        lat0: grid.lat0, lon0: grid.lon0,
        lats: latsOf(grid), lons: lonsOf(grid),
        vars: {},
      };
      gridObj = new GridCtor(shape);
      gridObj.__model = model;
      gridObj.__runKey = entry.runKey;
      gridObj.__staticMeta = meta;
    }
  } catch { /* meta 缺失或损坏 → global 回退 */ }
  if (!gridObj) gridObj = await staticGlobalGrid(model, entry);
  staticGrids.set(cacheKey, gridObj);
  if (needKeys) await ensureGridVars(gridObj, needKeys);
  return gridObj;
}

/* 旧格式 global-2.5.json(全变量一体,int16 编码)→ 与 /api/grid 同构的 Grid */
async function staticGlobalGrid(model, entry) {
  if (!entry.global) throw new Error(`模式 ${model} 的静态数据尚未生成`);
  const r = await fetch(`${STATIC_BASE}/${model}/${entry.runKey}/${entry.global}`);
  if (!r.ok) throw new Error(`全局数据包加载失败(${r.status})`);
  const pack = await r.json();
  const grid = pack.grid;
  if (!grid || !grid.ni) throw new Error('全局数据包缺少网格定义');
  const shape = {
    model, source: `静态数据包(${model})`,
    step: grid.dlon, wrapLon: true,
    cols: grid.ni, rows: grid.nj,
    times: pack.times, generated: pack.generated,
    lat0: grid.lat0, lon0: grid.lon0,
    lats: latsOf(grid), lons: lonsOf(grid),
    vars: {},
  };
  const gridObj = new GridCtor(shape);
  for (const [vk, e] of Object.entries(pack.vars || {})) {
    gridObj.vars[vk] = e && typeof e === 'object' && e.data
      ? f32FromI16B64(e.data, +e.scale || 1)
      : b64ToF32(e);
  }
  gridObj.__model = model;
  gridObj.__runKey = entry.runKey;
  gridObj.__staticMeta = { format: 'global' }; // 全变量已加载,ensureGridVars 直通
  return gridObj;
}

/* 点位预报固定走大气基准模式:海浪/海温/化学/雪包等专用模式无完整大气要素 */
const POINT_BASE = { waves_raw: 'gfs_raw', ocean_raw: 'gfs_raw', chem_raw: 'gfs_raw', gfs_snow: 'gfs_raw' };

/* 静态模式:点预报由本地格点插值合成(与 /api/point 响应同构);needs 可精简(对比 tab 只需温/风) */
async function staticPoint(lat, lon, model, needs) {
  model = POINT_BASE[model] || model;
  const grid = await staticModelGrid(model, needs || ['temp', 'rh', 'precip', 'cloud', 'msl', 'u', 'v', 'gust']);
  const times = grid.times; // Grid 构造时已解析为毫秒
  const fr = { i0: 0, i1: 0, f: 0 };
  const series = times.map((ms, ti) => {
    fr.i0 = ti; fr.i1 = ti; fr.f = 0;
    return {
      ms,
      temp: grid.sample('temp', lon, lat, fr),
      rh: grid.sample('rh', lon, lat, fr),
      precip: grid.sample('precip', lon, lat, fr),
      cloud: grid.sample('cloud', lon, lat, fr),
      msl: grid.sample('msl', lon, lat, fr),
      u: grid.sample('u', lon, lat, fr),
      v: grid.sample('v', lon, lat, fr),
      gust: grid.sample('gust', lon, lat, fr),
    };
  });
  const spd = (x) => Number.isNaN(x?.u) || Number.isNaN(x?.v) ? NaN : Math.hypot(x.u, x.v);
  const dirOf = (x) => Number.isNaN(x?.u) || Number.isNaN(x?.v) ? NaN : Math.round(((Math.atan2(-x.u, -x.v) * 180) / Math.PI + 360) % 360);
  const app = (t, rh, w) => {
    if (Number.isNaN(t) || Number.isNaN(rh)) return NaN;
    const e = (rh / 100) * 6.105 * Math.exp(17.67 * t / (t + 243.5));
    return t + 0.33 * e - 0.70 * (Number.isNaN(w) ? 0 : w) - 4.00;
  };
  const wcode = (pr, t, cl) => {
    const p = Number.isNaN(pr) ? 0 : pr;
    const snow = !Number.isNaN(t) && t <= 0.5;
    if (p >= 0.1) return snow ? (p >= 4 ? 75 : p >= 1 ? 73 : 71) : (p >= 7.6 ? 65 : p >= 2.5 ? 63 : 61);
    const c = Number.isNaN(cl) ? 0 : cl;
    return c >= 70 ? 3 : c >= 40 ? 2 : c >= 10 ? 1 : 0;
  };
  const now = Date.now();
  const cur = series.find((x) => x.ms <= now + 1800e3 && !Number.isNaN(x.temp)) || series[0];
  const curSpd = spd(cur);
  const curDir = dirOf(cur);
  const hourly = {
    time: series.map((x) => naiveLocal(x.ms)),
    temperature_2m: series.map((x) => +x.temp.toFixed(1)),
    apparent_temperature: series.map((x) => +app(x.temp, x.rh, spd(x)).toFixed(1)),
    precipitation: series.map((x) => +(Math.max(0, x.precip) * 3).toFixed(2)),
    precipitation_probability: series.map(() => null),
    weather_code: series.map((x) => wcode(x.precip, x.temp, x.cloud)),
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
    daily.time.push(naiveLocal(dayStart).slice(0, 10));
    if (!inDay.length) {
      for (const k of ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'sunrise', 'sunset']) daily[k].push(null);
      continue;
    }
    const temps = inDay.map((x) => x.temp);
    const mid = inDay[Math.floor(inDay.length / 2)];
    daily.weather_code.push(wcode(Math.max(...inDay.map((x) => x.precip || 0)), mid.temp, Math.max(...inDay.map((x) => x.cloud || 0))));
    daily.temperature_2m_max.push(+Math.max(...temps).toFixed(1));
    daily.temperature_2m_min.push(+Math.min(...temps).toFixed(1));
    daily.precipitation_sum.push(+inDay.reduce((a, x) => a + Math.max(0, x.precip || 0) * 3, 0).toFixed(1));
    daily.precipitation_probability_max.push(null);
    daily.wind_speed_10m_max.push(+Math.max(...inDay.map((x) => spd(x) || 0)).toFixed(1));
    const st = sunTimesLocal(dayStart, lat, lon);
    daily.sunrise.push(naiveLocal(st.sunrise));
    daily.sunset.push(naiveLocal(st.sunset));
  }
  return {
    source: `静态数据包(${model}),浏览器本地插值`,
    current: {
      temperature_2m: +cur.temp.toFixed(1),
      relative_humidity_2m: Math.round(cur.rh),
      apparent_temperature: +app(cur.temp, cur.rh, curSpd).toFixed(1),
      is_day: (() => { const st = sunTimesLocal(now - 12 * 3600e3, lat, lon); return (!Number.isNaN(st.sunrise) && now >= st.sunrise && now <= st.sunset) ? 1 : 0; })(),
      precipitation: Math.max(0, +(cur.precip).toFixed(2)),
      weather_code: wcode(cur.precip, cur.temp, cur.cloud),
      cloud_cover: Math.round(cur.cloud),
      pressure_msl: Math.round(cur.msl),
      wind_speed_10m: +curSpd.toFixed(1),
      wind_direction_10m: curDir,
      wind_gusts_10m: Number.isNaN(cur.gust) ? null : +cur.gust.toFixed(1),
    },
    hourly, daily,
  };
}

/* 静态模式可用模式列表(供模型选择器过滤) */
let staticAvailCache = null;
export async function staticAvailableModels() {
  await resolveMode(); // 启动竞态:调用早于模式探测完成时 staticMode 尚为 false
  if (!staticMode) return null;
  try {
    const index = await staticIndexGet();
    staticAvailCache = Object.keys(index.models || {});
    return staticAvailCache;
  } catch { return null; }
}

/* 同步查询:某模式是否已有静态数据(供图层自动切换做优雅降级决策) */
export function staticHasModel(m) {
  return !!staticAvailCache && staticAvailCache.includes(m);
}

/* 同步查询:静态模式清单是否已加载(未加载时调用方不应据此置灰图层或过滤选择器) */
export function staticAvailReady() {
  return !!staticAvailCache;
}

function naiveLocal(ms) {
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function sunTimesLocal(dayStartUtcMs, lat, lon) {
  const rad = Math.PI / 180;
  const d = new Date(dayStartUtcMs);
  const doy = Math.floor((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 86400e3) + 1;
  const g = (2 * Math.PI / 365) * (doy - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  const noon = start + (720 - 4 * lon - eq) * 60000;
  if (cosH > 1 || cosH < -1) return { sunrise: NaN, sunset: NaN };
  const H = Math.acos(cosH) / rad;
  return { sunrise: noon - 4 * H * 60000, sunset: noon + 4 * H * 60000 };
}

/* ---------------- 对外接口 ---------------- */

export async function fetchGrid(params) {
  await resolveMode();
  if (staticMode) {
    const grid = await staticModelGrid(params.model, params.needs || ['u', 'v'], params.level || 0);
    return { grid, cached: true };
  }
  const key = cacheKey(params);
  if (gridCache.has(key)) {
    const g = gridCache.get(key);
    gridCache.delete(key); gridCache.set(key, g); // LRU touch
    return { grid: g, cached: true };
  }
  const qs = new URLSearchParams({
    model: params.model, w: params.w, s: params.s, e: params.e, n: params.n, step: params.step,
    level: params.level || 0,
  });
  const res = await fetch(`/api/grid?${qs}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.message || `格点加载失败 (${res.status})`);
  const grid = new GridCtor(data);
  gridCache.set(key, grid);
  if (gridCache.size > GRID_CACHE_MAX) {
    gridCache.delete(gridCache.keys().next().value);
  }
  return { grid, cached: false };
}
export function clearGridCache() { gridCache.clear(); staticGrids.clear(); staticMetas.clear(); }

export async function fetchPoint(lat, lon, model) {
  await resolveMode();
  if (staticMode) return staticPoint(lat, lon, model);
  const qs = new URLSearchParams({ lat, lon, model });
  const res = await fetch(`/api/point?${qs}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.message || `预报加载失败 (${res.status})`);
  return data;
}

/* 指定模式的点预报(模式对比 tab 用);light=true 只拉温度/风,静态模式下省流量。
 * 单模式失败返回空对象,由调用方按 current 字段判空跳过。 */
export async function fetchPointModel(lat, lon, model, light = false) {
  await resolveMode();
  try {
    if (staticMode) return await staticPoint(lat, lon, model, light ? ['temp', 'u', 'v'] : undefined);
    const res = await fetch(`/api/point?lat=${lat}&lon=${lon}&model=${model}`);
    return await res.json();
  } catch { return {}; }
}

/* 海浪预报(静态部署无服务端代理,直连 Open-Meteo Marine,其 API 允许跨域) */
export async function fetchMarine(lat, lon) {
  await resolveMode();
  if (staticMode) {
    const params = new URLSearchParams({
      latitude: String(lat), longitude: String(lon),
      hourly: 'wave_height,wave_direction,wave_period',
      daily: 'wave_height_max,wave_direction_dominant,wave_period_max',
      timezone: 'auto', forecast_days: '7',
    });
    const res = await fetch(`https://marine-api.open-meteo.com/v1/marine?${params}`);
    if (!res.ok) throw new Error('海浪数据加载失败');
    return res.json();
  }
  const res = await fetch(`/api/marine?lat=${lat}&lon=${lon}`);
  if (!res.ok) throw new Error('海浪数据加载失败');
  return res.json();
}

export async function fetchGeocode(name) {
  await resolveMode();
  if (staticMode) {
    const qs = new URLSearchParams({ name, count: '8', language: 'zh' });
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${qs}`);
    if (!res.ok) throw new Error('地名检索失败');
    return (await res.json()).results || [];
  }
  const qs = new URLSearchParams({ name });
  const res = await fetch(`/api/geocode?${qs}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error('地名检索失败');
  return data.results || [];
}

export async function fetchRadarMeta() {
  await resolveMode();
  if (staticMode) {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (!res.ok) throw new Error('雷达数据加载失败');
    return res.json();
  }
  const res = await fetch('/api/radar');
  const data = await res.json();
  if (!res.ok || data.error) throw new Error('雷达数据加载失败');
  return data;
}
