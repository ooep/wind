/* 风云地球 — 主控:地图、图层状态、格点调度、时间轴联动 */
import { Grid, getView, clamp } from './util.js';
import { WIND, TEMP, MSL, PRECIP, CLOUD, RH, RADAR, DEW, PTYPE, CAPE, SNOWCM, VIS, PWAT, CWAT, NEWSNOW, SOILW, FRZLVL, CIN, WAVES, WPER, AQI, SST, PM25, NO2, O3, SO2, UVI, WENERGY } from './colormaps.js';
import { initApi, fetchGrid, clearGridCache, ensureGridVars, staticAvailableModels } from './api.js';
import { ParticleLayer } from './layers/particles.js';
import { ScalarLayer } from './layers/scalar.js';
import { IsobarLayer } from './layers/isobars.js';
import { RadarLayer } from './layers/radar.js';
import { AqiLayer } from './layers/aqi.js';
import { BarbLayer } from './layers/barbs.js';
import { GlobeView } from './globe.js';
import { SatelliteLayer } from './layers/satellite.js';
import { LightningLayer } from './layers/lightning.js';
import { TropicalLayer } from './layers/tropical.js';
import { StationLayer } from './layers/stations.js';
import { Timeline } from './timeline.js';
import { ForecastPanel, setDegUnit } from './panel.js';
import { initUnits, onUnits, units, unitsHash, convV, unitLabel, cycleUnit, fmtPresStr, fmtPrecipStr } from './units.js';
import { initShortcuts } from './shortcuts.js';
import { Search } from './search.js';
import { MeasureTool } from './measure.js';
import { FavoritesUI } from './favs.js';

initApi(Grid);

/* ---------- 图层定义 ---------- */
const ICONS = {
  wind: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 8c4-2.5 7 2.5 11 0M3 13c4-2.5 7 2.5 11 0M7 18c3-2 5 2 9 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  temp: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M10 4a2 2 0 1 1 4 0v9.3a4.5 4.5 0 1 1-4 0z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="17.5" r="2" fill="currentColor"/></svg>',
  pressure: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="13" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 13l4-4M7.5 16.5h.01M16.5 16.5h.01M12 5.5v1.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="13" r="1.4" fill="currentColor"/></svg>',
  precip: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 14a4.5 4.5 0 0 1-.5-9 5.5 5.5 0 0 1 10.7 1.2A4 4 0 0 1 17 14z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 17.5l-1 2.5M13 17.5l-1 2.5M17 17.5l-1 2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  radar: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 12L4 20M12 3a9 9 0 0 1 9 9M12 7.5A4.5 4.5 0 0 1 16.5 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 18a4.5 4.5 0 0 1-.5-9 5.5 5.5 0 0 1 10.7 1.2A4 4 0 0 1 17 18z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  humidity: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3.5s6 6.8 6 11a6 6 0 0 1-12 0c0-4.2 6-11 6-11z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  feels: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M10 4a2 2 0 1 1 4 0v9.3a4.5 4.5 0 1 1-4 0z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="17.5" r="2" fill="currentColor"/><path d="M17 5h4M17 9h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  dew: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 14.5s3 3.4 3 5.5a3 3 0 0 1-6 0c0-2.1 3-5.5 3-5.5z" fill="currentColor" opacity="0.8"/><path d="M14 3.5s6 6.8 6 11a6 6 0 0 1-6 6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  ptype: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 13a4.5 4.5 0 0 1-.5-9 5.5 5.5 0 0 1 10.7 1.2A4 4 0 0 1 17 13z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 16.5l-1 2M12 16.5l-1 2M16 16.5l-1 2M9 20l-.7 1.6M13 20l-.7 1.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  cape: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M13 2 5 13h5l-1.5 9L19 10h-5l1-8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  snow: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M12 3l-2 2.4M12 3l2 2.4M12 21l-2-2.4M12 21l2-2.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  vis: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  gust: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 7c4-2.5 7 2.5 11 0M2 12c4-2.5 7 2.5 11 0M4 17c3-2 5 2 9 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M17 10.5l3 1.5-3 1.5" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  pwat: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3.2s5 5.7 5 9.2a5 5 0 0 1-10 0c0-3.5 5-9.2 5-9.2z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 15.5v-4M9.8 13.8h4.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  cwat: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 13a4.5 4.5 0 0 1-.5-9 5.5 5.5 0 0 1 10.7 1.2A4 4 0 0 1 17 13z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 16.5c1 1.2 2 1.2 3 0s2-1.2 3 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  lcdc: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6.5 9a3.8 3.8 0 0 1-.4-7.6A4.6 4.6 0 0 1 15 2.9 3.4 3.4 0 0 1 14.5 9z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4 20h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity="0.55"/></svg>',
  mcdc: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6.5 11a3.8 3.8 0 0 1-.4-7.6A4.6 4.6 0 0 1 15 4.9 3.4 3.4 0 0 1 14.5 11z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4 20h16M6 16.5h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity="0.55"/></svg>',
  hcdc: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6.5 8a3.8 3.8 0 0 1-.4-7.6A4.6 4.6 0 0 1 15 1.9 3.4 3.4 0 0 1 14.5 8z" fill="none" stroke="currentColor" stroke-width="1.7" transform="translate(0 4)"/><path d="M4 20h16M6 16.5h12M8 13h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity="0.55"/></svg>',
  newsnow: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2v14M5.5 5.8l13 6.4M5.5 12.2l13-6.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M6 20.5h12M8 17.5c1.3 1 2.7 1 4 0s2.7-1 4 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.8"/></svg>',
  soilw: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 7.5s3.5 4 3.5 6.4a3.5 3.5 0 0 1-7 0C8.5 11.5 12 7.5 12 7.5z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4 18.5h16M6 21h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity="0.6"/></svg>',
  soilt: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M10 4a2 2 0 1 1 4 0v9.3a4.5 4.5 0 1 1-4 0z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="17.5" r="2" fill="currentColor"/><path d="M3.5 21h17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity="0.6"/></svg>',
  frzlvl: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 20l5.5-9 3.5 5.5L15 12l6 8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.5 11V4.5M6.8 6.2L8.5 4.5l1.7 1.7M14.5 6.5L17 4m0 0l-2.2-.4M17 4l-.4 2.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.8"/></svg>',
  cin: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M13 2 5 13h5l-1.5 9L19 10h-5l1-8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" opacity="0.45"/><path d="M4 21.5h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  wvh: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M2.5 16c2.4-2.2 4.8-2.2 7.2 0s4.8 2.2 7.2 0 3.6-1.8 4.6-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M2.5 20c2.4-2.2 4.8-2.2 7.2 0s4.8 2.2 7.2 0 3.6-1.8 4.6-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity="0.55"/><path d="M12 3.5c2 1.6 3.2 3.2 3.2 4.9A3.2 3.2 0 0 1 12 11.6a3.2 3.2 0 0 1-3.2-3.2c0-1.7 1.2-3.3 3.2-4.9z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  wvp: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.5V12l3.2 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M7 19.5c2-1.6 4-1.6 6 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.6"/></svg>',
  swvh: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M2.5 10.5c3-2.8 6-2.8 9.5 0s6.5 2.8 9.5 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M2.5 16.5c3-2.8 6-2.8 9.5 0s6.5 2.8 9.5 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity="0.65"/></svg>',
  swvp: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="10.5" r="7.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 6V10.5l3 1.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M3.5 20.5c2.8-2 5.7-2 8.5 0s5.7 2 8.5 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/></svg>',
  wwh: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M2.5 11.5c1.6-2.6 3.2-2.6 4.8 0s3.2 2.6 4.8 0 3.2-2.6 4.8 0 3.2 2.6 4.8 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M2.5 17c1.6-2.6 3.2-2.6 4.8 0s3.2 2.6 4.8 0 3.2-2.6 4.8 0 3.2 2.6 4.8 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity="0.6"/></svg>',
  wwp: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.5V12l2.8 1.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M6.5 18.5c1.5-1.8 3-1.8 4.5 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.65"/></svg>',
  wve: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M2.5 18c2.4-2.2 4.8-2.2 7.2 0s4.8 2.2 7.2 0 3.6-1.8 4.6-1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M13.5 2.5 7.5 10.5h3.6L9.5 17l6.8-8.5h-3.7l1.6-6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  aqi: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3.5 9c3.2-1.6 6.3-1.6 9.4 0 2.4 1.2 4.6 1.3 6.6.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3.5 13.5c3.2-1.6 6.3-1.6 9.4 0 2.4 1.2 4.6 1.3 6.6.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3.5 18c3.2-1.6 6.3-1.6 9.4 0 2.4 1.2 4.6 1.3 6.6.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity="0.55"/></svg>',
  wetbulb: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M10 4a2 2 0 1 1 4 0v9.3a4.5 4.5 0 1 1-4 0z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.6 13.2s2.2 2.5 2.2 4a2.2 2.2 0 0 1-4.4 0c0-1.5 2.2-4 2.2-4z" fill="currentColor"/></svg>',
  sst: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M2.5 16.5c2.4-2.2 4.8-2.2 7.2 0s4.8 2.2 7.2 0 3.6-1.8 4.6-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 3.5c2.3 1.9 3.7 3.7 3.7 5.6a3.7 3.7 0 0 1-7.4 0c0-1.9 1.4-3.7 3.7-5.6z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  barbs: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 18L18 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M18 6l-5 1.2M18 6l-1.2 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  pm25: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="8.5" cy="9" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="15.5" cy="14.5" r="4.4" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="7" cy="17" r="1.8" fill="currentColor"/></svg>',
  pm10: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="8" cy="8.5" r="3.8" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="15.5" cy="15" r="5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="6.5" cy="17.8" r="1.7" fill="currentColor"/><circle cx="18" cy="6.8" r="1.4" fill="currentColor"/></svg>',
  uv: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v2.8M12 18.7v2.8M2.5 12h2.8M18.7 12h2.8M5.2 5.2l2 2M16.8 16.8l2 2M18.8 5.2l-2 2M7.2 16.8l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  no2: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="9" cy="9.5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="15" cy="15" r="4.6" fill="none" stroke="currentColor" stroke-width="1.7" opacity="0.65"/></svg>',
  o3: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  so2: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="8" cy="8.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="15.5" cy="10" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.7"/><circle cx="11" cy="16" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.85"/></svg>',
};

const LAYERS = [
  { id: 'wind', label: '风场', unit: 'm/s', cat: 'wind', cmap: WIND, variable: 'wind', fmt: (v) => String(Math.round(convV('wind', v))) },
  { id: 'gust', label: '阵风', unit: 'm/s', cat: 'wind', cmap: WIND, variable: 'gust', fmt: (v) => String(Math.round(convV('wind', v))), models: ['gfs_raw'] },
  { id: 'barbs', label: '风向杆', unit: 'kt', cat: 'wind', cmap: WIND, special: 'barbs', fmt: (v) => String(Math.round(convV('wind', v))) },
  { id: 'temp', label: '温度', unit: '°C', cat: 'temp', cmap: TEMP, variable: 'temp', fmt: (v) => String(Math.round(convV('temp', v))) },
  { id: 'feels', label: '体感', unit: '°C', cat: 'temp', cmap: TEMP, variable: 'feels', fmt: (v) => String(Math.round(convV('temp', v))) },
  { id: 'wetbulb', label: '湿球温度', unit: '°C', cat: 'temp', cmap: TEMP, variable: 'wetbulb', fmt: (v) => String(Math.round(convV('temp', v))) },
  { id: 'dew', label: '露点', unit: '°C', cat: 'temp', cmap: DEW, variable: 'dew', fmt: (v) => String(Math.round(convV('temp', v))) },
  { id: 'humidity', label: '湿度', unit: '%', cmap: RH, variable: 'rh', fmt: (v) => Math.round(v), levels: true },
  { id: 'frzlvl', label: '0°C层高度', unit: 'm', cmap: FRZLVL, variable: 'frzlvl', fmt: (v) => String(Math.round(v / 100) * 100), models: ['gfs_raw'] },
  { id: 'cloud', label: '总云量', unit: '%', cmap: CLOUD, variable: 'cloud', fmt: (v) => Math.round(v) },
  { id: 'lcdc', label: '低云', unit: '%', cmap: CLOUD, variable: 'lcdc', fmt: (v) => Math.round(v), models: ['gfs_raw'] },
  { id: 'mcdc', label: '中云', unit: '%', cmap: CLOUD, variable: 'mcdc', fmt: (v) => Math.round(v), models: ['gfs_raw'] },
  { id: 'hcdc', label: '高云', unit: '%', cmap: CLOUD, variable: 'hcdc', fmt: (v) => Math.round(v), models: ['gfs_raw'] },
  { id: 'cwat', label: '云水', unit: 'mm', cmap: CWAT, variable: 'cwat', fmt: (v) => v.toFixed(2), models: ['gfs_raw'] },
  { id: 'precip', label: '降水', unit: 'mm/h', cat: 'precip', cmap: PRECIP, variable: 'precip', fmt: (v) => fmtPrecipStr(v) },
  { id: 'ptype', label: '相态', unit: '', cmap: PTYPE, variable: 'ptype', fmt: (v) => ['—', '雨', '冻雨', '雪'][Math.round(v)] || '' },
  { id: 'vis', label: '能见度', unit: 'km', cmap: VIS, variable: 'vis', fmt: (v) => Math.round(v), models: ['gfs_raw'] },
  { id: 'snow', label: '积雪', unit: 'cm', cmap: SNOWCM, variable: 'snowd', fmt: (v) => Math.round(v), models: ['gfs_raw'] },
  { id: 'newsnow', label: '新雪', unit: 'cm', cmap: NEWSNOW, variable: 'newsnow', fmt: (v) => (v < 1 ? v.toFixed(1) : Math.round(v)), models: ['gfs_raw'] },
  { id: 'cape', label: '雷暴 CAPE', unit: 'J/kg', cmap: CAPE, variable: 'cape', fmt: (v) => Math.round(v), models: ['gfs_raw'] },
  { id: 'cin', label: '对流抑制', unit: 'J/kg', cmap: CIN, variable: 'cin', fmt: (v) => Math.round(v), models: ['gfs_raw'] },
  { id: 'pwat', label: '可降水', unit: 'mm', cmap: PWAT, variable: 'pwat', fmt: (v) => (v < 10 ? v.toFixed(1) : Math.round(v)), models: ['gfs_raw'] },
  { id: 'pressure', label: '气压', unit: 'hPa', cat: 'pressure', cmap: MSL, variable: 'msl', fmt: (v) => fmtPresStr(v), isobars: true },
  { id: 'soilw', label: '土壤湿度', unit: '%', cmap: SOILW, variable: 'soilw', fmt: (v) => Math.round(v * 100), models: ['gfs_raw'] },
  { id: 'soilt', label: '土壤温度', unit: '°C', cat: 'temp', cmap: TEMP, variable: 'soilt', fmt: (v) => String(Math.round(convV('temp', v))), models: ['gfs_raw'] },
  { id: 'radar', label: '雷达', unit: 'dBZ', cmap: RADAR, special: 'radar', fmt: (v) => Math.round(v) },
  { id: 'wvh', label: '波高', unit: 'm', cmap: WAVES, variable: 'wvh', fmt: (v) => v.toFixed(1), models: ['waves_raw'] },
  { id: 'wvp', label: '波周期', unit: 's', cmap: WPER, variable: 'wvp', fmt: (v) => v.toFixed(1), models: ['waves_raw'] },
  { id: 'swvh', label: '涌浪高度', unit: 'm', cmap: WAVES, variable: 'swvh', fmt: (v) => v.toFixed(1), models: ['waves_raw'] },
  { id: 'swvp', label: '涌浪周期', unit: 's', cmap: WPER, variable: 'swvp', fmt: (v) => v.toFixed(1), models: ['waves_raw'] },
  { id: 'wwh', label: '风浪高度', unit: 'm', cmap: WAVES, variable: 'wwh', fmt: (v) => v.toFixed(1), models: ['waves_raw'] },
  { id: 'wwp', label: '风浪周期', unit: 's', cmap: WPER, variable: 'wwp', fmt: (v) => v.toFixed(1), models: ['waves_raw'] },
  { id: 'wve', label: '波浪能量', unit: 'kW/m', cmap: WENERGY, variable: 'wve', fmt: (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v))), models: ['waves_raw'] },
  { id: 'sst', label: '海温', unit: '°C', cat: 'temp', cmap: SST, variable: 'sst', fmt: (v) => { const c = convV('temp', v); return Math.abs(c) < 1 ? c.toFixed(1) : String(Math.round(c)); }, models: ['ocean_raw'] },
  { id: 'aqi', label: '空气质量', unit: 'AQI', cmap: AQI, special: 'aqi', aqField: 'a', fmt: (v) => Math.round(v) },
  { id: 'pm25', label: 'PM2.5', unit: 'μg/m³', cmap: PM25, special: 'aqi', aqField: 'p', fmt: (v) => Math.round(v) },
  { id: 'pm10', label: 'PM10', unit: 'μg/m³', cmap: PM25, special: 'aqi', aqField: 'p10', fmt: (v) => Math.round(v) },
  { id: 'no2', label: '二氧化氮', unit: 'μg/m³', cmap: NO2, special: 'aqi', aqField: 'no2', fmt: (v) => Math.round(v) },
  { id: 'o3', label: '臭氧', unit: 'μg/m³', cmap: O3, special: 'aqi', aqField: 'o3', fmt: (v) => Math.round(v) },
  { id: 'so2', label: '二氧化硫', unit: 'μg/m³', cmap: SO2, special: 'aqi', aqField: 'so2', fmt: (v) => Math.round(v) },
  { id: 'uv', label: 'UV 指数', unit: '', cmap: UVI, special: 'aqi', aqField: 'u', fmt: (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v))) },
];

/* 分组(手风琴):图层按钮按组分节收纳,对齐 Windy 的导航结构 */
const GROUPS = [
  { id: 'obs', label: '观测', layers: ['radar'] },
  { id: 'wind', label: '风', layers: ['wind', 'gust', 'barbs'] },
  { id: 'temp', label: '温湿', layers: ['temp', 'feels', 'wetbulb', 'dew', 'humidity', 'frzlvl'] },
  { id: 'cloud', label: '云雨', layers: ['cloud', 'lcdc', 'mcdc', 'hcdc', 'cwat', 'precip', 'ptype', 'vis'] },
  { id: 'snow', label: '雪', layers: ['snow', 'newsnow'] },
  { id: 'conv', label: '对流气压', layers: ['cape', 'cin', 'pwat', 'pressure'] },
  { id: 'ground', label: '土壤', layers: ['soilw', 'soilt'] },
  { id: 'ocean', label: '海洋', layers: ['wvh', 'wvp', 'swvh', 'swvp', 'wwh', 'wwp', 'wve', 'sst'] },
  { id: 'air', label: '空气', layers: ['aqi', 'pm25', 'pm10', 'no2', 'o3', 'so2', 'uv'] },
];

/* 当前图层渲染所需的原始变量(派生图层映射到其数据来源) */
function varNeeds(def) {
  if (!def || def.special) return [];
  const M = {
    wind: ['u', 'v'], gust: ['gust'], barbs: ['u', 'v'],
    feels: ['temp', 'rh', 'u', 'v'], wetbulb: ['temp', 'rh'], dew: ['temp', 'rh'], ptype: ['temp', 'precip'],
  };
  return M[def.variable] || [def.variable];
}
const layerById = (id) => LAYERS.find((l) => l.id === id);

/* 当前图层+气压层所需的变量键:层级>0 时给 u/v/temp/rh 加后缀(静态包按层懒加载) */
function needsFor(def) {
  const base = [...new Set(['u', 'v', ...varNeeds(def)])];
  /* 海浪模式:粒子着色取波高,任意波浪图层都需 wvh 就绪 */
  if (state.model === 'waves_raw' && !base.includes('wvh')) base.push('wvh');
  if (!state.level) return base;
  return base.map((vk) => ['u', 'v', 'temp', 'rh'].includes(vk) ? `${vk}@${state.level}` : vk);
}

// 支持气压层切换的图层(风/风向杆/温/湿)
const LEVEL_LAYERS = new Set(['wind', 'barbs', 'temp', 'humidity']);
// 海浪/海温模式的图层白名单:该模式仅提供各自要素
const WAVE_ONLY = new Set(['wvh', 'wvp']);
const OCEAN_ONLY = new Set(['sst']);
function layerAvailable(def, model) {
  if (def.models) return def.models.includes(model);
  if (model === 'waves_raw') return WAVE_ONLY.has(def.id);
  if (model === 'ocean_raw') return OCEAN_ONLY.has(def.id);
  return true;
}

/* ---------- URL 状态(分享/恢复) ---------- */
const urlState = (() => {
  try { return Object.fromEntries(new URLSearchParams(location.hash.slice(1))); } catch { return {}; }
})();
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
let urlTimer = 0;

const MODEL_LABELS = {
  gfs_raw: 'NOAA GFS 0.5°(AWS 开放数据,原始 GRIB2 自解码)',
  gefs_raw: 'NOAA GEFS 控制成员 0.5°(AWS 开放数据,原始 GRIB2 自解码)',
  ecmwf_raw: 'ECMWF IFS 0.25°(ECMWF Open Data,原始 GRIB2 自解码)',
  aifs_raw: 'ECMWF AIFS 0.25°(AI 模式,ECMWF Open Data,原始 GRIB2 自解码)',
  waves_raw: 'NOAA GFS Wave 0.25°(海浪模式,AWS 开放数据,原始 GRIB2 自解码)',
  ocean_raw: 'NOAA OISST 日更海温(NCEI,逐日分析场)',
  best_match: 'Open-Meteo 最佳匹配', gfs_seamless: 'Open-Meteo NOAA GFS',
  icon_seamless: 'Open-Meteo DWD ICON', ecmwf_ifs025: 'Open-Meteo ECMWF IFS',
};

const state = {
  model: urlState.m || 'gfs_raw',
  layer: urlState.l || 'wind',
  particles: true,
  basemap: urlState.bm || 'vector',
  level: num(urlState.lv, 0),
  opacity: Math.min(1, Math.max(0.35, num(urlState.op, 100) / 100)),
  overlays: new Set(String(urlState.o || '').split(',').filter((x) => ['lightning', 'satellite', 'tropical', 'stations'].includes(x))),
  grid: null,
  gridKey: '',
  fetchingKey: '',
  timePos: Date.now(),
};

/* ---------- 地图 ---------- */
const map = L.map('map', {
  zoomControl: false,
  attributionControl: false,
  zoomAnimation: false,
  worldCopyJump: true,
  minZoom: 2,
  maxZoom: 10,
  center: [num(urlState.lat, 30), num(urlState.lon, 110)],
  zoom: Math.min(10, Math.max(2, num(urlState.z, 4))),
});

/* 底图:矢量线划(Natural Earth 本地化,渲染于气象层之上,不被填色遮挡);
 * 卫星 = NASA GIBS 影像在气象层之下 + 矢量线划叠加(hybrid)。 */
import { VectorBasemap, LandFill } from './basemap.js?v=2';
let satLayer = null;
const GIBS_URL = (date) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
const vectorBasemap = new VectorBasemap(map);
const landfill = new LandFill(map);
const OPENTOPO_URL = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';

function setBasemap(kind) {
  state.basemap = kind;
  syncUrl();
  if (satLayer) { map.removeLayer(satLayer); satLayer = null; }
  /* 深色 = 本地陆地填充(零外部依赖);卫星/地形 = 外部影像瓦片;线划均叠加其上 */
  landfill.show(kind === 'dark');
  if (kind === 'satellite') {
    const d = new Date(Date.now() - 86400e3); // 取完整的一日合成影像
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    satLayer = L.tileLayer(GIBS_URL(date), {
      maxNativeZoom: 9, maxZoom: 10, attribution: 'NASA GIBS',
    }).addTo(map);
  } else if (kind === 'terrain') {
    satLayer = L.tileLayer(OPENTOPO_URL, {
      maxNativeZoom: 10, maxZoom: 10, attribution: 'OpenTopoMap',
    }).addTo(map);
  }
}
setBasemap('vector');

/* ---------- 图层实例 ---------- */
const particles = new ParticleLayer(map);
const scalar = new ScalarLayer(map);
const isobars = new IsobarLayer(map);
const radar = new RadarLayer(map);
const satellite = new SatelliteLayer(map);
const lightning = new LightningLayer(map);
const tropical = new TropicalLayer(map);
const stations = new StationLayer(map);
const aqi = new AqiLayer(map);
const barbs = new BarbLayer(map);
const timeline = new Timeline({ onChange: onTimeChange });
const panel = new ForecastPanel(() => state.model);

/* ---------- 图例(按色标分段取 5 档,兼容非线性色标) ---------- */
const legendEl = document.getElementById('legend');
function updateLegend() {
  const def = LAYERS.find((l) => l.id === state.layer);
  if (!def) { legendEl.hidden = true; return; }
  legendEl.hidden = false;
  document.getElementById('legend-title').textContent = `${def.label} · ${def.cat ? unitLabel(def.cat) : def.unit}`;
  document.getElementById('legend-bar').style.background = def.cmap.gradientCss();
  const stops = def.cmap.stops;
  const idxs = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (stops.length - 1))))];
  document.getElementById('legend-labels').innerHTML =
    idxs.map((i) => `<span>${def.fmt(stops[i][0])}</span>`).join('');
}

/* Ventusky 式:点击色标循环切换该图层的单位制 */
legendEl.title = '点击切换单位';
legendEl.addEventListener('click', () => {
  const def = layerById(state.layer);
  if (!def || !def.cat) { hint('该图层暂无单位切换'); return; }
  cycleUnit(def.cat);
});

/* 图例显隐(记忆偏好) */
function applyLegendPref() {
  document.body.classList.toggle('legend-off', localStorage.getItem('fy_legend_off') === '1');
}
document.getElementById('legend-btn').addEventListener('click', () => {
  const off = document.body.classList.toggle('legend-off');
  try { localStorage.setItem('fy_legend_off', off ? '1' : '0'); } catch { /* 隐私模式 */ }
  hint(off ? '图例已隐藏' : '图例已显示');
});

/* ---------- 图层切换(分组手风琴) ---------- */
const layerBtnBox = document.getElementById('layer-buttons');
function refreshLayerButtons() {
  for (const btn of layerBtnBox.querySelectorAll('.layer-btn')) {
    const def = layerById(btn.dataset.layer);
    btn.classList.toggle('dim', !layerAvailable(def, state.model));
  }
}
let openGroups = new Set();
function renderLayerGroups() {
  layerBtnBox.innerHTML = '';
  for (const g of GROUPS) {
    const sec = document.createElement('div');
    sec.className = 'lgroup' + (openGroups.has(g.id) ? ' open' : '');
    sec.dataset.group = g.id;
    const head = document.createElement('button');
    head.className = 'lgroup-head';
    head.innerHTML = `<span>${g.label}</span><i>${g.layers.length}</i><b class="chev">›</b>`;
    head.addEventListener('click', () => {
      if (openGroups.has(g.id)) openGroups.delete(g.id);
      else openGroups.add(g.id);
      sec.classList.toggle('open', openGroups.has(g.id));
    });
    const body = document.createElement('div');
    body.className = 'lgroup-body';
    for (const id of g.layers) {
      const def = layerById(id);
      const btn = document.createElement('button');
      btn.className = 'layer-btn';
      btn.dataset.layer = def.id;
      btn.innerHTML = `${ICONS[def.id]}<span>${def.label}</span><small>${def.unit}</small>`;
      btn.addEventListener('click', () => setLayer(def.id));
      body.appendChild(btn);
    }
    sec.appendChild(head);
    sec.appendChild(body);
    layerBtnBox.appendChild(sec);
  }
  refreshLayerButtons();
  syncActiveLayerBtn();
}
function syncActiveLayerBtn() {
  document.querySelectorAll('.layer-btn').forEach((b) => b.classList.toggle('active', b.dataset.layer === state.layer));
  document.querySelectorAll('.lgroup').forEach((sec) => {
    const g = GROUPS.find((g) => g.id === sec.dataset.group);
    sec.classList.toggle('has-active', !!g && g.layers.includes(state.layer));
  });
}
function openGroupOf(layerId) {
  const g = GROUPS.find((g) => g.layers.includes(layerId));
  if (g) { openGroups.add(g.id); renderLayerGroups(); }
}

async function setLayer(id, silent = false) {
  const def0 = layerById(id);
  if (!layerAvailable(def0, state.model)) {
    toast(def0.models && def0.models.includes('waves_raw')
      ? `「${def0.label}」为海浪图层,请在设置中把模型切换到 NOAA Wave`
      : `「${def0.label}」暂不支持当前模式`);
    return;
  }
  state.layer = id;
  syncUrl();
  document.getElementById('cursor-tip').hidden = true; // 旧图层读数立即失效
  openGroupOf(id);
  syncActiveLayerBtn();
  const def = layerById(id);
  updateLevelBar();

  const isRadar = def.special === 'radar';
  const isAqi = def.special === 'aqi';
  const isBarbs = def.special === 'barbs';
  radar.show(isRadar);
  aqi.show(isAqi);
  if (isAqi) aqi.setField(def.aqField || 'a', def.cmap);
  barbs.show(isBarbs);
  document.body.dataset.radarActive = isRadar ? '1' : '0';

  if (!isRadar && !isAqi && !isBarbs) {
    scalar.show(true);
    scalar.setVar(def.variable, def.cmap);
  } else {
    scalar.show(false);
  }
  /* 粒子着色:海浪模式按波高,其余按风速 */
  particles.setColorVar(state.model === 'waves_raw' ? 'wvh' : null, WAVES);
  isobars.show(!!def.isobars);
  updateLegend();
  /* 观测数据有效窗(雷达:过去 2h 观测 + 30min 外推)供时间轴分段着色 */
  timeline.setDataWindow(def.special === 'radar' ? { past: 2.1 * 3600e3, fcst: 1800e3 } : null);

  /* 静态模式:按需补拉当前图层变量 */
  const needs = needsFor(def);
  if (state.grid && needs.length && needs.some((vk) => !state.grid.vars[vk.split('@')[0]])) {
    loadingEl.hidden = false;
    try {
      await ensureGridVars(state.grid, needs);
    } catch (e) {
      toast(`图层数据加载失败:${e.message}`);
    } finally {
      loadingEl.hidden = true;
    }
  }
  onTimeChange(state.timePos);
  if (!silent) hint(`图层 · ${def.label}`);
}

/* 粒子开关 */
const particleBtn = document.getElementById('toggle-particles');
particleBtn.addEventListener('click', () => {
  state.particles = !state.particles;
  particleBtn.classList.toggle('active', state.particles);
  particles.setEnabled(state.particles);
});

/* ---------- 实时叠加层(观测类,可与任意主图层共存) ---------- */
const OVERLAYS = [
  { id: 'lightning', label: '闪电', title: 'Blitzortung 实时闪电 · 最近 90 分钟',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M13 2 5 13h5l-1.5 9L19 10h-5l1-8z" fill="currentColor"/></svg>' },
  { id: 'satellite', label: '卫星', title: '卫星云图:GOES/向日葵9 红外与真彩(10 分钟)/ 全球真彩·夜光(VIIRS 每日)',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 4.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 7.5a6.5 6.5 0 0 1 2.6-5.2M18.5 7.5a6.5 6.5 0 0 0-2.6-5.2M8.1 2.3 7 3.4M16.9 2.3l1.1 1.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8.5 13.5 4 18M15.5 13.5 20 18M9.5 20.5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' },
  { id: 'tropical', label: '台风', title: '活动热带气旋路径:JMA(西太平洋)+ NOAA NHC(大西洋/东太平洋)',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="3.4" fill="currentColor"/><path d="M12 4a8 8 0 0 1 7 4.2M12 20a8 8 0 0 1-7-4.2M5.6 8.6A8 8 0 0 1 12 4M18.4 15.4A8 8 0 0 1 12 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' },
  { id: 'stations', label: '站点', title: '全球机场/气象站 METAR 实测(NOAA,每小时更新)',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M6 6a8.5 8.5 0 0 0 0 12M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' },
];
const overlayBtnBox = document.getElementById('overlay-buttons');
const satChannelWrap = document.getElementById('sat-channel-wrap');
for (const ov of OVERLAYS) {
  const btn = document.createElement('button');
  btn.className = 'layer-btn overlay-btn';
  btn.id = `ov-${ov.id}`;
  btn.title = ov.title;
  btn.innerHTML = `${ov.icon}<span>${ov.label}</span>`;
  btn.addEventListener('click', () => toggleOverlay(ov.id, !state.overlays.has(ov.id)));
  overlayBtnBox.appendChild(btn);
}
document.getElementById('sat-channel').value = satellite.channel;
document.getElementById('sat-channel').addEventListener('change', (e) => {
  satellite.setChannel(e.target.value);
});

function toggleOverlay(id, on, silent) {
  if (on) state.overlays.add(id); else state.overlays.delete(id);
  if (id === 'satellite') {
    satellite.show(on);
    satChannelWrap.hidden = !on;
  } else if (id === 'lightning') lightning.show(on);
  else if (id === 'tropical') tropical.show(on);
  else if (id === 'stations') stations.show(on);
  document.getElementById(`ov-${id}`)?.classList.toggle('active', on);
  if (!silent) syncUrl();
}
for (const id of [...state.overlays]) toggleOverlay(id, true, true);

/* ---------- 图层不透明度 ---------- */
const opacitySlider = document.getElementById('opacity-slider');
const opacityVal = document.getElementById('opacity-val');
function applyOpacity(v) {
  state.opacity = v;
  scalar.setOpacity(v);
  radar.setBaseOpacity(0.82 * v);
  opacitySlider.value = Math.round(v * 100);
  opacityVal.textContent = Math.round(v * 100) + '%';
}
opacitySlider.addEventListener('input', () => {
  applyOpacity(opacitySlider.value / 100);
  syncUrl();
});

/* ---------- 格点调度 ---------- */
const loadingEl = document.getElementById('grid-loading');
let fetchTimer = null;

function gridSpec() {
  const z = map.getZoom();
  if (z < 3) return { w: -180, s: -85, e: 180, n: 85, step: 5 };
  const b = map.getBounds().pad(0.2);
  let step = z < 5 ? 2 : z < 6.5 ? 0.75 : z < 8 ? 0.3 : 0.12;
  let w = Math.floor(Math.max(-180, b.getWest()) / step) * step;
  let e = Math.ceil(Math.min(180, b.getEast()) / step) * step;
  let s = Math.floor(Math.max(-85, b.getSouth()) / step) * step;
  let n = Math.ceil(Math.min(85, b.getNorth()) / step) * step;
  if (e <= w) e = w + 360;
  // 控制单次格点规模(≤ ~3000 点 ≈ 7 个上游请求,首屏更快)
  let pts = ((n - s) / step + 1) * ((e - w) / step + 1);
  while (pts > 3000) {
    step = Number((step * 1.4).toFixed(3));
    w = Math.floor(w / step) * step; e = Math.ceil(e / step) * step;
    s = Math.floor(s / step) * step; n = Math.ceil(n / step) * step;
    pts = ((n - s) / step + 1) * ((e - w) / step + 1);
  }
  return { w, s, e, n, step };
}
const specKey = (s) => `${state.model}|${s.w.toFixed(3)},${s.s.toFixed(3)},${s.e.toFixed(3)},${s.n.toFixed(3)}|${s.step}`;

function scheduleGridFetch(delay = 450) {
  clearTimeout(fetchTimer);
  fetchTimer = setTimeout(fetchGridNow, delay);
}

async function fetchGridNow() {
  const spec = gridSpec();
  const key = specKey(spec);
  if (key === state.gridKey && state.grid) return;
  if (state.fetchingKey === key) return;
  state.fetchingKey = key;
  loadingEl.hidden = false;
  let rateLimited = false;
  try {
    const needs = needsFor(layerById(state.layer));
    const { grid } = await fetchGrid({ ...spec, model: state.model, level: state.level, needs });
    // 请求期间视图又变了:丢弃(已缓存,稍后会重新取)
    const latest = gridSpec();
    if (specKey(latest) !== key) { return; }
    if (grid.stale) {
      const ageH = Math.max(1, Math.round((Date.now() / 1000 - (grid.generated || 0)) / 3600));
      toast(`上游数据源限流中,正在展示约 ${ageH} 小时前缓存的气象数据`);
    }
    applyGrid(grid, key);
  } catch (e) {
    const msg = String(e.message || e);
    if (/daily/i.test(msg)) {
      rateLimited = true;
      state.fetchingKey = '';
      loadingEl.hidden = true;
      toast('数据源当日免费配额已用尽,明日自动恢复;设置 OPEN_METEO_API_KEY 环境变量可获得更高配额(见 README)');
      return;
    }
    if (/limit|429/i.test(msg)) {
      rateLimited = true;
      state.fetchingKey = '';
      loadingEl.hidden = true;
      toast('上游数据源限流中,90 秒后自动重试…');
      clearTimeout(fetchTimer);
      fetchTimer = setTimeout(fetchGridNow, 90_000);
      return;
    }
    toast(`气象格点加载失败:${msg},15 秒后自动重试`);
    clearTimeout(fetchTimer);
    fetchTimer = setTimeout(() => { state.fetchingKey = ''; fetchGridNow(); }, 15_000);
    return;
  } finally {
    state.fetchingKey = '';
    loadingEl.hidden = true;
    // 若排队期间视图变化,补一次(限流时除外)
    if (!rateLimited && specKey(gridSpec()) !== state.gridKey) scheduleGridFetch(200);
  }
}

function applyGrid(grid, key) {
  state.grid = grid;
  state.gridKey = key;
  particles.setGrid(grid);
  scalar.setGrid(grid);
  isobars.setGrid(grid);
  barbs.setGrid(grid);
  timeline.setTimes(grid.times);
  /* 静态模式:确保当前图层 + 粒子所需变量已就绪再首帧渲染 */
  const needs = needsFor(layerById(state.layer));
  const pending = needs.some((vk) => !grid.vars[vk.split('@')[0]])
    ? ensureGridVars(grid, needs).catch((e) => toast(`部分图层数据未就绪:${e.message}`))
    : Promise.resolve();
  pending.then(() => {
    if (state.grid !== grid) return; // 期间已切换到更新的格点
    if (state.pendingTime) {
      const t = state.pendingTime;
      state.pendingTime = null;
      timeline.setPos(Math.min(Math.max(t, grid.times[0]), grid.times[grid.times.length - 1]));
    } else onTimeChange(state.timePos);
  });
}

map.on('moveend zoomend', () => { scheduleGridFetch(800); syncUrl(); });

/* ---------- 时间联动 ---------- */
function onTimeChange(ms) {
  state.timePos = ms;
  syncUrl();
  if (state.grid) {
    const fr = state.grid.frameAt(ms);
    state.fr = fr;
    scalar.setFrame(fr);
    isobars.setFrame(fr);
    particles.setFrame(fr);
    barbs.setFrame(fr);
  }
  radar.updateTime(ms);
  satellite.updateTime(ms);
}

/* ---------- 光标取值器(悬停读数) ---------- */
const tipEl = document.getElementById('cursor-tip');
const tipVal = document.getElementById('ct-val');
const tipSub = document.getElementById('ct-sub');
const DIR8 = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
let tipRaf = 0, tipXY = [0, 0], tipLL = null;

function tipContent(def, ll) {
  if (!state.grid) return null;
  if (def.special) return null; // 雷达为外部瓦片,无本地格点值
  const fr = state.grid.frameAt(state.timePos);
  const v = state.grid.sample(def.variable, ll.lng, ll.lat, fr);
  if (Number.isNaN(v)) return null;
  const unitStr = def.cat ? unitLabel(def.cat) : def.unit;
  let main = `${def.fmt(v)}${unitStr ? ' ' + unitStr : ''}`;
  if (def.variable === 'wind') {
    const uv = state.grid.sampleUV(ll.lng, ll.lat, fr);
    if (uv) {
      const [u, w] = uv;
      const bearing = (x, y) => (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
      const to = Math.round(bearing(u, w));          // 指向下风方向(箭头去向)
      const from = DIR8[Math.round(bearing(-u, -w) / 45) % 8];
      main = `<i class="ct-arrow" style="transform:rotate(${to - 90}deg)">➤</i>${Math.round(convV('wind', v))} ${unitLabel('wind')} ${from}风`;
    }
  }
  const lonN = ((ll.lng + 540) % 360) - 180;
  return { main, sub: `${ll.lat.toFixed(2)}°, ${lonN.toFixed(2)}°` };
}

map.on('mousemove', (e) => {
  if (e.originalEvent && e.originalEvent.pointerType === 'touch') return;
  tipLL = e.latlng.wrap();
  tipXY = [e.containerPoint.x, e.containerPoint.y];
  if (tipRaf) return;
  tipRaf = requestAnimationFrame(() => {
    tipRaf = 0;
    const def = LAYERS.find((l) => l.id === state.layer);
    const t = def && !timeline.playing && tipContent(def, tipLL);
    if (!t) { tipEl.hidden = true; return; }
    tipVal.innerHTML = t.main;
    tipSub.textContent = t.sub;
    tipEl.hidden = false;
    const x = Math.min(tipXY[0] + 16, window.innerWidth - 150);
    const y = Math.max(tipXY[1] - 44, 64);
    tipEl.style.transform = `translate(${x}px, ${y}px)`;
  });
});
map.on('mouseout movestart', () => { tipEl.hidden = true; });

/* ---------- 设置 ---------- */
const MODEL_SHORT = {
  gfs_raw: 'NOAA GFS', gefs_raw: 'NOAA GEFS', ecmwf_raw: 'ECMWF IFS', aifs_raw: 'ECMWF AIFS',
  waves_raw: 'NOAA Wave', ocean_raw: 'OISST 海温',
  best_match: 'OM 最佳匹配', gfs_seamless: 'OM GFS', icon_seamless: 'OM ICON', ecmwf_ifs025: 'OM ECMWF',
};
document.getElementById('model-select').addEventListener('change', (e) => {
  state.model = e.target.value;
  syncUrl();
  hint(`模式 · ${MODEL_SHORT[state.model] || state.model}`);
  window.__currentModelLabel = MODEL_LABELS[state.model];
  if (!LEVEL_LAYERS.has(state.layer) || state.model !== 'gfs_raw') { if (state.level) state.level = 0; }
  /* 模式切换后当前图层不可用 → 自动落到该模式的主图层 */
  if (!layerAvailable(layerById(state.layer), state.model)) {
    const home = state.model === 'waves_raw' ? 'wvh' : state.model === 'ocean_raw' ? 'sst' : 'wind';
    setLayer(home, true);
  } else particles.setColorVar(state.model === 'waves_raw' ? 'wvh' : null, WAVES);
  clearGridCache();
  state.grid = null; state.gridKey = '';
  refreshLayerButtons();
  updateLevelBar();
  scheduleGridFetch(0);
  panel.refresh();
});
document.getElementById('basemap-select').addEventListener('change', (e) => setBasemap(e.target.value));
/* ---------- 单位系统(注册表 + 设置弹层,替代原 °C/°F 单选) ---------- */
initUnits();
onUnits(() => {
  setDegUnit(units.temp.toLowerCase());
  updateLegend();
  timeline.refresh();
  panel.refresh();
  syncUrl();
});
setDegUnit(units.temp.toLowerCase());

/* ---------- 关于 ---------- */
const about = document.getElementById('about');
document.getElementById('about-btn').addEventListener('click', () => about.showModal());
document.getElementById('about-close').addEventListener('click', () => about.close());

/* ---------- 全屏 ---------- */
document.getElementById('fs-btn').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { toast('浏览器拒绝了全屏请求'); }
});

/* ---------- 移动端设置抽屉 ---------- */
const settingsEl = document.getElementById('settings');
const gearBtn = document.getElementById('settings-toggle');
gearBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsEl.classList.toggle('open');
  gearBtn.classList.toggle('active');
});
document.addEventListener('click', (e) => {
  if (!settingsEl.contains(e.target) && e.target !== gearBtn && settingsEl.classList.contains('open')) {
    settingsEl.classList.remove('open');
    gearBtn.classList.remove('active');
  }
});

/* ---------- 搜索 ---------- */
const search = new Search({
  onSelect({ lat, lon, name }) {
    map.flyTo([lat, lon], 9, { duration: 1.4 });
    setPin(lat, lon);
    panel.open(lat, lon);
    document.getElementById('panel-title').textContent = name;
  },
});

/* 收藏地点列表(与面板 ☆ 共享 localStorage) */
new FavoritesUI({
  go({ lat, lon, name }) {
    map.flyTo([lat, lon], 9, { duration: 1.4 });
    setPin(lat, lon);
    panel.open(lat, lon, name);
  },
});

let pin = null;
function setPin(lat, lon) {
  const icon = L.divIcon({ className: '', html: '<div class="marker-pin"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
  if (pin) pin.setLatLng([lat, lon]).setIcon(icon);
  else pin = L.marker([lat, lon], { icon, keyboard: false }).addTo(map);
}

/* ---------- 3D 地球视图 ---------- */
const globe = new GlobeView({
  getState: () => ({
    model: state.model, layer: state.layer, grid: state.grid, fr: state.fr,
    opacity: state.opacity, def: layerById(state.layer),
  }),
  toast,
  openPoint: (lat, lon) => { setPin(lat, lon); panel.open(lat, lon); },
});
document.getElementById('globe-btn').addEventListener('click', () => globe.toggle());

/* 测距/测面积工具:激活时点击只加点,不弹点位面板 */
const measure = new MeasureTool(map, { toast });
document.getElementById('measure-btn').addEventListener('click', () => measure.toggle());

/* 点击地图查预报(观测层命中站点/台风时已认领,此处跳过) */
map.on('click', (e) => {
  if (measure.active) return;
  if (window.__obsClickClaimed) { window.__obsClickClaimed = false; return; }
  setPin(e.latlng.lat, e.latlng.lng);
  panel.open(e.latlng.lat, e.latlng.lng);
});

/* ---------- 键盘(shortcuts.js 统一注册) ---------- */
function cycleLayer(dir) {
  const ids = GROUPS.flatMap((g) => g.layers).filter((id) => layerAvailable(layerById(id), state.model));
  if (!ids.length) return;
  const i = ids.indexOf(state.layer);
  const next = ids[(((i < 0 ? 0 : i) + dir) % ids.length + ids.length) % ids.length];
  if (next !== state.layer) setLayer(next);
}
function cycleLevel(dir) {
  if (!LEVEL_LAYERS.has(state.layer) || state.model !== 'gfs_raw') return;
  const i = LEVELS_UI.findIndex((l) => l.v === state.level);
  const next = LEVELS_UI[clamp(i + dir, 0, LEVELS_UI.length - 1)];
  setLevel(next.v);
}
initShortcuts({
  map, timeline,
  cycleLayer, cycleLevel,
  focusSearch: () => {
    const input = document.getElementById('search-input');
    input.focus(); input.select();
  },
});

/* ---------- URL 同步与分享 ---------- */
function syncUrl() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    const p = new URLSearchParams();
    p.set('m', state.model);
    p.set('l', state.layer);
    if (state.level) p.set('lv', state.level);
    p.set('bm', state.basemap);
    const c = map.getCenter();
    p.set('lat', c.lat.toFixed(3));
    p.set('lon', c.lng.toFixed(3));
    p.set('z', map.getZoom());
    if (state.timePos) p.set('t', state.timePos);
    if (state.opacity < 1) p.set('op', Math.round(state.opacity * 100));
    if (state.overlays.size) p.set('o', [...state.overlays].join(','));
    const uh = unitsHash();
    if (uh) p.set('u', uh);
    history.replaceState(null, '', '#' + p.toString());
  }, 600);
}
document.getElementById('share-btn').addEventListener('click', async () => {
  syncUrl();
  try {
    await navigator.clipboard.writeText(location.href);
    toast('分享链接已复制到剪贴板');
  } catch {
    toast('复制失败,请手动复制地址栏链接');
  }
});
document.getElementById('loc-btn').addEventListener('click', () => {
  if (!navigator.geolocation) { toast('浏览器不支持定位'); return; }
  toast('正在获取位置…');
  navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude: lat, longitude: lon } = pos.coords;
    map.flyTo([lat, lon], 10, { duration: 1.2 });
    setPin(lat, lon);
    panel.open(lat, lon);
  }, () => toast('定位失败:未授权或不可用'), { enableHighAccuracy: false, timeout: 10000 });
});

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(msg, ms = 5000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* 操作轻提示(右下角,区别于顶部的错误/状态 toast) */
let hintTimer = null;
function hint(msg, ms = 1500) {
  const el = document.getElementById('hint');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* ---------- 气压层选择器 ---------- */
const LEVELS_UI = [
  { v: 0, label: '表面' }, { v: 925, label: '925' }, { v: 850, label: '850' },
  { v: 700, label: '700' }, { v: 500, label: '500' }, { v: 300, label: '300' },
  { v: 250, label: '250' }, { v: 200, label: '200' }, { v: 150, label: '150' }, { v: 100, label: '100' },
];
const levelBar = document.getElementById('levelbar');
function updateLevelBar() {
  const show = LEVEL_LAYERS.has(state.layer) && state.model === 'gfs_raw';
  levelBar.hidden = !show;
  if (!show) return;
  levelBar.innerHTML = '';
  for (const l of LEVELS_UI) {
    const chip = document.createElement('button');
    chip.className = 'level-chip' + (state.level === l.v ? ' active' : '');
    chip.textContent = l.label;
    chip.addEventListener('click', () => setLevel(l.v));
    levelBar.appendChild(chip);
  }
}
function setLevel(v) {
  if (state.level === v) return;
  state.level = v;
  levelBar.querySelectorAll('.level-chip').forEach((c, idx) => c.classList.toggle('active', LEVELS_UI[idx].v === v));
  clearGridCache();
  state.grid = null; state.gridKey = '';
  scheduleGridFetch(0);
  const l = LEVELS_UI.find((x) => x.v === v);
  hint(`气压层 · ${l ? l.label : v} hPa`);
}

/* ---------- 启动 ---------- */
window.__currentModelLabel = MODEL_LABELS[state.model];
window.__state = state; window.__globe = globe; // 调试钩子
window.__applyGrid = (data, key) => applyGrid(data instanceof Grid ? data : new Grid(data), key || 'debug'); // 调试钩子:可注入格点数据
window.__app_map = map;
window.__app_overlays = { lightning, satellite, tropical, stations }; // 调试钩子:叠加层状态
/* 静态模式:模型选择器只保留静态包里实际存在的模式 */
staticAvailableModels().then((avail) => {
  if (!avail || avail.includes(state.model)) return;
  const sel = document.getElementById('model-select');
  [...sel.options].forEach((o) => { if (!avail.includes(o.value)) o.hidden = true; });
  const fallback = avail.includes('gfs_raw') ? 'gfs_raw' : avail[0];
  sel.value = fallback;
  sel.dispatchEvent(new Event('change'));
});
if (urlState.m) document.getElementById('model-select').value = state.model;
if (urlState.bm) document.getElementById('basemap-select').value = state.basemap;
setBasemap(state.basemap);
applyOpacity(state.opacity);
applyLegendPref();
setLayer(state.layer, true);
updateLevelBar();
particles.setEnabled(true);
particles.start();
if (urlState.t) state.pendingTime = num(urlState.t, 0);
fetchGridNow();

/* 首访提示 */
if (!localStorage.getItem('fy_hint_shown')) {
  try { localStorage.setItem('fy_hint_shown', '1'); } catch { /* 隐私模式 */ }
  toast('点击地图任意位置查看该点详细预报 · 悬停可读取数值 · 空格播放时间动画', 9000);
}
