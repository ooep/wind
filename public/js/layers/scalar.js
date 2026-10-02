/* 标量填色层:把格点数据按色标渲染为平滑填色(块采样 + 双线性放大)。
 * 海洋图层(maskLand)模式:NaN 格点用最近海值外推把填色延续到海岸线,
 * 再以独立画布把 land-50m 陆地多边形盖在填色之上 —— 陆地干净遮除、
 * 海洋色块紧贴大陆线,消除粗网格海岸处的锯齿空穴(对齐 Windy 的做法)。 */
import { getView } from '../util.js';
import { loadLand, traceRing } from '../basemap.js?v=2';
import { LAKE_BOXES } from '../lakemasks.js';

const BLOCK = 3; // 屏幕采样块大小(css px)

/* 各底图下陆地遮罩的颜色:与底图自身的陆地观感一致,遮罩才"隐形" */
const MASK_COLORS = {
  vector: '#06080c',
  dark: '#132637',
  satellite: '#06080c',
  terrain: '#06080c',
};

export class ScalarLayer {
  constructor(map) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'scalar-canvas';
    document.getElementById('overlay-root').appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.off = document.createElement('canvas');
    this.offCtx = this.off.getContext('2d');
    /* 陆地遮罩画布:z 序在 scalar 之上(DOM 顺序)、粒子/等压线之下;不受图层不透明度影响 */
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.id = 'oceanmask-canvas';
    this.maskCanvas.style.display = 'none';
    document.getElementById('overlay-root').appendChild(this.maskCanvas);
    this.maskCtx = this.maskCanvas.getContext('2d');
    this.rings = null;
    this.grid = null;
    this.varName = 'temp';
    this.cmap = null;
    this.fr = { i0: 0, i1: 0, f: 0 };
    this.visible = false;
    this.opacity = 1;
    this.maskLand = false;
    this.maskColor = MASK_COLORS.vector;

    map.on('move zoom resize viewreset', () => this.redraw());
    map.on('basemapchange', (e) => { this.maskColor = MASK_COLORS[e.kind] || MASK_COLORS.vector; if (this.maskLand) this.redraw(); });
  }

  setGrid(grid) { this.grid = grid; this.redraw(); }
  setVar(name, cmap) {
    this.varName = name; this.cmap = cmap;
    this.redraw();
  }
  /* 海洋图层开关:切换外推采样与陆地遮罩 */
  setMaskLand(on) {
    on = !!on;
    if (this.maskLand === on) { if (on) this.redraw(); return; }
    this.maskLand = on;
    this.maskCanvas.style.display = on && this.visible ? 'block' : 'none';
    if (on && !this.rings) {
      loadLand().then((d) => { this.rings = d.rings; this.redraw(); })
        .catch((e) => console.error('[scalar] 陆地遮罩数据失败:', e.message));
    }
    this.redraw();
  }
  setFrame(fr) { this.fr = fr; this.redraw(); }
  show(on) {
    this.visible = on;
    this.canvas.style.opacity = on ? this.opacity : 0;
    this.maskCanvas.style.display = on && this.maskLand ? 'block' : 'none';
    if (on) this.redraw();
  }
  setOpacity(v) {
    this.opacity = v;
    if (this.visible) this.canvas.style.opacity = v;
  }

  redraw() {
    if (!this.visible || !this.grid || !this.cmap) return;
    const view = getView(this.map);
    const dpr = view.dpr;
    const W = Math.round(view.w * dpr), H = Math.round(view.h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W; this.canvas.height = H;
    }
    if (this.maskCanvas.width !== W || this.maskCanvas.height !== H) {
      this.maskCanvas.width = W; this.maskCanvas.height = H;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const bw = Math.ceil(view.w / BLOCK), bh = Math.ceil(view.h / BLOCK);
    if (bw <= 0 || bh <= 0) return; // 容器尚未完成布局(0 尺寸)时跳过本帧
    if (this.off.width !== bw || this.off.height !== bh) {
      this.off.width = bw; this.off.height = bh;
    }
    const img = this.offCtx.createImageData(bw, bh);
    const px = img.data;
    const grid = this.grid, varName = this.varName, fr = this.fr, cmap = this.cmap;
    const ext = this.maskLand;

    // 预计算每个块中心对应的经纬度
    const lats = new Float64Array(bh);
    for (let r = 0; r < bh; r++) {
      const y = (r + 0.5) * BLOCK;
      lats[r] = view.containerToLatLng(0, y).lat;
    }
    const lons = new Float64Array(bw);
    for (let c = 0; c < bw; c++) {
      const x = (c + 0.5) * BLOCK;
      lons[c] = view.containerToLatLng(x, 0).lng;
    }

    let o = 0;
    for (let r = 0; r < bh; r++) {
      const lat = lats[r];
      for (let c = 0; c < bw; c++, o += 4) {
        const v = ext ? grid.sampleExt(varName, lons[c], lat, fr) : grid.sample(varName, lons[c], lat, fr);
        if (Number.isNaN(v)) continue;
        const col = cmap.color(v);
        px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = col[3];
      }
    }
    this.offCtx.putImageData(img, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.off, 0, 0, bw, bh, 0, 0, W, H);

    if (ext) this.drawLandMask(view, dpr, W, H);
  }

  /* 陆地遮罩:land-50m 多边形按当前视图填充(带 bbox 剔除) */
  drawLandMask(view, dpr, W, H) {
    const ctx = this.maskCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!this.rings) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const c0 = view.containerToLatLng(0, 0), c1 = view.containerToLatLng(view.w, view.h);
    const c2 = view.containerToLatLng(view.w, 0), c3 = view.containerToLatLng(0, view.h);
    let minLon = Math.min(c0.lng, c1.lng, c2.lng, c3.lng);
    let maxLon = Math.max(c0.lng, c1.lng, c2.lng, c3.lng);
    if (maxLon - minLon >= 359) { minLon = -180; maxLon = 180; }
    const minLat = Math.min(c0.lat, c1.lat, c2.lat, c3.lat);
    const maxLat = Math.max(c0.lat, c1.lat, c2.lat, c3.lat);

    ctx.fillStyle = this.maskColor;
    for (const ring of this.rings) {
      const [rLon0, rLat0, rLon1, rLat1] = ring.b;
      if (rLon1 < minLon - 1 || rLon0 > maxLon + 1 || rLat1 < minLat - 1 || rLat0 > maxLat + 1) continue;
      ctx.beginPath();
      traceRing(ctx, ring, view);
      ctx.fill();
    }
    // 大湖(里海等):陆地多边形的洞,遮罩盖不到,显式按陆地填掉
    for (const b of LAKE_BOXES) {
      if (b.lon1 < minLon - 1 || b.lon0 > maxLon + 1 || b.lat1 < minLat - 1 || b.lat0 > maxLat + 1) continue;
      const p0 = view.latLngToContainer(b.lat1, b.lon0);
      const p1 = view.latLngToContainer(b.lat0, b.lon1);
      ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    }
  }
}
