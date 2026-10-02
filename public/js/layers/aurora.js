/* 极光概率图层:NOAA SWPC OVATION Prime(未来 30-90 分钟极光概率,1° 网格,0-100)。
 * 客户端直取 SWPC JSON(服务端 CORS 全开),概率场渲染到等距圆柱离屏画布,
 * 再按纬度带做墨卡托投影 + 经度环绕切片贴到屏幕。纯预报场,不与时间轴联动。 */

const SRC = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
const NW = 360, NH = 181;          // lon 0..359 / lat +90..-90(行序与 SWPC 坐标序无关,重建网格)
const REFRESH_MS = 10 * 60_000;    // SWPC 每 30 分钟更新,10 分钟重取

/* OVATION 概率 → 极光色(低透明绿 → 亮绿 → 黄 → 橙 → 品红) */
const RAMP = [
  [0, 0, 0, 0, 0], [3, 60, 190, 110, 40], [8, 40, 220, 130, 120],
  [15, 90, 245, 150, 175], [25, 190, 250, 120, 195], [45, 250, 210, 70, 212],
  [70, 250, 110, 60, 224], [100, 220, 40, 120, 234],
];

function rampColor(p) {
  if (p <= RAMP[0][0]) return RAMP[0].slice(1);
  const last = RAMP[RAMP.length - 1];
  if (p >= last[0]) return last.slice(1);
  for (let i = 0; i < RAMP.length - 1; i++) {
    const a = RAMP[i], b = RAMP[i + 1];
    if (p <= b[0]) {
      const t = (p - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, a[4] + (b[4] - a[4]) * t];
    }
  }
  return last.slice(1);
}

export class AuroraLayer {
  constructor(map) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'aurora-canvas';
    this.canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    document.getElementById('overlay-root').appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.off = document.createElement('canvas');
    this.off.width = NW; this.off.height = NH;
    this.visible = false;
    this.grid = null;            // NW*NH 概率(-1 = 缺测)
    this.time = null;
    this.timer = null;
    this.fetching = false;
    this.onMove = () => { if (this.visible) this.draw(); };
  }

  async load(force) {
    if ((this.grid && !force) || this.fetching) return;
    this.fetching = true;
    try {
      const r = await fetch(SRC);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const grid = new Float32Array(NW * NH).fill(-1);
      for (const it of d.coordinates || []) {
        const lon = ((it[0] % 360) + 360) % 360, lat = it[1], p = it[2];
        const i = lon | 0, j = (90 - lat) | 0;
        if (i >= 0 && i < NW && j >= 0 && j < NH) grid[j * NW + i] = p;
      }
      this.grid = grid;
      this.time = d['Forecast Time'] || d['Observation Time'] || null;
      this.renderOff();
      this.draw();
    } catch (e) {
      console.error('极光数据加载失败:', e);
    } finally {
      this.fetching = false;
    }
  }

  renderOff() {
    const ctx = this.off.getContext('2d');
    const img = ctx.createImageData(NW, NH);
    for (let i = 0; i < this.grid.length; i++) {
      const c = this.grid[i] < 0 ? [0, 0, 0, 0] : rampColor(this.grid[i]);
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = c[3];
    }
    ctx.putImageData(img, 0, 0);
  }

  draw() {
    const map = this.map, size = map.getSize();
    if (this.canvas.width !== size.x || this.canvas.height !== size.y) {
      this.canvas.width = size.x; this.canvas.height = size.y;
      this.canvas.style.width = size.x + 'px'; this.canvas.style.height = size.y + 'px';
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, size.x, size.y);
    if (!this.grid || !size.x) return;
    const bounds = map.getBounds();
    const west = bounds.getWest(), lonSpan = bounds.getEast() - west;
    const pxPerDeg = map.latLngToContainerPoint([0, bounds.getEast()]).x
      - map.latLngToContainerPoint([0, west]).x;
    if (!(pxPerDeg > 0) || !Number.isFinite(pxPerDeg)) return;
    const lat0 = Math.max(-90, Math.floor(bounds.getSouth()));
    const lat1 = Math.min(89, Math.ceil(bounds.getNorth()));
    ctx.imageSmoothingEnabled = true;
    for (let lat = lat0; lat <= lat1; lat++) {
      const j = 90 - lat;                       // 该 1° 纬度带在离屏画布中的行(带中心 lat → 行 90-lat)
      if (j < 0 || j >= NH) continue;
      const yTop = map.latLngToContainerPoint([lat + 0.5, 0]).y;
      const yBot = map.latLngToContainerPoint([lat - 0.5, 0]).y;
      if (yBot - yTop < 0.5) continue;
      /* 经度环绕:视口可能跨 180° 或放大到 >360°,按 ≤360° 逐段贴 */
      let l0 = ((west % 360) + 360) % 360, x = map.latLngToContainerPoint([0, west]).x, rem = lonSpan;
      let guard = 0;
      while (rem > 1e-6 && guard++ < 8) {
        const deg = Math.min(rem, 360 - l0);
        ctx.drawImage(this.off, l0, j, deg, 1, x, yTop, deg * pxPerDeg, yBot - yTop);
        x += deg * pxPerDeg; rem -= deg; l0 = 0;
      }
    }
  }

  show(on) {
    this.visible = on;
    this.canvas.style.display = on ? '' : 'none';
    if (on) {
      this.load();
      this.timer = setInterval(() => this.load(true), REFRESH_MS);
      this.map.on('moveend zoomend resize', this.onMove);
      this.onMove();
    } else {
      clearInterval(this.timer);
      this.map.off('moveend zoomend resize', this.onMove);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}
