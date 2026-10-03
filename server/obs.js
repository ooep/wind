/*
 * 全球气象站实况(METAR):aviationweather.gov API(美国 NOAA 官方,public domain)。
 * 接口按 bbox 限单次 400 条,这里用 3×3 九宫格抓取后按 ICAO 去重合并。
 * 供 server.js /api/obs 路由(实时+缓存)与 tools/bake-obs.js(Actions 烘焙)共用。
 */
'use strict';

const SOURCE = 'https://aviationweather.gov/api/data/metar?format=json&hours=2&bbox=';

/* 3×3 覆盖全球,60° 分片带重叠,规避单请求 400 条上限 */
const TILES = [];
for (let i = 0; i < 3; i++) {
  for (let j = 0; j < 3; j++) {
    const lat0 = -90 + i * 60, lat1 = -90 + (i + 1) * 60;
    const lon0 = -180 + j * 120, lon1 = -180 + (j + 1) * 120;
    TILES.push(`${lat0},${lon0},${lat1},${lon1}`);
  }
}

async function fetchTile(bbox, retries = 4) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(`${SOURCE}${encodeURIComponent(bbox)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === retries) throw e;
      await new Promise((s) => setTimeout(s, 2000 * (i + 1)));
    }
  }
}

/* 抓取并精简:只保留地图渲染需要的字段(压缩烘焙体积) */
async function fetchStations() {
  const results = await Promise.allSettled(TILES.map((b) => fetchTile(b)));
  const byIcao = new Map();
  for (const r of results) {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
    for (const m of r.value) {
      if (!m || !m.icaoId || !Number.isFinite(m.lat) || !Number.isFinite(m.lon)) continue;
      if (m.metarType && m.metarType !== 'METAR' && m.metarType !== 'SPECI') continue;
      const prev = byIcao.get(m.icaoId);
      if (prev && prev.obsTime >= m.obsTime) continue;
      byIcao.set(m.icaoId, {
        i: m.icaoId,
        lat: m.lat, lon: m.lon,
        t: num(m.temp), td: num(m.dewp),
        wd: num(m.wdir), ws: num(m.wspd), wg: num(m.wgst),
        p: num(m.slp) ?? (num(m.altim) ? (num(m.altim) < 950 ? num(m.altim) * 33.8639 : num(m.altim)) : null),
        vis: m.visib || null,
        wx: m.wxString || null,
        c: m.cover || null,
        f: m.fltCat || null,   // 飞行规则 VFR/MVFR/IFR/LIFR(API 官方分类,机场 FR 层着色用)
        cb: (() => {           // 最低 BKN/OVC 云底(ft),天花板参考
          const cs = Array.isArray(m.clouds) ? m.clouds : [];
          for (const c of cs) if (/BKN|OVC/i.test(c.cover || '') && Number.isFinite(num(c.base))) return num(c.base);
          return null;
        })(),
        o: m.obsTime || null,
        n: m.name || null,
        raw: m.rawOb || null,
      });
    }
  }
  return [...byIcao.values()].sort((a, b) => (b.o || 0) - (a.o || 0));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ---------- 缓存封装 ---------- */
let cache = null;
let cacheAt = 0;

async function getObs(force) {
  if (!force && cache && Date.now() - cacheAt < 10 * 60_000) return cache;
  const stations = await fetchStations();
  if (stations.length) {
    cache = { generated: Math.floor(Date.now() / 1000), count: stations.length, stations };
    cacheAt = Date.now();
  } else if (!cache) {
    throw new Error('METAR 抓取失败:全部分片不可用');
  }
  return cache;
}

module.exports = { getObs };
