/* 风云地球 — 主控:地图、图层状态、格点调度、时间轴联动 */
import { Grid, getView, clamp } from './util.js';
import { WIND, TEMP, MSL, PRECIP, CLOUD, RH, RADAR, DEW, PTYPE, CAPE, SNOWCM, VIS, PWAT, CWAT, NEWSNOW, SOILW, FRZLVL, CIN, WAVES, WPER, AQI, SST, PM25, NO2, O3, SO2, UVI, WENERGY, FOG, PACCU, FIRE, WPD, SSTA, CO2F, DUST, SO4F, NH3F, SMOKE, NIF, IMERRG, GLST, GSMAP, GFROZEN, GNDVI, GAOD, GCHL, GICE, GVAP, FIRECONF, SOLAR, COCM, ICING, CATC, FFMC, EXTPROB, gphCmap, CUR, THUNDER, GO3 } from './colormaps.js';
import { initApi, fetchGrid, clearGridCache, ensureGridVars, staticAvailableModels, staticHasModel, staticAvailReady, isStatic } from './api.js';
import { ParticleLayer } from './layers/particles.js';
import { ScalarLayer } from './layers/scalar.js';
import { IsobarLayer } from './layers/isobars.js';
import { RadarLayer } from './layers/radar.js';
import { AqiLayer } from './layers/aqi.js';
import { BarbLayer } from './layers/barbs.js';
import { GlobeView } from './globe.js';
import { SatelliteLayer } from './layers/satellite.js';
import { GibsLayer } from './layers/gibs.js';
import { FiresLayer } from './layers/fires.js';
import { SnowCoverLayer } from './layers/snowcover.js';
import { LightningLayer } from './layers/lightning.js';
import { AuroraLayer } from './layers/aurora.js';
import { TropicalLayer } from './layers/tropical.js';
import { StationLayer } from './layers/stations.js';
import { WarningsLayer } from './layers/warnings.js';
import { QuakesLayer } from './layers/quakes.js';
import { BuoysLayer } from './layers/buoys.js';
import { RiversLayer } from './layers/rivers.js';
import { TidesLayer } from './layers/tides.js';
import { Terminator } from './terminator.js';
import { Timeline } from './timeline.js';
import { ForecastPanel, setDegUnit } from './panel.js';
import { initUnits, onUnits, units, unitsHash, convV, unitLabel, cycleUnit, fmtPresStr, fmtPrecipStr } from './units.js';
import { initShortcuts } from './shortcuts.js';
import { Search } from './search.js';
import { MeasureTool } from './measure.js';
import { FavoritesUI } from './favs.js';
import { t, ta, has, applyDom, initLangSelect, onChange as onLangChange } from './i18n.js';

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
  fog: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 9h13M2.5 12.5h16M5 16h12M9 19.5h7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  fire: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2.8c1.2 3.4 4.4 4.6 4.4 8.6a4.4 4.4 0 0 1-8.8 0c0-1.5.6-2.8 1.5-4 .3 1 .9 1.8 1.9 2.3C10.6 7 10.8 4.6 12 2.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.5 18.5c1.1 1 2.3 1.5 3.5 1.5s2.4-.5 3.5-1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/></svg>',
  wpd: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 21v-8.2M12 12.8 5.8 9.2M12 12.8l6.2-3.6M12 12.8V4.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12.8" r="1.5" fill="currentColor"/></svg>',
  ssta: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M2.5 16.5c2.4-2.2 4.8-2.2 7.2 0s4.8 2.2 7.2 0 3.6-1.8 4.6-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 10.5V5.2a2 2 0 0 1 4 0v5.3a3 3 0 1 1-4 0z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 13.6v-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".8"/></svg>',
  aurora: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 14c2-5.5 3.6-5.5 5.5 0s3.6 5.5 5.5 0 3.4-5.2 7 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4.5 19c1.8-4 3.2-4 5 0s3.2 4 5 0 2.8-3.8 5.5 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.6"/></svg>',
  dust: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M2.5 15.5c2-2.2 4-2.2 6 0s4 2.2 6 0 3.5-2 7-.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 10.5c1.5-1.6 3-1.6 4.5 0M13.5 8c1.2-1.2 2.6-1.2 3.8 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/><circle cx="7" cy="5.5" r="1" fill="currentColor"/><circle cx="15" cy="4.8" r="0.8" fill="currentColor"/><circle cx="19" cy="11.5" r="1" fill="currentColor"/></svg>',
  pm25f: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="8" cy="9" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="15.5" cy="8" r="1.7" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="15" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="18.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="5.5" cy="16.5" r="1" fill="currentColor"/></svg>',
  pmtot: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="13" cy="14.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="19" cy="15" r="1.6" fill="currentColor"/><circle cx="5" cy="16" r="1.4" fill="currentColor"/><circle cx="17.5" cy="19.5" r="1" fill="currentColor"/></svg>',
  so2f: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="9" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="16.5" cy="8.5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 10.5l2.8-1.2" stroke="currentColor" stroke-width="1.4"/><path d="M17 15.5h4M19 13.5v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/></svg>',
  so4f: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 8.6V4.5M14.9 13.7l3.6 2M9.1 13.7l-3.6 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  nh3f: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 4.5 5 19h14z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 4.5V10M9.5 12l-3-1.5M14.5 12l3-1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/></svg>',
  ocf: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 20c-2.5-3 1.5-4.5-.5-7.5S6 7 8.5 4M14 20c-2.5-3 1.5-4.5-.5-7.5S12 7 14.5 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M18.5 19c-1.5-2 .8-3-.3-5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.6"/></svg>',
  bcf: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 20c-3-3.5 2-5-.5-8S7.5 6.5 10 3.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M15.5 20c-3-3.5 2-5-.5-8s.5-5.5 3-8.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" opacity="0.75"/></svg>',
  nif: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3.5l7 4v9l-7 4-7-4v-9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>',
  co2f: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6.5 17.5A4.2 4.2 0 0 1 7 9.2 5.5 5.5 0 0 1 17.6 8a3.9 3.9 0 0 1 .4 7.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M9.5 12.2h3M11 10.7v3M15.5 11h3.4M17.2 9.3v3.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  gph: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 19c0-5 4-9 8-9s8 4 8 9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 19c0-3 2-5.5 4.5-5.5s4.5 2.5 4.5 5.5" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.75"/><path d="M10.5 19c0-1 .7-1.8 1.5-1.8s1.5.8 1.5 1.8" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.5"/><path d="M3.5 21h17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  precip24: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 12.5a4.5 4.5 0 0 1-.5-9 5.5 5.5 0 0 1 10.7 1.2 4 4 0 0 1-.2 7.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 16.5h12M8 19.5h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  precip72: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 12.5a4.5 4.5 0 0 1-.5-9 5.5 5.5 0 0 1 10.7 1.2 4 4 0 0 1-.2 7.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 16.5h12M8 19.5h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
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

/* 卫星观测图层图标:复用语义相近的既有图标 + 两个新增(植被/叶绿素) */
ICONS.imerg = ICONS.precip;
ICONS.wind100 = ICONS.wind;
ICONS.lst = ICONS.soilt;
ICONS.smap = ICONS.soilw;
ICONS.frozen = ICONS.frzlvl;
ICONS.aerosol = ICONS.dust;
ICONS.seaice = ICONS.snow;
ICONS.vapor = ICONS.humidity;
ICONS.fires = ICONS.fire;
ICONS.gustmax = ICONS.gust;
ICONS.sw2h = ICONS.swvh; ICONS.sw2p = ICONS.swvp;
ICONS.sw3h = ICONS.swvh; ICONS.sw3p = ICONS.swvp;
ICONS.cloudbase = ICONS.frzlvl; ICONS.cloudtop = ICONS.frzlvl; ICONS.thermals = ICONS.frzlvl;
ICONS.solar = '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9 19 19M19 5l-2.1 2.1M7.1 16.9 5 19" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
ICONS.icing = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 13.5 10 11l6.5-6.5c.9-.9 2.4-.9 3.2 0 .8.8.8 2.2 0 3.1L13 14l-2.5 7-2.4-4.4L3.8 14z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" transform="rotate(8 12 12)"/><path d="M14.5 4.5l1.2 1.2M12.8 6.6l1.2 1.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.85"/></svg>';
ICONS.cat = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 16c4-2.5 7 2.5 11 0M4 11.5c4-2.5 7 2.5 11 0M6.5 20c3-1.8 5 1.6 8 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M15.5 4.5l4 4M19.5 4.5l-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
ICONS.ffmc = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3.5s4.5 5 4.5 8.2a4.5 4.5 0 0 1-9 0c0-3.2 4.5-8.2 4.5-8.2z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 8.5v6M9.8 11h4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.8"/></svg>';
ICONS.extprob = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3.5 21 19H3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 9.5v4.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16.4" r="1.1" fill="currentColor"/></svg>';
ICONS.cof = '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="9" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="16.5" cy="12" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.75"/><path d="M13.2 12h1" stroke="currentColor" stroke-width="1.4" opacity="0.75"/></svg>';
ICONS.ndvi = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M18.5 4.5C11 5 5.5 9.5 5.5 16c0 1.2.3 2.3.8 3.2C7.5 13 12 8.5 17.5 6.5c-4.5 3-8 7.5-9.3 13 .9.4 1.9.6 3 .6 6 0 9.3-5.5 7.3-15.6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
ICONS.chl = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M2.5 15c2.4-2.2 4.8-2.2 7.2 0s4.8 2.2 7.2 0 3.6-1.8 4.6-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="15" cy="6.5" r="1.3" fill="currentColor"/><circle cx="13.5" cy="10.5" r="0.9" fill="currentColor"/><circle cx="18.5" cy="9.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
ICONS.currents = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M2.5 9.5c2.4-2.2 4.8-2.2 7.2 0s4.8 2.2 7.2 0 3.4-2 5.6-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M2.5 15c2.4-2.2 4.8-2.2 7.2 0s4.8 2.2 7.2 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.65"/><path d="M14 15h6.5m0 0-2.3-2.3M20.5 15l-2.3 2.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
ICONS.thunder = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 13a4.5 4.5 0 0 1-.5-9 5.5 5.5 0 0 1 10.7 1.2A4 4 0 0 1 17 13z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12.5 12 9.5 17h4l-3 5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
ICONS.ozone = ICONS.o3;
ICONS.ssh = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 16c3-2.5 6-2.5 9 0s6 2.5 9 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 12V4.5M12 4.5 9.2 7.3M12 4.5l2.8 2.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
ICONS.salt = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3.5s4.5 5 4.5 8.2a4.5 4.5 0 0 1-9 0c0-3.2 4.5-8.2 4.5-8.2z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="10.2" cy="12.2" r="0.95" fill="currentColor"/><circle cx="13.8" cy="13.6" r="0.95" fill="currentColor"/><circle cx="12.6" cy="10.4" r="0.8" fill="currentColor"/></svg>';
ICONS.fzra = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 3.8s3.6 4 3.6 6.6a3.6 3.6 0 0 1-7.2 0C5.4 7.8 9 3.8 9 3.8z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M17 13.2v6.6M14.7 14.5l4.6 4M19.3 14.5l-4.6 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
ICONS.ivt = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 8.5h13.5M16.5 8.5l-3.2-3.2M16.5 8.5l-3.2 3.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 15.5h9.5M12.5 15.5l-2.8-2.8M12.5 15.5l-2.8 2.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.65"/></svg>';

const LAYERS = [
  { id: 'wind', label: '风场', unit: 'm/s', cat: 'wind', cmap: WIND, variable: 'wind', fmt: (v) => String(Math.round(convV('wind', v))) },
  { id: 'gust', label: '阵风', unit: 'm/s', cat: 'wind', cmap: WIND, variable: 'gust', fmt: (v) => String(Math.round(convV('wind', v))), models: ['gfs_raw'] },
  { id: 'gustmax', label: '最大阵风·过程', unit: 'm/s', cat: 'wind', cmap: WIND, variable: 'gustmax', fmt: (v) => String(Math.round(convV('wind', v))), models: ['gfs_raw'] },
  { id: 'wind100', label: '100米风', unit: 'm/s', cat: 'wind', cmap: WIND, variable: 'wind', models: ['gfs_raw'], fmt: (v) => String(Math.round(convV('wind', v))) },
  { id: 'barbs', label: '风向杆', unit: 'kt', cat: 'wind', cmap: WIND, special: 'barbs', fmt: (v) => String(Math.round(convV('wind', v))) },
  { id: 'temp', label: '温度', unit: '°C', cat: 'temp', cmap: TEMP, variable: 'temp', fmt: (v) => String(Math.round(convV('temp', v))) },
  { id: 'feels', label: '体感', unit: '°C', cat: 'temp', cmap: TEMP, variable: 'feels', fmt: (v) => String(Math.round(convV('temp', v))) },
  { id: 'wetbulb', label: '湿球温度', unit: '°C', cat: 'temp', cmap: TEMP, variable: 'wetbulb', fmt: (v) => String(Math.round(convV('temp', v))) },
  { id: 'dew', label: '露点', unit: '°C', cat: 'temp', cmap: DEW, variable: 'dew', fmt: (v) => String(Math.round(convV('temp', v))) },
  { id: 'humidity', label: '湿度', unit: '%', cmap: RH, variable: 'rh', fmt: (v) => Math.round(v), levels: true },
  { id: 'frzlvl', label: '0°C层高度', unit: 'm', cmap: FRZLVL, variable: 'frzlvl', fmt: (v) => String(Math.round(v / 100) * 100), models: ['gfs_raw'] },
  { id: 'solar', label: '太阳辐射', unit: 'W/m²', cmap: SOLAR, variable: 'dswrf', fmt: (v) => String(Math.round(v)), models: ['gfs_raw'] },
  { id: 'icing', label: '积冰风险', unit: '%', cmap: ICING, variable: 'icing', fmt: (v) => (v >= 60 ? t('lv.strong') : v >= 30 ? t('lv.medium') : v > 5 ? t('lv.light') : '—'), models: ['gfs_raw'] },
  { id: 'cat', label: '晴空湍流', unit: 'TI', cmap: CATC, variable: 'cat', fmt: (v) => (v >= 4.5 ? t('lv.strong') : v >= 2 ? t('lv.medium') : v > 0.4 ? t('lv.light') : '—'), models: ['gfs_raw'] },
  { id: 'thermals', label: '热气流·边界层顶', unit: 'm', cmap: FRZLVL, variable: 'hpbl', fmt: (v) => String(Math.round(v / 100) * 100), models: ['gfs_raw'] },
  { id: 'cloud', label: '总云量', unit: '%', cmap: CLOUD, variable: 'cloud', fmt: (v) => Math.round(v) },
  { id: 'lcdc', label: '低云', unit: '%', cmap: CLOUD, variable: 'lcdc', fmt: (v) => Math.round(v), models: ['gfs_raw'] },
  { id: 'mcdc', label: '中云', unit: '%', cmap: CLOUD, variable: 'mcdc', fmt: (v) => Math.round(v), models: ['gfs_raw'] },
  { id: 'hcdc', label: '高云', unit: '%', cmap: CLOUD, variable: 'hcdc', fmt: (v) => Math.round(v), models: ['gfs_raw'] },
  { id: 'cwat', label: '云水', unit: 'mm', cmap: CWAT, variable: 'cwat', fmt: (v) => v.toFixed(2), models: ['gfs_raw'] },
  { id: 'cloudbase', label: '云底高度', unit: 'm', cmap: FRZLVL, variable: 'cloudbase', fmt: (v) => String(Math.round(v / 100) * 100), models: ['gfs_raw'] },
  { id: 'cloudtop', label: '云顶高度', unit: 'm', cmap: FRZLVL, variable: 'cloudtop', fmt: (v) => String(Math.round(v / 100) * 100), models: ['gfs_raw'] },
  { id: 'fog', label: '雾', unit: '', cmap: FOG, variable: 'fog', fmt: (v) => ta('foglv')[Math.round(v)] || '' },
  { id: 'precip', label: '降水', unit: 'mm/h', cat: 'precip', cmap: PRECIP, variable: 'precip', fmt: (v) => fmtPrecipStr(v) },
  { id: 'precip24', label: '降水·24h', unit: 'mm', cat: 'precip', cmap: PACCU, variable: 'precip24', fmt: (v) => fmtPrecipStr(v), models: ['gfs_raw'] },
  { id: 'precip72', label: '降水·72h', unit: 'mm', cat: 'precip', cmap: PACCU, variable: 'precip72', fmt: (v) => fmtPrecipStr(v), models: ['gfs_raw'] },
  { id: 'ptype', label: '相态', unit: '', cmap: PTYPE, variable: 'ptype', fmt: (v) => ta('ptypelv')[Math.round(v)] || '' },
  { id: 'fzra', label: '冻雨', unit: '', cmap: FZRA, variable: 'ptype', fmt: (v) => (v >= 1.5 && v < 3 ? (ta('ptypelv')[2] || '冻雨') : '—'), models: ['gfs_raw'] },
  { id: 'vis', label: '能见度', unit: 'km', cmap: VIS, variable: 'vis', fmt: (v) => Math.round(v), models: ['gfs_raw'] },
  { id: 'snow', label: '积雪', unit: 'cm', cmap: SNOWCM, variable: 'snowd', fmt: (v) => Math.round(v), models: ['gfs_snow', 'gfs_raw'], autoModel: true },
  { id: 'newsnow', label: '新雪', unit: 'cm', cmap: NEWSNOW, variable: 'newsnow', fmt: (v) => (v < 1 ? v.toFixed(1) : Math.round(v)), models: ['gfs_snow', 'gfs_raw'], autoModel: true },
  { id: 'cape', label: '雷暴 CAPE', unit: 'J/kg', cmap: CAPE, variable: 'cape', fmt: (v) => Math.round(v), models: ['gfs_raw'] },
  { id: 'cin', label: '对流抑制', unit: 'J/kg', cmap: CIN, variable: 'cin', fmt: (v) => Math.round(v), models: ['gfs_raw'] },
  { id: 'thunder', label: '雷暴复合', unit: 'mm/h', cmap: THUNDER, variable: 'thunder', fmt: (v) => fmtPrecipStr(v), models: ['gfs_raw'] },
  { id: 'pwat', label: '可降水', unit: 'mm', cmap: PWAT, variable: 'pwat', fmt: (v) => (v < 10 ? v.toFixed(1) : Math.round(v)), models: ['gfs_raw'] },
  { id: 'ivt', label: '大气河 IVT', unit: 'kg/(m·s)', cmap: IVT, variable: 'ivt', fmt: (v) => String(Math.round(v)), models: ['gfs_raw'] },
  { id: 'extprob', label: '极端天气概率', unit: '%', cmap: EXTPROB, variable: 'extprob', fmt: (v) => String(Math.round(v)), models: ['gefs_raw'] },
  { id: 'pressure', label: '气压', unit: 'hPa', cat: 'pressure', cmap: MSL, variable: 'msl', fmt: (v) => fmtPresStr(v), isobars: true },
  { id: 'gph', label: '位势高度', unit: 'm', cmap: gphCmap(500), variable: 'h', fmt: (v) => String(Math.round(v)), models: ['gfs_raw'], levels: true, isolines: true },
  { id: 'soilw', label: '土壤湿度', unit: '%', cmap: SOILW, variable: 'soilw', fmt: (v) => Math.round(v * 100), models: ['gfs_raw'] },
  { id: 'soilt', label: '土壤温度', unit: '°C', cat: 'temp', cmap: TEMP, variable: 'soilt', fmt: (v) => String(Math.round(convV('temp', v))), models: ['gfs_raw'] },
  { id: 'fire', label: '火险', unit: 'CBI', cmap: FIRE, variable: 'fire', fmt: (v) => (v >= 97.5 ? t('firelv.ext') : v >= 90 ? t('firelv.vhigh') : v >= 75 ? t('firelv.high') : v >= 50 ? t('firelv.med') : v >= 20 ? t('firelv.low') : '—'), models: ['gfs_raw'] },
  { id: 'ffmc', label: '可燃物含水率', unit: '%', cmap: FFMC, variable: 'ffmc', fmt: (v) => (v >= 25 ? t('ffmc.wet') : v >= 16 ? t('ffmc.ok') : v >= 10 ? t('ffmc.dry') : t('ffmc.vdry')), models: ['gfs_raw'] },
  { id: 'wpd', label: '风功率密度', unit: 'W/m²', cmap: WPD, variable: 'wpd', fmt: (v) => String(Math.round(v)), models: ['gfs_raw'] },
  { id: 'ssta', label: '海温距平', unit: '°C', cmap: SSTA, variable: 'ssta', fmt: (v) => (v > 0 ? '+' : '') + (Math.abs(v) < 1 ? v.toFixed(2) : v.toFixed(1)), models: ['ocean_raw'], maskLand: true },
  { id: 'ssh', label: '海面高度', unit: 'm', cmap: SSH, variable: 'ssh', fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(2), models: ['currents_raw'], maskLand: true },
  { id: 'salt', label: '盐度', unit: 'PSU', cmap: SALT, variable: 'salt', fmt: (v) => v.toFixed(2), models: ['currents_raw'], maskLand: true },
  { id: 'currents', label: '海流', unit: 'm/s', cat: 'wind', cmap: CUR, variable: 'cur', fmt: (v) => String(Math.round(convV('wind', v) * 10) / 10), models: ['currents_raw'], maskLand: true },
  { id: 'dust', label: '沙尘', unit: 'µg/m³', cmap: DUST, variable: 'dust', fmt: (v) => Math.round(v), models: ['chem_raw'] },
  { id: 'pm25f', label: 'PM2.5 场', unit: 'µg/m³', cmap: PM25, variable: 'pm25', fmt: (v) => Math.round(v), models: ['chem_raw'] },
  { id: 'pmtot', label: 'PM 总量', unit: 'µg/m³', cmap: PM25, variable: 'pmtot', fmt: (v) => Math.round(v), models: ['chem_raw'] },
  { id: 'so2f', label: 'SO₂ 场', unit: 'µg/m³', cmap: SO2, variable: 'so2', fmt: (v) => Math.round(v), models: ['chem_raw'] },
  { id: 'so4f', label: '硫酸盐', unit: 'µg/m³', cmap: SO4F, variable: 'so4', fmt: (v) => Math.round(v), models: ['chem_raw'] },
  { id: 'nh3f', label: '氨', unit: 'µg/m³', cmap: NH3F, variable: 'nh3', fmt: (v) => Math.round(v), models: ['chem_raw'] },
  { id: 'ocf', label: '有机碳(烟)', unit: 'µg/m³', cmap: SMOKE, variable: 'oc', fmt: (v) => Math.round(v), models: ['chem_raw'] },
  { id: 'bcf', label: '黑碳', unit: 'µg/m³', cmap: SMOKE, variable: 'bc', fmt: (v) => Math.round(v), models: ['chem_raw'] },
  { id: 'nif', label: '硝酸盐', unit: 'µg/m³', cmap: NIF, variable: 'ni', fmt: (v) => Math.round(v), models: ['chem_raw'] },
  { id: 'co2f', label: '二氧化碳', unit: 'ppm', cmap: CO2F, variable: 'co2', fmt: (v) => v.toFixed(1), models: ['chem_raw'] },
  { id: 'cof', label: '一氧化碳', unit: 'µg/m³', cmap: COCM, variable: 'co', fmt: (v) => String(Math.round(v)), models: ['chem_raw'] },
  { id: 'radar', label: '雷达', unit: 'dBZ', cmap: RADAR, special: 'radar', fmt: (v) => Math.round(v) },
  { id: 'wvh', label: '波高', unit: 'm', cmap: WAVES, variable: 'wvh', fmt: (v) => v.toFixed(1), models: ['waves_raw'], maskLand: true },
  { id: 'wvp', label: '波周期', unit: 's', cmap: WPER, variable: 'wvp', fmt: (v) => v.toFixed(1), models: ['waves_raw'], maskLand: true },
  { id: 'swvh', label: '涌浪1·高度', unit: 'm', cmap: WAVES, variable: 'swvh', fmt: (v) => v.toFixed(1), models: ['waves_raw'], maskLand: true },
  { id: 'swvp', label: '涌浪1·周期', unit: 's', cmap: WPER, variable: 'swvp', fmt: (v) => v.toFixed(1), models: ['waves_raw'], maskLand: true },
  { id: 'sw2h', label: '涌浪2·高度', unit: 'm', cmap: WAVES, variable: 'sw2h', fmt: (v) => v.toFixed(1), models: ['waves_raw'], maskLand: true },
  { id: 'sw2p', label: '涌浪2·周期', unit: 's', cmap: WPER, variable: 'sw2p', fmt: (v) => v.toFixed(1), models: ['waves_raw'], maskLand: true },
  { id: 'sw3h', label: '涌浪3·高度', unit: 'm', cmap: WAVES, variable: 'sw3h', fmt: (v) => v.toFixed(1), models: ['waves_raw'], maskLand: true },
  { id: 'sw3p', label: '涌浪3·周期', unit: 's', cmap: WPER, variable: 'sw3p', fmt: (v) => v.toFixed(1), models: ['waves_raw'], maskLand: true },
  { id: 'wwh', label: '风浪高度', unit: 'm', cmap: WAVES, variable: 'wwh', fmt: (v) => v.toFixed(1), models: ['waves_raw'], maskLand: true },
  { id: 'wwp', label: '风浪周期', unit: 's', cmap: WPER, variable: 'wwp', fmt: (v) => v.toFixed(1), models: ['waves_raw'], maskLand: true },
  { id: 'wve', label: '波浪能量', unit: 'kW/m', cmap: WENERGY, variable: 'wve', fmt: (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v))), models: ['waves_raw'], maskLand: true },
  { id: 'sst', label: '海温', unit: '°C', cat: 'temp', cmap: SST, variable: 'sst', fmt: (v) => { const c = convV('temp', v); return Math.abs(c) < 1 ? c.toFixed(1) : String(Math.round(c)); }, maskLand: true, models: ['ocean_raw'] },
  { id: 'aqi', label: '空气质量', unit: 'AQI', cmap: AQI, special: 'aqi', aqField: 'a', fmt: (v) => Math.round(v) },
  { id: 'pm25', label: 'PM2.5', unit: 'μg/m³', cmap: PM25, special: 'aqi', aqField: 'p', fmt: (v) => Math.round(v) },
  { id: 'pm10', label: 'PM10', unit: 'μg/m³', cmap: PM25, special: 'aqi', aqField: 'p10', fmt: (v) => Math.round(v) },
  { id: 'no2', label: '二氧化氮', unit: 'μg/m³', cmap: NO2, special: 'aqi', aqField: 'no2', fmt: (v) => Math.round(v) },
  { id: 'o3', label: '臭氧', unit: 'μg/m³', cmap: O3, special: 'aqi', aqField: 'o3', fmt: (v) => Math.round(v) },
  { id: 'so2', label: '二氧化硫', unit: 'μg/m³', cmap: SO2, special: 'aqi', aqField: 'so2', fmt: (v) => Math.round(v) },
  { id: 'uv', label: 'UV 指数', unit: '', cmap: UVI, special: 'aqi', aqField: 'u', fmt: (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v))) },
  { id: 'ozone', label: '总柱臭氧', unit: 'DU', cmap: GO3, special: 'gibs',
    gibs: { gibs: 'OMPS_Ozone_Total_Column', tms: 'GoogleMapsCompatible_Level6', zoom: 6, cadence: 'daily', lag: 1, attr: 'NASA OMPS / GIBS' },
    fmt: (v) => String(Math.round(v)) },
  /* NASA GIBS 卫星观测(零注册直连瓦片,官方预渲染配色) */
  { id: 'fires', label: '活跃火点', unit: '', special: 'fires', cmap: FIRECONF, fmt: (v) => ta('fireConf')[Math.round(v)] || '' },
  { id: 'imerg', label: '卫星降水', unit: 'mm/h', cat: 'precip', cmap: IMERRG, special: 'gibs',
    gibs: { gibs: 'IMERG_Precipitation_Rate_30min', tms: 'GoogleMapsCompatible_Level6', zoom: 6, cadence: 'min30', attr: 'NASA GPM IMERG / GIBS' },
    fmt: (v) => (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : String(Math.round(v))) },
  { id: 'lst', label: '地表温度', unit: '°C', cat: 'temp', cmap: GLST, special: 'gibs',
    gibs: { gibs: 'MODIS_Terra_Land_Surface_Temp_Day', tms: 'GoogleMapsCompatible_Level7', zoom: 7, cadence: 'daily', lag: 1, attr: 'NASA MODIS Terra / GIBS' },
    fmt: (v) => String(Math.round(convV('temp', v))) },
  { id: 'smap', label: '卫星土壤湿', unit: '%', cmap: GSMAP, special: 'gibs',
    gibs: { gibs: 'SMAP_L4_Analyzed_Surface_Soil_Moisture', tms: 'GoogleMapsCompatible_Level6', zoom: 6, cadence: 'daily', lag: 4, attr: 'NASA SMAP L4 / GIBS' },
    fmt: (v) => String(Math.round(v * 100)) },
  { id: 'frozen', label: '冻土', unit: '%', cmap: GFROZEN, special: 'gibs',
    gibs: { gibs: 'SMAP_L4_Frozen_Area', tms: 'GoogleMapsCompatible_Level6', zoom: 6, cadence: 'daily', lag: 10, attr: 'NASA SMAP L4 / GIBS' },
    fmt: (v) => String(Math.round(v)) },
  { id: 'ndvi', label: '植被指数', unit: 'NDVI', cmap: GNDVI, special: 'gibs',
    gibs: { gibs: 'MODIS_Terra_NDVI_8Day', tms: 'GoogleMapsCompatible_Level9', zoom: 9, cadence: 'days8', lag: 2, attr: 'NASA MODIS Terra / GIBS' },
    fmt: (v) => v.toFixed(2) },
  { id: 'aerosol', label: '气溶胶指数', unit: '', cmap: GAOD, special: 'gibs',
    gibs: { gibs: 'OMI_Aerosol_Index', tms: 'GoogleMapsCompatible_Level6', zoom: 6, cadence: 'daily', lag: 1, attr: 'NASA OMI / Aura / GIBS' },
    fmt: (v) => v.toFixed(1) },
  { id: 'chl', label: '叶绿素', unit: 'mg/m³', cmap: GCHL, special: 'gibs', maskLand: true,
    gibs: { gibs: 'MODIS_Aqua_L2_Chlorophyll_A', tms: 'GoogleMapsCompatible_Level7', zoom: 7, cadence: 'daily', lag: 1, attr: 'NASA MODIS Aqua / GIBS' },
    fmt: (v) => (v < 1 ? v.toFixed(2) : v.toFixed(1)) },
  { id: 'seaice', label: '海冰浓度', unit: '%', cmap: GICE, special: 'gibs', maskLand: true,
    gibs: { gibs: 'GHRSST_L4_MUR_Sea_Ice_Concentration', tms: 'GoogleMapsCompatible_Level7', zoom: 7, cadence: 'daily', lag: 1, attr: 'NASA JPL MUR / GIBS' },
    fmt: (v) => String(Math.round(v)) },
  { id: 'vapor', label: '大气水汽', unit: 'cm', cmap: GVAP, special: 'gibs',
    gibs: { gibs: 'MODIS_Terra_Water_Vapor_5km_Day', tms: 'GoogleMapsCompatible_Level6', zoom: 6, cadence: 'daily', lag: 1, attr: 'NASA MODIS Terra / GIBS' },
    fmt: (v) => v.toFixed(1) },
];

/* 分组(手风琴):图层按钮按组分节收纳,对齐 Windy 的导航结构 */
const GROUPS = [
  { id: 'obs', label: '观测', layers: ['radar'] },
  { id: 'satobs', label: '卫星观测', layers: ['fires', 'imerg', 'lst', 'smap', 'frozen', 'ndvi', 'aerosol', 'chl', 'seaice', 'vapor'] },
  { id: 'wind', label: '风', layers: ['wind', 'wind100', 'gust', 'gustmax', 'barbs', 'wpd'] },
  { id: 'temp', label: '温湿', layers: ['temp', 'feels', 'wetbulb', 'dew', 'humidity', 'frzlvl'] },
  { id: 'sun', label: '太阳', layers: ['solar'] },
  { id: 'cloud', label: '云雨', layers: ['cloud', 'cloudbase', 'cloudtop', 'lcdc', 'mcdc', 'hcdc', 'cwat', 'fog', 'precip', 'precip24', 'precip72', 'ptype', 'fzra', 'vis'] },
  { id: 'aviation', label: '航空', layers: ['icing', 'cat', 'thermals'] },
  { id: 'snow', label: '雪', layers: ['snow', 'newsnow'] },
  { id: 'conv', label: '对流气压', layers: ['cape', 'cin', 'thunder', 'pwat', 'ivt', 'extprob', 'pressure', 'gph'] },
  { id: 'ground', label: '土壤', layers: ['soilw', 'soilt'] },
  { id: 'fire', label: '火险', layers: ['fire', 'ffmc'] },
  { id: 'ocean', label: '海洋', layers: ['currents', 'sst', 'ssta', 'ssh', 'salt', 'wvh', 'wvp', 'swvh', 'swvp', 'sw2h', 'sw2p', 'sw3h', 'sw3p', 'wwh', 'wwp', 'wve'] },
  { id: 'air', label: '空气', layers: ['aqi', 'pm25', 'pm10', 'no2', 'o3', 'so2', 'uv', 'ozone'] },
  { id: 'chem', label: '空气场', layers: ['dust', 'pm25f', 'pmtot', 'so2f', 'so4f', 'nh3f', 'ocf', 'bcf', 'nif', 'co2f', 'cof'] },
];

/* 当前图层渲染所需的原始变量(派生图层映射到其数据来源) */
function varNeeds(def) {
  if (!def || def.special) return [];
  if (def.id === 'wind100') return ['u100', 'v100']; // 100 米高度风(GFS 原生层),前端别名成 u/v
  const M = {
    wind: ['u', 'v'], gust: ['gust'], barbs: ['u', 'v'],
    feels: ['temp', 'rh', 'u', 'v'], wetbulb: ['temp', 'rh'], dew: ['temp', 'rh'], ptype: ['temp', 'precip'],
    fog: ['rh'],
    /* cloudbase/ffmc/icing/cat/gustmax 等派生场由服务端与烘焙端同源产出,前端直读 */
  };
  return M[def.variable] || [def.variable];
}
const layerById = (id) => LAYERS.find((l) => l.id === id);

/* 粒子样式随数据模式联动:海浪按波高(wave 档)、海流按流速(current 档),其余按风速着色 */
function syncParticleStyle() {
  const mode = state.model === 'waves_raw' ? 'wvh' : state.model === 'currents_raw' ? 'cur' : null;
  particles.setColorVar(mode, mode === 'wvh' ? WAVES : mode === 'cur' ? CUR : null);
}

/* i18n:图层/分组/叠加的 label(含 overlay title)改为按语言取词的 getter —
 * 词典缺键(如后续新增图层)时保留定义处的原标签,不会显示键名 */
function localizeLabels(list, prefix) {
  for (const item of list) {
    const key = `${prefix}.${item.id}`;
    if (!has(key)) continue;
    Object.defineProperty(item, 'label', { get: () => t(key), configurable: true });
    if (item.title && has(`${key}.title`)) {
      Object.defineProperty(item, 'title', { get: () => t(`${key}.title`), configurable: true });
    }
  }
}
localizeLabels(LAYERS, 'layer');
localizeLabels(GROUPS, 'group');

/* 图层色标(位势高度按当前气压层取对应色标)与等值线间距 gpm */
const GPH_INT = { 925: 30, 850: 40, 700: 50, 500: 60, 300: 90, 250: 120, 200: 120, 150: 160, 100: 200, 70: 240, 10: 320 };
function layerCmap(def) {
  return def.id === 'gph' ? gphCmap(state.level || 500) : def.cmap;
}

/* 当前图层+气压层所需的变量键:层级>0 时给 u/v/temp/rh/h 加后缀(静态包按层懒加载) */
function needsFor(def) {
  const base = [...new Set(['u', 'v', ...varNeeds(def)])];
  /* 海浪模式:粒子着色取波高,任意波浪图层都需 wvh 就绪 */
  if (state.model === 'waves_raw' && !base.includes('wvh')) base.push('wvh');
  if (!state.level) return base;
  return base.map((vk) => ['u', 'v', 'temp', 'rh', 'h'].includes(vk) ? `${vk}@${state.level}` : vk);
}

// 支持气压层切换的图层(风/风向杆/温/湿/位势高度)
const LEVEL_LAYERS = new Set(['wind', 'barbs', 'temp', 'humidity', 'gph']);
/* 图层的数据模式候选(按优先级):显式声明 models 的图层用其清单;
 * 通用要素图层由四套大气模式共同提供(服务端模式下附加 Open-Meteo 备用源)。
 * 模式解析原则:点击图层即显示 — 当前模式提供则沿用,否则自动切到最优可用模式;
 * 仅当一个图层有多个数据模式时才显示右下角模式选择器。 */
const DEFAULT_MODELS = ['gfs_raw', 'ecmwf_raw', 'aifs_raw', 'gefs_raw'];
const OM_MODELS = ['best_match', 'gfs_seamless', 'icon_seamless', 'ecmwf_ifs025'];
function modelsForLayer(def, { inclFallback = false } = {}) {
  if (def.models) return def.models;
  return inclFallback && !isStatic() ? [...DEFAULT_MODELS, ...OM_MODELS] : DEFAULT_MODELS;
}

/* ---------- URL 状态(分享/恢复) ---------- */
const urlState = (() => {
  try { return Object.fromEntries(new URLSearchParams(location.hash.slice(1))); } catch { return {}; }
})();
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
let urlTimer = 0;

/* 模式标签按语言取词(代理保持 MODEL_LABELS[m] 用法不变) */
const MODEL_LABELS = new Proxy({}, { get: (_, m) => t('model.' + String(m)) });

const state = {
  model: urlState.m || 'gfs_raw',
  layer: urlState.l || 'wind',
  particles: true,
  basemap: urlState.bm || 'vector',
  level: num(urlState.lv, 0),
  opacity: Math.min(1, Math.max(0.35, num(urlState.op, 100) / 100)),
  overlays: new Set(String(urlState.o || '').split(',').filter((x) => ['lightning', 'satellite', 'tropical', 'stations', 'airports', 'snowcover', 'aurora'].includes(x))),
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
import { HillshadeLayer } from './hillshade.js';
let satLayer = null;
let hillshadeLayer = null;
const GIBS_URL = (date) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
const vectorBasemap = new VectorBasemap(map);
const landfill = new LandFill(map);
const OPENTOPO_URL = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';

function setBasemap(kind) {
  state.basemap = kind;
  map.fire('basemapchange', { kind });
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
  } else if (kind === 'hillshade') {
    hillshadeLayer = new HillshadeLayer({
      tileSize: 256, maxNativeZoom: 15, maxZoom: 10, attribution: 'NASA SRTM / AWS Terrain Tiles',
    }).addTo(map);
  }
  if (hillshadeLayer && kind !== 'hillshade') {
    map.removeLayer(hillshadeLayer);
    hillshadeLayer = null;
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
const aurora = new AuroraLayer(map);
const tropical = new TropicalLayer(map);
const stations = new StationLayer(map);
const airports = new StationLayer(map, { fr: true });
const snowCover = new SnowCoverLayer(map);
const gibs = new GibsLayer(map);
const firesLayer = new FiresLayer(map, { toast });
const warnings = new WarningsLayer(map, { toast });
const quakes = new QuakesLayer(map, { toast });
const terminator = new Terminator(map);
const buoys = new BuoysLayer(map, { toast });
const rivers = new RiversLayer(map, { toast });
const tides = new TidesLayer(map, { toast });
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
  const cmap = layerCmap(def);
  document.getElementById('legend-bar').style.background = cmap.gradientCss();
  const stops = cmap.stops;
  const idxs = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (stops.length - 1))))];
  document.getElementById('legend-labels').innerHTML =
    idxs.map((i) => `<span>${def.fmt(stops[i][0])}</span>`).join('');
}

/* Ventusky 式:点击色标循环切换该图层的单位制 */
legendEl.title = t('ui.legendCycle');
legendEl.addEventListener('click', () => {
  const def = layerById(state.layer);
  if (!def || !def.cat) { hint(t('hint.noUnit')); return; }
  cycleUnit(def.cat);
});

/* 图例显隐(记忆偏好) */
function applyLegendPref() {
  document.body.classList.toggle('legend-off', localStorage.getItem('fy_legend_off') === '1');
}
document.getElementById('legend-btn').addEventListener('click', () => {
  const off = document.body.classList.toggle('legend-off');
  try { localStorage.setItem('fy_legend_off', off ? '1' : '0'); } catch { /* 隐私模式 */ }
  hint(off ? t('hint.legendOff') : t('hint.legendOn'));
});

/* ---------- 图层切换(分组手风琴) ---------- */
const layerBtnBox = document.getElementById('layer-buttons');
/* 图层置灰仅表示"所有数据模式都未上线"(如专用包尚未进数据管道);
 * 只要任一候选模式有数据,图层就可点开并自动切到该模式 */
function layerGloballyAvailable(def) {
  if (!staticAvailReady()) return true; // 服务端模式或清单未就绪:不误判
  return modelsForLayer(def).some((m) => staticHasModel(m));
}
function refreshLayerButtons() {
  for (const btn of layerBtnBox.querySelectorAll('.layer-btn')) {
    btn.classList.toggle('dim', !layerGloballyAvailable(layerById(btn.dataset.layer)));
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

/* ---------- 模式自动解析(图层点开即显示,右下角选择器只做多模式切换) ---------- */
let staticAvailPromise = null;
function ensureStaticAvail() {
  if (!staticAvailPromise) staticAvailPromise = staticAvailableModels().catch(() => null);
  return staticAvailPromise;
}
function modelHasData(m) {
  if (!staticAvailReady()) return true; // 服务端模式或清单未就绪:视为可用
  return staticHasModel(m);
}
/* 为图层选出一个有数据的模式:当前模式提供则沿用(不折腾),
 * 专用图层(autoModel)优先升级专用模式,否则按候选优先级取首个可用者 */
async function resolveLayerModel(def) {
  await ensureStaticAvail();
  const cands = modelsForLayer(def, { inclFallback: true });
  if (def.autoModel && cands.length && modelHasData(cands[0])) return cands[0];
  if (cands.includes(state.model) && modelHasData(state.model)) return state.model;
  for (const m of cands) if (modelHasData(m)) return m;
  return null;
}
/* 模式切换的公共副作用(手动选择与图层自动切换共用) */
function applyModelCore(m) {
  state.model = m;
  const sel = document.getElementById('model-select');
  if (sel.value !== m) sel.value = m;
  window.__currentModelLabel = MODEL_LABELS[m];
  if (!LEVEL_LAYERS.has(state.layer) || m !== 'gfs_raw') { if (state.level) state.level = 0; }
  /* 位势高度层切回 GFS 时回到默认 500 hPa(表面无此要素) */
  if (state.layer === 'gph' && !state.level) state.level = 500;
  clearGridCache();
  state.grid = null; state.gridKey = '';
  refreshLayerButtons();
  updateLevelBar();
  panel.refresh();
}
/* 右下角模式选择器:只列出当前图层可用的数据模式;唯一模式时整个胶囊隐藏 */
function refreshModelPill() {
  const pill = document.getElementById('model-pill');
  const sel = document.getElementById('model-select');
  const def = layerById(state.layer);
  if (!def) { pill.hidden = true; return; }
  let cands = modelsForLayer(def, { inclFallback: true });
  if (staticAvailReady()) cands = cands.filter((m) => staticHasModel(m));
  sel.innerHTML = '';
  for (const m of cands) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = MODEL_SHORT[m] || m;
    sel.appendChild(o);
  }
  if (cands.includes(state.model)) sel.value = state.model;
  pill.hidden = cands.length <= 1;
}

async function setLayer(id, silent = false) {
  const def0 = layerById(id);
  if (!def0) return;
  /* 智能模式解析:当前模式提供该图层则直接显示,否则自动切到最优可用模式 —
   * 图层点开即用,无需手动到右下角切换模式 */
  const target = await resolveLayerModel(def0);
  if (!target) {
    toast(t('toast.layerUnavailable', { name: def0.label }));
    return;
  }
  const switched = target !== state.model;
  if (switched) applyModelCore(target);
  state.layer = id;
  /* 位势高度默认 500 hPa(表面无此要素) */
  if (id === 'gph' && !state.level) { state.level = 500; syncUrl(); }
  syncUrl();
  document.getElementById('cursor-tip').hidden = true; // 旧图层读数立即失效
  openGroupOf(id);
  syncActiveLayerBtn();
  const def = layerById(id);
  updateLevelBar();

  const isRadar = def.special === 'radar';
  const isAqi = def.special === 'aqi';
  const isBarbs = def.special === 'barbs';
  const isGibs = def.special === 'gibs';
  const isFires = def.special === 'fires';
  radar.show(isRadar);
  aqi.show(isAqi);
  if (isAqi) aqi.setField(def.aqField || 'a', def.cmap);
  barbs.show(isBarbs);
  gibs.show(isGibs, def.gibs);
  firesLayer.show(isFires);
  document.body.dataset.radarActive = isRadar ? '1' : '0';

  if (!isRadar && !isAqi && !isBarbs && !isGibs && !isFires) {
    scalar.show(true);
    scalar.setVar(def.variable, layerCmap(def));
    scalar.setMaskLand(!!def.maskLand);
  } else {
    scalar.show(false);
  }
  /* 粒子着色:随数据模式联动(海浪波高 / 海流流速 / 其余风速) */
  syncParticleStyle();
  /* 等值线:气压层用等压线,位势高度层用等高线(间距随层变化) */
  const isoCfg = def.isobars ? { var: 'msl', interval: 4, major: 3 }
    : def.isolines ? { var: def.variable, interval: GPH_INT[state.level || 500], major: 5 } : null;
  isobars.show(!!isoCfg);
  if (isoCfg) isobars.setSource(isoCfg.var, isoCfg.interval, isoCfg.major);
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
      toast(t('toast.layerLoadFail', { msg: e.message }));
    } finally {
      loadingEl.hidden = true;
    }
  }
  /* 模式自动切换或首启后格点为空 → 立即拉取(常规平移缩放仍由 moveend 调度) */
  if (!state.grid) scheduleGridFetch(0);
  refreshModelPill();
  onTimeChange(state.timePos);
  if (!silent) hint(switched ? t('hint.switched', { name: def.label, model: MODEL_SHORT[target] || target }) : t('hint.layer', { name: def.label }));
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
  { id: 'airports', label: '机场', title: '全球机场飞行规则(Flight Rules):VFR 绿 / MVFR 蓝 / IFR 橙 / LIFR 红 — METAR 实测(NOAA,每小时更新)',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2.8c.9 0 1.6.7 1.6 1.6v4.4l6.6 3.9v1.9l-6.6-2v4l2.5 1.8v1.5L12 18.9l-4.1 1v-1.5l2.5-1.8v-4l-6.6 2v-1.9l6.6-3.9V4.4c0-.9.7-1.6 1.6-1.6z" fill="currentColor"/></svg>' },
  { id: 'snowcover', label: '雪盖', title: '雪盖观测:NASA VIIRS NDSI 日产品(卫星反演雪盖范围,每日更新)',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3v18M5.5 6.2l13 11.6M5.5 17.8l13-11.6M12 6.5l-1.8-1.8M12 6.5l1.8-1.8M12 17.5l-1.8 1.8M12 17.5l1.8 1.8M5 12H3.2M5 12l-1.3 1.4M5 12 3.7 10.6M19 12h1.8M19 12l1.3 1.4M19 12l-1.3-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
  { id: 'aurora', label: '极光', title: 'NOAA SWPC OVATION 极光概率(未来 30-90 分钟,每 30 分钟更新)',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 14c2-5.5 3.6-5.5 5.5 0s3.6 5.5 5.5 0 3.4-5.2 7 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4.5 19c1.8-4 3.2-4 5 0s3.2 4 5 0 2.8-3.8 5.5 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.6"/></svg>' },
  { id: 'warnings', label: '预警', title: '官方气象预警:美国 NWS 多边形 + 欧洲 MeteoAlarm(黄/橙/红,每小时更新)',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3.5 22 20H2L12 3.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v4.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.15" fill="currentColor"/></svg>' },
  { id: 'quakes', label: '地震', title: '全球地震(USGS):24h 内 2.5 级+ 与 7 天内 4.5 级+,点大小=震级 颜色=时间(每小时更新)',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M2 15c2.5 0 3-2.5 5-2.5S9.5 15 12 15s3-2.5 5-2.5 2.5 2.5 5 2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 13.5V20M12 13.5l4-3.2M12 13.5l-4-3.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity="0.75"/></svg>' },
  { id: 'daynight', label: '晨昏线', title: '昼夜晨昏线:按当前时刻计算太阳直射点,深色遮罩显示夜半球(前端实时计算)',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3.8A8.2 8.2 0 0 1 12 20.2z" fill="currentColor" opacity="0.55"/></svg>' },
  { id: 'buoys', label: '浮标', title: '全球海洋浮标/站实测(NOAA NDBC,每小时更新):风速着色,弹卡含浪高/水温/气压',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 15c2.5 0 2.5 1.8 5 1.8s2.5-1.8 5-1.8 2.5 1.8 5 1.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12 14V6.5M12 6.5l5-1.6M12 6.5l-5-1.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="4.6" r="1.4" fill="currentColor"/></svg>' },
  { id: 'rivers', label: '大河', title: '全球主要大河径流(GloFAS,日更新):点大小=流量,弹卡看 5 天趋势',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 8c3-2.5 6-2.5 9 0s6 2.5 9 0M3 13c3-2.5 6-2.5 9 0s6 2.5 9 0M3 18c3-2.5 6-2.5 9 0s6 2.5 9 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' },
  { id: 'tides', label: '潮汐', title: '潮汐:NOAA 潮汐站最高/最低潮位预报(美国沿岸)+ 全球验潮站实测(UHSLC,逐时),日更新',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 16c2.5 0 2.5-1.8 5-1.8s2.5 1.8 5 1.8 2.5-1.8 5-1.8 2.5 1.8 3 1.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12 12V4.5M12 4.5l3.5 2M12 4.5l-3.5 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/></svg>' },
];
const overlayBtnBox = document.getElementById('overlay-buttons');
const satChannelWrap = document.getElementById('sat-channel-wrap');
function buildOverlayButtons() {
  overlayBtnBox.innerHTML = '';
  for (const ov of OVERLAYS) {
    const btn = document.createElement('button');
    btn.className = 'layer-btn overlay-btn';
    btn.id = `ov-${ov.id}`;
    btn.title = ov.title;
    btn.innerHTML = `${ov.icon}<span>${ov.label}</span>`;
    btn.addEventListener('click', () => toggleOverlay(ov.id, !state.overlays.has(ov.id)));
    overlayBtnBox.appendChild(btn);
  }
}
localizeLabels(OVERLAYS, 'overlay');
buildOverlayButtons();
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
  else if (id === 'airports') airports.show(on);
  else if (id === 'snowcover') snowCover.show(on);
  else if (id === 'aurora') aurora.show(on);
  else if (id === 'warnings') warnings.show(on);
  else if (id === 'quakes') quakes.show(on);
  else if (id === 'daynight') terminator.show(on);
  else if (id === 'buoys') buoys.show(on);
  else if (id === 'rivers') rivers.show(on);
  else if (id === 'tides') tides.show(on);
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
  gibs.setBaseOpacity(v);
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
    /* 100 米风层:把 u100/v100 别名成 u/v,标量场/粒子/采样全链路按风场消费 */
    if (state.layer === 'wind100' && grid.vars && grid.vars.u100) {
      grid.vars.u = grid.vars.u100;
      grid.vars.v = grid.vars.v100;
    }
    // 请求期间视图又变了:丢弃(已缓存,稍后会重新取)
    const latest = gridSpec();
    if (specKey(latest) !== key) { return; }
    if (grid.stale) {
      const ageH = Math.max(1, Math.round((Date.now() / 1000 - (grid.generated || 0)) / 3600));
      toast(t('toast.stale', { h: ageH }));
    }
    applyGrid(grid, key);
  } catch (e) {
    const msg = String(e.message || e);
    if (/daily/i.test(msg)) {
      rateLimited = true;
      state.fetchingKey = '';
      loadingEl.hidden = true;
      toast(t('toast.quota'));
      return;
    }
    if (/limit|429/i.test(msg)) {
      rateLimited = true;
      state.fetchingKey = '';
      loadingEl.hidden = true;
      toast(t('toast.ratelimit'));
      clearTimeout(fetchTimer);
      fetchTimer = setTimeout(fetchGridNow, 90_000);
      return;
    }
    toast(t('toast.gridFail', { msg }));
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
    ? ensureGridVars(grid, needs).catch((e) => toast(t('toast.partialVars', { msg: e.message })))
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
  snowCover.updateTime(ms);
  gibs.updateTime(ms);
}

/* ---------- 光标取值器(悬停读数) ---------- */
const tipEl = document.getElementById('cursor-tip');
const tipVal = document.getElementById('ct-val');
const tipSub = document.getElementById('ct-sub');
let DIR8 = ta('dir8'); // 语言切换时重取
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
      main = `<i class="ct-arrow" style="transform:rotate(${to - 90}deg)">➤</i>${Math.round(convV('wind', v))} ${unitLabel('wind')} ${t('windFmt', { dir: from })}`;
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
const MODEL_SHORT = new Proxy({}, { get: (_, m) => (has('modelShort.' + String(m)) ? t('modelShort.' + String(m)) : m) });
document.getElementById('model-select').addEventListener('change', (e) => {
  const m = e.target.value;
  if (!m || m === state.model) return;
  /* 选择器只列出当前图层可用的模式,切换即生效,无需兜底跳转主图层 */
  applyModelCore(m);
  syncUrl();
  hint(t('hint.model', { model: MODEL_SHORT[m] || m }));
  syncParticleStyle();
  scheduleGridFetch(0);
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
/* 关于弹窗正文按界面语言渲染(词典 about.rows = [标题, HTML] 列表) */
function renderAbout() {
  const body = document.getElementById('about-body');
  if (!body) return;
  const rows = ta('about.rows');
  body.innerHTML = '<table>' + rows.map(([h, b]) => `<tr><th>${h}</th><td>${b}</td></tr>`).join('') + '</table>'
    + `<p>${t('about.license')}</p>`;
}
renderAbout();

/* ---------- 全屏 ---------- */
document.getElementById('fs-btn').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { toast(t('toast.fullscreen')); }
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
  const ids = GROUPS.flatMap((g) => g.layers).filter((id) => layerGloballyAvailable(layerById(id)));
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
    toast(t('toast.copyOk'));
  } catch {
    toast(t('toast.copyFail'));
  }
});
document.getElementById('loc-btn').addEventListener('click', () => {
  if (!navigator.geolocation) { toast(t('toast.geoUnsupported')); return; }
  toast(t('toast.locating'));
  navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude: lat, longitude: lon } = pos.coords;
    map.flyTo([lat, lon], 10, { duration: 1.2 });
    setPin(lat, lon);
    panel.open(lat, lon);
  }, () => toast(t('toast.locFail')), { enableHighAccuracy: false, timeout: 10000 });
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
  { v: 0, get label() { return t('level.surface'); } }, { v: 925, label: '925' }, { v: 850, label: '850' },
  { v: 700, label: '700' }, { v: 500, label: '500' }, { v: 300, label: '300' },
  { v: 250, label: '250' }, { v: 200, label: '200' }, { v: 150, label: '150' }, { v: 100, label: '100' },
  { v: 70, label: '70' }, { v: 10, label: '10' },
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
  /* 位势高度:换层同步换色标与等高线间距 */
  if (state.layer === 'gph') {
    scalar.setVar('h', gphCmap(v));
    isobars.setSource('h', GPH_INT[v] || 60, 5);
    updateLegend();
  }
  const l = LEVELS_UI.find((x) => x.v === v);
  hint(t('hint.level', { v: l ? l.label : v }));
}

/* ---------- 启动 ---------- */
window.__currentModelLabel = MODEL_LABELS[state.model];
window.__state = state; window.__globe = globe; // 调试钩子
window.__applyGrid = (data, key) => applyGrid(data instanceof Grid ? data : new Grid(data), key || 'debug'); // 调试钩子:可注入格点数据
window.__app_map = map;
window.__app_overlays = { lightning, satellite, tropical, stations, airports, aurora, warnings, quakes, terminator, fires: firesLayer, buoys, rivers, tides }; // 调试钩子:叠加层状态
/* 静态模式:数据索引就绪后刷新图层置灰与模式胶囊(初始 setLayer 内部已等待索引,
 * URL 指定的模式若不提供该图层,也会由 setLayer 的自动解析修正) */
ensureStaticAvail().then(() => {
  refreshLayerButtons();
  refreshModelPill();
});
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

/* ---------- 语言(i18n):静态文案 + 选择器 + 切换热更新 ---------- */
applyDom();
initLangSelect();
onLangChange(() => {
  DIR8 = ta('dir8');
  renderLayerGroups();
  buildOverlayButtons();
  refreshModelPill();
  updateLevelBar();
  updateLegend();
  timeline.refresh();
  renderAbout();
  panel.refresh();
});

/* 首访提示 */
if (!localStorage.getItem('fy_hint_shown')) {
  try { localStorage.setItem('fy_hint_shown', '1'); } catch { /* 隐私模式 */ }
  toast(t('toast.firstVisit'), 9000);
}
