/* 时间轴:统一时间源,驱动填色层 / 粒子 / 等压线 / 雷达
 * Windy 式:日期表头 + 周末高亮 + 拖动双时区气泡 + 播放速度 + 数据窗分段着色 + 回当前浮钮 */
import { clamp, weekdayNames } from './util.js';
import { t } from './i18n.js';
import { units, tzParts, fmtClock, fmtDateParts } from './units.js';

const PLAY_SPEED = 2.6 * 3600e3; // 1× 播放速度:每秒前进 2.6 小时
const p2 = (n) => String(n).padStart(2, '0');

export class Timeline {
  constructor({ onChange }) {
    this.onChange = onChange;
    this.times = null;
    this.pos = Date.now();
    this.playing = false;
    this._raf = null;
    this._lastT = 0;
    this.speed = 1;          // 播放倍速
    this.dataWindow = null;  // {past, fcst} 雷达等观测数据的有效窗

    this.el = document.getElementById('timeline');
    this.track = document.getElementById('tl-track');
    this.ticks = document.getElementById('tl-ticks');
    this.nowEl = document.getElementById('tl-now');
    this.thumb = document.getElementById('tl-thumb');
    this.progress = document.createElement('div');
    this.progress.id = 'tl-progress';
    this.track.appendChild(this.progress);
    this.segPast = document.getElementById('tl-datapast');
    this.segFcst = document.getElementById('tl-datafcst');

    this.playBtn = document.getElementById('play-btn');
    this.iconPlay = document.getElementById('icon-play');
    this.iconPause = document.getElementById('icon-pause');
    this.timeMain = document.getElementById('time-main');
    this.timeSub = document.getElementById('time-sub');
    this.bubble = document.getElementById('tl-bubble');
    this.bubA = document.getElementById('tb-a');
    this.bubB = document.getElementById('tb-b');
    this.fab = document.getElementById('now-fab');

    this.playBtn.addEventListener('click', () => this.togglePlay());
    document.getElementById('step-back').addEventListener('click', () => this.nudge(-1));
    document.getElementById('step-fwd').addEventListener('click', () => this.nudge(1));
    document.getElementById('step-now').addEventListener('click', () => this.goNow());
    this.fab.addEventListener('click', () => this.goNow());

    // 播放倍速(仅桌面显示,持久化)
    const speedBox = document.getElementById('tl-speed');
    const saved = parseFloat(localStorage.getItem('fy_speed'));
    if ([0.5, 1, 2].includes(saved)) this.speed = saved;
    this._syncSpeedBtns(speedBox);
    speedBox.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-s]');
      if (!b) return;
      this.speed = parseFloat(b.dataset.s);
      try { localStorage.setItem('fy_speed', String(this.speed)); } catch { /* 隐私模式 */ }
      this._syncSpeedBtns(speedBox);
    });

    // 拖动 / 点击(rAF 节流,拖动中每帧最多渲染一次)
    let dragging = false;
    let pendingFrac = null;
    let seekRaf = 0;
    const fracOf = (e) => {
      const rect = this.track.getBoundingClientRect();
      return clamp((e.clientX - rect.left) / rect.width, 0, 1);
    };
    const seekFromEvent = (e) => {
      if (!this.times) return;
      const f = fracOf(e);
      this.setPos(this.times[0] + f * (this.times[this.times.length - 1] - this.times[0]));
    };
    this.el.addEventListener('pointerdown', (e) => {
      dragging = true; this.el.setPointerCapture(e.pointerId);
      this.pause(); seekFromEvent(e);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!dragging || !this.times) return;
      pendingFrac = fracOf(e);
      if (seekRaf) return;
      seekRaf = requestAnimationFrame(() => {
        seekRaf = 0;
        if (!dragging || pendingFrac == null) return;
        this.setPos(this.times[0] + pendingFrac * (this.times[this.times.length - 1] - this.times[0]));
      });
    });
    const endDrag = () => { dragging = false; };
    this.el.addEventListener('pointerup', endDrag);
    this.el.addEventListener('pointercancel', endDrag);

    setInterval(() => this._refreshNowMarker(), 60_000);
    this._refreshNowMarker();

    // 窗口尺寸变化时按轨道宽度重建刻度(标签密度自适应)
    window.addEventListener('resize', () => this._buildTicks());
  }

  _syncSpeedBtns(box) {
    box.querySelectorAll('button[data-s]').forEach((b) =>
      b.classList.toggle('active', parseFloat(b.dataset.s) === this.speed));
  }

  /* 观测层(雷达)数据有效窗:past 毫秒历史 + fcst 毫秒外推 */
  setDataWindow(w) {
    this.dataWindow = w;
    this._render();
  }

  /* 单位/时区变更后重建刻度并重绘当前时刻 */
  refresh() {
    if (!this.times) return;
    this._buildTicks();
    this._render();
  }

  setTimes(times) {
    this.times = times;
    this._buildTicks();
    if (this.pos < times[0] || this.pos > times[times.length - 1]) this.goNow();
    else this._render();
  }

  goNow() {
    if (!this.times) return;
    this.pause();
    const now = Date.now();
    this.setPos(clamp(now, this.times[0], this.times[this.times.length - 1]));
  }

  nudge(hours) {
    if (!this.times) return;
    this.setPos(clamp(this.pos + hours * 3600e3, this.times[0], this.times[this.times.length - 1]));
  }

  setPos(ms) {
    this.pos = ms;
    this._render();
    if (!this.playing) this._showBubble();
    this.onChange(ms);
  }

  togglePlay() { this.playing ? this.pause() : this.play(); }

  play() {
    if (!this.times || this.playing) return;
    this.playing = true;
    this.iconPlay.style.display = 'none';
    this.iconPause.style.display = 'block';
    if (this.pos >= this.times[this.times.length - 1] - 3600e3) {
      this.setPos(this.times[0]); // 播到头则从头开始
    }
    this._lastT = performance.now();
    const loop = (t) => {
      if (!this.playing) return;
      const dt = t - this._lastT;
      this._lastT = t;
      let next = this.pos + dt * PLAY_SPEED * this.speed / 1000;
      if (next >= this.times[this.times.length - 1]) next = this.times[0];
      this.setPos(next);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  pause() {
    this.playing = false;
    this.iconPlay.style.display = 'block';
    this.iconPause.style.display = 'none';
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _range() { return this.times ? this.times[this.times.length - 1] - this.times[0] : 0; }

  /* 日期表头 + 周末底色 + 小时刻度,一次遍历逐小时扫描(自动兼容夏令时的 23/25 小时日) */
  _buildTicks() {
    const times = this.times;
    const span = this._range();
    this.ticks.innerHTML = '';
    if (!times || span <= 0) return;
    const start = times[0];
    const end = times[times.length - 1];
    const frag = document.createDocumentFragment();
    const majorEvery = span > 60 * 3600e3 ? 24 : 12;
    const trackW = this.el.clientWidth || 720;
    const labelMode = trackW < 340 ? 0 : trackW < 560 ? 1 : 2; // 0=无 1=仅整日 2=常规
    let dayCount = 0;

    const place = (t) => (100 * (t - start) / span) + '%';
    const addDayDiv = (t, P) => {
      dayCount += 1;
      const show = labelMode === 0 ? false : labelMode === 1 ? dayCount % 2 === 1 : true;
      const div = document.createElement('div');
      div.className = 'tl-day-div' + (P.wd === 0 || P.wd === 6 ? ' wk' : '');
      div.style.left = place(t);
      frag.appendChild(div);
      if (show) {
        const lb = document.createElement('div');
        lb.className = 'tl-day-label' + (P.wd === 0 || P.wd === 6 ? ' wk' : '');
        lb.style.left = place(t);
        lb.textContent = `${P.m + 1}/${P.d} ${weekdayNames()[P.wd]}`;
        frag.appendChild(lb);
      }
    };

    const firstHour = Math.ceil(start / 3600e3) * 3600e3;
    for (let t = firstHour; t <= end; t += 3600e3) {
      const P = tzParts(t);
      if (P.h === 0) addDayDiv(t, P); // 整日边界(按显示时区)
      const major = P.h === 0 || P.h % majorEvery === 0;
      if (P.h % 6 === 0) {
        const tick = document.createElement('div');
        tick.className = 'tick' + (major ? ' major' : '');
        tick.style.left = place(t);
        frag.appendChild(tick);
        // 小时标签仅常规密度且非整日(整日交给日期表头)
        if (labelMode === 2 && major && P.h !== 0) {
          const lb = document.createElement('div');
          lb.className = 'tick-label';
          lb.style.left = place(t);
          lb.textContent = `${p2(P.h)}:00`;
          frag.appendChild(lb);
        }
      }
      // 周六 00:00 起到周一 00:00 的底色段
      if (P.h === 0 && P.wd === 6) {
        const segEnd = Math.min(t + 48 * 3600e3, end);
        const wk = document.createElement('div');
        wk.className = 'tl-wk-seg';
        wk.style.left = place(t);
        wk.style.width = (100 * (segEnd - t) / span) + '%';
        frag.appendChild(wk);
      }
    }
    this.ticks.appendChild(frag);
  }

  _refreshNowMarker() {
    if (!this.times) return;
    const now = Date.now();
    if (now < this.times[0] || now > this.times[this.times.length - 1]) {
      this.nowEl.style.display = 'none';
    } else {
      this.nowEl.style.display = 'block';
      this.nowEl.style.left = (100 * (now - this.times[0]) / this._range()) + '%';
    }
  }

  /* 拖动/步进气泡:本地时间 + UTC 双读,1.4s 后自动隐藏 */
  _showBubble() {
    if (!this.times || this.playing) { this.bubble.hidden = true; return; }
    const span = this._range();
    const frac = clamp((this.pos - this.times[0]) / span, 0, 1);
    const w = this.el.clientWidth || 720;
    const x = clamp(frac * w, 74, Math.max(74, w - 74));
    this.bubble.style.left = x + 'px';
    const d = new Date(this.pos);
    const localT = units.timefmt === '12h'
      ? `${d.getHours() % 12 || 12}:${p2(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`
      : `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    this.bubA.textContent = `${t('tl.local')} ${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${localT}`;
    this.bubB.textContent = `UTC ${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
    this.bubble.hidden = false;
    clearTimeout(this._bubT);
    this._bubT = setTimeout(() => { this.bubble.hidden = true; }, 1400);
  }

  _render() {
    if (!this.times) return;
    const span = this._range();
    const frac = clamp((this.pos - this.times[0]) / span, 0, 1);
    this.thumb.style.left = (frac * 100) + '%';
    this.progress.style.width = (frac * 100) + '%';
    this.timeMain.textContent = `${fmtDateParts(this.pos)} ${fmtClock(this.pos)}`;
    const diffH = Math.round((this.pos - Date.now()) / 3600e3);
    let sub;
    if (Math.abs(diffH) <= 0) sub = t('tl.now');
    else if (diffH < 0) sub = t('tl.past', { n: -diffH });
    else sub = t('tl.fcst', { n: diffH });
    if (units.tz === 'utc') sub += ' · UTC';
    const radarActive = document.body.dataset.radarActive === '1';
    if (radarActive && diffH > 0.5) sub += ' · ' + t('tl.radarExtrap');
    this.timeSub.textContent = sub;
    this._refreshNowMarker();
    this._renderDataWindow();
    // 「回到当前」浮钮:离开当前时刻 3 小时以上且未在播放时浮现
    this.fab.hidden = this.playing || Math.abs(this.pos - Date.now()) <= 3 * 3600e3;
  }

  /* 观测数据有效窗分段着色:过去段(灰)/外推段(蓝) */
  _renderDataWindow() {
    const w = this.dataWindow;
    if (!w || !this.times) {
      this.segPast.hidden = true; this.segFcst.hidden = true;
      return;
    }
    const start = this.times[0];
    const end = this.times[this.times.length - 1];
    const span = this._range();
    const now = Date.now();
    const seg = (el, a, b) => {
      const a2 = Math.max(a, start), b2 = Math.min(b, end);
      if (b2 <= a2) { el.hidden = true; return; }
      el.hidden = false;
      el.style.left = (100 * (a2 - start) / span) + '%';
      el.style.width = (100 * (b2 - a2) / span) + '%';
    };
    seg(this.segPast, now - w.past, now);
    seg(this.segFcst, now, now + w.fcst);
  }
}
