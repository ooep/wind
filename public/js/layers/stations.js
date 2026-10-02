/* 气象站实况图层:全球机场/气象站 METAR 观测(aviationweather.gov,Action 每小时烘焙)。
 * 自绘 canvas 按温度着色(Leaflet 矢量层会被气象填色画布遮挡),点击站点弹详情卡。 */
import { resolveMode, isStatic, staticBase } from '../api.js';
import { TEMP } from '../colormaps.js';

const WX_ZH = {
  TS: '雷暴', RA: '雨', SN: '雪', DZ: '毛毛雨', SH: '阵雨', GR: '冰雹', FZ: '冻雨',
  FG: '雾', BR: '轻雾', HZ: '霾', FU: '烟', DU: '浮尘', SS: '沙暴', DS: '尘暴',
  BLDU: '扬沙', BLSN: '吹雪', VCSH: '附近阵雨', TSRA: '雷雨', RASN: '雨夹雪', UP: '未知降水',
};

function wxToZh(wx) {
  if (!wx) return '';
  const out = [];
  for (const p of String(wx).split(/\s+/).filter(Boolean)) {
    const stripped = p.replace(/^(VC|-|\+)$/g, '');
    const zh = WX_ZH[stripped] || WX_ZH[p];
    if (zh) out.push((p.startsWith('+') ? '大' : p.startsWith('-') ? '小' : '') + zh);
    else out.push(p);
  }
  return out.join(' · ');
}

const DIR8 = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

export class StationLayer {
  constructor(map) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'stations-canvas';
    document.getElementById('overlay-root').appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.visible = false;
    this.data = null;
    this.pxIndex = [];        // 绘制时缓存的屏幕位置 → 站点,供点击命中
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
      this._fetchTimer = setInterval(() => this._refresh(), 15 * 60_000);
    } else {
      this._hidePopup();
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  async _refresh() {
    if (this._loading) return;
    this._loading = true;
    try {
      await resolveMode();
      const url = isStatic() ? `${staticBase()}/obs/latest.json` : '/api/obs';
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.data = await r.json();
      if (this.visible) this._draw();
    } catch (e) {
      console.error('[stations]', e.message);
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

  _draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.visible || !this.data) return;
    this.pxIndex = [];
    const center = this.map.getCenter();
    const cp = this._prj(center.lat, center.lng);
    const r = this.map.getZoom() >= 7 ? 4 : 3;
    for (const s of (this.data.stations || [])) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
      const p = this._prj(s.lat, ((s.lon + 540) % 360) - 180);
      const x = p.x - cp.x + this.w / 2;
      const y = p.y - cp.y + this.h / 2;
      if (x < -6 || y < -6 || x > this.w + 6 || y > this.h + 6) continue;
      this.pxIndex.push({ x, y, s });
      const col = Number.isFinite(s.t) ? TEMP.color(s.t) : [160, 180, 200, 230];
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},1)`;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /* ---------- 点击弹卡 ---------- */

  _onClick(e) {
    if (!this.visible || !this.pxIndex.length) return;
    const { x, y } = e.containerPoint;
    let best = null, bestD = 11;
    for (const p of this.pxIndex) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { best = p; bestD = d; }
    }
    if (!best) { this._hidePopup('stations'); return; }
    window.__obsClickClaimed = true; // 命中观测对象:阻止主控弹预报面板
    this._showPopup(best.s, best.x, best.y);
  }

  _showPopup(s, px, py) {
    let el = document.getElementById('obs-popup');
    if (!el) {
      el = document.createElement('div');
      el.id = 'obs-popup';
      document.getElementById('overlay-root').appendChild(el);
    }
    el.dataset.owner = 'stations';
    el.innerHTML = this._popupHtml(s);
    el.style.display = 'block';
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(px + 12, this.w - w - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(py - h - 10, this.h - h - 8))}px`;
  }

  _hidePopup(owner) {
    const el = document.getElementById('obs-popup');
    if (el && (!owner || el.dataset.owner === owner)) el.style.display = 'none';
  }

  _popupHtml(s) {
    const zh = wxToZh(s.wx);
    const ageH = s.o ? Math.max(0, (Date.now() / 1000 - s.o) / 3600) : null;
    const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const dirText = () => {
      if (!Number.isFinite(s.ws)) return '—';
      const d = Number.isFinite(s.wd) ? `${DIR8[Math.round(((s.wd + 360) % 360) / 45) % 8]}风` : '';
      const g = Number.isFinite(s.wg) ? ` 阵风${Math.round(s.wg * 0.5144)}m/s` : '';
      return `${d} ${Math.round(s.ws * 0.5144)} m/s${g}`.trim();
    };
    return `<div class="tc-popup">
      <b>${esc(s.n || s.i)}</b>
      <div style="opacity:.75;font-size:11.5px;margin:2px 0 6px">${esc(s.i)} · METAR 实测${ageH != null ? ` · ${ageH < 1 ? '刚刚' : Math.round(ageH) + ' 小时前'}` : ''}</div>
      <div class="tc-grid">
        <span>气温</span><b>${Number.isFinite(s.t) ? Math.round(s.t) + '°C' : '—'}</b>
        <span>露点</span><b>${Number.isFinite(s.td) ? Math.round(s.td) + '°C' : '—'}</b>
        <span>风</span><b>${dirText()}</b>
        <span>海平面气压</span><b>${Number.isFinite(s.p) ? Math.round(s.p) + ' hPa' : '—'}</b>
        <span>能见度</span><b>${s.vis != null ? esc(s.vis) + ' km' : '—'}</b>
        <span>天气</span><b>${zh ? esc(zh) : '—'}</b>
      </div>
      ${s.raw ? `<div style="margin-top:6px;font-size:10px;opacity:.55;font-family:monospace;word-break:break-all">${esc(s.raw)}</div>` : ''}
    </div>`;
  }
}
