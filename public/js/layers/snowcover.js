/* 雪盖观测叠加(NASA GIBS / VIIRS SNPP NDSI 日产品):
 * 卫星反演的真实雪盖范围,逐日更新(~1 天滞后),边缘远比模式格点锐利。
 * 与时间轴联动:按时间轴时刻取对应 UTC 日期的日产品。 */
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const LAYER_ID = 'VIIRS_SNPP_NDSI_Snow_Cover';
const TMS = 'GoogleMapsCompatible_Level8';

export class SnowCoverLayer {
  constructor(map) {
    this.map = map;
    this.visible = false;
    this.tile = null;
    this.lastDate = '';
  }

  show(on) {
    this.visible = on;
    if (on) {
      this.updateTime(this.lastMs || Date.now());
    } else if (this.tile) {
      this.map.removeLayer(this.tile);
      this.tile = null;
    }
  }

  updateTime(ms) {
    this.lastMs = ms;
    if (!this.visible) return;
    /* 日产品取 ≤ 时刻最近一天(数据滞后约 1 天,取昨天兜底) */
    const d = new Date(Math.min(ms, Date.now() - 86400e3));
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    if (date === this.lastDate && this.tile) return;
    this.lastDate = date;
    const url = `${GIBS}/${LAYER_ID}/default/${date}/${TMS}/{z}/{y}/{x}.png`;
    if (this.tile) {
      this.tile.setUrl(url);
    } else {
      this.tile = L.tileLayer(url, {
        maxNativeZoom: 8, maxZoom: 10, opacity: 0.72,
        className: 'snowcover-tiles', attribution: 'NASA GIBS / VIIRS',
      }).addTo(this.map);
    }
  }

  destroy() {
    this.show(false);
  }
}
