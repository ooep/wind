/* 点位增值数据模块(第三批):
 *  - 机场库(本地烘焙 public/data/airports.json)+ 最近机场检索
 *  - METAR 站点观测 / TAF 航路预报(本地烘焙 obs JSON,或服务端代理)
 *  - 高空剖面(airgram)、空气质量/UV:Open-Meteo 按点查询产品,直连(其 API 允许跨域)
 *  - 海拔批量查询(测距工具用)
 */
import { resolveMode, isStatic, staticBase } from './api.js';
import { t, ta } from './i18n.js';

/* ---------------- 机场库(OurAirports 精简,5718 个) ---------------- */
let airportsPromise = null;
function loadAirports() {
  if (!airportsPromise) {
    airportsPromise = fetch(new URL('../data/airports.json', import.meta.url))
      .then((r) => { if (!r.ok) throw new Error(t('err.airports', { status: r.status })); return r.json(); });
  }
  return airportsPromise;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

/* 最近 n 个机场:[icao, iata, 名称, 纬度, 经度, 海拔ft, 国家, 城市] */
export async function nearestAirports(lat, lon, n = 8) {
  const list = await loadAirports();
  const scored = [];
  for (const a of list) {
    const d = haversineKm(lat, lon, a[3], a[4]);
    if (scored.length < n || d < scored[scored.length - 1].d) {
      scored.push({ icao: a[0], iata: a[1], name: a[2], lat: a[3], lon: a[4], elev: a[5], country: a[6], city: a[7], d });
      scored.sort((x, y) => x.d - y.d);
      if (scored.length > n) scored.pop();
    }
  }
  return scored;
}

/* ---------------- METAR 站点观测(与站点实况图层共用一套数据) ----------------
 * 返回 { generated, count, stations: [{i,lat,lon,t,td,wd,ws,wg,p,vis,wx,c,o,n,raw}] } */
export async function fetchObs() {
  await resolveMode();
  if (isStatic()) {
    const r = await fetch(`${staticBase()}/obs/latest.json`);
    if (!r.ok) throw new Error(t('err.obsNotReady', { status: r.status }));
    return r.json();
  }
  const r = await fetch('/api/obs');
  if (!r.ok) throw new Error(t('err.obsLoad'));
  return r.json();
}

/* ---------------- TAF:返回 { ICAO: [签发s, 有效起s, 有效止s, 原文] } ---------------- */
export async function fetchTaf(icaos) {
  if (!icaos.length) return {};
  await resolveMode();
  try {
    if (isStatic()) {
      const r = await fetch(`${staticBase()}/obs/taf.json`);
      if (!r.ok) return {};
      const all = (await r.json()).taf || {};
      const out = {};
      for (const id of icaos) if (all[id]) out[id] = all[id];
      return out;
    }
    const r = await fetch(`/api/taf?ids=${icaos.join(',')}`);
    if (!r.ok) return {};
    return (await r.json()).taf || {};
  } catch { return {}; }
}

/* ---------------- 高空剖面(airgram):Open-Meteo 气压层 ---------------- */
export const AIRGRAM_LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150];
const LEVEL_ALT_M = { 1000: 110, 925: 760, 850: 1500, 700: 3100, 600: 4200, 500: 5900, 400: 7200, 300: 9200, 250: 10400, 200: 11800, 150: 13500 };

export async function fetchAirgram(lat, lon) {
  const hourly = [];
  for (const lv of AIRGRAM_LEVELS) {
    hourly.push(`temperature_${lv}hPa`, `windspeed_${lv}hPa`, `winddirection_${lv}hPa`, `cloudcover_${lv}hPa`);
  }
  const params = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    hourly: hourly.join(','), forecast_days: '3', timezone: 'GMT',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(t('err.agLoad'));
  const d = await res.json();
  if (!d.hourly) throw new Error(t('err.agEmpty'));
  return { levels: AIRGRAM_LEVELS, levelAlt: LEVEL_ALT_M, h: d.hourly, tzOffset: d.utc_offset_seconds || 0 };
}

/* ---------------- 空气质量 / UV:Open-Meteo Air Quality(CAMS) ---------------- */
const AQ_HOURLY = 'pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,uv_index,us_aqi,dust,aerosol_optical_depth';
const AQ_HOURLY_POLLEN = AQ_HOURLY + ',alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen';

export async function fetchAirQuality(lat, lon) {
  const base = (hourly) => new URLSearchParams({
    latitude: String(lat), longitude: String(lon), hourly,
    forecast_days: '3', timezone: 'auto',
  });
  /* 花粉仅欧洲域提供,带花粉参数在区域外可能报错 → 失败降级重试 */
  let d;
  try {
    const r = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${base(AQ_HOURLY_POLLEN)}`);
    if (!r.ok) throw new Error(String(r.status));
    d = await r.json();
  } catch {
    const r = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${base(AQ_HOURLY)}`);
    if (!r.ok) throw new Error(t('err.aqLoad'));
    d = await r.json();
  }
  if (!d.hourly) throw new Error(t('err.aqEmpty'));
  return d;
}

/* US AQI 分级(着色用) */
export const AQI_BANDS = [
  { max: 50, get label() { return ta('aqiBand')[0]; }, color: '#7ddc9a' },
  { max: 100, get label() { return ta('aqiBand')[1]; }, color: '#ffd257' },
  { max: 150, get label() { return ta('aqiBand')[2]; }, color: '#ff9f43' },
  { max: 200, get label() { return ta('aqiBand')[3]; }, color: '#ff6b5e' },
  { max: 300, get label() { return ta('aqiBand')[4]; }, color: '#c39bff' },
  { max: 1e9, get label() { return ta('aqiBand')[5]; }, color: '#b3536b' },
];
export const aqiBand = (v) => (v == null ? null : AQI_BANDS.find((b) => v <= b.max));
export const UV_BANDS = [
  { max: 3, get label() { return ta('uvBand')[0]; }, color: '#7ddc9a' },
  { max: 6, get label() { return ta('uvBand')[1]; }, color: '#ffd257' },
  { max: 8, get label() { return ta('uvBand')[2]; }, color: '#ff9f43' },
  { max: 11, get label() { return ta('uvBand')[3]; }, color: '#ff6b5e' },
  { max: 1e9, get label() { return ta('uvBand')[4]; }, color: '#c39bff' },
];
export const uvBand = (v) => (v == null ? null : UV_BANDS.find((b) => v <= b.max));

/* ---------------- 海拔批量(测距工具) ---------------- */
export async function fetchElevations(lats, lons) {
  const params = new URLSearchParams({ latitude: lats.join(','), longitude: lons.join(',') });
  const r = await fetch(`https://api.open-meteo.com/v1/elevation?${params}`);
  if (!r.ok) throw new Error(t('err.elev'));
  const d = await r.json();
  return d.elevation || [];
}
