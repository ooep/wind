/* 风云地球 — 主控:地图、图层状态、格点调度、时间轴联动 */
import { Grid, getView } from './util.js';
import { WIND, TEMP, MSL, PRECIP, CLOUD, RH, RADAR, DEW, PTYPE, CAPE, SNOWCM, VIS } from './colormaps.js';
import { initApi, fetchGrid, clearGridCache } from './api.js';
import { ParticleLayer } from './layers/particles.js';
import { ScalarLayer } from './layers/scalar.js';
import { IsobarLayer } from './layers/isobars.js';
import { RadarLayer } from './layers/radar.js';
import { Timeline } from './timeline.js';
import { ForecastPanel, setDegUnit, toDeg } from './panel.js';
import { Search } from './search.js';

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
};

const LAYERS = [
  { id: 'wind', label: '风场', unit: 'm/s', cmap: WIND, variable: 'wind', fmt: (v) => Math.round(v) },
  { id: 'temp', label: '温度', unit: '°C', cmap: TEMP, variable: 'temp', fmt: (v) => Math.round(toDeg(v)) },
  { id: 'pressure', label: '气压', unit: 'hPa', cmap: MSL, variable: 'msl', fmt: (v) => Math.round(v), isobars: true },
  { id: 'precip', label: '降水', unit: 'mm/h', cmap: PRECIP, variable: 'precip', fmt: (v) => (v < 1 ? v.toFixed(1) : Math.round(v)) },
  { id: 'radar', label: '雷达', unit: 'dBZ', cmap: RADAR, special: 'radar', fmt: (v) => Math.round(v) },
  { id: 'cloud', label: '云量', unit: '%', cmap: CLOUD, variable: 'cloud', fmt: (v) => Math.round(v) },
  { id: 'humidity', label: '湿度', unit: '%', cmap: RH, variable: 'rh', fmt: (v) => Math.round(v), levels: true },
  { id: 'feels', label: '体感', unit: '°C', cmap: TEMP, variable: 'feels', fmt: (v) => Math.round(toDeg(v)) },
  { id: 'dew', label: '露点', unit: '°C', cmap: DEW, variable: 'dew', fmt: (v) => Math.round(toDeg(v)) },
  { id: 'ptype', label: '相态', unit: '', cmap: PTYPE, variable: 'ptype', fmt: (v) => ['—', '雨', '冻雨', '雪'][Math.round(v)] || '' },
  { id: 'cape', label: '雷暴', unit: 'J/kg', cmap: CAPE, variable: 'cape', fmt: (v) => Math.round(v), models: ['gfs_raw'] },
  { id: 'snow', label: '积雪', unit: 'cm', cmap: SNOWCM, variable: 'snowd', fmt: (v) => Math.round(v), models: ['gfs_raw'] },
  { id: 'vis', label: '能见度', unit: 'km', cmap: VIS, variable: 'vis', fmt: (v) => Math.round(v), models: ['gfs_raw'] },
];
// 支持气压层切换的图层(风/温/湿)
const LEVEL_LAYERS = new Set(['wind', 'temp', 'humidity']);

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
  best_match: 'Open-Meteo 最佳匹配', gfs_seamless: 'Open-Meteo NOAA GFS',
  icon_seamless: 'Open-Meteo DWD ICON', ecmwf_ifs025: 'Open-Meteo ECMWF IFS',
};

const state = {
  model: urlState.m || 'gfs_raw',
  layer: urlState.l || 'wind',
  particles: true,
  basemap: urlState.bm || 'vector',
  unit: 'c',
  level: num(urlState.lv, 0),
  opacity: Math.min(1, Math.max(0.35, num(urlState.op, 100) / 100)),
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
import { VectorBasemap } from './basemap.js?v=2';
let satLayer = null;
const GIBS_URL = (date) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
const vectorBasemap = new VectorBasemap(map);

function setBasemap(kind) {
  state.basemap = kind;
  syncUrl();
  if (satLayer) { map.removeLayer(satLayer); satLayer = null; }
  if (kind === 'satellite') {
    const d = new Date(Date.now() - 86400e3); // 取完整的一日合成影像
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    satLayer = L.tileLayer(GIBS_URL(date), {
      maxNativeZoom: 9, maxZoom: 10, attribution: 'NASA GIBS',
    }).addTo(map);
  }
}
setBasemap('vector');

/* ---------- 图层实例 ---------- */
const particles = new ParticleLayer(map);
const scalar = new ScalarLayer(map);
const isobars = new IsobarLayer(map);
const radar = new RadarLayer(map);
const timeline = new Timeline({ onChange: onTimeChange });
const panel = new ForecastPanel(() => state.model);

/* ---------- 图例(按色标分段取 5 档,兼容非线性色标) ---------- */
const legendEl = document.getElementById('legend');
function updateLegend() {
  const def = LAYERS.find((l) => l.id === state.layer);
  if (!def) { legendEl.hidden = true; return; }
  legendEl.hidden = false;
  document.getElementById('legend-title').textContent = `${def.label} · ${def.unit}`;
  document.getElementById('legend-bar').style.background = def.cmap.gradientCss();
  const stops = def.cmap.stops;
  const idxs = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (stops.length - 1))))];
  document.getElementById('legend-labels').innerHTML =
    idxs.map((i) => `<span>${def.fmt(stops[i][0])}</span>`).join('');
}

/* ---------- 图层切换 ---------- */
const layerBtnBox = document.getElementById('layer-buttons');
function refreshLayerButtons() {
  for (const btn of layerBtnBox.querySelectorAll('.layer-btn')) {
    const def = LAYERS.find((l) => l.id === btn.dataset.layer);
    btn.classList.toggle('dim', !!(def.models && !def.models.includes(state.model)));
  }
}
for (const def of LAYERS) {
  const btn = document.createElement('button');
  btn.className = 'layer-btn';
  btn.dataset.layer = def.id;
  btn.innerHTML = `${ICONS[def.id]}<span>${def.label}</span><small>${def.unit}</small>`;
  btn.addEventListener('click', () => setLayer(def.id));
  layerBtnBox.appendChild(btn);
}

function setLayer(id) {
  const def0 = LAYERS.find((l) => l.id === id);
  if (def0.models && !def0.models.includes(state.model)) {
    toast(`「${def0.label}」图层暂不支持当前模式,请切换到 NOAA GFS`);
    return;
  }
  state.layer = id;
  syncUrl();
  document.getElementById('cursor-tip').hidden = true; // 旧图层读数立即失效
  document.querySelectorAll('.layer-btn').forEach((b) => b.classList.toggle('active', b.dataset.layer === id));
  const def = LAYERS.find((l) => l.id === id);
  updateLevelBar();

  const isRadar = !!def.special;
  radar.show(isRadar);
  document.body.dataset.radarActive = isRadar ? '1' : '0';

  if (!isRadar) {
    scalar.show(true);
    scalar.setVar(def.variable, def.cmap);
  } else {
    scalar.show(false);
  }
  isobars.show(!!def.isobars);
  updateLegend();
  onTimeChange(state.timePos);
}

/* 粒子开关 */
const particleBtn = document.getElementById('toggle-particles');
particleBtn.addEventListener('click', () => {
  state.particles = !state.particles;
  particleBtn.classList.toggle('active', state.particles);
  particles.setEnabled(state.particles);
});

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
    const { grid } = await fetchGrid({ ...spec, model: state.model, level: state.level });
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
  timeline.setTimes(grid.times);
  if (state.pendingTime) {
    const t = state.pendingTime;
    state.pendingTime = null;
    timeline.setPos(Math.min(Math.max(t, grid.times[0]), grid.times[grid.times.length - 1]));
  } else onTimeChange(state.timePos);
}

map.on('moveend zoomend', () => { scheduleGridFetch(800); syncUrl(); });

/* ---------- 时间联动 ---------- */
function onTimeChange(ms) {
  state.timePos = ms;
  syncUrl();
  if (state.grid) {
    const fr = state.grid.frameAt(ms);
    scalar.setFrame(fr);
    isobars.setFrame(fr);
    particles.setFrame(fr);
  }
  radar.updateTime(ms);
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
  let main = `${def.fmt(v)}${def.unit ? ' ' + def.unit : ''}`;
  if (def.variable === 'wind') {
    const uv = state.grid.sampleUV(ll.lng, ll.lat, fr);
    if (uv) {
      const [u, w] = uv;
      const toDeg = (x, y) => (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
      const to = Math.round(toDeg(u, w));            // 指向下风方向(箭头去向)
      const from = DIR8[Math.round(toDeg(-u, -w) / 45) % 8];
      main = `<i class="ct-arrow" style="transform:rotate(${to - 90}deg)">➤</i>${Math.round(v)} m/s ${from}风`;
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
document.getElementById('model-select').addEventListener('change', (e) => {
  state.model = e.target.value;
  syncUrl();
  window.__currentModelLabel = MODEL_LABELS[state.model];
  if (!LEVEL_LAYERS.has(state.layer) || state.model !== 'gfs_raw') { if (state.level) state.level = 0; }
  clearGridCache();
  state.grid = null; state.gridKey = '';
  refreshLayerButtons();
  updateLevelBar();
  scheduleGridFetch(0);
  panel.refresh();
});
document.getElementById('basemap-select').addEventListener('change', (e) => setBasemap(e.target.value));
document.getElementById('unit-select').addEventListener('change', (e) => {
  state.unit = e.target.value;
  setDegUnit(state.unit);
  updateLegend();
  panel.refresh();
});

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

let pin = null;
function setPin(lat, lon) {
  const icon = L.divIcon({ className: '', html: '<div class="marker-pin"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
  if (pin) pin.setLatLng([lat, lon]).setIcon(icon);
  else pin = L.marker([lat, lon], { icon, keyboard: false }).addTo(map);
}

/* 点击地图查预报 */
map.on('click', (e) => {
  setPin(e.latlng.lat, e.latlng.lng);
  panel.open(e.latlng.lat, e.latlng.lng);
});

/* ---------- 键盘 ---------- */
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); timeline.togglePlay(); }
  else if (e.key === 'ArrowLeft') timeline.nudge(-1);
  else if (e.key === 'ArrowRight') timeline.nudge(1);
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

/* ---------- 气压层选择器 ---------- */
const LEVELS_UI = [
  { v: 0, label: '表面' }, { v: 925, label: '925' }, { v: 850, label: '850' },
  { v: 700, label: '700' }, { v: 500, label: '500' }, { v: 300, label: '300' },
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
    chip.addEventListener('click', () => {
      if (state.level === l.v) return;
      state.level = l.v;
      levelBar.querySelectorAll('.level-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      clearGridCache();
      state.grid = null; state.gridKey = '';
      scheduleGridFetch(0);
    });
    levelBar.appendChild(chip);
  }
}

/* ---------- 启动 ---------- */
window.__currentModelLabel = MODEL_LABELS[state.model];
window.__applyGrid = (data, key) => applyGrid(data instanceof Grid ? data : new Grid(data), key || 'debug'); // 调试钩子:可注入格点数据
window.__app_map = map;
if (urlState.m) document.getElementById('model-select').value = state.model;
if (urlState.bm) document.getElementById('basemap-select').value = state.basemap;
setBasemap(state.basemap);
applyOpacity(state.opacity);
setLayer(state.layer);
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
