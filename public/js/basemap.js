/* 矢量线划底图(Natural Earth 本地化):Canvas 渲染,位于 #overlay-root 最顶层。
 * 只有线条与文字:经纬网、湖泊、国界、海岸线、分级城市标注——空白处完全透明,
 * 因此叠在气象图层之上也不会遮挡任何填色/粒子/雷达。
 */
import { getView } from './util.js';
import { neNameField, onChange as onLangChange } from './i18n.js';

const FILES = {
  coast: 'ne_50m_coastline.geojson',
  borders: 'ne_50m_admin_0_boundary_lines_land.geojson',
  lakes: 'ne_50m_lakes.geojson',
  places: 'ne_50m_populated_places_simple.geojson',
};

let dataPromise = null;
function loadData() {
  console.log('[basemap] loadData v2 调用');
  if (!dataPromise) {
    dataPromise = Promise.all(Object.entries(FILES).map(async ([k, name]) => {
      // 相对模块路径解析:任意静态托管布局下都有效
      const url = new URL('../geo/' + name, import.meta.url).href;
      console.log('[basemap] fetch', url);
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return [k, await r.json()];
    })).then(Object.fromEntries);
  }
  return dataPromise;
}

/* 城市标注分级:按缩放级别显示对应人口以上的城市 */
const BANDS = [
  { minZoom: 0, pop: 3e6 },
  { minZoom: 4, pop: 1e6 },
  { minZoom: 5, pop: 4e5 },
  { minZoom: 7, pop: 0 },
];

const LINES = [
  { key: 'graticule', color: 'rgba(157, 180, 208, 0.10)', width: 0.7 },
  { key: 'lakes', color: 'rgba(168, 196, 222, 0.32)', width: 0.8 },
  { key: 'borders', color: 'rgba(230, 238, 248, 0.30)', width: 0.8 },
  { key: 'coast', color: 'rgba(232, 240, 250, 0.62)', width: 1.1 },
];

const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';

export class VectorBasemap {
  constructor(map) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'vecbase-canvas';
    document.getElementById('overlay-root').appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.data = null;
    this.lines = null;
    this.cities = null;
    this._raf = 0;

    map.on('move zoom resize viewreset', () => this.schedule());
    onLangChange(() => this.schedule()); // 语言切换 → 城市标注重绘
    this.schedule();
    loadData().then((data) => {
      this.data = data;
      this._preprocess();
      this.schedule();
    }).catch((e) => console.error('[basemap] 失败:', e.message));
  }

  /* 预处理:线要素拉平为折线数组 + 经纬度包围盒;城市按人口排序 */
  _preprocess() {
    this.lines = {};
    for (const key of ['coast', 'borders', 'lakes']) {
      const lines = [];
      for (const f of this.data[key].features) {
        const g = f.geometry;
        if (!g) continue;
        const parts = g.type === 'LineString' ? [g.coordinates]
          : g.type === 'MultiLineString' ? g.coordinates
          : g.type === 'Polygon' ? g.coordinates
          : g.type === 'MultiPolygon' ? g.coordinates.flatMap((p) => p) : [];
        for (const part of parts) {
          let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
          for (const [lon, lat] of part) {
            if (lon < minLon) minLon = lon;
            if (lon > maxLon) maxLon = lon;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
          lines.push({ part, minLon, maxLon, minLat, maxLat });
        }
      }
      this.lines[key] = lines;
    }
    const grat = [];
    for (let lat = -80; lat <= 80; lat += 10) grat.push({ part: [[-180, lat], [0, lat], [180, lat]], minLat: lat, maxLat: lat, minLon: -180, maxLon: 180 });
    for (let lon = -180; lon < 180; lon += 10) grat.push({ part: [[-85, lon], [0, lon], [85, lon]], minLat: -85, maxLat: 85, minLon: lon, maxLon: lon });
    this.lines.graticule = grat;

    this.cities = this.data.places.features
      .map((f) => {
        const p = f.properties;
        const [lon, lat] = f.geometry.coordinates;
        return {
          lon, lat, pop: p.pop_max || 0,
          cap: /capital/i.test(p.featurecla || '') || p.worldcity === 1,
          name: p.name,
          props: p, /* 多语言名称字段(name_zh/name_ja/…),redraw 时按语言取 */
        };
      })
      .sort((a, b) => b.pop - a.pop);
  }

  schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.redraw(); });
  }

  redraw() {
    if (!this.map) return;
    const view = getView(this.map);
    const dpr = view.dpr;
    const W = Math.round(view.w * dpr), H = Math.round(view.h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W; this.canvas.height = H;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!this.lines) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* 可视范围(经纬度),用于要素剔除 */
    const c0 = view.containerToLatLng(0, 0), c1 = view.containerToLatLng(view.w, view.h);
    const c2 = view.containerToLatLng(view.w, 0), c3 = view.containerToLatLng(0, view.h);
    let minLon = Math.min(c0.lng, c1.lng, c2.lng, c3.lng);
    let maxLon = Math.max(c0.lng, c1.lng, c2.lng, c3.lng);
    if (maxLon - minLon >= 359) { minLon = -180; maxLon = 180; }
    const minLatView = Math.min(c0.lat, c1.lat, c2.lat, c3.lat);
    const maxLatView = Math.max(c0.lat, c1.lat, c2.lat, c3.lat);

    for (const { key, color, width } of LINES) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      for (const line of this.lines[key]) {
        if (line.maxLon < minLon - 2 || line.minLon > maxLon + 2) continue;
        if (line.maxLat < minLatView - 2 || line.minLat > maxLatView + 2) continue;
        ctx.beginPath();
        let drawing = false;
        for (const [lon, lat] of line.part) {
          const pt = view.latLngToContainer(lat, lon);
          if (pt.x < -60 || pt.x > view.w + 60 || pt.y < -60 || pt.y > view.h + 60) {
            if (drawing) { ctx.stroke(); ctx.beginPath(); drawing = false; }
            continue;
          }
          if (drawing) ctx.lineTo(pt.x, pt.y);
          else { ctx.moveTo(pt.x, pt.y); drawing = true; }
        }
        if (drawing) ctx.stroke();
      }
    }

    /* 城市标注:分级 + 视口内 + 贪心避让;名称跟随界面语言(无本地化名回落英文名) */
    const nameField = neNameField();
    const z = this.map.getZoom();
    let band = BANDS[0];
    for (const b of BANDS) if (z >= b.minZoom) band = b;
    const placed = [];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    for (const c of this.cities) {
      if (c.pop < band.pop) break;
      const pt = view.latLngToContainer(c.lat, c.lon);
      if (pt.x < 24 || pt.x > view.w - 24 || pt.y < 76 || pt.y > view.h - 16) continue; // 顶部避开 UI 栏
      const label = (nameField && c.props[nameField]) || c.name;
      ctx.font = c.cap ? '600 11.5px ' + FONT : '400 10.5px ' + FONT;
      const w = ctx.measureText(label).width; /* CJK 与拉丁字母宽度差异交给真实测量 */
      const box = { x0: pt.x - w / 2, y0: pt.y - 13, x1: pt.x + w / 2, y1: pt.y };
      let hit = false;
      for (const b of placed) {
        if (box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) { hit = true; break; }
      }
      if (hit) continue;
      placed.push(box);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.strokeText(label, pt.x, pt.y);
      ctx.fillStyle = c.cap ? 'rgba(255, 255, 255, 0.96)' : 'rgba(233, 240, 250, 0.9)';
      ctx.fillText(label, pt.x, pt.y);
    }
  }
}

/* 陆地填充(深色底图):烘焙的 land-50m 多边形(0.83MB 本地文件,无外部瓦片依赖)。
 * canvas 位于 overlay-root z=0 —— 气象填色层之下、地图瓦片之上;卫星/地形模式下隐藏。 */
let landPromise = null;

/* 环路径(经度解缠绕 + 三份世界副本):楚科奇等陆地横跨 ±180°,原始经度直接绘制
 * 会产生横穿整幅地图的"跳变边",nonzero 填充在两条跳变边之间绕数归零,
 * 挖出一条横贯大陆的洞 —— 解缠绕后沿同一世界副本连续投影,并按 ±360° 补画副本。 */
export function traceRing(ctx, ring, view) {
  const r = ring.r;
  let lastRaw = null, off = 0;
  for (let copy = -360; copy <= 360; copy += 360) {
    lastRaw = null; off = copy;
    for (let i = 0; i < r.length; i += 2) {
      const raw = r[i];
      if (lastRaw !== null) {
        if (raw - lastRaw > 180) off -= 360;
        else if (raw - lastRaw < -180) off += 360;
      }
      lastRaw = raw;
      const pt = view.latLngToContainer(r[i + 1], raw + off);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
  }
}
export function loadLand() {
  if (!landPromise) {
    landPromise = fetch(new URL('../geo/land-50m.json', import.meta.url))
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); });
  }
  return landPromise;
}

export class LandFill {
  constructor(map) {
    this.map = map;
    this.visible = false;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'landfill-canvas';
    document.getElementById('overlay-root').appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.rings = null;
    this._raf = 0;
    map.on('move zoom resize viewreset', () => this.schedule());
    loadLand().then((d) => { this.rings = d.rings; this.schedule(); })
      .catch((e) => console.error('[landfill] 陆地数据失败:', e.message));
    this.schedule();
  }

  show(on) {
    this.visible = on;
    this.canvas.style.display = on ? 'block' : 'none';
    if (on) this.schedule();
  }

  schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.redraw(); });
  }

  redraw() {
    if (!this.map || !this.visible) return;
    const view = getView(this.map);
    const dpr = view.dpr;
    const W = Math.round(view.w * dpr), H = Math.round(view.h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W; this.canvas.height = H;
    }
    const ctx = this.ctx;
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

    ctx.fillStyle = '#132637';
    ctx.strokeStyle = 'rgba(130, 170, 210, 0.10)';
    ctx.lineWidth = 0.6;
    for (const ring of this.rings) {
      const [rLon0, rLat0, rLon1, rLat1] = ring.b;
      if (rLon1 < minLon - 1 || rLon0 > maxLon + 1 || rLat1 < minLat - 1 || rLat0 > maxLat + 1) continue;
      ctx.beginPath();
      traceRing(ctx, ring, view);
      ctx.fill();
      ctx.stroke();
    }
  }
}
