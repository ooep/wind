/*
 * 风云地球 FengyunEarth — 服务端
 * 零依赖:静态托管 + 气象数据代理 + 全球格点组装 + 磁盘/内存缓存
 *
 * 数据源:
 *  - Open-Meteo  https://api.open-meteo.com  (NOAA GFS / DWD ICON / ECMWF IFS 原始模式数据)
 *  - RainViewer  https://www.rainviewer.com  (全球雷达拼图)
 *  - NASA GIBS   https://worldview.earthdata.nasa.gov (卫星影像,前端直连瓦片)
 *  - Open-Meteo Geocoding https://geocoding-api.open-meteo.com (地名检索)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_DIR = path.join(__dirname, '.cache');

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const GEO_API = 'https://geocoding-api.open-meteo.com/v1/search';
const RADAR_API = 'https://api.rainviewer.com/public/weather-maps.json';

/* gfs_raw = 自建管道:NOAA GFS 原始 GRIB2(AWS 开放数据,无 key 无配额)+ 自研解码 */
const gfs = require('./server/gfs');
/* nwp = 更多自建模式引擎:GEFS 控制成员、ECMWF IFS Open Data */
const nwp = require('./server/nwp');

const MODELS = new Set(['gfs_raw', 'gefs_raw', 'aifs_raw', 'ecmwf_raw', 'best_match', 'gfs_seamless', 'icon_seamless', 'ecmwf_ifs025']);
/* 可选:设置 OPEN_METEO_API_KEY 环境变量以获得更高请求配额(免费注册:https://open-meteo.com/en/docs) */
const API_KEY = process.env.OPEN_METEO_API_KEY || '';
const HOURLY_VARS = [
  'temperature_2m', 'relative_humidity_2m', 'precipitation', 'cloud_cover',
  'pressure_msl', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
];
const MAX_GRID_POINTS = 8000;   // 单次格点上限
const CHUNK = 440;              // 每次 Open-Meteo 请求的坐标数(>500 会触发 414)
const CHUNK_SPACING_MS = 550;   // 块间隔,避免触发上游每分钟限流
const FETCH_TIMEOUT_MS = 90_000;

fs.mkdirSync(CACHE_DIR, { recursive: true });

/* 启动与每小时:清理 2 小时前的磁盘缓存(GFS 原始数据目录自理保留) */
function cleanCache() {
  fs.readdir(CACHE_DIR, (err, files) => {
    if (err) return;
    for (const f of files) {
      if (f === 'gfsraw') continue;
      const fp = path.join(CACHE_DIR, f);
      fs.stat(fp, (e, st) => {
        if (!e && Date.now() - st.mtimeMs > 2 * 3600_000) fs.unlink(fp, () => {});
      });
    }
  });
}
cleanCache();
setInterval(cleanCache, 30 * 60_000);

/* ---------------- 工具 ---------------- */

function sendJSON(res, status, obj, cacheTTL) {
  const body = JSON.stringify(obj);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  };
  if (cacheTTL) headers['Cache-Control'] = `public, max-age=${cacheTTL}`;
  const accept = String(res.req?.headers['accept-encoding'] || '');
  if (accept.includes('gzip') && body.length > 1024) {
    zlib.gzip(Buffer.from(body), (err, buf) => {
      if (err) { res.writeHead(status, headers); res.end(body); return; }
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = buf.length;
      res.writeHead(status, headers);
      res.end(buf);
    });
  } else {
    headers['Content-Length'] = Buffer.byteLength(body);
    res.writeHead(status, headers);
    res.end(body);
  }
}

function readBodyLimit(req) { /* 本服务全是 GET,预留 */ return ''; }

async function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'FengyunEarth/1.0' } });
  } finally { clearTimeout(t); }
}

async function fetchJSON(url, retries = 2) {
  const fullUrl = API_KEY ? `${url}${url.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(API_KEY)}` : url;
  const MAX_ATTEMPTS = retries + 1; // 首次 + 重试;429 也占用次数
  let lastErr;
  let attempt = 0;
  while (attempt <= MAX_ATTEMPTS) {
    try {
      const r = await fetchWithTimeout(fullUrl);
      if (r.status === 429) {
        const body = await r.text().catch(() => '');
        // 日配额用尽:重试无意义,快速失败
        if (/daily/i.test(body)) {
          throw new Error('上游日配额已用尽(429 daily limit),明日自动恢复,或配置 OPEN_METEO_API_KEY');
        }
        if (attempt < MAX_ATTEMPTS) {
          attempt++;
          await new Promise((s) => setTimeout(s, 20_000)); // 分钟限流:退避 20s 重试
          continue;
        }
        throw new Error(`upstream 429: ${body.slice(0, 200)}`);
      }
      if (!r.ok) throw new Error(`upstream ${r.status}: ${(await r.text()).slice(0, 300)}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      attempt++;
      if (attempt <= MAX_ATTEMPTS) await new Promise((s) => setTimeout(s, 800 * attempt));
    }
  }
  throw lastErr;
}

/* 内存缓存(LRU 简化版) */
const memCache = new Map(); // key -> { expires, value }
function memGet(key) {
  const it = memCache.get(key);
  if (!it) return null;
  if (Date.now() > it.expires) { memCache.delete(key); return null; }
  return it.value;
}
function memSet(key, value, ttlMs) {
  memCache.set(key, { expires: Date.now() + ttlMs, value });
  if (memCache.size > 500) {
    const first = memCache.keys().next().value;
    memCache.delete(first);
  }
}

/* ---------------- 格点构建 ---------------- */

function buildGridCoords(w, s, e, n, stepIn) {
  // 自动调大步长以满足点数上限
  let step = stepIn;
  let cols = Math.round((e - w) / step) + 1;
  let rows = Math.round((n - s) / step) + 1;
  while (cols * rows > MAX_GRID_POINTS) {
    step = step * 1.5;
    cols = Math.round((e - w) / step) + 1;
    rows = Math.round((n - s) / step) + 1;
  }
  const wrapLon = (e - w) >= 360 - 1e-6;
  const lons = [];
  const lonCount = wrapLon ? Math.round(360 / step) : cols;
  for (let i = 0; i < lonCount; i++) {
    let lon = w + i * step;
    if (lon > 180) lon -= 360;
    lons.push(Number(lon.toFixed(3)));
  }
  const lats = [];
  for (let j = 0; j < rows; j++) lats.push(Number((n - j * step).toFixed(3)));
  return { step: Number(step.toFixed(4)), lons, lats, wrapLon };
}

/* 磁盘格点索引:用于上游限流/故障时回退到最近一次同规格缓存 */
let gridDiskIndex = null;
function invalidateGridIndex() { gridDiskIndex = null; }

function findStaleGrid(model, lats, lons) {
  if (!gridDiskIndex) {
    gridDiskIndex = new Map();
    let files = [];
    try { files = fs.readdirSync(CACHE_DIR).filter((f) => f.startsWith('g_') && f.endsWith('.json')); } catch { /* */ }
    for (const f of files) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
        if (!d || !d.model || !d.lats || !d.lons || d.lats.length < 2 || d.lons.length < 2) continue;
        const arr = gridDiskIndex.get(d.model) || [];
        arr.push({
          file: f, generated: d.generated || 0, step: d.step,
          latN: d.lat0, latS: d.lat1, lonW: d.lons[0], lonE: d.lons[d.lons.length - 1],
        });
        gridDiskIndex.set(d.model, arr);
      } catch { /* 跳过损坏文件 */ }
    }
  }
  const eps = 1e-6;
  const reqStep = Math.abs(lats[0] - lats[1]);
  const reqN = lats[0], reqS = lats[lats.length - 1], reqW = lons[0], reqE = lons[lons.length - 1];
  const candidates = [];
  for (const c of gridDiskIndex.get(model) || []) {
    if (c.step === reqStep && c.latN === reqN && c.latS === reqS && c.lonW === reqW && c.lonE === reqE) {
      candidates.push({ ...c, rank: 0 }); // 完全同规格
      continue;
    }
    // 包含匹配:缓存范围覆盖请求范围,且分辨率不比请求粗太多
    const covers = c.latN >= reqN - eps && c.latS <= reqS + eps
      && (reqW >= reqE // 跨反子午线(全球)时不做包含判断
        ? false
        : c.lonW <= reqW + eps && c.lonE >= reqE - eps);
    if (covers && c.step <= reqStep * 1.5 + eps) candidates.push({ ...c, rank: 1 });
  }
  candidates.sort((a, b) => a.rank - b.rank || a.step - b.step || b.generated - a.generated);
  for (const c of candidates) {
    const fp = path.join(CACHE_DIR, c.file);
    try {
      if (!fs.existsSync(fp)) continue;
      return JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch { continue; }
  }
  return null;
}

async function fetchGrid(model, w, s, e, n, stepIn) {
  const { step, lons, lats, wrapLon } = buildGridCoords(w, s, e, n, stepIn);
  const points = [];
  for (const lat of lats) for (const lon of lons) points.push([lat, lon]);

  const cacheKey = crypto.createHash('sha1')
    .update(`${model}|${lats[0]}|${lats[lats.length - 1]}|${lons.join(',')}|${Math.floor(Date.now() / 3600e3)}`)
    .digest('hex');

  const cached = memGet('grid:' + cacheKey);
  if (cached) return cached;

  // 相同格点的并发请求共享同一次构建(节省上游配额)
  if (!fetchGrid._inflight) fetchGrid._inflight = new Map();
  if (fetchGrid._inflight.has(cacheKey)) return fetchGrid._inflight.get(cacheKey);

  const build = (async () => {

  // 磁盘缓存(同小时内有效)
  const diskPath = path.join(CACHE_DIR, `g_${cacheKey}.json`);
  try {
    const stat = fs.statSync(diskPath);
    if (Date.now() - stat.mtimeMs < 55 * 60_000) {
      const grid = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
      memSet('grid:' + cacheKey, grid, 60 * 60_000);
      return grid;
    }
  } catch { /* no cache */ }

  // 分块请求 Open-Meteo
  const coordStr = (arr) => arr.join(',');
  const chunks = [];
  for (let i = 0; i < points.length; i += CHUNK) {
    const part = points.slice(i, i + CHUNK);
    chunks.push({
      lats: coordStr(part.map((p) => p[0])),
      lons: coordStr(part.map((p) => p[1])),
      start: i,
    });
  }

  const results = new Array(chunks.length);
  let failed = null;
  // 串行 + 间隔,避免触发上游每分钟请求限制
  for (let idx = 0; idx < chunks.length; idx++) {
    if (failed) break;
    const c = chunks[idx];
    const url = `${OPEN_METEO}?latitude=${c.lats}&longitude=${c.lons}`
      + `&hourly=${HOURLY_VARS.join(',')}&wind_speed_unit=ms`
      + `&past_days=1&forecast_days=4&models=${model}`;
    try {
      const data = await fetchJSON(url);
      results[idx] = Array.isArray(data) ? data : [data]; // 单坐标时返回对象
    } catch (err) { failed = err; }
    if (idx < chunks.length - 1) await new Promise((s) => setTimeout(s, CHUNK_SPACING_MS));
  }
  if (failed) throw failed;

  // 组装:vars[var] = Float32Array(times × points),索引 t*points + p
  const times = results[0][0].hourly.time;
  const nT = times.length;
  const nP = points.length;
  const srcVars = {};
  for (const v of HOURLY_VARS) srcVars[v] = new Float32Array(nT * nP).fill(Number.NaN);

  let p = 0;
  for (const chunkRes of results) {
    const arr = Array.isArray(chunkRes) ? chunkRes : [chunkRes];
    for (const loc of arr) {
      if (!loc || !loc.hourly) throw new Error('upstream 返回缺少 hourly 数据');
      const h = loc.hourly;
      if (h.time.length !== nT) throw new Error('时间维度不一致,请重试');
      for (const v of HOURLY_VARS) {
        const series = h[v];
        if (!series) continue;
        for (let t = 0; t < nT; t++) srcVars[v][t * nP + p] = Number(series[t]);
      }
      p++;
    }
  }
  if (p !== nP) throw new Error(`格点坐标数量不符 ${p}/${nP}`);

  // 由风速+风向换算 u/v 分量(气象约定:风向为来向)
  const u = new Float32Array(nT * nP);
  const v = new Float32Array(nT * nP);
  const spd = srcVars['wind_speed_10m'], dir = srcVars['wind_direction_10m'];
  for (let i = 0; i < u.length; i++) {
    const rad = (dir[i] * Math.PI) / 180;
    u[i] = -spd[i] * Math.sin(rad);
    v[i] = -spd[i] * Math.cos(rad);
  }

  const f32b64 = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
  const grid = {
    model,
    step,
    wrapLon,
    cols: lons.length,
    rows: lats.length,
    points: nP,
    times,
    lat0: lats[0],           // 北边界(第一行)
    lat1: lats[lats.length - 1], // 南边界(最后一行)
    lon0: lons[0],           // 西边界(第一列)
    lon1: lons[lons.length - 1], // 东边界(最后一列)
    lats, lons,
    generated: Math.floor(Date.now() / 1000),
    vars: {
      u: f32b64(u), v: f32b64(v),
      temp: f32b64(srcVars['temperature_2m']),
      rh: f32b64(srcVars['relative_humidity_2m']),
      precip: f32b64(srcVars['precipitation']),
      cloud: f32b64(srcVars['cloud_cover']),
      msl: f32b64(srcVars['pressure_msl']),
      gust: f32b64(srcVars['wind_gusts_10m']),
    },
  };

  memSet('grid:' + cacheKey, grid, 60 * 60_000);
  fs.writeFile(diskPath, JSON.stringify(grid), () => {});
  invalidateGridIndex();
  return grid;
  })();

  fetchGrid._inflight.set(cacheKey, build);
  try {
    return await build;
  } catch (err) {
    // 上游限流/故障:回退到磁盘上最近一次同规格缓存,标记 stale
    const stale = findStaleGrid(model, lats, lons);
    if (stale) {
      memSet('grid:' + cacheKey, stale, 5 * 60_000);
      return { ...stale, stale: true };
    }
    throw err;
  } finally {
    fetchGrid._inflight.delete(cacheKey);
  }
}

/* ---------------- HTTP 路由 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!abs.startsWith(PUBLIC_DIR + path.sep) && abs !== PUBLIC_DIR) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(abs).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': rel.startsWith('/vendor/') || rel.startsWith('/geo/') ? 'public, max-age=604800' : 'no-cache',
    };
    const accept = String(req.headers['accept-encoding'] || '');
    const compressible = /\.(html|css|js|json|svg)$/.test(ext);
    if (compressible && accept.includes('gzip') && st.size > 1024) {
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
      fs.createReadStream(abs).pipe(zlib.createGzip()).pipe(res);
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': st.size });
      fs.createReadStream(abs).pipe(res);
    }
  });
}

function clampNum(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;

  try {
    if (p === '/api/health') {
      return sendJSON(res, 200, { ok: true, time: new Date().toISOString() });
    }

    if (p === '/api/marine') {
      const lat = clampNum(u.searchParams.get('lat'), -85, 85, NaN);
      const lon = clampNum(u.searchParams.get('lon'), -180, 180, NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return sendJSON(res, 400, { error: 'bad lat/lon' });
      const key = `marine:${lat.toFixed(2)}:${lon.toFixed(2)}:${Math.floor(Date.now() / 3600e3)}`;
      const cached = memGet(key);
      if (cached) return sendJSON(res, 200, cached, 600);
      const params = new URLSearchParams({
        latitude: String(lat), longitude: String(lon),
        hourly: 'wave_height,wave_direction,wave_period',
        daily: 'wave_height_max,wave_direction_dominant,wave_period_max',
        timezone: 'auto', forecast_days: '7',
      });
      const data = await fetchJSON(`https://marine-api.open-meteo.com/v1/marine?${params}`, 1);
      memSet(key, data, 30 * 60_000);
      return sendJSON(res, 200, data, 600);
    }

    if (p === '/api/gfs/status') {
      return sendJSON(res, 200, { gfs: gfs.status(), ...nwp.status() });
    }

    /* 全球/区域格点:w,s,e,n,step,model */
    if (p === '/api/grid') {
      const model = MODELS.has(u.searchParams.get('model')) ? u.searchParams.get('model') : 'gfs_raw';
      const w = clampNum(u.searchParams.get('w'), -180, 180, -180);
      const eRaw = clampNum(u.searchParams.get('e'), -180, 180, 180);
      const s = clampNum(u.searchParams.get('s'), -85, 85, -85);
      const n = clampNum(u.searchParams.get('n'), -85, 85, 85);
      const step = clampNum(u.searchParams.get('step'), 0.05, 10, 5);
      const east = eRaw <= w ? w + 360 : eRaw; // 跨反子午线
      const t0 = Date.now();
      if (model === 'gfs_raw') {
        const level = Math.round(clampNum(u.searchParams.get('level'), 0, 1000, 0));
        const grid = await gfs.rawGrid(w, s, east, n, step, level);
        return sendJSON(res, 200, { ...grid, fetchMs: Date.now() - t0 });
      }
      if (model === 'gefs_raw' || model === 'ecmwf_raw' || model === 'aifs_raw') {
        const grid = await nwp.ENGINES[model].rawGrid(w, s, east, n, step);
        return sendJSON(res, 200, { ...grid, fetchMs: Date.now() - t0 });
      }
      const grid = await fetchGrid(model, w, s, east, n, step);
      return sendJSON(res, 200, { ...grid, fetchMs: Date.now() - t0 });
    }

    /* 单点精细预报 */
    if (p === '/api/point') {
      const lat = clampNum(u.searchParams.get('lat'), -85, 85, NaN);
      const lon = clampNum(u.searchParams.get('lon'), -180, 180, NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return sendJSON(res, 400, { error: 'bad lat/lon' });
      const model = MODELS.has(u.searchParams.get('model')) ? u.searchParams.get('model') : 'gfs_raw';
      if (model === 'gfs_raw') {
        const data = await gfs.rawPoint(lat, lon);
        return sendJSON(res, 200, data, 600);
      }
      if (model === 'gefs_raw' || model === 'ecmwf_raw' || model === 'aifs_raw') {
        const data = await nwp.ENGINES[model].rawPoint(lat, lon);
        return sendJSON(res, 200, data, 600);
      }
      const key = `pt:${model}:${lat.toFixed(2)}:${lon.toFixed(2)}:${Math.floor(Date.now() / 600e3)}`;
      const cached = memGet(key);
      if (cached) return sendJSON(res, 200, cached, 600);
      const params = new URLSearchParams({
        latitude: String(lat), longitude: String(lon),
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
        hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,cloud_cover',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset',
        wind_speed_unit: 'ms', timezone: 'auto', forecast_days: '7', models: model,
      });
      const diskKey = crypto.createHash('sha1').update(`pt|${model}|${lat.toFixed(2)}|${lon.toFixed(2)}`).digest('hex');
      const diskPath = path.join(CACHE_DIR, `p_${diskKey}.json`);
      try {
        const st = fs.statSync(diskPath);
        if (Date.now() - st.mtimeMs < 15 * 60_000) {
          const data = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
          memSet(key, data, 10 * 60_000);
          return sendJSON(res, 200, data, 600);
        }
      } catch { /* 无新鲜磁盘缓存 */ }
      try {
        const data = await fetchJSON(`${OPEN_METEO}?${params}`, 1);
        memSet(key, data, 10 * 60_000);
        fs.writeFile(diskPath, JSON.stringify(data), () => {});
        return sendJSON(res, 200, data, 600);
      } catch (err) {
        // 上游限流:回退到旧缓存并标记 stale
        try {
          const st = fs.statSync(diskPath);
          const data = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
          return sendJSON(res, 200, { ...data, stale: true, cachedAt: Math.floor(st.mtimeMs / 1000) });
        } catch { throw err; }
      }
    }

    /* 地名搜索 */
    if (p === '/api/geocode') {
      let name = (u.searchParams.get('name') || '').trim().slice(0, 60);
      // 兼容未经百分号编码的原始 UTF-8 字节(Node 会按 latin1 解码)
      if (/[\u0080-\u00ff]/.test(name)) {
        const fixed = Buffer.from(name, 'latin1').toString('utf8');
        if (fixed && !fixed.includes('\uFFFD')) name = fixed;
      }
      if (!name) return sendJSON(res, 200, { results: [] });
      const key = `geo:${name}`;
      const cached = memGet(key);
      if (cached) return sendJSON(res, 200, cached, 86400);
      const params = new URLSearchParams({ name, count: '8', language: 'zh', format: 'json' });
      const diskKey = crypto.createHash('sha1').update(`geo|${name}`).digest('hex');
      const diskPath = path.join(CACHE_DIR, `s_${diskKey}.json`);
      try {
        const data = await fetchJSON(`${GEO_API}?${params}`, 1);
        memSet(key, data, 24 * 3600_000);
        fs.writeFile(diskPath, JSON.stringify(data), () => {});
        return sendJSON(res, 200, data, 86400);
      } catch (err) {
        try {
          const data = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
          return sendJSON(res, 200, data, 86400);
        } catch { throw err; }
      }
    }

    /* 雷达元数据(RainViewer) */
    if (p === '/api/radar') {
      const key = 'radar:' + Math.floor(Date.now() / 240e3);
      const cached = memGet(key);
      if (cached) return sendJSON(res, 200, cached, 240);
      const data = await fetchJSON(RADAR_API);
      memSet(key, data, 4 * 60_000);
      return sendJSON(res, 200, data, 240);
    }

    return serveStatic(req, res, p);
  } catch (err) {
    console.error('[error]', p, err.message);
    return sendJSON(res, 502, { error: true, message: String(err.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  风云地球 FengyunEarth`);
  console.log(`  ➜  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}\n`);
  console.log(`  默认数据引擎: NOAA GFS 原始 GRIB2 自建管道(无 key、无配额)`);
  console.log(`  备用: Open-Meteo(GFS/ICON/ECMWF) · 雷达: RainViewer · 卫星: NASA GIBS`);
  if (!API_KEY) {
    console.log(`  提示: Open-Meteo 备用引擎为匿名免费配额(有限流);自建 GFS 管道不受影响。\n`);
  }
});
