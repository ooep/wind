/* 全球主要大河径流叠加层(自绘 canvas):GloFAS(经 Open-Meteo Flood API)日更烘焙。
 * 点大小 = 对数径流量,颜色单一水蓝;弹卡显示近 2 天 + 未来 3 天流量趋势。 */
import { resolveMode, isStatic, staticBase } from '../api.js';
import { CanvasOverlay } from './canvasoverlay.js';

const TTL = 6 * 3600e3;
const COLOR = '#4cc9f0';

export class RiversLayer extends CanvasOverlay {
  constructor(map, { toast } = {}) {
    super(map, 'rivers-canvas');
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
      const url = isStatic() ? `${staticBase()}/rivers/latest.json` : '/dist/data/rivers/latest.json';
      const r = await fetch(url, { cache: 'no-store' });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !ct.includes('json')) throw new Error('河流数据未就绪');
      const d = await r.json();
      if (!Array.isArray(d.stations)) throw new Error('河流数据格式异常');
      this.data = d;
      this._fetchedAt = Date.now();
      this.requestRedraw();
    } catch (e) {
      if (this.toast) this.toast(`大河径流加载失败:${e.message}`);
    } finally {
      this._loading = false;
    }
  }

  draw(ctx) {
    if (!this.data) return;
    const today = new Date().toISOString().slice(0, 10);
    for (const st of this.data.stations) {
      const p = this._toXY(st.lat, st.lon);
      if (p.x < -14 || p.y < -14 || p.x > this.w + 14 || p.y > this.h + 14) continue;
      const q = st.series?.find(([t]) => t === today)?.[1] ?? st.series?.[2]?.[1] ?? null;
      const r = q == null ? 2.4 : Math.min(11, 2.4 + 1.55 * Math.log10(Math.max(1, q)));
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, 6.2832);
      ctx.fillStyle = COLOR;
      ctx.globalAlpha = 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      this.hits.push({ x: p.x, y: p.y, r: r + 5, data: { st, q } });
    }
  }

  popupHtml(d) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const st = d.st;
    const rows = (st.series || []).map(([t, q], i) => {
      const tag = i === 2 ? '今天' : i < 2 ? `${2 - i}天前` : `+${i - 2}天`;
      return `<span style="opacity:.65">${tag}</span><b>${q == null ? '—' : q.toLocaleString('en-US') + ' m³/s'}</b>`;
    }).map((x) => `<div style="display:flex;justify-content:space-between;gap:14px">${x}</div>`).join('');
    return `<div class="tc-popup"><b>${esc(st.zh || st.name)}</b> <span style="opacity:.7;font-size:11px">${esc(st.name)}</span>
      <div style="opacity:.78;font-size:11.5px;margin:3px 0">当前径流 <b style="color:${COLOR}">${d.q == null ? '—' : d.q.toLocaleString('en-US')} m³/s</b></div>
      <div style="font-size:11px;margin-top:4px">${rows}</div>
      <div style="opacity:.6;font-size:11px;margin-top:4px">GloFAS · Open-Meteo</div></div>`;
  }
}
