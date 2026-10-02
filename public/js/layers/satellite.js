/* 卫星云图图层(NASA GIBS):全球真彩(VIIRS 每日)+ GOES 东/西红外(10 分钟)。
 * 与时间轴联动:GOES 取 ≤ 时刻最近的 10 分钟帧,VIIRS 取对应 UTC 日期。 */
import { clamp } from '../util.js';

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

const CHANNELS = {
  truecolor: {
    label: '真彩 · 全球',
    layer: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
    tms: 'GoogleMapsCompatible_Level9', ext: 'jpg', maxNativeZoom: 9,
    daily: true, attribution: 'NASA GIBS / VIIRS',
  },
  irw: {
    label: '红外 · GOES-West',
    layer: 'GOES-West_ABI_Band13_Clean_Infrared',
    tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxNativeZoom: 6,
    stepMin: 10, coverage: [[-60, 105], [65, -115]], attribution: 'NOAA GOES-West / NASA GIBS',
  },
  ire: {
    label: '红外 · GOES-East',
    layer: 'GOES-East_ABI_Band13_Clean_Infrared',
    tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxNativeZoom: 6,
    stepMin: 10, coverage: [[-60, -165], [65, 15]], attribution: 'NOAA GOES-East / NASA GIBS',
  },
};

export class SatelliteLayer {
  constructor(map) {
    this.map = map;
    this.visible = false;
    this.channel = localStorage.getItem('fy_sat_ch') || 'irw';
    if (!CHANNELS[this.channel]) this.channel = 'irw';
    this.tile = null;
    this.lastMs = null;
    this.lastUrlTime = '';
    this._refreshTimer = null;
  }

  static channels() { return CHANNELS; }

  setChannel(id) {
    if (!CHANNELS[id] || id === this.channel) return;
    this.channel = id;
    try { localStorage.setItem('fy_sat_ch', id); } catch { /* 隐私模式 */ }
    if (this.visible) { this.lastUrlTime = ''; this.updateTime(this.lastMs || Date.now()); }
  }

  show(on) {
    this.visible = on;
    clearInterval(this._refreshTimer);
    if (on) {
      this._refreshTimer = setInterval(() => { if (this.visible) this.updateTime(this.lastMs || Date.now()); }, 10 * 60_000);
      this.updateTime(this.lastMs || Date.now());
    } else if (this.tile) {
      this.map.removeLayer(this.tile);
      this.tile = null;
      this.lastUrlTime = '';
    }
  }

  /* 时间轴驱动:挑选 ≤ 时刻的最新帧 */
  updateTime(ms) {
    if (!this.visible) return;
    this.lastMs = ms;
    const ch = CHANNELS[this.channel];
    let t;
    if (ch.daily) {
      const d = new Date(Math.min(ms, Date.now() - 5 * 3600e3));
      t = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    } else {
      const now = Date.now();
      // 未来/当前时刻 → 用 default(最新帧);过去时刻 → 取 ≤ 时刻最近 10 分钟帧
      if (ms > now - 20 * 60_000) t = 'default';
      else {
        const step = ch.stepMin * 60_000;
        const d = new Date(Math.floor(ms / step) * step);
        t = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:00Z`;
      }
    }
    if (t === this.lastUrlTime && this.tile) return;
    this.lastUrlTime = t;
    this._swap();
  }

  _swap() {
    const ch = CHANNELS[this.channel];
    const url = `${GIBS}/${ch.layer}/default/${this.lastUrlTime || 'default'}/${ch.tms}/{z}/{y}/{x}.${ch.ext}`;
    if (this.tile) {
      this.tile.setUrl(url);
      this.tile.options.maxNativeZoom = ch.maxNativeZoom;
    } else {
      this.tile = L.tileLayer(url, {
        maxNativeZoom: ch.maxNativeZoom, maxZoom: 12, opacity: 0.88,
        attribution: ch.attribution, className: 'satellite-tiles',
      }).addTo(this.map);
    }
  }
}
