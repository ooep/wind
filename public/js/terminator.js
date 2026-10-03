/* 昼夜晨昏线遮罩(自绘 canvas,#overlay-root,纯前端天文计算,无数据源):
 * 按当前时刻算太阳直射点(赤纬 + 太阳时角),对每个经度求晨昏线纬度,
 * 构造夜半球多边形(含极夜极昼近似)填充半透明深色。每 60s 自刷新。
 * z-index 低于预警/地震画布:夜幕压在天气场上,信息叠加层保持在最上。 */

import { CanvasOverlay } from './layers/canvasoverlay.js';

const FILL = '#0b1026';
const FILL_OPACITY = 0.38;
const STEP_DEG = 1.5;          // 晨昏线经度采样步长
const REFRESH_MS = 60e3;

/* 太阳赤纬(弧度)- 近似式,误差 <0.2°,足够晨昏线视觉用途 */
function sunDeclination(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = (date.getTime() - start) / 86400e3;
  const rad = Math.PI / 180;
  return -23.44 * rad * Math.cos(rad * (360 / 365.24) * (doy + 10));
}

function nightCurve(date) {
  const decl = sunDeclination(date);
  const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const subsolarLon = -15 * (utcH - 12);      // 直射点经度(忽略均时差,<4° 视觉可接受)
  const rad = Math.PI / 180;
  const curve = [];
  for (let lon = -180; lon <= 180 + 1e-9; lon += STEP_DEG) {
    const H = (lon - subsolarLon) * rad;
    /* tan(lat) = -cos(H)/tan(decl) — 晨昏线在该经度上的纬度 */
    let lat = Math.atan(-Math.cos(H) / Math.tan(decl)) / rad;
    if (!Number.isFinite(lat)) lat = decl > 0 ? -90 : 90;   // 赤纬≈0 时晨昏线过极点
    curve.push([lat, lon]);
  }
  return { curve, pole: decl > 0 ? -90 : 90 };  // 夜侧极点:直射点在北半球则夜在南极
}

export class Terminator extends CanvasOverlay {
  constructor(map) {
    super(map, 'terminator-canvas');
    this.timer = null;
  }

  show(on) {
    super.show(on);
    clearInterval(this.timer);
    if (on) {
      this.requestRedraw();
      this.timer = setInterval(() => this.requestRedraw(), REFRESH_MS);
    }
  }

  draw(ctx) {
    const { curve, pole } = nightCurve(new Date());
    const path = new Path2D();
    let started = false, prev = null;
    for (const [lat, lon] of curve) {
      const p = this._toXY(lat, lon);
      if (prev && Math.abs(p.x - prev.x) > this.w / 2) started = false; // 视口跨反子午线断笔
      if (!started) { path.moveTo(p.x, p.y); started = true; }
      else path.lineTo(p.x, p.y);
      prev = p;
    }
    /* 闭合到夜侧极点(屏幕外也没关系,填充按路径闭合计算) */
    const e1 = this._toXY(pole, 180), e2 = this._toXY(pole, -180);
    path.lineTo(e1.x, e1.y);
    path.lineTo(e2.x, e2.y);
    path.closePath();
    ctx.fillStyle = FILL;
    ctx.globalAlpha = FILL_OPACITY;
    ctx.fill(path);
    ctx.globalAlpha = 1;
    /* 晨昏线本体一条微光细线 */
    ctx.strokeStyle = 'rgba(255,214,140,.35)';
    ctx.lineWidth = 1;
    ctx.stroke(path);
  }
}
