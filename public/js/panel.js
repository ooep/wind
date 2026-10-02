/* 点位预报面板:当前实况 + 48 小时图表 + 7 天列表 */
import { fetchPoint, fetchPointModel, fetchMarine } from './api.js';
import { nearestAirports, fetchObs, fetchTaf, fetchAirgram, fetchAirQuality, aqiBand, uvBand } from './pointdata.js';
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
    this._tabCache = {};

    document.getElementById('panel-close').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    document.getElementById('panel-fav').addEventListener('click', () => this.toggleFav());
  }

  get isOpen() { return !this.el.hidden; }

  open(lat, lon, name) {
    this.lat = lat; this.lon = lon;
    this.placeName = name || null;
    this.compareData = null;
    this._tabCache = {};
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
        <button data-tab="mg">气象图</button>
        <button data-tab="7d">7 天</button>
        <button data-tab="ag">剖面</button>
        <button data-tab="ap">机场</button>
        <button data-tab="aq">空气</button>
        <button data-tab="cmp">对比</button>
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
    else if (this.tab === 'mg') this._renderMeteogram(body);
    else if (this.tab === 'ag') this._renderAirgram(body);
    else if (this.tab === 'ap') this._renderAirports(body);
    else if (this.tab === 'aq') this._renderAir(body);
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
        const d = await fetchPointModel(this.lat, this.lon, m.id, true);
        clearTimeout(timer);
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
      d = await Promise.race([
        fetchMarine(this.lat, this.lon),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
      ]).catch(() => null);
      clearTimeout(timer);
      if (d && d.error) throw new Error(d.reason || '无数据');
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

  /* ================= 气象图(meteogram):温度/露点/降水/气压/风/云 综合图 ================= */
  _renderMeteogram(body) {
    const d = this.data;
    const allTimes = d.hourly.time.map((t) => Date.parse(t));
    let start = allTimes.findIndex((t) => t >= Date.now() - 3600e3);
    if (start < 0) start = 0;
    const N = Math.min(allTimes.length - start, 56);
    if (N < 4) { body.innerHTML = '<p style="color:var(--text-dim);font-size:12.5px;text-align:center;padding:16px 0">序列数据不足</p>'; return; }
    const sl = (arr) => arr.slice(start, start + N);
    const ms = sl(allTimes);
    const T = sl(d.hourly.temperature_2m);
    const RH = sl(d.hourly.relative_humidity_2m);
    const TD = T.map((t, i) => dewPoint(t, RH[i]));
    const PR = sl(d.hourly.precipitation);
    const WS = sl(d.hourly.wind_speed_10m);
    const WD = sl(d.hourly.wind_direction_10m);
    const CL = sl(d.hourly.cloud_cover);
    const PP = sl(d.hourly.pressure_msl);
    const CODES = sl(d.hourly.weather_code);

    const cw = 318, ch = 320, padL = 26, padR = 30, padT = 26, padB = 66;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = document.createElement('canvas');
    cv.width = cw * dpr; cv.height = ch * dpr;
    cv.style.width = '100%';
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const plotH = ch - padT - padB;
    const x = (i) => padL + (cw - padL - padR) * i / (N - 1);

    // 云量背景(浅灰纱幕)
    for (let i = 0; i < N; i++) {
      if (!CL[i]) continue;
      ctx.fillStyle = `rgba(210,220,235,${(CL[i] / 100 * 0.10).toFixed(3)})`;
      ctx.fillRect(x(i) - (cw - padL - padR) / (N - 1) / 2, padT, (cw - padL - padR) / (N - 1) + 1, plotH);
    }
    // 降水柱(占下半 45%)
    const pMax = Math.max(1, ...PR.filter((v) => v != null));
    const y0 = ch - padB, prZone = plotH * 0.45;
    for (let i = 0; i < N; i++) {
      if (!PR[i]) continue;
      const h = prZone * (PR[i] / pMax);
      ctx.fillStyle = 'rgba(80,150,255,0.55)';
      ctx.fillRect(x(i) - 2, y0 - h, 4, h);
    }
    // 气压线(右轴)
    let pMin = Infinity, pMaxP = -Infinity;
    for (const v of PP) if (v != null) { pMin = Math.min(pMin, v); pMaxP = Math.max(pMaxP, v); }
    pMin = Math.floor(pMin) - 1; pMaxP = Math.ceil(pMaxP) + 1;
    const yP = (v) => padT + plotH * (1 - (v - pMin) / (pMaxP - pMin)) * 0.8;
    ctx.beginPath();
    let pen = false;
    PP.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      if (!pen) { ctx.moveTo(x(i), yP(v)); pen = true; } else ctx.lineTo(x(i), yP(v));
    });
    ctx.strokeStyle = 'rgba(195,155,255,0.65)'; ctx.lineWidth = 1.1; ctx.stroke();

    // 温度/露点曲线(左轴)
    const tAll = [...T, ...TD].filter((v) => v != null);
    const tMin = Math.floor(Math.min(...tAll) / 5) * 5 - 2;
    const tMax = Math.ceil(Math.max(...tAll) / 5) * 5 + 2;
    const yT = (v) => padT + plotH * (1 - (v - tMin) / (tMax - tMin));
    ctx.font = '9px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    for (let v = Math.ceil(tMin / 5) * 5; v <= tMax; v += 5) {
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.moveTo(padL, yT(v)); ctx.lineTo(cw - padR, yT(v)); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(Math.round(toDeg(v)) + '°', padL - 3, yT(v) + 3);
    }
    const line = (arr, color, dash) => {
      ctx.beginPath();
      let p = false;
      arr.forEach((v, i) => {
        if (v == null || Number.isNaN(v)) { p = false; return; }
        if (!p) { ctx.moveTo(x(i), yT(v)); p = true; } else ctx.lineTo(x(i), yT(v));
      });
      ctx.strokeStyle = color; ctx.lineWidth = 1.8;
      ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
    };
    line(TD, 'rgba(79,209,165,0.85)', [4, 3]);
    line(T, '#ffb454');

    // 气压右轴刻度
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(195,155,255,0.5)';
    for (const v of [pMin + 1, (pMin + pMaxP) / 2, pMaxP - 1]) {
      ctx.fillText(String(Math.round(v)), cw - padR + 3, yP(v) + 3);
    }

    // 天气图标(每天正午列)
    ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    for (let i = 0; i < N; i++) {
      const dt = new Date(ms[i]);
      if (dt.getHours() === 12 && i < N - 1) ctx.fillText(wmo(CODES[i])[1], x(i), padT - 8);
    }
    // 日期分隔与标签
    ctx.font = '9px -apple-system, sans-serif';
    for (let i = 0; i < N; i++) {
      const dt = new Date(ms[i]);
      if (dt.getHours() === 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.beginPath(); ctx.moveTo(x(i), padT); ctx.lineTo(x(i), ch - 14); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillText(weekday(ms[i]), Math.min(x(i) + 14, cw - padR - 10), padT + 8);
      }
    }
    // 风向杆带(底部,每 2 列)
    const wBand = y0 + 8, wH = 30;
    ctx.strokeStyle = 'rgba(140,200,255,0.25)';
    ctx.beginPath(); ctx.moveTo(padL, wBand - 4); ctx.lineTo(cw - padR, wBand - 4); ctx.stroke();
    ctx.font = '8.5px -apple-system, sans-serif';
    for (let i = 0; i < N; i += 2) {
      if (WD[i] == null || WS[i] == null) continue;
      const cx = x(i), cy = wBand + wH / 2 - 6;
      const rad = ((WD[i] + 180) % 360) * Math.PI / 180; // 来向 → 箭头指向去向
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(rad + Math.PI / 2);
      ctx.strokeStyle = 'rgba(140,200,255,0.9)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(0, -4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(-2.4, -1); ctx.moveTo(0, -4); ctx.lineTo(2.4, -1); ctx.stroke();
      ctx.restore();
      if (i % 4 === 0) {
        ctx.fillStyle = 'rgba(170,215,255,0.85)';
        ctx.fillText(String(Math.round(WS[i])), cx, wBand + wH);
      }
    }
    // 时间标签
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < N; i += 4) ctx.fillText(fmtHourLocal(ms[i]), x(i), ch - 3);
    // 图例
    ctx.textAlign = 'left';
    ctx.font = '9px -apple-system, sans-serif';
    ctx.fillStyle = '#ffb454'; ctx.fillText('— 温度', padL, ch - padB + 2);
    ctx.fillStyle = 'rgba(79,209,165,0.85)'; ctx.fillText('-- 露点', padL + 40, ch - padB + 2);
    ctx.fillStyle = 'rgba(80,150,255,0.8)'; ctx.fillText('▮降水', padL + 80, ch - padB + 2);
    ctx.fillStyle = 'rgba(195,155,255,0.75)'; ctx.fillText('—气压', padL + 116, ch - padB + 2);
    ctx.fillStyle = 'rgba(140,200,255,0.9)'; ctx.fillText('↑风向风速 m/s', padL + 152, ch - padB + 2);

    const wrap = document.createElement('div');
    wrap.className = 'pchart-wrap';
    wrap.appendChild(cv);
    body.innerHTML = '';
    body.appendChild(wrap);
  }

  /* ================= 剖面(airgram):气压层 × 时间 高空剖面 ================= */
  async _renderAirgram(body) {
    const ckey = `${this.lat.toFixed(2)},${this.lon.toFixed(2)}`;
    if (this._tabCache.airgram?.key === ckey) { this._drawAirgram(body, this._tabCache.airgram.data); return; }
    body.innerHTML = '<div class="spinner"></div><div style="text-align:center;font-size:11.5px;color:var(--text-faint)">获取气压层数据…</div>';
    try {
      const data = await fetchAirgram(this.lat, this.lon);
      this._tabCache.airgram = { key: ckey, data };
      if (this.tab !== 'ag') return;
      this._drawAirgram(body, data);
    } catch (e) {
      body.innerHTML = `<p style="color:var(--text-dim);font-size:12.5px;padding:16px 0;text-align:center">${e.message}</p>`;
    }
  }

  _drawAirgram(body, ag) {
    const { levels, levelAlt, h } = ag;
    const times = h.time.map((t) => Date.parse(t + 'Z'));
    let start = times.findIndex((t) => t >= Date.now() - 3600e3);
    if (start < 0) start = 0;
    const N = Math.min(times.length - start, 16); // 48h × 3h
    const rows = levels.length;
    const cw = 318, ch = 268, padL = 40, padR = 10, padT = 20, padB = 22;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = document.createElement('canvas');
    cv.width = cw * dpr; cv.height = ch * dpr;
    cv.style.width = '100%';
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const plotW = cw - padL - padR, plotH = ch - padT - padB;
    // y:气压对数刻度(1000 底 → 150 顶)
    const yOf = (p) => padT + plotH * (Math.log(p) - Math.log(levels[rows - 1])) / (Math.log(levels[0]) - Math.log(levels[rows - 1]));
    const x = (i) => padL + plotW * i / (N - 1);
    const cellW = plotW / (N - 1), rowH = plotH / (rows - 1);
    const tempAt = (li, i) => h[`temperature_${levels[li]}hPa`]?.[start + i];

    // 温度填色 + 云量纱幕
    for (let li = 0; li < rows - 1; li++) {
      for (let i = 0; i < N - 1; i++) {
        const t = tempAt(li, i);
        if (t == null) continue;
        const [r, g, b] = TEMP.color(t);
        ctx.fillStyle = `rgba(${r},${g},${b},0.55)`;
        ctx.fillRect(x(i) - cellW / 2, yOf(levels[li]) - rowH / 2 * 0, cellW + 1, yOf(levels[li + 1]) - yOf(levels[li]) + 1);
        const cc = h[`cloudcover_${levels[li]}hPa`]?.[start + i];
        if (cc) {
          ctx.fillStyle = `rgba(205,215,230,${(cc / 100 * 0.4).toFixed(3)})`;
          ctx.fillRect(x(i) - cellW / 2, yOf(levels[li]), cellW + 1, yOf(levels[li + 1]) - yOf(levels[li]) + 1);
        }
      }
    }
    // 0°C 线(逐列在相邻层间插值)
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < N; i++) {
      let fy = null;
      for (let li = 0; li < rows - 1; li++) {
        const t0 = tempAt(li, i), t1 = tempAt(li + 1, i);
        if (t0 == null || t1 == null) continue;
        if ((t0 <= 0 && t1 > 0) || (t0 > 0 && t1 <= 0)) {
          const f = (0 - t0) / (t1 - t0);
          fy = yOf(levels[li]) + f * (yOf(levels[li + 1]) - yOf(levels[li]));
          break;
        }
      }
      if (fy == null) { pen = false; continue; }
      if (!pen) { ctx.moveTo(x(i), fy); pen = true; } else ctx.lineTo(x(i), fy);
    }
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);

    // 风箭头(每 2 列)
    for (let li = 0; li < rows; li++) {
      for (let i = 0; i < N; i += 2) {
        const wd = h[`winddirection_${levels[li]}hPa`]?.[start + i];
        const ws = h[`windspeed_${levels[li]}hPa`]?.[start + i];
        if (wd == null || ws == null || ws < 2) continue;
        ctx.save();
        ctx.translate(x(i), yOf(levels[li]));
        ctx.rotate(((wd + 180) % 360) * Math.PI / 180);
        const len = Math.min(3 + ws * 0.28, 8);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, len / 2); ctx.lineTo(0, -len / 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -len / 2); ctx.lineTo(-1.8, -len / 2 + 2); ctx.moveTo(0, -len / 2); ctx.lineTo(1.8, -len / 2 + 2); ctx.stroke();
        ctx.restore();
      }
    }
    // 层标签(左)
    ctx.font = '8.5px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    for (let li = 0; li < rows; li++) {
      const p = levels[li];
      const alt = levelAlt[p];
      const altS = alt >= 10000 ? `${(alt / 1000).toFixed(0)}km` : `${alt}m`;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(String(p), padL - 4, yOf(p) + 3);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillText(altS, padL - 4, yOf(p) + 11);
    }
    // 时间标签
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < N; i += 4) ctx.fillText(fmtHourLocal(times[start + i]), x(i), ch - 8);
    // 图例
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('温度填色 · 白虚线=0°C · 箭头=风向风速', padL, 11);

    const wrap = document.createElement('div');
    wrap.className = 'pchart-wrap';
    wrap.appendChild(cv);
    body.innerHTML = '';
    body.appendChild(wrap);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:var(--text-faint);margin-top:6px';
    note.textContent = '数据源:Open-Meteo(GFS 气压层)· 1000→150 hPa 对数高度轴';
    body.appendChild(note);
  }

  /* ================= 机场:最近机场 METAR/TAF ================= */
  async _renderAirports(body) {
    const ckey = `${this.lat.toFixed(2)},${this.lon.toFixed(2)}`;
    if (!this._tabCache.ap || this._tabCache.ap.key !== ckey) {
      body.innerHTML = '<div class="spinner"></div><div style="text-align:center;font-size:11.5px;color:var(--text-faint)">检索附近机场与观测…</div>';
      try {
        const [airports, obs] = await Promise.all([nearestAirports(this.lat, this.lon, 8), fetchObs()]);
        const stMap = {};
        for (const s of obs.stations || []) stMap[s.i] = s;
        const rows = airports.map((a) => ({ a, st: stMap[a.icao] || null }));
        const taf = await fetchTaf(rows.map((r) => r.a.icao));
        this._tabCache.ap = { key: ckey, rows, obsAt: obs.generated };
        this._tabCache.taf = taf;
      } catch (e) {
        body.innerHTML = `<p style="color:var(--text-dim);font-size:12.5px;padding:16px 0;text-align:center">${e.message}</p>`;
        return;
      }
    }
    const { rows, obsAt } = this._tabCache.ap;
    const taf = this._tabCache.taf || {};
    const obsAge = obsAt ? fmtHourLocal(obsAt * 1000) : null;
    const html = rows.map(({ a, st }) => {
      const fr = st ? flightRule(st.raw) : null;
      const frChip = fr ? `<i class="ap-chip" style="background:${FLIGHT_RULES[fr]}22;color:${FLIGHT_RULES[fr]};border-color:${FLIGHT_RULES[fr]}55">${fr}</i>` : '';
      const metar = st ? [
        `风 ${st.wd == null ? '不定' : Math.round(st.wd) + '°'} ${st.ws == null ? '—' : (st.ws * 0.514).toFixed(1)}m/s${st.wg ? ' 阵' + (st.wg * 0.514).toFixed(0) : ''}`,
        `能见度 ${visDisp(st.vis)}`,
        st.t != null ? `${Math.round(toDeg(st.t))}°/${st.td != null ? Math.round(toDeg(st.td)) + '°' : '—'}` : null,
        st.p != null ? `Q${Math.round(st.p)}` : null,
        st.wx || '',
      ].filter(Boolean).join(' · ') : '暂无该站观测';
      const dist = a.d < 1 ? '<1' : Math.round(a.d);
      return `<div class="ap-row">
        <div class="ap-head">
          <b>${a.icao}${a.iata ? '/' + a.iata : ''}</b>
          <span class="ap-name">${a.city || a.name}</span>
          <span class="ap-dist">${dist} km</span>
          ${frChip}
        </div>
        <div class="ap-metar">${metar}</div>
        ${st?.raw ? `<div class="ap-raw" hidden>${st.raw}</div>` : ''}
        ${taf[a.icao] ? `<div class="ap-taf" hidden><pre>${taf[a.icao][3]}</pre></div>` : ''}
        <div class="ap-links">
          ${st?.raw ? '<button class="ap-x" data-x="raw">原文</button>' : ''}
          ${taf[a.icao] ? '<button class="ap-x" data-x="taf">TAF 预报</button>' : ''}
        </div>
      </div>`;
    }).join('');
    body.innerHTML = `<div class="ap-list">${html}</div>
      <div style="font-size:10.5px;color:var(--text-faint);margin-top:8px;text-align:center">
      METAR/TAF:aviationweather.gov(NOAA,公有领域)${obsAge ? ` · 观测更新于 ${obsAge}` : ''}</div>`;
    body.querySelectorAll('.ap-row').forEach((row) => {
      row.querySelectorAll('.ap-x').forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = row.querySelector(btn.dataset.x === 'raw' ? '.ap-raw' : '.ap-taf');
          if (target) target.hidden = !target.hidden;
        });
      });
    });
  }

  /* ================= 空气:US AQI / PM / UV / 花粉 ================= */
  async _renderAir(body) {
    const ckey = `${this.lat.toFixed(2)},${this.lon.toFixed(2)}`;
    if (!this._tabCache.aq || this._tabCache.aq.key !== ckey) {
      body.innerHTML = '<div class="spinner"></div><div style="text-align:center;font-size:11.5px;color:var(--text-faint)">获取空气质量与 UV…</div>';
      try {
        const d = await fetchAirQuality(this.lat, this.lon);
        this._tabCache.aq = { key: ckey, d };
      } catch (e) {
        body.innerHTML = `<p style="color:var(--text-dim);font-size:12.5px;padding:16px 0;text-align:center">${e.message}</p>`;
        return;
      }
    }
    const h = this._tabCache.aq.d.hourly;
    const times = h.time.map((t) => Date.parse(t));
    let start = times.findIndex((t) => t >= Date.now() - 3600e3);
    if (start < 0) start = 0;
    const N = Math.min(times.length - start, 48);
    const sl = (arr) => (arr || []).slice(start, start + N);
    const cur = (k) => {
      const arr = h[k] || [];
      for (let i = start; i < arr.length; i++) if (arr[i] != null) return arr[i];
      return null;
    };
    const aqi = cur('us_aqi');
    const band = aqiBand(aqi);
    const uv = cur('uv_index');
    const uvb = uvBand(uv);
    const stats = [
      ['PM2.5', cur('pm2_5'), 'μg/m³'], ['PM10', cur('pm10'), 'μg/m³'],
      ['臭氧 O₃', cur('ozone'), 'μg/m³'], ['二氧化氮', cur('nitrogen_dioxide'), 'μg/m³'],
      ['二氧化硫', cur('sulphur_dioxide'), 'μg/m³'], ['沙尘', cur('dust'), 'μg/m³'],
    ];
    const pollenKeys = [['grass_pollen', '草'], ['birch_pollen', '桦树'], ['mugwort_pollen', '艾草'], ['olive_pollen', '橄榄'], ['ragweed_pollen', '豚草'], ['alder_pollen', '桤木']];
    const pollen = pollenKeys.map(([k, zh]) => [zh, cur(k)]).filter((x) => x[1] != null);

    const statsHtml = `<div class="pgrid">
      <div class="pstat" style="border:1px solid ${band ? band.color + '66' : 'transparent'}"><b style="color:${band ? band.color : 'inherit'}">${aqi == null ? '—' : Math.round(aqi)}</b><span>US AQI${band ? ' · ' + band.label : ''}</span></div>
      <div class="pstat"><b style="color:${uvb ? uvb.color : 'inherit'}">${uv == null ? '—' : uv.toFixed(1)}</b><span>UV 指数${uvb ? ' · ' + uvb.label : ''}</span></div>
      ${stats.map(([zh, v, u]) => `<div class="pstat"><b>${v == null ? '—' : Math.round(v)}</b><span>${zh} ${u}</span></div>`).join('')}
    </div>`;

    const cw = 318, chA = 120, padL = 30, padR = 8, padT = 14, padB = 20;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const mkCanvas = (ch) => {
      const cv = document.createElement('canvas');
      cv.width = cw * dpr; cv.height = ch * dpr;
      cv.style.width = '100%';
      const ctx = cv.getContext('2d');
      ctx.scale(dpr, dpr);
      return [cv, ctx];
    };
    const x = (i) => padL + (cw - padL - padR) * i / Math.max(1, N - 1);

    // AQI 曲线(按分级着色)+ PM2.5 柱
    const AQ = sl(h.us_aqi), PM = sl(h.pm2_5);
    const aqiMax = Math.max(50, ...AQ.filter((v) => v != null)) * 1.15;
    const [cvA, ctxA] = mkCanvas(chA);
    const yA = (v) => padT + (chA - padT - padB) * (1 - v / aqiMax);
    ctxA.font = '9px -apple-system, sans-serif';
    for (const b of AQI_BANDS_LABELLED) {
      if (b.lo >= aqiMax) continue;
      ctxA.fillStyle = b.color + '18';
      ctxA.fillRect(padL, yA(Math.min(b.hi, aqiMax)), cw - padL - padR, yA(b.lo) - yA(Math.min(b.hi, aqiMax)));
      ctxA.fillStyle = b.color + 'cc';
      ctxA.textAlign = 'right';
      ctxA.fillText(b.zh, padL - 3, yA(Math.min(b.hi, aqiMax)) + 8);
    }
    const bw = Math.max(2, (cw - padL - padR) / N - 1);
    for (let i = 0; i < N; i++) {
      if (!PM[i]) continue;
      const hh = (chA - padT - padB) * (PM[i] / Math.max(1, ...PM)) * 0.5;
      ctxA.fillStyle = 'rgba(120,160,220,0.4)';
      ctxA.fillRect(x(i) - bw / 2, chA - padB - hh, bw, hh);
    }
    ctxA.beginPath();
    let pen = false;
    AQ.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      const band2 = aqiBand(v);
      if (!pen) { ctxA.moveTo(x(i), yA(v)); pen = true; } else ctxA.lineTo(x(i), yA(v));
    });
    ctxA.strokeStyle = '#ffb454'; ctxA.lineWidth = 1.6; ctxA.stroke();
    ctxA.fillStyle = 'rgba(255,255,255,0.4)'; ctxA.textAlign = 'center';
    for (let i = 0; i < N; i += 8) ctxA.fillText(fmtHourLocal(times[start + i]), x(i), chA - 6);

    // UV 曲线
    const UV = sl(h.uv_index);
    const uvMax = Math.max(6, ...UV.filter((v) => v != null)) * 1.15;
    const chU = 88;
    const [cvU, ctxU] = mkCanvas(chU);
    const yU = (v) => padT + (chU - padT - padB) * (1 - v / uvMax);
    ctxU.font = '9px -apple-system, sans-serif';
    for (const b of UV_BANDS_LABELLED) {
      if (b.lo >= uvMax) continue;
      ctxU.fillStyle = b.color + '15';
      ctxU.fillRect(padL, yU(Math.min(b.hi, uvMax)), cw - padL - padR, yU(b.lo) - yU(Math.min(b.hi, uvMax)));
    }
    ctxU.beginPath();
    pen = false;
    UV.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      if (!pen) { ctxU.moveTo(x(i), yU(v)); pen = true; } else ctxU.lineTo(x(i), yU(v));
    });
    ctxU.strokeStyle = '#ffd257'; ctxU.lineWidth = 1.6; ctxU.stroke();
    ctxU.fillStyle = 'rgba(255,255,255,0.4)'; ctxU.textAlign = 'right';
    ctxU.fillText(String(Math.round(uvMax)), padL - 3, yU(uvMax) + 3);
    ctxU.fillStyle = 'rgba(255,210,87,0.9)'; ctxU.textAlign = 'left';
    ctxU.fillText('UV 指数(48h)', padL, 10);

    body.innerHTML = '';
    body.insertAdjacentHTML('beforeend', statsHtml);
    const wA = document.createElement('div');
    wA.className = 'pchart-wrap';
    wA.appendChild(cvA);
    body.appendChild(wA);
    const wU = document.createElement('div');
    wU.className = 'pchart-wrap';
    wU.appendChild(cvU);
    body.appendChild(wU);
    if (pollen.length) {
      body.insertAdjacentHTML('beforeend', `<div class="pgrid" style="margin-top:8px">${pollen.map(([zh, v]) =>
        `<div class="pstat"><b>${v.toFixed(0)}</b><span>${zh}花粉 粒/m³</span></div>`).join('')}</div>`);
    }
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:var(--text-faint);margin:8px 0 4px;text-align:center';
    note.textContent = '数据源:Open-Meteo Air Quality(CAMS 全球)· 灰柱=PM2.5 相对量';
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

/* ---------- 气象图:露点(Magnus) ---------- */
function dewPoint(tC, rh) {
  if (!Number.isFinite(tC) || !Number.isFinite(rh)) return NaN;
  const a = 17.62, b = 243.12;
  const g = Math.log(Math.max(1, rh) / 100) + (a * tC) / (b + tC);
  return (b * g) / (a - g);
}

/* ---------- 机场:能见度显示(SM → km) ---------- */
function visDisp(visSM) {
  if (visSM == null) return '—';
  const s = String(visSM).trim();
  const frac = s.match(/^(\d+)\/(\d+)/);
  if (frac) return `${(frac[1] / frac[2] * 1.609).toFixed(2)} km`;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return s;
  const km = n * 1.609;
  if (s.includes('+') || n >= 10) return '≥10 km';
  return `${km.toFixed(km < 2 ? 2 : 1)} km`;
}

/* ---------- 机场:由原始 METAR 推算飞行规则(VFR/MVFR/IFR/LIFR) ---------- */
const FLIGHT_RULES = { VFR: '#7ddc9a', MVFR: '#6db8ff', IFR: '#ff6b5e', LIFR: '#c39bff' };
function flightRule(raw) {
  if (!raw) return null;
  const r = String(raw);
  if (/\bCAVOK\b/.test(r)) return 'VFR';
  let visMi = Infinity;
  const meters = r.match(/\s(\d{4})\s/);           // ICAO 米制能见度(9999=≥10km)
  const sm = r.match(/\s(P?M?\d{1,2}(?:\/\d)?|\d\/\d)SM/);
  const smFrac = r.match(/\s(\d)\/(\d)SM/);
  if (meters) visMi = Number(meters[1]) >= 9999 ? Infinity : Number(meters[1]) / 1609;
  else if (smFrac) visMi = Number(smFrac[1]) / Number(smFrac[2]);
  else if (sm) {
    const v = parseFloat(sm[1].replace(/^[PM]/, ''));
    visMi = Number.isFinite(v) ? (v >= 6 ? Infinity : v) : Infinity;
  }
  let ceil = Infinity;
  for (const m of r.matchAll(/\b(?:BKN|OVC)(\d{3})/g)) ceil = Math.min(ceil, Number(m[1]) * 100);
  const vv = r.match(/\bVV(\d{3})/);
  if (vv) ceil = Math.min(ceil, Number(vv[1]) * 100);
  if (visMi < 1 || ceil < 500) return 'LIFR';
  if (visMi < 3 || ceil < 1000) return 'IFR';
  if (visMi <= 5 || ceil <= 3000) return 'MVFR';
  return 'VFR';
}

/* ---------- 空气:AQI/UV 分级带(图表背景) ---------- */
const AQI_BANDS_LABELLED = [
  { lo: 0, hi: 50, zh: '优', color: '#7ddc9a' }, { lo: 50, hi: 100, zh: '良', color: '#ffd257' },
  { lo: 100, hi: 150, zh: '轻度', color: '#ff9f43' }, { lo: 150, hi: 200, zh: '中度', color: '#ff6b5e' },
  { lo: 200, hi: 300, zh: '重度', color: '#c39bff' },
];
const UV_BANDS_LABELLED = [
  { lo: 0, hi: 3, color: '#7ddc9a' }, { lo: 3, hi: 6, color: '#ffd257' },
  { lo: 6, hi: 8, color: '#ff9f43' }, { lo: 8, hi: 11, color: '#ff6b5e' },
  { lo: 11, hi: 999, color: '#c39bff' },
];
