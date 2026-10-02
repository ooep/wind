/* 台风/飓风路径图层:
 *  - 西太平洋:JMA 气象厅数据,浏览器直连(CORS 开放)——targetTc → specifications + forecast
 *  - 其他洋区(大西洋/东中太平洋):NHC,走静态烘焙包或服务端代理(NOAA 无 CORS)
 * 渲染采用 #overlay-root 上的自绘 canvas(Leaflet 矢量层会被气象填色画布遮挡),
 * 点击风暴中心弹出自定义详情卡。 */
import { resolveMode, isStatic, staticBase } from '../api.js';

const JMA = 'https://www.jma.go.jp/bosai/typhoon/data';

/* 强度等级 → 颜色(参照通用台风分级配色) */
function tierOf(cat, kt) {
  const c = String(cat || '').toUpperCase();
  if (c === 'HU' || c === 'TY') return kt >= 96 ? 'major' : 'ty';
  if (c === 'STS' || c === 'MH') return 'ty';
  if (c === 'TS' || c === 'SS') return 'ts';
  if (!kt) return 'td';
  if (kt >= 96) return 'major';
  if (kt >= 48) return 'ty';
  if (kt >= 34) return 'ts';
  return 'td';
}
const TIER_COLOR = { td: '#7fd0ff', ts: '#4cd9a8', ty: '#ffab4a', major: '#ff5f6e' };
const TIER_LABEL = { td: '热带低压', ts: '热带风暴', ty: '台风/飓风', major: '强台风/强飓风' };

export class TropicalLayer {
  constructor(map) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'tropical-canvas';
    document.getElementById('overlay-root').appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.visible = false;
    this.data = null;
    this.stormPx = [];        // 绘制时缓存各风暴中心屏幕位置,供点击命中
    this._fetchTimer = null;
    this._loading = false;
    this._resize();
    map.on('resize zoomend viewreset', () => { this._resize(); this._draw(); });
    map.on('move zoom movestart', () => { if (this.visible) { this._hidePopup(); this._draw(); } });
    map.on('click', (e) => this._onClick(e));
  }

  _resize() {
    const size = this.map.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = size.x; this.h = size.y;
    this.canvas.width = Math.round(size.x * dpr);
    this.canvas.height = Math.round(size.y * dpr);
  }

  show(on) {
    this.visible = on;
    clearInterval(this._fetchTimer);
    if (on) {
      this._refresh();
      this._fetchTimer = setInterval(() => this._refresh(), 10 * 60_000);
    } else {
      this._hidePopup();
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  async _refresh() {
    if (this._loading) return;
    this._loading = true;
    try {
      const [jma, nhc] = await Promise.all([
        jmaStorms().catch((e) => { console.error('[tropical-jma]', e.message || e); return []; }),
        nhcStorms().catch((e) => { console.error('[tropical-nhc]', e.message || e); return []; }),
      ]);
      this.data = { storms: [...jma, ...nhc], generated: Date.now() };
      if (this.visible) this._draw();
    } finally {
      this._loading = false;
    }
  }

  /* ---------- 绘制 ---------- */

  _prj(lat, lng) {
    const s = 256 * Math.pow(2, this.map.getZoom());
    const x = ((lng + 180) / 360) * s;
    const sin = Math.sin(Math.max(-Math.PI / 2 + 1e-9, Math.min(Math.PI / 2 - 1e-9, lat * Math.PI / 180)));
    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s;
    return { x, y };
  }

  _toXY(lat, lng) {
    const center = this.map.getCenter();
    const cp = this._prj(center.lat, center.lng);
    const p = this._prj(lat, ((lng + 540) % 360) - 180);
    return { x: p.x - cp.x + this.w / 2, y: p.y - cp.y + this.h / 2 };
  }

  /* 米 → 屏幕像素(纬度圈上) */
  _metersToPx(m, lat) {
    const z = this.map.getZoom();
    return m / (156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z));
  }

  _draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.visible || !this.data) return;
    this.stormPx = [];
    const z = this.map.getZoom();
    for (const st of this.data.storms || []) {
      const [lat0, lon0] = st.position;
      if (!Number.isFinite(lat0) || !Number.isFinite(lon0)) continue;
      const tier = tierOf(st.category, st.intensityKt);
      const color = TIER_COLOR[tier];

      // 过去轨迹(实线;相邻点跨反子午线则断笔)
      const past = st.pastTrack || [];
      if (past.length > 1) {
        ctx.beginPath();
        let started = false;
        let prev = null;
        for (const p of past) {
          const pt = this._toXY(p[0], p[1]);
          if (prev && Math.abs(pt.x - prev.x) > this.w / 2) started = false;
          if (!started) { ctx.moveTo(pt.x, pt.y); started = true; }
          else ctx.lineTo(pt.x, pt.y);
          prev = pt;
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // 预报:虚线 + 预报点 + 概率圆/大风圈
      const fpts = (st.forecast || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      if (fpts.length) {
        ctx.beginPath();
        const c0 = this._toXY(lat0, lon0);
        ctx.moveTo(c0.x, c0.y);
        let prev = c0;
        for (const p of fpts) {
          const pt = this._toXY(p.lat, p.lon);
          if (Math.abs(pt.x - prev.x) > this.w / 2) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
          prev = pt;
        }
        ctx.setLineDash([7, 6]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.setLineDash([]);
        for (const p of fpts) {
          const pt = this._toXY(p.lat, p.lon);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3, 0, 6.2832);
          ctx.fillStyle = '#0b1420';
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.4;
          ctx.stroke();
          if (p.radiusProb) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, this._metersToPx(p.radiusProb, p.lat), 0, 6.2832);
            ctx.setLineDash([3, 5]);
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.setLineDash([]);
          }
          if (p.radiusStorm) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, this._metersToPx(p.radiusStorm, p.lat), 0, 6.2832);
            ctx.strokeStyle = 'rgba(255,171,74,0.7)';
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        }
      }

      // 当前位置:光晕 + 双弧台风符 + 名字标注
      const c = this._toXY(lat0, lon0);
      if (c.x > -30 && c.y > -30 && c.x < this.w + 30 && c.y < this.h + 30) {
        this.stormPx.push({ x: c.x, y: c.y, st });
        ctx.beginPath();
        ctx.arc(c.x, c.y, 10, 0, 6.2832);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 6.5, 0.6, 2.6);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(c.x, c.y, 6.5, 0.6 + Math.PI, 2.6 + Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(c.x, c.y, 2.2, 0, 6.2832);
        ctx.fillStyle = color;
        ctx.fill();
        if (z >= 4) {
          ctx.font = '600 11px system-ui, sans-serif';
          ctx.textAlign = 'left';
          const name = st.name || 'TC';
          const tw = ctx.measureText(name).width;
          ctx.fillStyle = 'rgba(8,14,22,0.72)';
          ctx.fillRect(c.x + 11, c.y - 9, tw + 10, 17);
          ctx.fillStyle = '#e8f2fa';
          ctx.fillText(name, c.x + 16, c.y + 4);
        }
      }
    }
  }

  /* ---------- 点击弹卡 ---------- */

  _onClick(e) {
    if (!this.visible || !this.stormPx.length) return;
    const { x, y } = e.containerPoint;
    let best = null, bestD = 16;
    for (const s of this.stormPx) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) { best = s; bestD = d; }
    }
    if (!best) { this._hidePopup('tropical'); return; }
    window.__obsClickClaimed = true; // 命中观测对象:阻止主控弹预报面板
    this._showPopup(best.st, best.x, best.y);
  }

  _showPopup(st, px, py) {
    let el = document.getElementById('obs-popup');
    if (!el) {
      el = document.createElement('div');
      el.id = 'obs-popup';
      document.getElementById('overlay-root').appendChild(el);
    }
    el.dataset.owner = 'tropical';
    el.innerHTML = this._popupHtml(st);
    el.style.display = 'block';
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(px + 14, this.w - w - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(py - h - 12, this.h - h - 8))}px`;
  }

  _hidePopup(owner) {
    const el = document.getElementById('obs-popup');
    if (el && (!owner || el.dataset.owner === owner)) el.style.display = 'none';
  }

  _popupHtml(st) {
    const tier = tierOf(st.category, st.intensityKt);
    const kt = st.intensityKt;
    const ms = kt != null ? Math.round(kt * 0.5144) : null;
    const mv = st.movement
      ? (typeof st.movement === 'string' ? st.movement
        : `${st.movement.dirDeg != null ? DIR8(Math.round(st.movement.dirDeg / 45) % 8) + '方向' : ''} ${st.movement.speedKt != null ? st.movement.speedKt + ' kt' : ''}`.trim() || '—')
      : '—';
    return `<div class="tc-popup">
      <b>${escapeHtml(st.name || '热带气旋')}${st.nameLocal ? ` <span style="opacity:.65">${escapeHtml(st.nameLocal)}</span>` : ''}</b>
      <div style="opacity:.75;font-size:11.5px;margin:2px 0 6px">${TIER_LABEL[tier]}${st.number ? ` · ${escapeHtml(st.number)}` : ''} · ${st.source === 'jma' ? '日本气象厅' : 'NOAA NHC'}</div>
      <div class="tc-grid">
        <span>最大风速</span><b>${kt != null ? `${kt} kt${ms != null ? ' / ' + ms + ' m/s' : ''}` : '—'}</b>
        <span>中心气压</span><b>${st.pressureHpa != null ? st.pressureHpa + ' hPa' : '—'}</b>
        <span>移向移速</span><b>${escapeHtml(mv)}</b>
        <span>发布时间</span><b>${st.issue ? fmtUTC(st.issue) : '—'}</b>
      </div></div>`;
  }
}

function DIR8(i) { return ['东', '东南', '南', '西南', '西', '西北', '北', '东北'][i] || ''; }
function fmtUTC(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}
function escapeHtml(t) { return String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

/* ---------------- 数据获取 ---------------- */

async function fetchOk(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

/* JMA:西太平洋(浏览器直连,官方 CORS 开放) */
async function jmaStorms() {
  const tcs = await fetchOk(`${JMA}/targetTc.json`);
  const list = (tcs || []).filter((t) => t.tropicalCyclone);
  const results = await Promise.allSettled(list.map(async (tc) => {
    const [spec, fc] = await Promise.all([
      fetchOk(`${JMA}/${tc.tropicalCyclone}/specifications.json`).catch(() => null),
      fetchOk(`${JMA}/${tc.tropicalCyclone}/forecast.json`).catch(() => null),
    ]);
    return buildJma(tc, spec, fc);
  }));
  return results.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value);
}

function buildJma(tc, spec, fc) {
  const title = Array.isArray(spec) && spec.find((p) => p.part === 'title');
  const analysis = Array.isArray(fc) && fc.find((p) => p.part && p.part.en === 'Analysis');
  const fcParts = (Array.isArray(fc) ? fc : []).filter((p) => p.part && Number(p.advancedHours) > 0 && p.center);
  const center = analysis && analysis.center;
  if (!center) return null;
  const specAnalysis = Array.isArray(spec) && spec.find((p) => p.part && p.part.en === 'Analysis');
  const kt = specAnalysis && specAnalysis.maximumWind && specAnalysis.maximumWind.sustained
    ? Number(specAnalysis.maximumWind.sustained.kt) : null;
  const past = [];
  if (analysis && analysis.track) {
    for (const seg of [analysis.track.preTyphoon, analysis.track.typhoon]) {
      for (const p of seg || []) if (Number.isFinite(p[0]) && Number.isFinite(p[1])) past.push([p[0], p[1]]);
    }
  }
  const mvText = specAnalysis ? [specAnalysis.course, specAnalysis.speed && specAnalysis.speed['km/h'] ? `${specAnalysis.speed['km/h']} km/h` : ''].filter(Boolean).join(' ') : null;
  return {
    source: 'jma',
    id: tc.tropicalCyclone,
    number: title && title.typhoonNumber ? `第${String(title.typhoonNumber).slice(2)}号` : null,
    name: title && title.name ? title.name.en : null,
    nameLocal: title && title.name ? title.name.jp : null,
    category: (title && title.category && title.category.en) || tc.category || null,
    intensityKt: kt,
    pressureHpa: specAnalysis && specAnalysis.pressure ? Number(specAnalysis.pressure) : null,
    position: [center[0], center[1]],
    movement: mvText,
    issue: (title && title.issue && title.issue.UTC) || tc.issue || null,
    pastTrack: past,
    forecast: fcParts.map((p) => ({
      lat: p.center[0], lon: p.center[1],
      ms: p.validtime && p.validtime.UTC ? Date.parse(p.validtime.UTC) : null,
      tau: Number(p.advancedHours),
      kt: null,
      radiusProb: p.probabilityCircle && p.probabilityCircle.radius || null,
      radiusStorm: p.stormWarningArea && p.stormWarningArea.arc && p.stormWarningArea.arc[0] && p.stormWarningArea.arc[0][1] || null,
    })),
  };
}

/* NHC:其他洋区(无 CORS → 静态烘焙包 / 服务端代理;都失败则放弃该源) */
async function nhcStorms() {
  await resolveMode();
  const url = isStatic() ? `${staticBase()}/tropical/nhc.json` : '/api/tropical/nhc';
  const data = await fetchOk(url);
  return (data && data.storms) || [];
}
