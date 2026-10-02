/*
 * 空气质量数据(Open-Meteo Air Quality API,CAMS 全球模式)
 * 城市库:Natural Earth populated places(本地 GeoJSON,已随前端分发)。
 * 一次烘焙/请求返回全部城市的 48h 逐小时序列:US AQI / PM2.5 / PM10 / O₃ / NO₂ / SO₂ / UV。
 * 被 tools/bake-aq.js(Action 定时烘焙)与 server.js /api/aq(本地模式实时取)共用。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const GEO = path.join(__dirname, '..', 'public', 'geo', 'ne_50m_populated_places_simple.geojson');
const API = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const VARS = 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,uv_index';
const CHUNK = 125; // 每请求城市数(URL 长度与响应体平衡)

function loadCities() {
  const gj = JSON.parse(fs.readFileSync(GEO, 'utf8'));
  const cities = [];
  const seen = new Set();
  for (const f of gj.features) {
    const p = f.properties || {};
    if (!f.geometry) continue;
    const [lon, lat] = f.geometry.coordinates;
    const name = p.name || p.nameascii || p.name_en;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = `${name}|${lat.toFixed(1)}|${lon.toFixed(1)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cities.push({ n: name, lat: +lat.toFixed(3), lon: +(((lon + 540) % 360) - 180).toFixed(3), pop: p.pop_max || 0 });
  }
  cities.sort((a, b) => b.pop - a.pop);
  return cities;
}

async function fetchRetry(url, retries = 5) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 429 || r.status === 503) throw new Error(`HTTP ${r.status} (rate)`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      const rate = /rate/.test(String(e.message));
      await new Promise((s) => setTimeout(s, Math.min((i + 1) * (rate ? 8000 : 3000), 45_000)));
    }
  }
  throw lastErr;
}

async function fetchAq() {
  const cities = loadCities();
  const out = [];
  let t0 = null;
  for (let i = 0; i < cities.length; i += CHUNK) {
    const chunk = cities.slice(i, i + CHUNK);
    const params = new URLSearchParams({
      latitude: chunk.map((c) => c.lat).join(','),
      longitude: chunk.map((c) => c.lon).join(','),
      hourly: VARS,
      forecast_days: '2',
      timezone: 'UTC',
    });
    let data;
    try {
      data = await fetchRetry(`${API}?${params}`);
    } catch (e) {
      console.error(`  aq: 城市块 ${i}-${i + chunk.length} 获取失败(${e.message}),跳过`);
      continue;
    }
    const arr = Array.isArray(data) ? data : [data];
    if (!t0 && arr[0] && arr[0].hourly && arr[0].hourly.time && arr[0].hourly.time[0]) {
      t0 = Date.parse(arr[0].hourly.time[0] + 'Z') || null;
    }
    arr.forEach((d, k) => {
      const c = chunk[k];
      if (!c) return;
      const h = d.hourly || {};
      out.push({
        n: c.n, lat: c.lat, lon: c.lon,
        a: h.us_aqi || [], p: h.pm2_5 || [], p10: h.pm10 || [],
        o3: h.ozone || [], no2: h.nitrogen_dioxide || [], so2: h.sulphur_dioxide || [],
        u: h.uv_index || [],
      });
    });
  }
  return { generated: Math.floor(Date.now() / 1000), t0, source: 'Open-Meteo Air Quality (CAMS 全球模式)', cities: out };
}

module.exports = { fetchAq, loadCities };
