/* 闪电实时图层(Blitzortung 社区定位网络):
 * WebSocket 直连官方推送(连上后发 {"a":111},二进制内容为 LZW 压缩的 JSON 文本帧),
 * 最近 90 分钟落雷按年龄渐变着色绘制在 canvas 上。纯实时,不与时间轴联动。 */

const WS_HOSTS = ['ws1', 'ws3', 'ws7', 'ws8'];
const KEEP_MS = 90 * 60_000;      // 保留时长
const DRAW_MS = 120;              // 重绘间隔
const AGE_COLORS = [              // [年龄上限ms, r, g, b]
  [3 * 60_000, 255, 255, 255],
  [10 * 60_000, 255, 238, 120],
  [25 * 60_000, 255, 170, 60],
  [50 * 60_000, 255, 90, 60],
  [KEEP_MS, 190, 40, 40],
];

/* Blitzortung 专有 LZW(与官方 web 端一致):输入字符串 → 解压出 JSON 文本 */
function lzwDecode(input) {
  const d = [...input];
  let c = d[0], f = c;
  const out = [c];
  const dict = {};
  let size = 256, next = size;
  for (let i = 1; i < d.length; i++) {
    const code = d[i].charCodeAt(0);
    let entry;
    if (size > code) entry = d[i];
    else entry = dict[code] !== undefined ? dict[code] : (f + c);
    out.push(entry);
    c = entry[0];
    dict[next] = f + c; next++; f = entry;
  }
  return out.join('');
}

export class LightningLayer {
  constructor(map) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'lightning-canvas';
    document.getElementById('overlay-root').appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.visible = false;
    this.strikes = [];           // {t, lat, lon, pol}
    this.ws = null;
    this.hostIdx = 0;
    this._drawTimer = null;
    this._retryTimer = null;
    this._closedByUs = false;
    this._resize();
    map.on('resize zoomend', () => this._resize());
    map.on('move zoom', () => { if (this.visible) this._draw(); });
  }

  _resize() {
    const size = this.map.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = size.x; this.h = size.y;
    this.canvas.width = Math.round(size.x * dpr);
    this.canvas.height = Math.round(size.y * dpr);
    this._draw();
  }

  show(on) {
    this.visible = on;
    if (on) {
      this._drawTimer = setInterval(() => this._tick(), DRAW_MS);
      this._connect();
    } else {
      clearInterval(this._drawTimer);
      clearTimeout(this._retryTimer);
      this._closedByUs = true;
      if (this.ws) { try { this.ws.close(); } catch { /* 已断开 */ } this.ws = null; }
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  _connect() {
    if (!this.visible || this.ws) return;
    this._closedByUs = false;
    const host = WS_HOSTS[this.hostIdx % WS_HOSTS.length];
    this.hostIdx++;
    let ws;
    try {
      ws = new WebSocket(`wss://${host}.blitzortung.org/`);
    } catch {
      this._retry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => { ws.send('{"a":111}'); };
    ws.onmessage = (e) => {
      try {
        const j = JSON.parse(lzwDecode(e.data));
        if (typeof j.lat === 'number' && typeof j.lon === 'number' && j.time) {
          this.strikes.push({ t: Math.round(j.time / 1e6), lat: j.lat, lon: j.lon, pol: j.pol });
          if (this.strikes.length > 12000) this.strikes.splice(0, 4000);
        }
      } catch { /* 单帧坏数据忽略 */ }
    };
    ws.onclose = () => {
      this.ws = null;
      if (!this._closedByUs && this.visible) this._retry();
    };
    ws.onerror = () => { try { ws.close(); } catch { /* 无连接 */ } };
  }

  _retry() {
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => this._connect(), 5000 + 3000 * (this.hostIdx % 4));
  }

  _tick() {
    const now = Date.now();
    if (this.strikes.length && this.strikes[0].t < now - KEEP_MS) {
      let i = 0;
      while (i < this.strikes.length && this.strikes[i].t < now - KEEP_MS) i++;
      if (i > 0) this.strikes.splice(0, i);
    }
    this._draw();
  }

  _draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.visible || !this.strikes.length) return;
    const z = this.map.getZoom();
    // 与 util.getView 相同的投影换算(避免循环依赖直接内联)
    const s = 256 * Math.pow(2, this.map.getZoom());
    const center = this.map.getCenter();
    const prj = (lat, lng) => {
      const x = ((lng + 180) / 360) * s;
      const sin = Math.sin(Math.max(-Math.PI / 2 + 1e-9, Math.min(Math.PI / 2 - 1e-9, lat * Math.PI / 180)));
      const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s;
      return { x, y };
    };
    const cp = prj(center.lat, center.lng);
    const toXY = (lat, lng) => {
      const p = prj(lat, ((lng + 540) % 360) - 180);
      return { x: p.x - cp.x + this.w / 2, y: p.y - cp.y + this.h / 2 };
    };
    const now = Date.now();
    ctx.globalCompositeOperation = 'lighter';
    for (const st of this.strikes) {
      const age = now - st.t;
      if (age < 0 || age > KEEP_MS) continue;
      const p = toXY(st.lat, st.lon);
      if (p.x < -8 || p.y < -8 || p.x > this.w + 8 || p.y > this.h + 8) continue;
      let col = AGE_COLORS[AGE_COLORS.length - 1];
      for (const c of AGE_COLORS) { if (age <= c[0]) { col = c; break; } }
      const fade = age > KEEP_MS * 0.7 ? Math.max(0.25, 1 - (age - KEEP_MS * 0.7) / (KEEP_MS * 0.3)) : 1;
      const r = (z >= 6 ? 3.4 : 2.6) * (st.pol > 0 ? 1.35 : 1);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, 6.2832);
      ctx.fillStyle = `rgba(${col[1]},${col[2]},${col[3]},${0.9 * fade})`;
      ctx.fill();
      if (age < 3 * 60_000) { // 新雷:光晕
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 2.6, 0, 6.2832);
        ctx.fillStyle = `rgba(255,255,180,${0.22 * fade})`;
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
