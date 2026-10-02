/* 测距/测面积工具(Windy 式量算):
 * 点击地图加点 → 逐段与总距离(km + 海里)→ 「完成」闭合多边形显示面积;
 * 每个顶点异步查海拔(Open-Meteo Elevation)。不干扰图层面板(主控在 measure.active 时不弹面板)。
 */
import { fetchElevations } from './pointdata.js';

const R_EARTH = 6371;
const rad = Math.PI / 180;

function haversineKm(a, b) {
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

/* 球面多边形面积(km²) */
function ringAreaKm2(pts) {
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
    total += (p2.lng - p1.lng) * rad * (2 + Math.sin(p1.lat * rad) + Math.sin(p2.lat * rad));
  }
  return Math.abs(total) * R_EARTH * R_EARTH / 2;
}

const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : km < 100 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`);

export class MeasureTool {
  constructor(map, { toast } = {}) {
    this.map = map;
    this.toast = toast || (() => {});
    this.active = false;
    this.finished = false;
    this.points = []; // {lat, lng, elev?}
    this.group = L.layerGroup().addTo(map);
    this.bar = document.getElementById('measure-bar');
    this.info = document.getElementById('measure-info');
    this._elevTimer = 0;

    map.on('click', (e) => {
      if (!this.active || this.finished) return;
      L.DomEvent.stop(e);
      this.points.push({ lat: e.latlng.lat, lng: e.latlng.wrap().lng });
      this._redraw();
      this._fetchElev();
    });
    map.on('dblclick', () => { if (this.active && !this.finished) this.finish(); });

    document.getElementById('measure-done').addEventListener('click', () => this.finish());
    document.getElementById('measure-clear').addEventListener('click', () => { this.finished = false; this.points = []; this._redraw(); });
    document.getElementById('measure-exit').addEventListener('click', () => this.stop());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.active) this.stop();
    });
  }

  toggle() { this.active ? this.stop() : this.start(); }

  start() {
    this.active = true;
    this.finished = false;
    this.points = [];
    document.getElementById('measure-btn').classList.add('active');
    document.getElementById('map').classList.add('measuring');
    this.bar.hidden = false;
    this.info.textContent = '点击地图加点 · 双击或「完成」闭合量面积 · Esc 退出';
    this.group.clearLayers();
    this.toast('测量模式已开启:点击地图开始量算');
  }

  stop() {
    this.active = false;
    this.finished = false;
    this.points = [];
    document.getElementById('measure-btn').classList.remove('active');
    document.getElementById('map').classList.remove('measuring');
    this.bar.hidden = true;
    this.group.clearLayers();
  }

  finish() {
    if (this.points.length < 2) { this.toast('至少需要 2 个点'); return; }
    this.finished = true;
    this._redraw();
  }

  _totalKm() {
    let t = 0;
    for (let i = 1; i < this.points.length; i++) t += haversineKm(this.points[i - 1], this.points[i]);
    if (this.finished && this.points.length >= 3) t += haversineKm(this.points[this.points.length - 1], this.points[0]);
    return t;
  }

  _redraw() {
    const g = this.group;
    g.clearLayers();
    const pts = this.points.map((p) => [p.lat, p.lng]);
    const closed = this.finished && pts.length >= 3;
    if (closed) {
      g.addLayer(L.polygon(pts, { color: '#45c4ff', weight: 2, dashArray: '6 4', fillColor: '#45c4ff', fillOpacity: 0.12, interactive: false }));
    } else if (pts.length >= 2) {
      g.addLayer(L.polyline(pts, { color: '#45c4ff', weight: 2, dashArray: '6 4', interactive: false }));
    }
    pts.forEach((ll, i) => {
      const p = this.points[i];
      const tag = p.elev != null ? `<br><i>${Math.round(p.elev)} m</i>` : '';
      g.addLayer(L.circleMarker(ll, {
        radius: 4, color: '#fff', weight: 1.5, fillColor: '#45c4ff', fillOpacity: 1, interactive: false,
      }).bindTooltip(`<b>P${i + 1}</b>${tag}`, { permanent: true, direction: 'top', offset: [0, -7], className: 'measure-tip' }));
    });
    if (pts.length >= 2) {
      const total = this._totalKm();
      const seg = haversineKm(this.points[this.points.length - 2], this.points[this.points.length - 1]);
      let txt = `本段 ${fmtKm(seg)} · 总计 ${fmtKm(total)} / ${(total / 1.852).toFixed(1)} nm`;
      if (closed) {
        const a = ringAreaKm2(this.points);
        txt = `周长 ${fmtKm(total)} / ${(total / 1.852).toFixed(1)} nm · 面积 ${a < 1 ? `${Math.round(a * 1e6)} m²` : a < 1e4 ? `${a.toFixed(1)} km²` : `${Math.round(a).toLocaleString()} km²`}`;
      }
      g.addLayer(L.tooltip({ permanent: true, direction: 'top', offset: [0, -16], className: 'measure-total', interactive: false })
        .setLatLng(pts[pts.length - 1]).setContent(txt));
      this.info.textContent = txt + (this.finished ? '' : ' · 继续点击加点');
    } else {
      this.info.textContent = '点击地图加点 · 双击或「完成」闭合量面积 · Esc 退出';
    }
  }

  _fetchElev() {
    clearTimeout(this._elevTimer);
    this._elevTimer = setTimeout(async () => {
      try {
        const lats = this.points.map((p) => p.lat.toFixed(4));
        const lons = this.points.map((p) => p.lng.toFixed(4));
        const arr = await fetchElevations(lats, lons);
        arr.forEach((v, i) => { if (this.points[i] && Number.isFinite(v)) this.points[i].elev = v; });
        if (this.active) this._redraw();
      } catch { /* 海拔失败不影响量算 */ }
    }, 400);
  }
}
