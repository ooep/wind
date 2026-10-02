/* 等值线层:marching squares 提取等值线(默认海平面气压,可配置任意标量场与间距) */
import { getView } from '../util.js';

export class IsobarLayer {
  constructor(map) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'isobar-canvas';
    document.getElementById('overlay-root').appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.grid = null;
    this.varName = 'msl';
    this.interval = 4;
    this.majorEvery = 3;
    this.fr = { i0: 0, i1: 0, f: 0 };
    this.visible = false;
    map.on('move zoom resize viewreset', () => this.redraw());
  }

  setGrid(g) { this.grid = g; this.redraw(); }
  setFrame(fr) { this.fr = fr; this.redraw(); }
  /* 等值线源与间距:气压 4hPa/主线每 3 条;位势高度 60gpm/主线每 5 条 */
  setSource(varName, interval = 4, majorEvery = 3) {
    this.varName = varName || 'msl';
    this.interval = interval;
    this.majorEvery = majorEvery;
    if (this.visible) this.redraw();
  }
  show(on) {
    this.visible = on;
    this.canvas.style.display = on ? 'block' : 'none';
    if (on) this.redraw();
  }

  redraw() {
    const ctx = this.ctx;
    const view = getView(this.map);
    const dpr = view.dpr;
    const W = Math.round(view.w * dpr), H = Math.round(view.h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W; this.canvas.height = H;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!this.visible || !this.grid) return;

    const grid = this.grid;
    const frame = this.fr.i0; // 等值线取最近整点帧
    const interval = this.interval;
    const { cols, rows, step, lon0, lat0 } = grid;
    const src = grid.vars[this.varName];
    if (!src) return;

    // 求值域(稀疏采样)
    let mn = Infinity, mx = -Infinity;
    const strideT = Math.max(1, Math.floor((grid.nT * grid.P) / 5000));
    for (let k = 0; k < src.length; k += strideT) {
      const v = src[k];
      if (!Number.isNaN(v)) { if (v < mn) mn = v; if (v > mx) mx = v; }
    }
    if (!Number.isFinite(mn)) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const labels = [];
    let labelLevelCount = 0;

    const project = (gx, gy, out) => {
      let lon = lon0 + gx * step;
      while (lon > 180) lon -= 360;
      const lat = lat0 - gy * step;
      const p = view.latLngToContainer(lat, lon);
      out[0] = p.x; out[1] = p.y;
    };

    for (let level = Math.ceil(mn / interval) * interval; level <= mx; level += interval) {
      const isMajor = (Math.round(level / interval) % this.majorEvery) === 0;
      ctx.beginPath();
      const a = [0, 0], b = [0, 0];
      let any = false;

      for (let j = 0; j < rows - 1; j++) {
        const rowOff = j * cols, rowOff2 = (j + 1) * cols;
        const lat = lat0 - (j + 0.5) * step;
        if (lat < view.containerToLatLng(0, view.h).lat - step) continue; // 视口裁剪(粗略)
        for (let i = 0; i < cols - 1; i++) {
          const v00 = src[frame * grid.P + rowOff + i];
          const v10 = src[frame * grid.P + rowOff + i + 1];
          const v01 = src[frame * grid.P + rowOff2 + i];
          const v11 = src[frame * grid.P + rowOff2 + i + 1];
          if (Number.isNaN(v00) || Number.isNaN(v10) || Number.isNaN(v01) || Number.isNaN(v11)) continue;
          let bits = 0;
          if (v00 > level) bits |= 8;
          if (v10 > level) bits |= 4;
          if (v11 > level) bits |= 2;
          if (v01 > level) bits |= 1;
          if (bits === 0 || bits === 15) continue;

          const itop = () => i + (level - v00) / (v10 - v00);
          const ibot = () => i + (level - v01) / (v11 - v01);
          const jleft = () => j + (level - v00) / (v01 - v00);
          const jright = () => j + (level - v10) / (v11 - v10);

          const segs = SEGS[bits];
          for (const seg of segs) {
            for (let s = 0; s < 2; s++) {
              const ex = seg[s];
              let gxv, gyv;
              if (ex === 0) { gxv = itop(); gyv = j; }
              else if (ex === 2) { gxv = ibot(); gyv = j + 1; }
              else if (ex === 1) { gxv = i + 1; gyv = jright(); }
              else { gxv = i; gyv = jleft(); }
              project(gxv, gyv, s === 0 ? a : b);
            }
            if (Math.abs(a[0] - b[0]) > view.w * 0.6) continue; // 反子午线跳变
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            any = true;
            if (isMajor && labels.length < 80) {
              const mx2 = (a[0] + b[0]) / 2, my2 = (a[1] + b[1]) / 2;
              if (mx2 > 30 && mx2 < view.w - 30 && my2 > 20 && my2 < view.h - 20) {
                labels.push({ x: mx2, y: my2, v: level });
              }
            }
          }
        }
      }
      if (!any) continue;
      ctx.lineWidth = isMajor ? 1.5 : 0.8;
      ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.34)';
      ctx.stroke();

      // 标注数值
      if (isMajor) {
        labelLevelCount++;
        ctx.font = '10.5px -apple-system, "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const lb of labels) {
          if (lb.v !== level) continue;
          let near = false;
          for (const q of labels) {
            if (q !== lb && q.v === level && Math.hypot(q.x - lb.x, q.y - lb.y) < 70) { near = true; break; }
          }
          if (near) continue;
          const txt = String(lb.v);
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(8,12,18,0.85)';
          ctx.strokeText(txt, lb.x, lb.y);
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.fillText(txt, lb.x, lb.y);
        }
      }
    }
  }
}

/* marching squares 边连接表(边编码:0 top,1 right,2 bottom,3 left) */
const SEGS = {
  1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 5: [[3, 0], [2, 1]],
  6: [[0, 2]], 7: [[3, 0]], 8: [[3, 0]], 9: [[0, 2]], 10: [[3, 2], [0, 1]],
  11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]],
};
