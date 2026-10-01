/* 工具:Web 墨卡托投影(与 Leaflet 一致)、格点数据访问器、通用 helpers */

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function b64ToF32(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/* ---------- Web 墨卡托 ---------- */

export function project(lat, lng, s) {
  const rad = (lat * Math.PI) / 180;
  const x = ((lng + 180) / 360) * s;
  const sin = Math.sin(clamp(rad, -Math.PI / 2 + 1e-9, Math.PI / 2 - 1e-9));
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s;
  return { x, y };
}

export function unproject(px, py, s) {
  const lng = (px / s) * 360 - 180;
  const n = Math.PI * (1 - (2 * py) / s);
  const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  return { lat, lng };
}

/* 缓存当前视图的投影参数,供逐像素/逐粒子换算使用 */
export function getView(map) {
  const z = map.getZoom();
  const s = 256 * Math.pow(2, z);
  const size = map.getSize();
  const c = map.getCenter();
  const cp = project(c.lat, c.lng, s);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return {
    z, s, w: size.x, h: size.y, dpr,
    cx: cp.x, cy: cp.y,
    latLngToContainer(lat, lng) {
      const p = project(lat, lng, s);
      return { x: p.x - this.cx + this.w / 2, y: p.y - this.cy + this.h / 2 };
    },
    containerToLatLng(x, y) {
      return unproject(this.cx + x - this.w / 2, this.cy + y - this.h / 2, s);
    },
  };
}

/* ---------- 格点数据 ----------
 * 服务端布局:vars[k] = Float32Array(nT × points),索引 t*P + j*cols + i
 * lats[0] 为北边界,lons[0] 为西边界,等步长
 */
export class Grid {
  constructor(d) {
    this.raw = d;
    this.cols = d.cols; this.rows = d.rows; this.step = d.step;
    this.wrapLon = !!d.wrapLon;
    this.lats = d.lats; this.lons = d.lons;
    this.lon0 = d.lons[0]; this.lat0 = d.lats[0];
    this.times = d.times.map((t) => Date.parse(t + ':00Z'));
    this.nT = this.times.length;
    this.P = d.cols * d.rows;
    this.vars = {};
    for (const k of Object.keys(d.vars)) this.vars[k] = b64ToF32(d.vars[k]);
  }

  /* 时间 → {i0, i1, f} 相邻两个整点帧与插值系数 */
  frameAt(ms) {
    const t = this.times;
    if (ms <= t[0]) return { i0: 0, i1: 0, f: 0 };
    if (ms >= t[this.nT - 1]) return { i0: this.nT - 1, i1: this.nT - 1, f: 0 };
    let lo = 0, hi = this.nT - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid] <= ms) lo = mid; else hi = mid; }
    return { i0: lo, i1: hi, f: (ms - t[lo]) / (t[hi] - t[lo]) };
  }

  _bilinear(varName, lon, lat, fr) {
    const arr = this.vars[varName];
    if (!arr) return NaN;
    let x = (lon - this.lon0) / this.step;
    let i0, i1;
    if (this.wrapLon) {
      x = ((x % this.cols) + this.cols) % this.cols;
      i0 = Math.floor(x) % this.cols;
      i1 = (i0 + 1) % this.cols;
    } else {
      x = clamp(x, 0, this.cols - 1e-4);
      i0 = Math.floor(x); i1 = Math.min(i0 + 1, this.cols - 1);
    }
    let y = clamp((this.lat0 - lat) / this.step, 0, this.rows - 1e-4);
    const j0 = Math.floor(y); const j1 = Math.min(j0 + 1, this.rows - 1);
    const tx = x - i0, ty = y - j0;
    const C = this.cols;
    const a0 = fr.i0 * this.P, a1 = fr.i1 * this.P;
    const r0 = j0 * C, r1 = j1 * C;
    const v00 = arr[a0 + r0 + i0], v10 = arr[a0 + r0 + i1];
    const v01 = arr[a0 + r1 + i0], v11 = arr[a0 + r1 + i1];
    const w00 = arr[a1 + r0 + i0], w10 = arr[a1 + r0 + i1];
    const w01 = arr[a1 + r1 + i0], w11 = arr[a1 + r1 + i1];
    if (Number.isNaN(v00 + v10 + v01 + v11)) return NaN;
    const top = lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
    if (fr.i0 === fr.i1) return top;
    if (Number.isNaN(w00 + w10 + w01 + w11)) return top;
    const bot = lerp(lerp(w00, w10, tx), lerp(w01, w11, tx), ty);
    return lerp(top, bot, fr.f);
  }

  sample(varName, lon, lat, fr) {
    if (varName === 'wind') {
      const u = this._bilinear('u', lon, lat, fr);
      const v = this._bilinear('v', lon, lat, fr);
      if (Number.isNaN(u) || Number.isNaN(v)) return NaN;
      return Math.hypot(u, v);
    }
    if (varName === 'feels') {
      const t = this._bilinear('temp', lon, lat, fr);
      const rh = this._bilinear('rh', lon, lat, fr);
      if (Number.isNaN(t) || Number.isNaN(rh)) return NaN;
      const u = this._bilinear('u', lon, lat, fr);
      const v = this._bilinear('v', lon, lat, fr);
      const ws = Number.isNaN(u) || Number.isNaN(v) ? 0 : Math.hypot(u, v);
      return apparentTemp(t, rh, ws);
    }
    if (varName === 'dew') {
      const t = this._bilinear('temp', lon, lat, fr);
      const rh = this._bilinear('rh', lon, lat, fr);
      if (Number.isNaN(t) || Number.isNaN(rh) || rh <= 0) return NaN;
      const e = (rh / 100) * 6.112 * Math.exp(17.67 * t / (t + 243.5));
      const td = (243.5 * Math.log(e / 6.112)) / (17.67 - Math.log(e / 6.112));
      return Number.isFinite(td) ? td : NaN;
    }
    if (varName === 'ptype') {
      // 降水相态:0 无 1 雨 2 冻雨 3 雪(由温度与降水强度推导)
      const t = this._bilinear('temp', lon, lat, fr);
      const pr = this._bilinear('precip', lon, lat, fr);
      if (Number.isNaN(t)) return NaN;
      const p = Number.isNaN(pr) ? 0 : pr;
      if (p < 0.1) return 0;
      if (t > 2) return 1;
      if (t > 0.5) return 2;
      return 3;
    }
    return this._bilinear(varName, lon, lat, fr);
  }

  sampleUV(lon, lat, fr) {
    const u = this._bilinear('u', lon, lat, fr);
    const v = this._bilinear('v', lon, lat, fr);
    if (Number.isNaN(u) || Number.isNaN(v)) return null;
    return [u, v];
  }

  /* 等压线用的原始网格值(取最近整点帧) */
  rawAt(varName, i, j, frame) {
    return this.vars[varName][frame * this.P + j * this.cols + i];
  }
}

/* ---------- 时间格式化(浏览器本地时区) ---------- */
const p2 = (n) => String(n).padStart(2, '0');

export function fmtTime(ms) {
  const d = new Date(ms);
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
export function fmtTimeShort(ms) {
  const d = new Date(ms);
  return `${p2(d.getHours())}:00`;
}
export function fmtDay(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
export function fmtHourLocal(ms) {
  const d = new Date(ms);
  return `${p2(d.getHours())}:00`;
}
export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export function weekday(ms) { return WEEKDAYS[new Date(ms).getDay()]; }

/* 体感温度(Steadman 简化式) */
function apparentTemp(tC, rh, ws) {
  const e = (rh / 100) * 6.105 * Math.exp(17.67 * tC / (tC + 243.5));
  return tC + 0.33 * e - 0.70 * ws - 4.00;
}
