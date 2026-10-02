/* 雷达图层(RainViewer):过去 2h + 未来 30min 外推,与时间轴联动 */
import { fetchRadarMeta } from '../api.js';

const COLOR_SCHEME = 4; // TWC 配色
const SMOOTH = 1;

export class RadarLayer {
  constructor(map) {
    this.map = map;
    this.visible = false;
    this.meta = null;
    this.layers = [];      // 两个 TileLayer 交叉淡入淡出
    this.activeIdx = 0;
    this.currentPath = null;
    this.lastMs = null;
    this.baseOpacity = 0.82;
    this._fetchTimer = null;
    this._loading = false;
  }

  /* 全局不透明度联动(0.82 为雷达瓦片的默认基准) */
  setBaseOpacity(v) {
    this.baseOpacity = Math.min(1, Math.max(0, v));
    if (this.layers.length) this.layers[this.activeIdx].setOpacity(this.baseOpacity);
  }

  async ensureMeta() {
    if (this.meta && Date.now() - this.meta._fetchedAt < 4 * 60_000) return;
    const data = await fetchRadarMeta();
    data._fetchedAt = Date.now();
    this.meta = data;
  }

  frames() {
    if (!this.meta) return [];
    const r = this.meta.radar || {};
    return [...(r.past || []), ...(r.nowcast || [])];
  }

  show(on) {
    this.visible = on;
    if (on) {
      this._fetchTimer = setInterval(() => this._refresh(), 4 * 60_000);
      this._refresh();
    } else {
      clearInterval(this._fetchTimer);
      for (const l of this.layers) this.map.removeLayer(l);
      this.layers = [];
      this.activeIdx = 0;
      this.currentPath = null;
    }
  }

  async _refresh() {
    if (this._loading) return;
    this._loading = true;
    try {
      await this.ensureMeta();
      if (this.visible) this.updateTime(this.lastMs || Date.now());
    } catch (e) {
      console.error('[radar]', e.message);
    } finally {
      this._loading = false;
    }
  }

  _ensureLayers(path) {
    if (this.layers.length) return;
    const url = `${this.meta.host}${path}/256/{z}/{x}/{y}/${COLOR_SCHEME}/${SMOOTH}_1.png`;
    for (let i = 0; i < 2; i++) {
      const l = L.tileLayer(url, {
        opacity: 0, maxNativeZoom: 8, maxZoom: 12, className: 'radar-tiles',
      });
      l.addTo(this.map);
      const el = l.getContainer();
      if (el) el.style.transition = 'opacity 320ms ease';
      this.layers.push(l);
    }
  }

  /* 时间轴驱动:选 ≤ 时刻的最新一帧 */
  updateTime(ms) {
    this.lastMs = ms;
    if (!this.visible || !this.meta) return;
    const frames = this.frames();
    if (!frames.length) return;
    let pick = frames[0];
    for (const f of frames) {
      if (f.time * 1000 <= ms + 30_000) pick = f; else break;
    }
    if (pick.path === this.currentPath) return;
    const firstCreate = !this.layers.length;
    this._ensureLayers(pick.path);
    if (firstCreate) {
      this.layers[this.activeIdx].setOpacity(this.baseOpacity);
      this.layers[this.activeIdx].setUrl(`${this.meta.host}${pick.path}/256/{z}/{x}/{y}/${COLOR_SCHEME}/${SMOOTH}_1.png`);
      this.currentPath = pick.path;
      return;
    }
    this.currentPath = pick.path;
    const next = this.layers[this.activeIdx ^ 1];
    const cur = this.layers[this.activeIdx];
    next.setUrl(`${this.meta.host}${pick.path}/256/{z}/{x}/{y}/${COLOR_SCHEME}/${SMOOTH}_1.png`);
    next.setOpacity(this.baseOpacity);
    cur.setOpacity(0);
    this.activeIdx ^= 1;
  }
}
