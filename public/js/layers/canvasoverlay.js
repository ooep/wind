/* 自绘叠加层基类:#overlay-root 画布 + 点击命中 + #obs-popup 弹卡。
 * 为什么不用 Leaflet 矢量层:气象场画布挂在 #overlay-root(z-index 450),
 * 而 .leaflet-map-pane 自身 z-index 400 形成独立堆叠上下文,其内部矢量层
 * (overlayPane/markerPane)永远被气象填色盖住 — 与 tropical/stations 同一套方案。
 * 子类实现 draw(ctx) 并在绘制时填充 this.hits(圆形 {x,y,r,data} 或路径 {path,data}),
 * 以及 popupHtml(data) 输出弹卡内容。 */
const POPUP_PAD = 8;

export class CanvasOverlay {
  constructor(map, canvasId) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.id = canvasId;
    document.getElementById('overlay-root').appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.popupOwner = canvasId;
    this.visible = false;
    this.hits = [];           // 绘制时缓存的命中目标
    this._resize();
    map.on('resize zoomend viewreset', () => { this._resize(); this._redraw(); });
    map.on('move zoom movestart', () => { if (this.visible) { this._hidePopup(); this._redraw(); } });
    map.on('click', (e) => this._onClick(e));
  }

  _resize() {
    const size = this.map.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = size.x; this.h = size.y;
    this.canvas.width = Math.round(size.x * dpr);
    this.canvas.height = Math.round(size.y * dpr);
  }

  /* Web 墨卡托投影 + 屏幕换算(与 tropical.js 同式,经度环绕安全) */
  _prj(lat, lng) {
    const s = 256 * Math.pow(2, this.map.getZoom());
    const x = ((lng + 180) / 360) * s;
    const sin = Math.sin(Math.max(-Math.PI / 2 + 1e-9, Math.min(Math.PI / 2 - 1e-9, lat * Math.PI / 180)));
    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s;
    return { x, y };
  }

  _toXY(lat, lng) {
    const center = this.map.getCenter();
    const cp = this._prj(center.lat, center.lng);
    const p = this._prj(lat, ((lng + 540) % 360) - 180);
    return { x: p.x - cp.x + this.w / 2, y: p.y - cp.y + this.h / 2 };
  }

  show(on) {
    this.visible = on;
    if (!on) {
      this._hidePopup();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  _redraw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.hits = [];
    if (this.visible) this.draw(ctx);
  }

  requestRedraw() { if (this.visible) this._redraw(); }

  _onClick(e) {
    if (!this.visible || !this.hits.length) return;
    const { x, y } = e.containerPoint;
    let best = null;
    for (const h of this.hits) {
      if (h.path) {
        if (this.ctx.isPointInPath(h.path, x * this.dpr, y * this.dpr)) { best = h; break; }
      } else {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d <= (h.r || 7) && (!best || d < best.d)) { best = h; best.d = d; }
      }
    }
    if (!best) { this._hidePopup(); return; }
    window.__obsClickClaimed = true; // 命中叠加对象:阻止主控弹预报面板
    this._showPopup(best);
  }

  _showPopup(hit) {
    let el = document.getElementById('obs-popup');
    if (!el) {
      el = document.createElement('div');
      el.id = 'obs-popup';
      document.getElementById('overlay-root').appendChild(el);
    }
    el.dataset.owner = this.popupOwner;
    el.innerHTML = this.popupHtml(hit.data);
    el.style.display = 'block';
    const w = el.offsetWidth, h = el.offsetHeight;
    const px = hit.popupX ?? hit.x, py = hit.popupY ?? hit.y;
    el.style.left = `${Math.max(POPUP_PAD, Math.min(px + 14, this.w - w - POPUP_PAD))}px`;
    el.style.top = `${Math.max(POPUP_PAD, Math.min(py - h - 12, this.h - h - POPUP_PAD))}px`;
  }

  _hidePopup() {
    const el = document.getElementById('obs-popup');
    if (el && el.dataset.owner === this.popupOwner) el.style.display = 'none';
  }

  popupHtml() { return ''; }
}

/* 日期格式化(弹卡共用) */
export function fmtUTC(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso)
    : `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}
