/* 点位预报面板:当前实况 + 48 小时图表 + 7 天列表 */
import { fetchPoint } from './api.js';
import { fmtTime, fmtHourLocal, weekday, fmtDay } from './util.js';

const WMO = {
  0: ['晴', '☀️'], 1: ['基本晴', '🌤️'], 2: ['多云', '⛅'], 3: ['阴', '☁️'],
  45: ['雾', '🌫️'], 48: ['雾凇', '🌫️'], 51: ['小毛毛雨', '🌦️'], 53: ['毛毛雨', '🌦️'],
  55: ['浓毛毛雨', '🌧️'], 56: ['冻毛毛雨', '🌧️'], 57: ['浓冻毛毛雨', '🌧️'],
  61: ['小雨', '🌦️'], 63: ['中雨', '🌧️'], 65: ['大雨', '🌧️'],
  66: ['冻雨', '🌧️'], 67: ['强冻雨', '🌧️'],
  71: ['小雪', '🌨️'], 73: ['中雪', '🌨️'], 75: ['大雪', '❄️'], 77: ['雪粒', '❄️'],
  80: ['小阵雨', '🌦️'], 81: ['阵雨', '🌧️'], 82: ['强阵雨', '⛈️'],
  85: ['阵雪', '🌨️'], 86: ['强阵雪', '🌨️'],
  95: ['雷暴', '⛈️'], 96: ['雷暴伴冰雹', '⛈️'], 99: ['强雷暴伴冰雹', '⛈️'],
};
const wmo = (c) => WMO[c] || ['—', '🌡️'];
const p2 = (n) => String(n).padStart(2, '0');
let degUnit = 'c';
export function setDegUnit(u) { degUnit = u; }
export const toDeg = (c) => (degUnit === 'f' ? c * 9 / 5 + 32 : c);
export const degStr = (c, fixed = 0) => toDeg(c).toFixed(fixed) + '°';

export class ForecastPanel {
  constructor(modelGetter) {
    this.getModel = modelGetter;
    this.el = document.getElementById('panel');
    this.content = document.getElementById('panel-content');
    this.loading = document.getElementById('panel-loading');
    this.title = document.getElementById('panel-title');
    this.coords = document.getElementById('panel-coords');
    this.lat = null; this.lon = null;
    this.placeName = null;
    this.tab = '48h';
    this.data = null;
    this.compareData = null;

    document.getElementById('panel-close').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    document.getElementById('panel-fav').addEventListener('click', () => this.toggleFav());
  }

  get isOpen() { return !this.el.hidden; }

  open(lat, lon, name) {
    this.lat = lat; this.lon = lon;
    this.placeName = name || null;
    this.compareData = null;
    this.el.hidden = false;
    this.title.textContent = name || '定位中…';
    this.coords.textContent = `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`;
    this.content.hidden = true;
    this.loading.style.display = 'block';
    this._updateFav();
    this._load();
  }

  /* 收藏地点(localStorage) */
  static favs() {
    try { return JSON.parse(localStorage.getItem('fy_favs') || '[]'); } catch { return []; }
  }
  _updateFav() {
    const btn = document.getElementById('panel-fav');
    if (!btn) return;
    const hit = ForecastPanel.favs().some((f) => Math.abs(f.lat - this.lat) < 0.01 && Math.abs(f.lon - this.lon) < 0.01);
    btn.textContent = hit ? '★' : '☆';
    btn.style.color = hit ? '#ffd257' : '';
  }
  toggleFav() {
    if (this.lat == null) return;
    let favs = ForecastPanel.favs();
    const hit = favs.some((f) => Math.abs(f.lat - this.lat) < 0.01 && Math.abs(f.lon - this.lon) < 0.01);
    if (hit) favs = favs.filter((f) => !(Math.abs(f.lat - this.lat) < 0.01 && Math.abs(f.lon - this.lon) < 0.01));
    else favs.push({ name: this.placeName || `${this.lat.toFixed(2)}, ${this.lon.toFixed(2)}`, lat: this.lat, lon: this.lon });
    localStorage.setItem('fy_favs', JSON.stringify(favs.slice(-20)));
    this._updateFav();
    document.dispatchEvent(new CustomEvent('favs-changed'));
  }

  refresh() { if (this.isOpen) this._load(); }

  close() { this.el.hidden = true; }

  async _load() {
    try {
      const data = await fetchPoint(this.lat, this.lon, this.getModel());
      this.data = data;
      this._render();
    } catch (e) {
      this.loading.style.display = 'none';
      this.title.textContent = '加载失败';
      this.content.hidden = false;
      this.content.innerHTML = `<p style="color:var(--text-dim);font-size:13px">${e.message},请稍后重试。</p>`;
    }
  }

  _render() {
    const d = this.data;
    const cur = d.current;
    const [desc, icon] = wmo(cur.weather_code);
    this.title.textContent = `${desc} · ${Math.round(toDeg(cur.temperature_2m))}°`;
    if (Number.isFinite(d.elevation)) {
      this.coords.textContent += ` · 海拔 ${Math.round(d.elevation)} m`;
    }
    const dir = compass(cur.wind_direction_10m);
    const staleNote = d.stale
      ? ` · 缓存于 ${p2(new Date(d.cachedAt * 1000).getHours())}:${p2(new Date(d.cachedAt * 1000).getMinutes())}(上游限流)`
      : '';

    const windDisp = (ms) => (ms == null || Number.isNaN(ms)) ? '—' : `${ms.toFixed(1)} m/s`;

    this.content.innerHTML = `
      <div class="pcur">
        <div class="pcur-icon">${cur.is_day ? icon : (cur.weather_code === 0 || cur.weather_code === 1 ? '🌙' : icon)}</div>
        <div>
          <div class="pcur-temp">${Math.round(toDeg(cur.temperature_2m))}<sup>°${degUnit.toUpperCase()}</sup></div>
          <div class="pcur-desc">${desc} · 体感 ${Math.round(toDeg(cur.apparent_temperature))}°</div>
        </div>
      </div>
      <div class="pgrid">
        <div class="pstat"><b>${windDisp(cur.wind_speed_10m)}</b><span>风速 ${dir}</span></div>
        <div class="pstat"><b>${windDisp(cur.wind_gusts_10m)}</b><span>阵风</span></div>
        <div class="pstat"><b>${Math.round(cur.relative_humidity_2m)}%</b><span>相对湿度</span></div>
        <div class="pstat"><b>${Math.round(cur.pressure_msl)} hPa</b><span>海平面气压</span></div>
        <div class="pstat"><b>${Math.round(cur.cloud_cover)}%</b><span>云量</span></div>
        <div class="pstat"><b>${cur.precipitation ?? 0} mm</b><span>当前降水</span></div>
      </div>
      <div class="ptabs">
        <button data-tab="48h" class="active">48 小时</button>
        <button data-tab="7d">7 天</button>
        <button data-tab="cmp">模式对比</button>
        <button data-tab="wave">海浪</button>
      </div>
      <div id="ptab-body"></div>
      <div class="psun">🌅 ${fmtHourLocal(Date.parse(d.daily.sunrise[0]))} 日出 · 🌇 ${fmtHourLocal(Date.parse(d.daily.sunset[0]))} 日落(当地)</div>
      <div style="font-size:10.5px;color:var(--text-dim);margin-top:8px;text-align:center">数据源:${modelLabel(d)},插值到该点坐标${staleNote}</div>
    `;

    this.content.querySelectorAll('.ptabs button').forEach((b) => {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        this.content.querySelectorAll('.ptabs button').forEach((x) => x.classList.toggle('active', x === b));
        this._renderTab();
      });
    });
    this.loading.style.display = 'none';
    this.content.hidden = false;
    this._renderTab();
  }

  _renderTab() {
    const body = document.getElementById('ptab-body');
    if (!body) return;
    if (this.tab === '48h') this._renderChart(body);
    else if (this.tab === 'cmp') this._renderCompare(body);
    else if (this.tab === 'wave') this._renderWave(body);
    else this._renderDays(body);
  }

  /* 模式对比:多模式温度/风速曲线叠绘(GFS / GEFS / ECMWF / Open-Meteo) */
  async _renderCompare(body) {
    if (this.compareData) { this._drawCompare(body, this.compareData); return; }
    body.innerHTML = '<div class="spinner"></div><div style="text-align:center;font-size:11.5px;color:var(--text-faint)">并行获取多模式预报…</div>';
    const MODELS = [
      { id: 'gfs_raw', name: 'GFS', color: '#45c4ff' },
      { id: 'gefs_raw', name: 'GEFS', color: '#ffb454' },
      { id: 'ecmwf_raw', name: 'ECMWF', color: '#c39bff' },
      { id: 'aifs_raw', name: 'AIFS', color: '#ff8c42' },
      { id: 'best_match', name: 'OM', color: '#7ddc9a' },
    ];
    const get = (m) => new Promise(async (resolve) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 20000);
      try {
        const r = await fetch(`/api/point?lat=${this.lat}&lon=${this.lon}&model=${m.id}`, { signal: ac.signal });
        clearTimeout(timer);
        const d = await r.json();
        resolve(d.current ? { d, color: m.color, name: m.name } : null);
      } catch { clearTimeout(timer); resolve(null); }
    });
    const settled = await Promise.all(MODELS.map(get));
    const ok = settled.filter(Boolean);
    this.compareData = ok;
    if (!ok.length) { body.innerHTML = '<p style="color:var(--text-dim);font-size:12.5px;padding:20px 0;text-align:center">各模式数据暂不可用,请稍后重试</p>'; return; }
    this._drawCompare(body, ok);
  }

  _drawCompare(body, models) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = 318, ch = 210, padL = 30, padR = 10, padT = 26, padB = 24;
    const cv = document.createElement('canvas');
    cv.width = cw * dpr; cv.height = ch * dpr;
    cv.style.width = '100%';
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);

    // 时间轴:取最长序列的时间作为基准(字符串即键)
    let axis = [];
    for (const m of models) if (m.d.hourly.time.length > axis.length) axis = m.d.hourly.time;
    axis = axis.slice(0, 64);
    const keyOf = (arr, i) => arr[i];
    const idxOf = (arr, key) => arr.indexOf(key);

    let tMin = Infinity, tMax = -Infinity, wMax = 0;
    for (const m of models) {
      for (const v of m.d.hourly.temperature_2m.slice(0, axis.length)) {
        if (v == null) continue;
        if (v < tMin) tMin = v; if (v > tMax) tMax = v;
      }
      for (const v of m.d.hourly.wind_speed_10m.slice(0, axis.length)) {
        if (v != null && v > wMax) wMax = v;
      }
    }
    tMin = Math.floor(tMin) - 1; tMax = Math.ceil(tMax) + 1;
    const x = (i) => padL + (cw - padL - padR) * i / (axis.length - 1);
    const yT = (v) => padT + (ch - padT - padB) * (1 - (v - tMin) / (tMax - tMin));
    const yW = (v) => padT + (ch - padT - padB) * (1 - v / Math.max(8, wMax * 1.1));

    ctx.font = '9px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    for (let v = Math.ceil(tMin / 5) * 5; v <= tMax; v += 5) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.moveTo(padL, yT(v)); ctx.lineTo(cw - padR, yT(v)); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(v + '°', padL - 3, yT(v) + 3);
    }
    // 各模式温度曲线
    for (const m of models) {
      const times = m.d.hourly.time;
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < axis.length; i++) {
        const k = idxOf(times, axis[i]);
        if (k < 0) { pen = false; continue; }
        const v = m.d.hourly.temperature_2m[k];
        if (v == null) { pen = false; continue; }
        if (!pen) { ctx.moveTo(x(i), yT(v)); pen = true; } else ctx.lineTo(x(i), yT(v));
      }
      ctx.strokeStyle = m.color; ctx.lineWidth = 1.7; ctx.stroke();
    }
    // 时间标签
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'center';
    for (let i = 0; i < axis.length; i += 12) {
      const hh = axis[i].slice(11, 16);
      ctx.fillText(hh, x(i), ch - 8);
    }
    // 图例(顶部)
    ctx.textAlign = 'left';
    let lx = padL;
    for (const m of models) {
      ctx.fillStyle = m.color;
      ctx.fillRect(lx, 6, 8, 3);
      const cur = m.d.current.temperature_2m;
      ctx.font = '9.5px -apple-system, sans-serif';
      ctx.fillText(`${m.name} ${Math.round(cur)}°`, lx + 11, 11);
      lx += 17 + ctx.measureText(`${m.name} ${Math.round(cur)}°`).width + 8;
    }

    const wrap = document.createElement('div');
    wrap.className = 'pchart-wrap';
    wrap.appendChild(cv);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:var(--text-faint);margin:4px 0 8px';
    note.textContent = '温度曲线逐 3h(虚线轴 °C);曲线缺失表示该模式数据暂未就绪';
    body.innerHTML = '';
    body.appendChild(wrap);
    body.appendChild(note);
  }

  _renderChart(body) {
    const d = this.data;
    const now = Date.now();
    const times = d.hourly.time.map((t) => Date.parse(t));
    let start = times.findIndex((t) => t >= now - 3600e3);
    if (start < 0) start = 0;
    const end = Math.min(start + 48, times.length);
    const slice = times.slice(start, end);
    const temp = d.hourly.temperature_2m.slice(start, end).map(toDeg);
    const prcp = d.hourly.precipitation.slice(start, end);
    const wind = d.hourly.wind_speed_10m.slice(start, end);
    const codes = d.hourly.weather_code.slice(start, end);

    const cw = 318, ch = 190, padL = 30, padR = 34, padT = 18, padB = 26;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = document.createElement('canvas');
    cv.width = cw * dpr; cv.height = ch * dpr;
    cv.style.width = '100%';
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);

    const x = (i) => padL + (cw - padL - padR) * i / Math.max(1, slice.length - 1);
    const tMin = Math.floor(Math.min(...temp) / 5) * 5 - 2;
    const tMax = Math.ceil(Math.max(...temp) / 5) * 5 + 2;
    const wMax = Math.max(10, ...wind);
    const pMax = Math.max(2, ...prcp);
    const yT = (v) => padT + (ch - padT - padB) * (1 - (v - tMin) / (tMax - tMin));
    const yW = (v) => padT + (ch - padT - padB) * (1 - v / wMax);

    // 网格与温度刻度
    ctx.font = '9px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    for (let v = Math.ceil(tMin / 5) * 5; v <= tMax; v += 5) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath(); ctx.moveTo(padL, yT(v)); ctx.lineTo(cw - padR, yT(v)); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText(v + '°', padL - 4, yT(v) + 3);
    }
    // 风速刻度(右)
    ctx.textAlign = 'left';
    for (const v of [0, wMax / 2, wMax]) {
      ctx.fillStyle = 'rgba(110,220,255,0.55)';
      ctx.fillText(v.toFixed(0), cw - padR + 4, yW(v) + 3);
    }

    // 降水柱
    const bw = Math.max(2, (cw - padL - padR) / slice.length - 1.5);
    for (let i = 0; i < slice.length; i++) {
      if (!prcp[i]) continue;
      const h = (ch - padT - padB) * (prcp[i] / pMax) * 0.5;
      ctx.fillStyle = 'rgba(80,150,255,0.55)';
      ctx.fillRect(x(i) - bw / 2, ch - padB - h, bw, h);
    }

    // 温度曲线
    ctx.beginPath();
    temp.forEach((v, i) => i ? ctx.lineTo(x(i), yT(v)) : ctx.moveTo(x(i), yT(v)));
    ctx.strokeStyle = '#ffb454'; ctx.lineWidth = 1.8; ctx.stroke();
    // 风速曲线
    ctx.beginPath();
    wind.forEach((v, i) => i ? ctx.lineTo(x(i), yW(v)) : ctx.moveTo(x(i), yW(v)));
    ctx.strokeStyle = 'rgba(110,220,255,0.85)'; ctx.lineWidth = 1.3;
    ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);

    // 天气图标(每 6 小时)
    ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    for (let i = 0; i < slice.length; i += 6) {
      ctx.fillText(wmo(codes[i])[1], x(i), padT - 5);
    }
    // 时间标签(每 8 小时)
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '9px -apple-system, sans-serif';
    for (let i = 0; i < slice.length; i += 8) {
      ctx.fillText(fmtHourLocal(slice[i]), x(i), ch - 12);
    }
    // 图例
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffb454'; ctx.fillText('— 温度', padL, ch - 2);
    ctx.fillStyle = 'rgba(110,220,255,0.85)'; ctx.fillText('--- 风速 m/s', padL + 52, ch - 2);
    ctx.fillStyle = 'rgba(80,150,255,0.8)'; ctx.fillText('▮ 降水 mm', padL + 140, ch - 2);

    const wrap = document.createElement('div');
    wrap.className = 'pchart-wrap';
    wrap.appendChild(cv);
    body.innerHTML = '';
    body.appendChild(wrap);
  }

  /* 海浪:Open-Meteo Marine(免费无 key),陆地返回空数据 */
  async _renderWave(body) {
    body.innerHTML = '<div class="spinner"></div><div style="text-align:center;font-size:11.5px;color:var(--text-faint)">获取海浪预报…</div>';
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    let d = null;
    try {
      const r = await fetch(`/api/marine?lat=${this.lat}&lon=${this.lon}`, { signal: ac.signal });
      clearTimeout(timer);
      d = await r.json();
      if (d.error) throw new Error(d.reason || '无数据');
    } catch (e) { clearTimeout(timer); d = null; }
    if (!d || !d.hourly || !d.hourly.wave_height || !d.hourly.wave_height.some((v) => v != null && v > 0)) {
      body.innerHTML = '<p style="color:var(--text-dim);font-size:12.5px;padding:16px 0;text-align:center">该位置无海浪数据(内陆或数据未覆盖)</p>';
      return;
    }
    const times = d.hourly.time;
    const wh = d.hourly.wave_height;
    const wd = d.hourly.wave_direction;
    const wp = d.hourly.wave_period;
    const count = Math.min(times.length, 64);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = 318, ch = 150, padL = 28, padR = 8, padT = 14, padB = 24;
    const cv = document.createElement('canvas');
    cv.width = cw * dpr; cv.height = ch * dpr;
    cv.style.width = '100%';
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const x = (i) => padL + (cw - padL - 8) * i / Math.max(1, count - 1);
    let hMax = 0.5;
    for (let i = 0; i < count; i++) if (wh[i] != null && wh[i] > hMax) hMax = wh[i];
    hMax = Math.ceil(hMax * 1.15);
    const yH = (v) => padT + (ch - padT - padB) * (1 - v / hMax);
    // 波高面积
    ctx.beginPath();
    ctx.moveTo(x(0), ch - padB);
    for (let i = 0; i < count; i++) ctx.lineTo(x(i), yH(wh[i] || 0));
    ctx.lineTo(x(count - 1), ch - padB);
    ctx.closePath();
    ctx.fillStyle = 'rgba(69, 196, 255, 0.25)';
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const v = wh[i] == null ? 0 : wh[i];
      if (i) ctx.lineTo(x(i), yH(v)); else ctx.moveTo(x(i), yH(v));
    }
    ctx.strokeStyle = '#45c4ff'; ctx.lineWidth = 1.6; ctx.stroke();
    // 刻度/标签
    ctx.font = '9px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'right';
    for (const v of [hMax / 2, hMax]) { ctx.fillText(v.toFixed(1) + 'm', padL - 3, yH(v) + 3); }
    ctx.textAlign = 'center';
    for (let i = 0; i < count; i += 12) ctx.fillText(times[i].slice(11, 16), x(i), ch - 8);
    ctx.font = '9.5px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#45c4ff';
    ctx.fillText('波高 m · 箭头=浪向', padL, 10);
    // 浪向箭头(每 8 个)
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < count; i += 8) {
      if (wd[i] == null) continue;
      const cx = x(i), cy = yH(wh[i] || 0) - 9;
      const rad = (wd[i] * Math.PI) / 180; // 来向 → 箭头指向去向
      const dx = -Math.sin(rad), dy = Math.cos(rad);
      ctx.beginPath();
      ctx.moveTo(cx - dx * 4, cy - dy * 4);
      ctx.lineTo(cx + dx * 4, cy + dy * 4);
      ctx.stroke();
    }
    const wrap = document.createElement('div');
    wrap.className = 'pchart-wrap';
    wrap.appendChild(cv);
    body.innerHTML = '';
    body.appendChild(wrap);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:var(--text-faint);margin-top:6px';
    note.textContent = '数据源:Open-Meteo Marine(ECMWF WAM)· 波高 / 浪向 / 周期预报';
    body.appendChild(note);
  }

  _renderDays(body) {
    const d = this.data.daily;
    const times = d.time.map((t) => Date.parse(t + 'T00:00:00'));
    const gMin = Math.min(...d.temperature_2m_min.map(toDeg));
    const gMax = Math.max(...d.temperature_2m_max.map(toDeg));
    const span = Math.max(1, gMax - gMin);
    const rows = times.map((t, i) => {
      const [desc, icon] = wmo(d.weather_code[i]);
      const l = (100 * (toDeg(d.temperature_2m_min[i]) - gMin) / span).toFixed(1);
      const w = (100 * (toDeg(d.temperature_2m_max[i]) - toDeg(d.temperature_2m_min[i])) / span).toFixed(1);
      const name = i === 0 ? '今天' : i === 1 ? '明天' : weekday(t);
      const pp = d.precipitation_probability_max?.[i];
      const ppHtml = pp == null ? '<span class="d-pp" style="color:var(--text-dim)">—</span>' : `<span class="d-pp">💧${pp}%</span>`;
      return `<div class="pday">
        <span class="d-name">${name}</span><span class="d-icon" title="${desc}">${icon}</span>
        ${ppHtml}
        <span class="d-tmin">${Math.round(toDeg(d.temperature_2m_min[i]))}°</span>
        <span class="d-range"><i style="left:${l}%;width:${w}%"></i></span>
        <span class="d-tmax">${Math.round(toDeg(d.temperature_2m_max[i]))}°</span>
      </div>`;
    });
    body.innerHTML = `<div class="pdays">${rows.join('')}</div>
      <div style="font-size:10.5px;color:var(--text-dim);margin-top:8px">日期为当地时间;💧 为降水概率峰值(GFS 自建管道无此项,显示 —)。</div>`;
  }
}

function compass(deg) {
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return dirs[Math.round(((deg % 360) / 45)) % 8] + '风';
}
function modelLabel(d) {
  // Open-Meteo 未直接返回模型名,按请求参数推断由前端展示
  return window.__currentModelLabel || 'Open-Meteo 模式数据';
}
