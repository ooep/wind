/* NOAA 潮汐站叠加层(自绘 canvas):美国沿岸潮位预报,CI 日更烘焙。
 * 青色小点;弹卡列出今日+明日的最高/最低潮位(站点当地时)。 */
import { resolveMode, isStatic, staticBase } from '../api.js';
import { CanvasOverlay } from './canvasoverlay.js';

const TTL = 12 * 3600e3;
const COLOR = '#5eead4';

export class TidesLayer extends CanvasOverlay {
  constructor(map, { toast } = {}) {
    super(map, 'tides-canvas');
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
      await resolveMode();
      const url = isStatic() ? `${staticBase()}/tides/latest.json` : '/dist/data/tides/latest.json';
      const r = await fetch(url, { cache: 'no-store' });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !ct.includes('json')) throw new Error('潮汐数据未就绪');
      const d = await r.json();
      if (!Array.isArray(d.stations)) throw new Error('潮汐数据格式异常');
      this.data = d;
      this._fetchedAt = Date.now();
      this.requestRedraw();
    } catch (e) {
      if (this.toast) this.toast(`潮汐站加载失败:${e.message}`);
    } finally {
      this._loading = false;
    }
  }

  draw(ctx) {
    if (!this.data) return;
    for (const st of this.data.stations) {
      const p = this._toXY(st.lat, st.lon);
      if (p.x < -5 || p.y < -5 || p.x > this.w + 5 || p.y > this.h + 5) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, 6.2832);
      ctx.fillStyle = COLOR;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      this.hits.push({ x: p.x, y: p.y, r: 6, data: { st } });
    }
  }

  popupHtml(d) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const rows = (d.st.tides || []).map(([t, type, v]) =>
      `<div style="display:flex;justify-content:space-between;gap:12px">`
      + `<span style="opacity:.65">${t.slice(5, 16)}</span>`
      + `<b style="color:${type === 'H' ? COLOR : 'inherit'}">${type === 'H' ? '高潮' : '低潮'} ${v.toFixed(2)} m</b></div>`).join('');
    return `<div class="tc-popup"><b>${esc(d.st.name)}</b>${d.st.state ? ` <span style="opacity:.7;font-size:11px">${esc(d.st.state)}</span>` : ''}
      <div style="font-size:11px;margin-top:4px">${rows}</div>
      <div style="opacity:.6;font-size:11px;margin-top:4px">NOAA CO-OPS 预报 · 站点当地时</div></div>`;
  }
}
