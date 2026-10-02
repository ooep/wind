/* 单位注册表:全局单位制状态 + 换算 + 持久化(hash u= 参数 + localStorage)
 * 图例/悬停读数/时间轴/面板实况块统一从这里取单位,设置弹层按分组切换。 */

const CATS = {
  temp: { row: '温度', opts: ['C', 'F'], labels: { C: '°C', F: '°F' } },
  wind: { row: '风速', opts: ['ms', 'kmh', 'kt', 'mph'], labels: { ms: 'm/s', kmh: 'km/h', kt: '节', mph: 'mph' } },
  pressure: { row: '气压', opts: ['hpa', 'inhg'], labels: { hpa: 'hPa', inhg: 'inHg' } },
  precip: { row: '降水', opts: ['mm', 'in'], labels: { mm: 'mm', in: 'in' } },
  timefmt: { row: '时间制', opts: ['24h', '12h'], labels: { '24h': '24 小时', '12h': '12 小时' } },
  tz: { row: '时区', opts: ['local', 'utc'], labels: { local: '本地', utc: 'UTC' } },
};

export const units = { temp: 'C', wind: 'ms', pressure: 'hpa', precip: 'mm', timefmt: '24h', tz: 'local' };

/* 基准量纲:温度 °C、风 m/s、气压 hPa、降水 mm */
const CONV = {
  temp: { C: (v) => v, F: (v) => v * 9 / 5 + 32 },
  wind: { ms: (v) => v, kmh: (v) => v * 3.6, kt: (v) => v * 1.94384, mph: (v) => v * 2.23694 },
  pressure: { hpa: (v) => v, inhg: (v) => v * 0.02952998 },
  precip: { mm: (v) => v, in: (v) => v / 25.4 },
};

export const convV = (cat, v) => CONV[cat][units[cat]](v);
export const unitLabel = (cat) => CATS[cat].labels[units[cat]];

/* 气压/降水的整编字符串(hPa 取整;inHg 两位小数;mm 一位/取整,in 自适应) */
export function fmtPresStr(hpa) {
  return units.pressure === 'inhg' ? convV('pressure', hpa).toFixed(2) : String(Math.round(hpa));
}
export function fmtPrecipStr(mm) {
  if (units.precip === 'in') { const i = mm / 25.4; return i < 0.5 ? i.toFixed(2) : String(Math.round(i)); }
  return mm < 1 ? mm.toFixed(1) : String(Math.round(mm));
}

/* ---------- 时区感知的时间部件(时间轴/气泡用) ---------- */
export function tzOffsetMin(ms) { return units.tz === 'utc' ? 0 : -new Date(ms).getTimezoneOffset(); }
export function tzParts(ms) {
  const d = new Date(ms + tzOffsetMin(ms) * 60000);
  return { m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes(), wd: d.getUTCDay() };
}
const p2 = (n) => String(n).padStart(2, '0');
export function fmtClock(ms) {
  const P = tzParts(ms);
  if (units.timefmt === '12h') {
    const h12 = P.h % 12 || 12;
    return `${h12}:${p2(P.min)} ${P.h < 12 ? 'AM' : 'PM'}`;
  }
  return `${p2(P.h)}:${p2(P.min)}`;
}
export function fmtDateParts(ms) {
  const P = tzParts(ms);
  return `${p2(P.m + 1)}-${p2(P.d)}`;
}

/* ---------- 持久化与通知 ---------- */
let listeners = [];
export function onUnits(cb) { listeners.push(cb); }
function notify() { for (const cb of listeners) cb(); }

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem('fy_units') || 'null');
    if (saved) for (const k of Object.keys(CATS)) if (CATS[k].opts.includes(saved[k])) units[k] = saved[k];
  } catch { /* 隐私模式 */ }
  try {
    const u = new URLSearchParams(location.hash.slice(1)).get('u');
    if (u) for (const pair of u.split(',')) {
      const [k, v] = pair.split(':');
      if (CATS[k] && CATS[k].opts.includes(v)) units[k] = v;
    }
  } catch { /* 忽略非法 hash */ }
}
export function unitsHash() {
  const parts = [];
  for (const k of Object.keys(CATS)) if (units[k] !== CATS[k].opts[0]) parts.push(`${k}:${units[k]}`);
  return parts.join(',');
}
function persist() {
  try { localStorage.setItem('fy_units', JSON.stringify(units)); } catch { /* 隐私模式 */ }
}

export function setUnit(cat, opt) {
  if (!CATS[cat] || !CATS[cat].opts.includes(opt) || units[cat] === opt) return;
  units[cat] = opt;
  persist();
  renderPop();
  notify();
}
export function cycleUnit(cat) {
  const opts = CATS[cat].opts;
  setUnit(cat, opts[(opts.indexOf(units[cat]) + 1) % opts.length]);
}

/* ---------- 设置弹层(挂在 #settings 内,分组 × 分段按钮) ---------- */
let popBuilt = false;
export function initUnits() {
  load();
  const btn = document.getElementById('units-btn');
  const pop = document.getElementById('units-pop');
  if (!btn || !pop) return;
  if (!popBuilt) {
    popBuilt = true;
    btn.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; renderPop(); });
    pop.addEventListener('click', (e) => e.stopPropagation());
  }
  renderPop();
}
function renderPop() {
  const pop = document.getElementById('units-pop');
  if (!pop || pop.hidden) return;
  pop.innerHTML = Object.keys(CATS).map((cat) => `
    <div class="up-row"><span>${CATS[cat].row}</span>
      <div class="up-opts">${CATS[cat].opts.map((o) =>
        `<button data-cat="${cat}" data-opt="${o}" class="${units[cat] === o ? 'active' : ''}">${CATS[cat].labels[o]}</button>`).join('')}
      </div>
    </div>`).join('');
  pop.querySelectorAll('.up-opts button').forEach((b) => {
    b.addEventListener('click', () => setUnit(b.dataset.cat, b.dataset.opt));
  });
}
