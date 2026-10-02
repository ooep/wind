/* 风向杆层:格点风场的业务式风向杆绘制(满杆 10kt / 半杆 5kt / 三角旗 50kt)。
 * 与等压线层同款画布管线;按屏幕均匀采样,u/v 为当前气压层格点。 */
import { getView } from '../util.js';

const KT = 1.94384; // m/s → kt

export class BarbLayer {
  constructor(map) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'barb-canvas';
    document.getElementById('overlay-root').appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.grid = null;
    this.fr = { i0: 0, i1: 0, f: 0 };
    this.visible = false;
    map.on('move zoom resize viewreset', () => this.redraw());
  }

  setGrid(g) { this.grid = g; this.redraw(); }
  setFrame(fr) { this.fr = fr; this.redraw(); }
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const grid = this.grid;
    const fr = { i0: this.fr.i0, i1: this.fr.i0, f: 0 }; // 与等压线一致取整点帧
    const SP = 58;                                        // 杆距(css px)
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.lineCap = 'round';

    for (let y = SP * 0.5; y < view.h; y += SP) {
      for (let x = SP * 0.5; x < view.w; x += SP) {
        const ll = view.containerToLatLng(x, y);
        const uv = grid.sampleUV(ll.lng, ll.lat, fr);
        if (!uv) continue;
        drawBarb(ctx, x, y, uv[0], uv[1]);
      }
    }
  }
}

/* 单支风向杆:杆指向风的来向(气象约定),标注画于杆尾端 */
function drawBarb(ctx, x, y, u, v) {
  const kt = Math.hypot(u, v) * KT;
  if (kt < 1) { // 静风:单圆圈
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  const from = Math.atan2(-u, -v); // 来向角:0=自北,顺时针
  const L = 17;
  const tipX = x + Math.sin(from) * L;
  const tipY = y - Math.cos(from) * L;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(x, y);
  ctx.stroke();

  // 分解出与杆正交的"羽侧"方向(北半球画在杆的顺时针侧)
  const bdir = from + Math.PI / 2;
  const bx = Math.sin(bdir), by = -Math.cos(bdir);
  let rem = Math.round(kt / 5) * 5; // 5kt 量化
  let t = 3.5;                      // 沿杆从尖端往回放置的距离
  const step5 = 4.6;
  while (rem >= 50) { // 50kt 三角旗
    const px = tipX + Math.sin(from) * t, py = tipY - Math.cos(from) * t;
    const ax = px + bx * 5.4, ay = py + by * 5.4;
    const qx = px + Math.sin(from) * 6.5, qy = py - Math.cos(from) * 6.5;
    ctx.beginPath();
    ctx.moveTo(px, py); ctx.lineTo(ax, ay); ctx.lineTo(qx, qy);
    ctx.closePath(); ctx.fill();
    t += step5 + 1.5;
    rem -= 50;
  }
  while (rem >= 10) { // 10kt 满杆
    const px = tipX + Math.sin(from) * t, py = tipY - Math.cos(from) * t;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + bx * 6, py + by * 6);
    ctx.stroke();
    t += step5;
    rem -= 10;
  }
  if (rem >= 5) { // 5kt 半杆
    const px = tipX + Math.sin(from) * t, py = tipY - Math.cos(from) * t;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + bx * 3.2, py + by * 3.2);
    ctx.stroke();
  }
}
