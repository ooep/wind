/* 全球海洋浮标/站实况叠加层(自绘 canvas):NDBC 数据,CI 每小时烘焙。
 * 点颜色 = 风速档,弹卡含风向/风速/阵风/浪高/浪周期/气压/气温/水温。 */
import { resolveMode, isStatic, staticBase } from '../api.js';
import { CanvasOverlay, fmtUTC } from './canvasoverlay.js';

const TTL = 30 * 60e3;

function wspdColor(v) {
  if (v == null) return '#8a8f98';
  if (v >= 20) return '#e03131';
  if (v >= 14) return '#f28c28';
  if (v >= 9) return '#f5c518';
  if (v >= 5) return '#7de3a0';
  return '#5fb9f0';
}

export class BuoysLayer extends CanvasOverlay {
  constructor(map, { toast } = {}) {
    super(map, 'buoys-canvas');
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
      const url = isStatic() ? `${staticBase()}/buoys/latest.json` : '/dist/data/buoys/latest.json';
      const r = await fetch(url, { cache: 'no-store' });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !ct.includes('json')) throw new Error('浮标数据未就绪');
      const d = await r.json();
      if (!Array.isArray(d.buoys)) throw new Error('浮标数据格式异常');
      this.data = d;
      this._fetchedAt = Date.now();
      this.requestRedraw();
    } catch (e) {
      if (this.toast) this.toast(`海洋浮标加载失败:${e.message}`);
    } finally {
      this._loading = false;
    }
  }

  draw(ctx) {
    if (!this.data) return;
    for (const [lon, lat, wdir, wspd, wgst, wvht, dpd, pres, atmp, wtmp, name] of this.data.buoys) {
      const p = this._toXY(lat, lon);
      if (p.x < -6 || p.y < -6 || p.x > this.w + 6 || p.y > this.h + 6) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4, 0, 6.2832);
      ctx.fillStyle = wspdColor(wspd);
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (wspd != null && wdir != null) {
        /* 风羽短线:指向风的来向下风侧 */
        const a = (wdir + 180) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + Math.sin(a) * (2.4 + Math.min(5, wspd / 4)), p.y - Math.cos(a) * (2.4 + Math.min(5, wspd / 4)));
        ctx.strokeStyle = wspdColor(wspd);
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
      this.hits.push({ x: p.x, y: p.y, r: 7, data: { lon, lat, wdir, wspd, wgst, wvht, dpd, pres, atmp, wtmp, name } });
    }
  }

  popupHtml(d) {
    const f = (v, unit) => (v == null ? '—' : `${v}${unit || ''}`);
    const dir8 = d.wdir == null ? '—' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d.wdir % 360) + 360) % 360 / 45) % 8];
    return `<div class="tc-popup"><b>海洋浮标</b> <span style="opacity:.7;font-size:11px">${d.name || ''}</span>
      <div class="tc-grid" style="margin-top:5px">
        <span>风向</span><b>${f(d.wdir, '°')} (${dir8})</b>
        <span>风速 / 阵风</span><b>${f(d.wspd)} / ${f(d.wgst)} m/s</b>
        <span>浪高 / 周期</span><b>${f(d.wvht, ' m')} / ${f(d.dpd, ' s')}</b>
        <span>气压</span><b>${f(d.pres, ' hPa')}</b>
        <span>气温 / 水温</span><b>${f(d.atmp, '°C')} / ${f(d.wtmp, '°C')}</b>
      </div><div style="opacity:.6;font-size:11px;margin-top:4px">NDBC 实测</div></div>`;
  }
}
