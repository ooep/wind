/* 卫星云图图层(NASA GIBS):三颗静止卫星红外/真彩(10 分钟)+ 全球极轨每日(真彩/夜光)。
 * 静止卫星圆盘互不重叠区域由"自动"通道按地图视野就近选源;极区或圆盘外自动回落
 * 全球每日图层(按太阳高度角选真彩/夜光),避免出现黑区。
 * 与时间轴联动:静止卫星取 ≤ 时刻最近的 10 分钟帧,每日图层取对应 UTC 日期。 */
import { clamp } from '../util.js';

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

/* sub = 静止卫星星下点经度(自动选源用);stepMin = 帧间隔分钟 */
const CHANNELS = {
  auto: {
    label: '自动 · 按视野',
    auto: true, attribution: 'NOAA / JMA / NASA GIBS',
  },
  irh: {
    label: '红外 · 向日葵9(亚洲/大洋洲)',
    layer: 'Himawari_AHI_Band13_Clean_Infrared',
    tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxNativeZoom: 6,
    stepMin: 10, sub: 140.7, attribution: 'JMA Himawari-9 / NASA GIBS',
  },
  irw: {
    label: '红外 · GOES-West(太平洋)',
    layer: 'GOES-West_ABI_Band13_Clean_Infrared',
    tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxNativeZoom: 6,
    stepMin: 10, sub: -137.2, attribution: 'NOAA GOES-West / NASA GIBS',
  },
  ire: {
    label: '红外 · GOES-East(美洲/大西洋)',
    layer: 'GOES-East_ABI_Band13_Clean_Infrared',
    tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxNativeZoom: 6,
    stepMin: 10, sub: -75.2, attribution: 'NOAA GOES-East / NASA GIBS',
  },
  geow: {
    label: '真彩 · GOES-West(昼夜融合)',
    layer: 'GOES-West_ABI_GeoColor',
    tms: 'GoogleMapsCompatible_Level7', ext: 'png', maxNativeZoom: 7,
    stepMin: 10, sub: -137.2, attribution: 'NOAA GOES-West / NASA GIBS',
  },
  geoe: {
    label: '真彩 · GOES-East(昼夜融合)',
    layer: 'GOES-East_ABI_GeoColor',
    tms: 'GoogleMapsCompatible_Level7', ext: 'png', maxNativeZoom: 7,
    stepMin: 10, sub: -75.2, attribution: 'NOAA GOES-East / NASA GIBS',
  },
  truecolor: {
    label: '真彩 · 全球(VIIRS 每日)',
    layer: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
    tms: 'GoogleMapsCompatible_Level9', ext: 'jpg', maxNativeZoom: 9,
    daily: true, passHour: 14, attribution: 'NASA GIBS / VIIRS',
  },
  night: {
    label: '夜光 · 全球(VIIRS 每日)',
    layer: 'VIIRS_SNPP_DayNightBand_At_Sensor_Radiance',
    tms: 'GoogleMapsCompatible_Level8', ext: 'png', maxNativeZoom: 8,
    daily: true, passHour: 2.5, attribution: 'NASA GIBS / VIIRS 昼夜波段',
  },
};

/* 静止卫星圆盘有效半径(度):ABI/AHI 全圆盘约 ±80°,留边取 78 */
const DISK_RADIUS = 78;

/* 星下点在赤道,球面距离公式可简化 */
function diskDist(lat, lon, subLon) {
  const dLon = ((lon - subLon + 540) % 360) - 180;
  const rad = Math.PI / 180;
  return Math.acos(clamp(Math.cos(lat * rad) * Math.cos(dLon * rad), -1, 1)) / rad;
}

/* 粗略太阳高度角(±1°量级精度足够分昼夜) */
function sunElev(lat, lon, ms) {
  const d = new Date(ms);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const doy = (ms - start) / 86400e3;
  const decl = 23.44 * Math.sin((2 * Math.PI * (doy + 284)) / 365) * Math.PI / 180;
  const h = ((d.getUTCHours() + d.getUTCMinutes() / 60) - 12) * 15 + lon;
  const rad = Math.PI / 180;
  return Math.asin(
    Math.sin(lat * rad) * Math.sin(decl) +
    Math.cos(lat * rad) * Math.cos(decl) * Math.cos(h * rad),
  ) / rad;
}

export class SatelliteLayer {
  constructor(map) {
    this.map = map;
    this.visible = false;
    this.channel = localStorage.getItem('fy_sat_ch') || 'auto';
    if (!CHANNELS[this.channel]) this.channel = 'auto';
    this.eff = this._resolve(); // 自动模式展开后的实际通道
    this.tile = null;
    this.lastMs = null;
    this.lastUrlTime = '';
    this._refreshTimer = null;
    // 自动模式跟随视野:平移结束后重新就近选源
    this._onMoveEnd = () => {
      if (this.visible && CHANNELS[this.channel].auto) this.updateTime(this.lastMs || Date.now());
    };
    this.map.on('moveend', this._onMoveEnd);
  }

  static channels() { return CHANNELS; }

  /* 视野中心 → 实际数据源:覆盖圆盘就近,圆盘外按昼夜回落全球图层 */
  _resolve(atMs) {
    const id = this.channel;
    if (!CHANNELS[id].auto) return id;
    const c = this.map.getCenter();
    let best = null;
    let bestD = Infinity;
    for (const [k, ch] of Object.entries(CHANNELS)) {
      if (ch.sub === undefined) continue;
      const d = diskDist(c.lat, c.lng, ch.sub);
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best && bestD <= DISK_RADIUS) return best;
    const ms = atMs || Date.now();
    return sunElev(c.lat, c.lng, Math.min(ms, Date.now())) > -2 ? 'truecolor' : 'night';
  }

  setChannel(id) {
    if (!CHANNELS[id] || id === this.channel) return;
    this.channel = id;
    try { localStorage.setItem('fy_sat_ch', id); } catch { /* 隐私模式 */ }
    this.eff = this._resolve();
    if (this.visible) { this.lastUrlTime = ''; this.updateTime(this.lastMs || Date.now()); }
  }

  show(on) {
    this.visible = on;
    clearInterval(this._refreshTimer);
    if (on) {
      this._refreshTimer = setInterval(() => { if (this.visible) this.updateTime(this.lastMs || Date.now()); }, 10 * 60_000);
      this.eff = this._resolve();
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
    const eff = this._resolve(ms);
    const changed = eff !== this.eff;
    this.eff = eff;
    const ch = CHANNELS[eff];
    let t;
    if (ch.daily) {
      // 每日合成随当日过境逐步铺满:视野当地还没到该通道的过境时刻时,
      // 今天的拼图在该扇区仍是黑块 → 退回昨日完整拼图
      let d = new Date(Math.min(ms, Date.now()));
      const localH = (d.getUTCHours() + d.getUTCMinutes() / 60 + this.map.getCenter().lng / 15 + 48) % 24;
      if (Date.now() - d.getTime() < 24 * 3600e3 && localH < ch.passHour) {
        d = new Date(d.getTime() - 86400e3);
      }
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
    if (!changed && t === this.lastUrlTime && this.tile) return;
    this.lastUrlTime = t;
    this._swap();
  }

  destroy() {
    this.show(false);
    this.map.off('moveend', this._onMoveEnd);
  }

  _swap() {
    const ch = CHANNELS[this.eff];
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
