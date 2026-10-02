/* 风场粒子动画层(nullschool 风格):拖尾轨迹 + 速度着色。
 * 海浪档(wave):u/v 用外推场延续到海岸线,并以 land-50m 光栅位图做门控,
 * 粒子游到岸线以内立即重生 —— 岸外全流动、岸内零粒子。 */
import { getView } from '../util.js';
import { WIND } from '../colormaps.js';
import { loadLand } from '../basemap.js?v=2';
import { LAKE_BOXES } from '../lakemasks.js';

const MAX_SPEED_PX = 5.5;   // 单帧位移上限(px),防止视觉过快
const BASE_K = 0.055;        // z=2 时的 px/(m/s·帧) 系数

/* 粒子动效档位:default=风场;wave=海浪(短拖尾、低密度,柔缓的涌浪流动) */
const PROFILES = {
  default: { fade: 0.945, lineWidth: 1.4, ttlMin: 40, ttlVar: 110, density: 1 },
  wave: { fade: 0.928, lineWidth: 1.3, ttlMin: 32, ttlVar: 70, density: 0.6 },  // 短拖尾、低密度
};

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
    this.profile = PROFILES.default;
    this._raf = null;
    this._needsClear = false;
    this.landRings = null;
    this.landBits = null;      // 缩小版陆地位图 alpha 通道(1/4 分辨率)
    this.landW = 0; this.landH = 0;
    this._landRaf = 0;
    this._resize();
    map.on('resize zoomend', () => { this._resize(); this._clear(); this._scheduleLand(); });
    map.on('zoom move', () => { this._needsClear = true; this._scheduleLand(); });
    loadLand().then((d) => { this.landRings = d.rings; this._scheduleLand(); })
      .catch((e) => console.error('[particles] 陆地位图数据失败:', e.message));
  }

  /* 陆地位图:把 land-50m 多边形按当前视图光栅化到 1/4 分辨率画布,粒子 O(1) 查询 */
  _scheduleLand() {
    if (this._landRaf) return;
    this._landRaf = requestAnimationFrame(() => { this._landRaf = 0; this._buildLandBits(); });
  }

  _buildLandBits() {
    if (!this.landRings) return;
    const SC = 4;
    const W = Math.max(1, Math.round(this.w / SC)), H = Math.max(1, Math.round(this.h / SC));
    const cv = this._landCv || (this._landCv = document.createElement('canvas'));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const view = getView(this.map);
    ctx.setTransform(1 / SC, 0, 0, 1 / SC, 0, 0);
    ctx.fillStyle = '#fff';
    const c0 = view.containerToLatLng(0, 0), c1 = view.containerToLatLng(view.w, view.h);
    const c2 = view.containerToLatLng(view.w, 0), c3 = view.containerToLatLng(0, view.h);
    let minLon = Math.min(c0.lng, c1.lng, c2.lng, c3.lng);
    let maxLon = Math.max(c0.lng, c1.lng, c2.lng, c3.lng);
    if (maxLon - minLon >= 359) { minLon = -180; maxLon = 180; }
    const minLat = Math.min(c0.lat, c1.lat, c2.lat, c3.lat);
    const maxLat = Math.max(c0.lat, c1.lat, c2.lat, c3.lat);
    for (const ring of this.landRings) {
      const [rLon0, rLat0, rLon1, rLat1] = ring.b;
      if (rLon1 < minLon - 1 || rLon0 > maxLon + 1 || rLat1 < minLat - 1 || rLat0 > maxLat + 1) continue;
      ctx.beginPath();
      const r = ring.r;
      for (let i = 0; i < r.length; i += 2) {
        const pt = view.latLngToContainer(r[i + 1], r[i]);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fill();
    }
    // 大湖按陆地处理:粒子不进入湖盆
    for (const b of LAKE_BOXES) {
      if (b.lon1 < minLon - 1 || b.lon0 > maxLon + 1 || b.lat1 < minLat - 1 || b.lat0 > maxLat + 1) continue;
      const p0 = view.latLngToContainer(b.lat1, b.lon0);
      const p1 = view.latLngToContainer(b.lat0, b.lon1);
      ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    }
    const img = ctx.getImageData(0, 0, W, H);
    this.landBits = img.data;
    this.landW = W; this.landH = H; this.landSC = SC;
  }

  /* 岸线门控:屏幕坐标是否落在陆地内 */
  _isLand(x, y) {
    if (!this.landBits) return false;
    const ix = (x / this.landSC) | 0, iy = (y / this.landSC) | 0;
    if (ix < 0 || iy < 0 || ix >= this.landW || iy >= this.landH) return false;
    return this.landBits[(iy * this.landW + ix) * 4 + 3] > 128;
  }

  /* 动效档位切换(海浪模式换长拖尾低密度) */
  setProfile(name) {
    const next = PROFILES[name] || PROFILES.default;
    if (next === this.profile) return;
    this.profile = next;
    this._resize(); // 按新密度重算粒子数
    this._clear();
    this._scheduleLand();
  }

  _resize() {
    const size = this.map.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = size.x; this.h = size.y;
    this.canvas.width = Math.round(size.x * dpr);
    this.canvas.height = Math.round(size.y * dpr);
    const target = Math.round(clampNum((size.x * size.y) / 420, 500, 4500) * this.profile.density);
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
    p.ttl = this.profile.ttlMin + Math.random() * this.profile.ttlVar;
    return p;
  }

  _clear() { this.ctx && this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }

  setGrid(grid) {
    this.grid = grid;
    this._clear();
  }

  setFrame(fr) { this.fr = fr; }

  /* 粒子着色:默认按 u/v 风速;海浪等图层可指定标量变量(如波高)。
   * 海浪模式(wvh 着色)自动切换 wave 动效档(短拖尾低密度)。 */
  setColorVar(varName, cmap) {
    this.colorVar = varName || null;
    this.colorCmap = cmap || null;
    this.setProfile(varName === 'wvh' ? 'wave' : 'default');
  }

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

    // 拖尾衰减:对 alpha 通道做乘法衰减(wave 档衰减更快 → 短拖尾)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = `rgba(0,0,0,${this.profile.fade})`;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const k = Math.min(BASE_K * Math.pow(2, view.z - 2), MAX_SPEED_PX / 12);
    ctx.lineWidth = this.profile.lineWidth;
    ctx.lineCap = 'round';

    for (const p of this.particles) {
      p.age++;
      if (p.age > p.ttl || p.x < -20 || p.x > view.w + 20 || p.y < -20 || p.y > view.h + 20) {
        this._spawn(p);
      }
      const ll = view.containerToLatLng(p.x, p.y);
      let uv = grid.sampleUV(ll.lng, ll.lat, fr);
      if (!uv && this.profile === PROFILES.wave) uv = grid.sampleUVExt(ll.lng, ll.lat, fr);
      if (!uv) { p.age = p.ttl + 1; continue; }
      if (this.profile === PROFILES.wave && this._isLand(p.x, p.y)) { p.age = p.ttl + 1; continue; }
      const [u, v] = uv;
      let dx = u * k, dy = -v * k;
      const mag = Math.hypot(dx, dy);
      if (mag < 0.06) { p.age = p.ttl + 1; continue; } // 静风:重生
      if (mag > MAX_SPEED_PX) { dx *= MAX_SPEED_PX / mag; dy *= MAX_SPEED_PX / mag; }
      const spd = this.colorVar ? grid.sample(this.colorVar, ll.lng, ll.lat, fr) : Math.hypot(u, v);
      const c = (this.colorCmap || WIND).color(spd);
      // 略微提亮,保证深色底图上可见
      const r = Math.min(255, c[0] + 45), g = Math.min(255, c[1] + 45), b = Math.min(255, c[2] + 45);
      const nx = p.x + dx, ny = p.y + dy;
      if (this.profile === PROFILES.wave && this._isLand(nx, ny)) { p.age = p.ttl + 1; continue; }
      ctx.strokeStyle = `rgba(${r},${g},${b},0.9)`;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      p.x = nx; p.y = ny;
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }
}

function clampNum(v, a, b) { return Math.min(b, Math.max(a, v)); }
