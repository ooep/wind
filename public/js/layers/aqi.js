/* 空气质量图层:全球主要城市 AQI / PM2.5 / UV(Open-Meteo Air Quality,CAMS 全球数据)。
 * 数据由 Action 定期烘焙(静态模式读 dist/data/aq/latest.json)或服务端缓存接口提供。
 * 圆点按 US AQI 着色,点击弹出该城市详情。 */
import { resolveMode, isStatic, staticBase } from '../api.js';
import { AQI } from '../colormaps.js';
import { fmtHourLocal } from '../util.js';

/* 通风等级说明 */
const AQI_DESC = [
  [50, '优', '空气令人满意,基本无健康风险'],
  [100, '良', '极少数敏感人群应减少户外活动'],
  [150, '轻度污染', '敏感人群症状可能轻度加剧'],
  [200, '中度污染', '普遍建议减少长时间户外活动'],
  [300, '重度污染', '健康人群普遍出现症状'],
  [500, '严重污染', '所有人应避免户外活动'],
];

function aqiDesc(v) {
  for (const [max, grade, tip] of AQI_DESC) if (v <= max) return { grade, tip };
  return AQI_DESC[AQI_DESC.length - 1];
}

export class AqiLayer {
  constructor(map) {
    this.map = map;
    this.visible = false;
    this.group = null;
    this.data = null;
    this.field = 'a';   // 渲染字段:a=AQI,p=PM2.5,p10,o3,no2,so2
    this.cmap = AQI;
    this._fetchTimer = null;
    this._loading = false;
  }

  /* 切换渲染要素(图层族共用同一份数据,仅换字段与色标) */
  setField(field, cmap) {
    this.field = field || 'a';
    this.cmap = cmap || AQI;
    if (this.visible && this.data) this._render();
  }

  show(on) {
    this.visible = on;
    clearInterval(this._fetchTimer);
    if (on) {
      this._refresh();
      this._fetchTimer = setInterval(() => this._refresh(), 30 * 60_000);
    } else if (this.group) {
      this.map.removeLayer(this.group);
      this.group = null;
    }
  }

  async _refresh() {
    if (this._loading) return;
    this._loading = true;
    try {
      await resolveMode();
      const url = isStatic() ? `${staticBase()}/aq/latest.json` : '/api/aq';
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.data = await r.json();
      if (this.visible) this._render();
    } catch (e) {
      console.error('[aqi]', e.message);
    } finally {
      this._loading = false;
    }
  }

  _render() {
    if (this.group) { this.map.removeLayer(this.group); this.group = null; }
    this.group = L.layerGroup().addTo(this.map);
    const cities = (this.data && this.data.cities) || [];
    const nowH = this._nearestHour();
    const fld = this.field;
    for (const c of cities) {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
      const a = c[fld] ? c[fld][nowH] : null;
      if (!Number.isFinite(a)) continue;
      const col = rgbaOf(this.cmap.color(a));
      const m = L.circleMarker([c.lat, c.lon], {
        radius: a > 150 ? 5 : a > 100 ? 4.4 : 3.4,
        weight: 1.1, color: 'rgba(0,0,0,0.4)', fillColor: col, fillOpacity: 0.92,
      });
      m.bindPopup(this._popup(c, a, nowH), { maxWidth: 280 });
      this.group.addLayer(m);
    }
  }

  /* 取距当前最近的小时下标(数据为逐小时预报序列) */
  _nearestHour() {
    const t0 = this.data && this.data.t0;
    if (!t0) return 0;
    return Math.max(0, Math.min(47, Math.round((Date.now() - t0) / 3600e3)));
  }

  _popup(c, a, nowH) {
    const d = aqiDesc(a);
    const pick = (arr) => (arr ? arr[nowH] : null);
    const f = (v, unit, rd = 1) => (Number.isFinite(v) ? `${(+v).toFixed(rd)}${unit}` : '—');
    const FIELDS = { a: ['US AQI', ''], p: ['PM2.5', ' μg/m³'], p10: ['PM10', ' μg/m³'], o3: ['O₃', ' μg/m³'], no2: ['NO₂', ' μg/m³'], so2: ['SO₂', ' μg/m³'] };
    const [flabel, funit] = FIELDS[this.field] || FIELDS.a;
    const gen = this.data && this.data.generated ? new Date(this.data.generated * 1000) : null;
    return `<div class="tc-popup">
      <b>${escapeHtml(c.n || '')}</b>
      <div style="opacity:.75;font-size:11.5px;margin:2px 0 6px">${gen ? `CAMS 预报 · ${gen.getHours()}:00 更新` : 'CAMS 预报'}</div>
      <div style="display:flex;align-items:baseline;gap:8px;margin:2px 0 6px">
        <span style="font-size:26px;font-weight:700;color:${rgbaOf(this.cmap.color(a))}">${f(a, funit, this.field === 'a' ? 0 : 1)}</span>
        <span style="font-size:12.5px;font-weight:600">${flabel}${this.field === 'a' ? ' · ' + d.grade : ''}</span>
      </div>
      <div class="tc-grid">
        <span>AQI</span><b>${f(pick(c.a), '', 0)}</b>
        <span>PM2.5</span><b>${f(pick(c.p), ' μg/m³')}</b>
        <span>PM10</span><b>${f(pick(c.p10), ' μg/m³')}</b>
        <span>O₃</span><b>${f(pick(c.o3), ' μg/m³')}</b>
        <span>NO₂</span><b>${f(pick(c.no2), ' μg/m³')}</b>
        <span>SO₂</span><b>${f(pick(c.so2), ' μg/m³')}</b>
        <span>UV 指数</span><b>${f(pick(c.u), '', 1)}</b>
      </div>
      <div style="margin-top:6px;font-size:11px;opacity:.7;line-height:1.5">${this.field === 'a' ? d.tip : '浓度基于 CAMS 全球模式,城市代表值'}</div>
    </div>`;
  }
}

function rgbaOf(c) { return c ? `rgba(${c[0]},${c[1]},${c[2]},1)` : 'rgba(160,180,200,0.9)'; }
function escapeHtml(t) { return String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
