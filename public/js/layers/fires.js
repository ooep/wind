/* 活跃火点图层(NASA FIRMS 同源的 GIBS VIIRS 热异常点集,自绘 canvas):
 * CI 每小时从 GIBS 火点矢量瓦片烘焙全球点包(dist/data/fires/latest.json,零密钥),
 * 按置信度着色(黄/橙/红)。SPA 回退会把缺失路径也返回 200,
 * 因此必须校验 content-type 是 JSON 才认数。 */
import { resolveMode, isStatic, staticBase } from '../api.js';
import { CanvasOverlay } from './canvasoverlay.js';

const CONF_COLOR = ['#ffd24a', '#ff9d3c', '#ff5a3c'];
const CONF_LABEL = ['低', '中', '高'];
const TTL = 30 * 60e3;

export class FiresLayer extends CanvasOverlay {
  constructor(map, { toast } = {}) {
    super(map, 'fires-canvas');
    this.toast = toast;
    this.data = null;
    this._fetchedAt = 0;
    this._loading = false;
  }

  show(on) {
    super.show(on);
    if (on) this._ensure();
  }

  async _ensure() {
    if (this.data && Date.now() - this._fetchedAt < TTL) { this.requestRedraw(); return; }
    if (this._loading) return;
    this._loading = true;
    try {
      if (!this.data || Date.now() - this._fetchedAt > TTL) {
        await resolveMode();
        const url = isStatic() ? `${staticBase()}/fires/latest.json` : '/dist/data/fires/latest.json';
        const r = await fetch(url, { cache: 'no-store' });
        const ct = r.headers.get('content-type') || '';
        if (!r.ok || !ct.includes('json')) throw new Error('火点数据未就绪');
        const d = await r.json();
        if (!Array.isArray(d.points)) throw new Error('火点数据格式异常');
        this.data = d;
        this._fetchedAt = Date.now();
      }
      this.requestRedraw();
    } catch (e) {
      if (this.toast) this.toast(`活跃火点加载失败:${e.message}`);
    } finally {
      this._loading = false;
    }
  }

  draw(ctx) {
    if (!this.data) return;
    for (const [lon, lat, conf] of this.data.points) {
      const p = this._toXY(lat, lon);
      if (p.x < -5 || p.y < -5 || p.x > this.w + 5 || p.y > this.h + 5) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2, 0, 6.2832);
      ctx.fillStyle = CONF_COLOR[conf] || CONF_COLOR[1];
      ctx.globalAlpha = 0.78;
      ctx.fill();
      ctx.globalAlpha = 1;
      this.hits.push({ x: p.x, y: p.y, r: 6, data: { conf } });
    }
  }

  popupHtml(d) {
    return `<div class="tc-popup"><b>活跃火点</b><div style="opacity:.75;font-size:11.5px;margin-top:3px">置信度:${CONF_LABEL[d.conf] || '中'}</div>`
      + `<div style="opacity:.6;font-size:11px;margin-top:2px">VIIRS 375m · GIBS</div></div>`;
  }

  destroy() { this.show(false); }
}
