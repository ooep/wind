/* 全球地震叠加层(自绘 canvas,#overlay-root):USGS 数据,CI 每小时烘焙。
 * 圆点大小 = 震级,颜色 = 距今时间(红→橙→黄→灰),点击弹卡带地点/深度/时刻。 */
import { resolveMode, isStatic, staticBase } from '../api.js';
import { CanvasOverlay, fmtUTC } from './canvasoverlay.js';

const TTL = 15 * 60e3;
const HOUR = 3600e3;

function ageColor(ageMs) {
  if (ageMs < 6 * HOUR) return '#d92b2b';
  if (ageMs < 24 * HOUR) return '#e8702a';
  if (ageMs < 72 * HOUR) return '#e0a52a';
  return '#9aa0a8';
}

export class QuakesLayer extends CanvasOverlay {
  constructor(map, { toast } = {}) {
    super(map, 'quakes-canvas');
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
      const url = isStatic() ? `${staticBase()}/quakes/latest.json` : '/dist/data/quakes/latest.json';
      const r = await fetch(url, { cache: 'no-store' });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !ct.includes('json')) throw new Error('地震数据未就绪');
      const d = await r.json();
      if (!Array.isArray(d.quakes)) throw new Error('地震数据格式异常');
      this.data = d;
      this._fetchedAt = Date.now();
      this.requestRedraw();
    } catch (e) {
      if (this.toast) this.toast(`地震叠加层加载失败:${e.message}`);
    } finally {
      this._loading = false;
    }
  }

  draw(ctx) {
    if (!this.data) return;
    const now = Date.now();
    for (const [lon, lat, mag, depth, time, place] of this.data.quakes) {
      const age = now - time;
      if (age < 0 || age > 7.5 * 24 * HOUR) continue;
      const p = this._toXY(lat, lon);
      if (p.x < -16 || p.y < -16 || p.x > this.w + 16 || p.y > this.h + 16) continue;
      const r = Math.min(12, 2.6 + Math.max(0, mag) * 1.35);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, 6.2832);
      ctx.fillStyle = ageColor(age);
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      this.hits.push({ x: p.x, y: p.y, r: r + 3, data: { mag, depth, time, place } });
    }
  }

  popupHtml(d) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    return `<div class="tc-popup"><b>M${d.mag.toFixed(1)}</b> ${esc(d.place)}`
      + `<div style="opacity:.75;font-size:11.5px;margin-top:3px">深度 ${d.depth}km · ${fmtUTC(new Date(d.time).toISOString())} UTC</div>`
      + `<div style="opacity:.6;font-size:11px;margin-top:2px">USGS</div></div>`;
  }
}
