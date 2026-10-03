/* 官方气象预警叠加层(自绘 canvas,#overlay-root,与气象填色同栈):
 *  - 美国 NWS:多边形区域(黄/橙/红按 severity),Path2D 点击命中
 *  - 欧洲 meteoalarm:国家聚合徽标点(取该国最高级别,弹卡列明细)
 * CI 每小时烘焙 dist/data/warnings/latest.json;SPA 回退会把缺失路径返回 200,
 * 必须校验 content-type 是 JSON 才认数。 */
import { resolveMode, isStatic, staticBase } from '../api.js';
import { CanvasOverlay, fmtUTC } from './canvasoverlay.js';

const TTL = 15 * 60e3;
const LV_COLOR = { 1: '#f5c518', 2: '#f28c28', 3: '#e03131' };
const LV_NAME = { 1: '黄色', 2: '橙色', 3: '红色' };

export class WarningsLayer extends CanvasOverlay {
  constructor(map, { toast } = {}) {
    super(map, 'warnings-canvas');
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
      const url = isStatic() ? `${staticBase()}/warnings/latest.json` : '/dist/data/warnings/latest.json';
      const r = await fetch(url, { cache: 'no-store' });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !ct.includes('json')) throw new Error('预警数据未就绪');
      const d = await r.json();
      if (!d.nws && !d.eu) throw new Error('预警数据格式异常');
      this.data = d;
      this._fetchedAt = Date.now();
      this.requestRedraw();
    } catch (e) {
      if (this.toast) this.toast(`气象预警加载失败:${e.message}`);
    } finally {
      this._loading = false;
    }
  }

  draw(ctx) {
    if (!this.data) return;
    /* NWS 多边形 */
    for (const a of this.data.nws?.alerts || []) {
      const color = LV_COLOR[a.lv] || LV_COLOR[1];
      for (const poly of a.poly) {
        const path = new Path2D();
        let cx = 0, cy = 0, n = 0;
        for (const ring of poly) {
          let started = false, prev = null;
          for (const [lon, lat] of ring) {
            const p = this._toXY(lat, lon);
            if (prev && Math.abs(p.x - prev.x) > this.w / 2) started = false; // 跨反子午线断笔
            if (!started) { path.moveTo(p.x, p.y); started = true; }
            else path.lineTo(p.x, p.y);
            prev = p; cx += p.x; cy += p.y; n++;
          }
          path.closePath();
        }
        if (!n) continue;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.16;
        ctx.fill(path);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.1;
        ctx.stroke(path);
        ctx.globalAlpha = 1;
        this.hits.push({ path, data: { kind: 'nws', a }, popupX: cx / n, popupY: cy / n });
      }
    }
    /* 欧洲国家徽标 */
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const c of this.data.eu?.countries || []) {
      const p = this._toXY(c.lat, c.lon);
      if (p.x < -20 || p.y < -20 || p.x > this.w + 20 || p.y > this.h + 20) continue;
      const color = LV_COLOR[c.lv] || LV_COLOR[1];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, 6.2832);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = '#0b1420';
      ctx.fillText(c.cc, p.x, p.y + 3.5);
      this.hits.push({ x: p.x, y: p.y, r: 10, data: { kind: 'eu', c } });
    }
  }

  popupHtml(d) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    if (d.kind === 'nws') {
      const a = d.a;
      const ends = a.ends ? `${fmtUTC(a.ends + (a.ends.endsWith('Z') ? '' : 'Z'))} UTC` : '—';
      return `<div class="tc-popup"><b><span style="color:${LV_COLOR[a.lv]}">●</span> ${LV_NAME[a.lv] || ''}${esc(a.ev)}</b>`
        + `<div style="opacity:.78;font-size:11.5px;margin:3px 0">${esc(a.area)}</div>`
        + `<div style="opacity:.6;font-size:11px">NWS · 至 ${ends}</div></div>`;
    }
    const c = d.c;
    const rows = (c.items || []).map((it) =>
      `<div style="margin:2px 0"><span style="color:${LV_COLOR[it.lv]};font-weight:700">●</span> ${esc(it.ev)}`
      + `${it.areas?.length ? `<div style="opacity:.7;font-size:11px;margin-left:13px">${esc(it.areas.slice(0, 8).join(' / '))}</div>` : ''}</div>`).join('');
    return `<div class="tc-popup"><b>${esc(c.zh)} · ${LV_NAME[c.lv]}预警 ×${c.n}</b>`
      + `<div style="max-width:280px;max-height:220px;overflow:auto;margin-top:4px">${rows}</div>`
      + `<div style="opacity:.6;font-size:11px;margin-top:4px">MeteoAlarm</div></div>`;
  }
}
