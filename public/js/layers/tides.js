/* 潮汐叠加层(自绘 canvas,CI 日更烘焙):
 *  - 美国沿岸:NOAA CO-OPS 高/低潮预报(青色大点),弹卡列今日+明日最高/最低(站点当地时)
 *  - 全球:UHSLC 验潮站逐时实测(青色小点),弹卡显示最新水位与 24h 高低(相对本站基准面,UTC) */
import { resolveMode, isStatic, staticBase } from '../api.js';
import { CanvasOverlay } from './canvasoverlay.js';

const TTL = 12 * 3600e3;
const COLOR = '#5eead4';

export class TidesLayer extends CanvasOverlay {
  constructor(map, { toast } = {}) {
    super(map, 'tides-canvas');
    this.toast = toast;
    this.data = null;
    this.global = null;
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
      const base = isStatic() ? `${staticBase()}/tides` : '/dist/data/tides';
      const r = await fetch(`${base}/latest.json`, { cache: 'no-store' });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !ct.includes('json')) throw new Error('潮汐数据未就绪');
      const d = await r.json();
      if (!Array.isArray(d.stations)) throw new Error('潮汐数据格式异常');
      this.data = d;
      this._fetchedAt = Date.now();
      this.requestRedraw();
      /* 全球实测为增强包:拉不到不拦美国站 */
      try {
        const rg = await fetch(`${base}/global.json`, { cache: 'no-store' });
        if (rg.ok && (rg.headers.get('content-type') || '').includes('json')) {
          const g = await rg.json();
          if (Array.isArray(g.stations)) { this.global = g; this.requestRedraw(); }
        }
      } catch { /* 可选 */ }
    } catch (e) {
      if (this.toast) this.toast(`潮汐站加载失败:${e.message}`);
    } finally {
      this._loading = false;
    }
  }

  draw(ctx) {
    if (this.global) {
      for (const st of this.global.stations) {
        const p = this._toXY(st.lat, st.lon);
        if (p.x < -5 || p.y < -5 || p.x > this.w + 5 || p.y > this.h + 5) continue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6, 0, 6.2832);
        ctx.fillStyle = COLOR;
        ctx.globalAlpha = 0.7;
        ctx.fill();
        ctx.globalAlpha = 1;
        this.hits.push({ x: p.x, y: p.y, r: 5, data: { st, src: 'uhslc' } });
      }
    }
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
    if (d.src === 'uhslc') {
      const lv = d.st.lv || [];
      let rows = '';
      if (lv.length) {
        let hi = lv[0], lo = lv[0];
        for (const p of lv) { if (p[1] > hi[1]) hi = p; if (p[1] < lo[1]) lo = p; }
        const latest = lv[lv.length - 1];
        rows = `<div style="display:flex;justify-content:space-between;gap:12px"><span style="opacity:.65">${latest[0].slice(5, 16)} UTC</span><b style="color:${COLOR}">最新 ${latest[1].toFixed(2)} m</b></div>`
          + `<div style="display:flex;justify-content:space-between;gap:12px"><span style="opacity:.65">时段最高 / 最低</span><b>${hi[1].toFixed(2)} / ${lo[1].toFixed(2)} m</b></div>`;
      }
      return `<div class="tc-popup"><b>${esc(d.st.name)}</b>${d.st.country ? ` <span style="opacity:.7;font-size:11px">${esc(d.st.country)}</span>` : ''}
      <div style="font-size:11px;margin-top:4px">${rows}</div>
      <div style="opacity:.6;font-size:11px;margin-top:4px">UHSLC 实测(Fast Delivery,发布滞后数周)· 相对本站基准面</div></div>`;
    }
    const rows = (d.st.tides || []).map(([t, type, v]) =>
      `<div style="display:flex;justify-content:space-between;gap:12px">`
      + `<span style="opacity:.65">${t.slice(5, 16)}</span>`
      + `<b style="color:${type === 'H' ? COLOR : 'inherit'}">${type === 'H' ? '高潮' : '低潮'} ${v.toFixed(2)} m</b></div>`).join('');
    return `<div class="tc-popup"><b>${esc(d.st.name)}</b>${d.st.state ? ` <span style="opacity:.7;font-size:11px">${esc(d.st.state)}</span>` : ''}
      <div style="font-size:11px;margin-top:4px">${rows}</div>
      <div style="opacity:.6;font-size:11px;margin-top:4px">NOAA CO-OPS 预报 · 站点当地时</div></div>`;
  }
}
