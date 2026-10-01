/* 标量填色层:把格点数据按色标渲染为平滑填色(块采样 + 双线性放大) */
import { getView } from '../util.js';

const BLOCK = 3; // 屏幕采样块大小(css px)

export class ScalarLayer {
  constructor(map) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'scalar-canvas';
    document.getElementById('overlay-root').appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.off = document.createElement('canvas');
    this.offCtx = this.off.getContext('2d');
    this.grid = null;
    this.varName = 'temp';
    this.cmap = null;
    this.fr = { i0: 0, i1: 0, f: 0 };
    this.visible = false;
    this.opacity = 1;

    map.on('move zoom resize viewreset', () => this.redraw());
  }

  setGrid(grid) { this.grid = grid; this.redraw(); }
  setVar(name, cmap) {
    this.varName = name; this.cmap = cmap;
    this.canvas.style.opacity = 1; this.redraw();
  }
  setFrame(fr) { this.fr = fr; this.redraw(); }
  show(on) {
    this.visible = on;
    this.canvas.style.display = on ? 'block' : 'none';
    if (on) this.redraw();
  }
  setOpacity(v) { this.opacity = v; this.canvas.style.opacity = v; }

  redraw() {
    if (!this.visible || !this.grid || !this.cmap) return;
    const view = getView(this.map);
    const dpr = view.dpr;
    const W = Math.round(view.w * dpr), H = Math.round(view.h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W; this.canvas.height = H;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const bw = Math.ceil(view.w / BLOCK), bh = Math.ceil(view.h / BLOCK);
    if (this.off.width !== bw || this.off.height !== bh) {
      this.off.width = bw; this.off.height = bh;
    }
    const img = this.offCtx.createImageData(bw, bh);
    const px = img.data;
    const grid = this.grid, varName = this.varName, fr = this.fr, cmap = this.cmap;

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
        const v = grid.sample(varName, lons[c], lat, fr);
        if (Number.isNaN(v)) continue;
        const col = cmap.color(v);
        px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = col[3];
      }
    }
    this.offCtx.putImageData(img, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.off, 0, 0, bw, bh, 0, 0, W, H);
  }
}
