/* NASA GIBS 卫星观测图层(通用瓦片叠加):
 * IMERG 30 分钟降水 / MODIS 地表温度 / SMAP 土壤湿度与冻土 / NDVI /
 * OMI 气溶胶指数 / 叶绿素 / 海冰浓度 / 大气水汽 — 全部零注册直连,CORS 开放。
 * 时间策略按产品节奏:30min(准实时,~4.5h 延迟)/ 日产品(滞后 N 天)/ 8 天合成(对齐周期)。
 * 某日期整片 404(上游未出图)时自动回退上一个周期重试。 */
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const DAY = 86400e3;

const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export class GibsLayer {
  constructor(map) {
    this.map = map;
    this.visible = false;
    this.cfg = null;
    this.tile = null;
    this.lastUrlTime = '';
    this.lastMs = null;
    this.baseOpacity = 0.88;
    this.back = 0;          // 整片 404 时的周期回退步数
    this._err = 0; this._load = 0; this._check = null;
  }

  setBaseOpacity(v) {
    this.baseOpacity = 0.88 * Math.min(1, Math.max(0, v));
    if (this.tile) this.tile.setOpacity(this.baseOpacity);
  }

  show(on, cfg) {
    this.visible = !!on && !!cfg;
    if (cfg && this.cfg !== cfg) { this.cfg = cfg; this.lastUrlTime = ''; this.back = 0; }
    if (this.visible) {
      this.updateTime(this.lastMs || Date.now());
    } else if (this.tile) {
      this.map.removeLayer(this.tile);
      this.tile = null;
      this.lastUrlTime = '';
    }
  }

  /* 按产品节奏计算 GIBS 时间参数 */
  _timeAt(ms) {
    const c = this.cfg;
    const now = Date.now();
    if (c.cadence === 'min30') {
      const step = 30 * 60e3;
      const t = Math.floor((Math.min(ms, now) - (4.5 * 3600e3 + this.back * step)) / step) * step;
      const d = new Date(t);
      return `${dateStr(d)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00Z`;
    }
    if (c.cadence === 'days8') {
      // 8 天合成:对齐 GIBS 周期锚点(2000-02-24),再回退一个周期保证完整
      const d = new Date(Math.min(ms, now) - (c.lag + 8 + this.back * 8) * DAY);
      const anchor = Date.UTC(2000, 1, 24);
      const start = new Date(anchor + 8 * DAY * Math.floor((d.getTime() - anchor) / (8 * DAY)));
      return dateStr(start);
    }
    const d = new Date(Math.min(ms, now) - (c.lag + this.back) * DAY);
    return dateStr(d);
  }

  updateTime(ms) {
    if (!this.visible || !this.cfg) return;
    this.lastMs = ms;
    const t = this._timeAt(ms);
    if (t === this.lastUrlTime && this.tile) return;
    this.lastUrlTime = t;
    const c = this.cfg;
    const url = `${GIBS}/${c.gibs}/default/${t}/${c.tms}/{z}/{y}/{x}.${c.ext || 'png'}`;
    if (this.tile) {
      this.tile.setUrl(url);
    } else {
      this.tile = L.tileLayer(url, {
        maxNativeZoom: c.zoom, maxZoom: 10, opacity: this.baseOpacity,
        className: 'gibs-tiles', attribution: c.attr || 'NASA GIBS',
      }).addTo(this.map);
      /* 上游当日未出图:3.5s 内零成功瓦片且多次 404 → 回退一个周期 */
      this.tile.on('tileload', () => { this._load++; });
      this.tile.on('tileerror', () => { this._err++; });
    }
    clearTimeout(this._check);
    this._load = 0; this._err = 0;
    this._check = setTimeout(() => {
      const maxBack = c.cadence === 'min30' ? 8 : 6;
      if (this.visible && this._load === 0 && this._err >= 2 && this.back < maxBack) {
        this.back++;
        this.lastUrlTime = '';
        this.updateTime(this.lastMs || Date.now());
      }
    }, 3500);
  }

  destroy() {
    this.show(false);
    clearTimeout(this._check);
  }
}
