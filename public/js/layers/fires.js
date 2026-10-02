/* 活跃火点图层(NASA FIRMS 同源的 GIBS VIIRS 热异常点集):
 * CI 每小时从 GIBS 火点矢量瓦片烘焙全球点包(dist/data/fires/latest.json,零密钥),
 * 前端 canvas 圆点渲染,按置信度着色。SPA 回退会把缺失路径也返回 200,
 * 因此必须校验 content-type 是 JSON 才认数。 */
import { resolveMode, isStatic, staticBase } from '../api.js';

const CONF_COLOR = ['#ffd24a', '#ff9d3c', '#ff5a3c'];
const CONF_LABEL = ['低', '中', '高'];
const TTL = 30 * 60e3;

export class FiresLayer {
  constructor(map, { toast } = {}) {
    this.map = map;
    this.toast = toast;
    this.visible = false;
    this.group = null;
    this.data = null;
    this._fetchedAt = 0;
    this._loading = false;
    this._renderer = L.canvas({ padding: 0.4, pane: 'overlayPane' });
  }

  show(on) {
    this.visible = on;
    if (on) {
      this._ensure();
    } else if (this.group) {
      this.map.removeLayer(this.group);
      this.group = null;
    }
  }

  async _ensure() {
    if (this.group || this._loading) return;
    this._loading = true;
    try {
      if (!this.data || Date.now() - this._fetchedAt > TTL) {
        await resolveMode();
        const url = isStatic() ? `${staticBase()}/fires/latest.json` : '/api/fires';
        const r = await fetch(url, { cache: 'no-store' });
        const ct = r.headers.get('content-type') || '';
        if (!r.ok || !ct.includes('json')) throw new Error('火点数据未就绪');
        const d = await r.json();
        if (!Array.isArray(d.points)) throw new Error('火点数据格式异常');
        this.data = d;
        this._fetchedAt = Date.now();
      }
      if (!this.visible || this.group) return;
      const g = L.layerGroup([], { renderer: this._renderer });
      for (const [lon, lat, conf] of this.data.points) {
        g.addLayer(L.circleMarker([lat, lon], {
          radius: 3.2, weight: 0, fillOpacity: 0.78,
          fillColor: CONF_COLOR[conf] || CONF_COLOR[1],
        }).bindTooltip(`火点 · 置信度${CONF_LABEL[conf] || '中'}`, { direction: 'top' }));
      }
      this.group = g.addTo(this.map);
    } catch (e) {
      if (this.toast) this.toast(`活跃火点加载失败:${e.message}`);
    } finally {
      this._loading = false;
    }
  }

  destroy() { this.show(false); }
}
