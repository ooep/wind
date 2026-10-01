/* 风场粒子动画层(nullschool 风格):拖尾轨迹 + 速度着色 */
import { getView } from '../util.js';
import { WIND } from '../colormaps.js';

const MAX_SPEED_PX = 5.5;   // 单帧位移上限(px),防止视觉过快
const BASE_K = 0.055;        // z=2 时的 px/(m/s·帧) 系数
const FADE_ALPHA = 0.945;    // 拖尾衰减

export class ParticleLayer {
  constructor(map) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'particle-canvas';
    document.getElementById('overlay-root').appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.grid = null;
    this.fr = { i0: 0, i1: 0, f: 0 };
    this.enabled = true;
    this.running = false;
    this.particles = [];
    this._raf = null;
    this._needsClear = false;
    this._resize();
    map.on('resize zoomend', () => { this._resize(); this._clear(); });
    map.on('zoom move', () => { this._needsClear = true; });
  }

  _resize() {
    const size = this.map.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = size.x; this.h = size.y;
    this.canvas.width = Math.round(size.x * dpr);
    this.canvas.height = Math.round(size.y * dpr);
    const target = Math.round(clampNum((size.x * size.y) / 420, 500, 4500));
    this._adjustCount(target);
  }

  _adjustCount(n) {
    const ps = this.particles;
    while (ps.length < n) ps.push(this._spawn({}));
    if (ps.length > n) ps.length = n;
  }

  _spawn(p = {}) {
    p.x = Math.random() * this.w;
    p.y = Math.random() * this.h;
    p.age = 0;
    p.ttl = 40 + Math.random() * 110;
    return p;
  }

  _clear() { this.ctx && this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }

  setGrid(grid) {
    this.grid = grid;
    this._clear();
  }

  setFrame(fr) { this.fr = fr; }

  setEnabled(on) {
    this.enabled = on;
    if (!on) { this.stop(); this._clear(); } else this.start();
  }

  start() {
    if (this.running || !this.enabled) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      if (document.hidden || !this.grid) return;
      if (this._needsClear) { this._clear(); this._needsClear = false; }
      this._step();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _step() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const view = getView(this.map);
    const grid = this.grid;
    const fr = this.fr;

    // 拖尾衰减:对 alpha 通道做乘法衰减
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = `rgba(0,0,0,${FADE_ALPHA})`;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const k = Math.min(BASE_K * Math.pow(2, view.z - 2), MAX_SPEED_PX / 12);
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';

    for (const p of this.particles) {
      p.age++;
      if (p.age > p.ttl || p.x < -20 || p.x > view.w + 20 || p.y < -20 || p.y > view.h + 20) {
        this._spawn(p);
      }
      const ll = view.containerToLatLng(p.x, p.y);
      const uv = grid.sampleUV(ll.lng, ll.lat, fr);
      if (!uv) { p.age = p.ttl + 1; continue; }
      const [u, v] = uv;
      let dx = u * k, dy = -v * k;
      const mag = Math.hypot(dx, dy);
      if (mag < 0.06) { p.age = p.ttl + 1; continue; } // 静风:重生
      if (mag > MAX_SPEED_PX) { dx *= MAX_SPEED_PX / mag; dy *= MAX_SPEED_PX / mag; }
      const spd = Math.hypot(u, v);
      const c = WIND.color(spd);
      // 略微提亮,保证深色底图上可见
      const r = Math.min(255, c[0] + 45), g = Math.min(255, c[1] + 45), b = Math.min(255, c[2] + 45);
      ctx.strokeStyle = `rgba(${r},${g},${b},0.9)`;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      p.x += dx; p.y += dy;
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }
}

function clampNum(v, a, b) { return Math.min(b, Math.max(a, v)); }
