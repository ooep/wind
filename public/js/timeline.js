/* 时间轴:统一时间源,驱动填色层 / 粒子 / 等压线 / 雷达 */
import { fmtTime, fmtDay, fmtHourLocal, clamp } from './util.js';

const PLAY_SPEED = 2.6 * 3600e3; // 播放速度:每秒前进 2.6 小时

export class Timeline {
  constructor({ onChange }) {
    this.onChange = onChange;
    this.times = null;
    this.pos = Date.now();
    this.playing = false;
    this._raf = null;
    this._lastT = 0;

    this.el = document.getElementById('timeline');
    this.track = document.getElementById('tl-track');
    this.ticks = document.getElementById('tl-ticks');
    this.nowEl = document.getElementById('tl-now');
    this.thumb = document.getElementById('tl-thumb');
    this.progress = document.createElement('div');
    this.progress.id = 'tl-progress';
    this.track.appendChild(this.progress);

    this.playBtn = document.getElementById('play-btn');
    this.iconPlay = document.getElementById('icon-play');
    this.iconPause = document.getElementById('icon-pause');
    this.timeMain = document.getElementById('time-main');
    this.timeSub = document.getElementById('time-sub');

    this.playBtn.addEventListener('click', () => this.togglePlay());
    document.getElementById('step-back').addEventListener('click', () => this.nudge(-1));
    document.getElementById('step-fwd').addEventListener('click', () => this.nudge(1));
    document.getElementById('step-now').addEventListener('click', () => this.goNow());

    // 拖动 / 点击
    let dragging = false;
    const seekFromEvent = (e) => {
      const rect = this.track.getBoundingClientRect();
      const t = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      if (this.times) this.setPos(this.times[0] + t * (this.times[this.times.length - 1] - this.times[0]));
    };
    this.el.addEventListener('pointerdown', (e) => {
      dragging = true; this.el.setPointerCapture(e.pointerId);
      this.pause(); seekFromEvent(e);
    });
    this.el.addEventListener('pointermove', (e) => { if (dragging) seekFromEvent(e); });
    this.el.addEventListener('pointerup', () => { dragging = false; });

    setInterval(() => this._refreshNowMarker(), 60_000);
    this._refreshNowMarker();
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
      let next = this.pos + dt * PLAY_SPEED / 1000;
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

  _range() { return this.times[this.times.length - 1] - this.times[0]; }

  _buildTicks() {
    const times = this.times;
    const span = this._range();
    this.ticks.innerHTML = '';
    if (!times || span <= 0) return;
    const start = times[0];
    const frag = document.createDocumentFragment();
    const majorEvery = span > 60 * 3600e3 ? 24 : 12;
    // 对齐到整小时
    const firstHour = Math.ceil(start / 3600e3) * 3600e3;
    for (let t = firstHour; t <= times[times.length - 1]; t += 3600e3) {
      const d = new Date(t);
      const isMidnight = d.getHours() === 0;
      const major = isMidnight || (d.getHours() % majorEvery === 0);
      const x = (100 * (t - start) / span).toFixed(2) + '%';
      if (d.getHours() % 6 === 0) {
        const tick = document.createElement('div');
        tick.className = 'tick' + (major ? ' major' : '');
        tick.style.left = x;
        frag.appendChild(tick);
        if (major) {
          const lb = document.createElement('div');
          lb.className = 'tick-label';
          lb.style.left = x;
          lb.textContent = isMidnight ? fmtDay(t) : fmtHourLocal(t);
          frag.appendChild(lb);
        }
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

  _render() {
    if (!this.times) return;
    const span = this._range();
    const frac = clamp((this.pos - this.times[0]) / span, 0, 1);
    this.thumb.style.left = (frac * 100) + '%';
    this.progress.style.width = (frac * 100) + '%';
    this.timeMain.textContent = fmtTime(this.pos);
    const diffH = Math.round((this.pos - Date.now()) / 3600e3);
    let sub;
    if (Math.abs(diffH) <= 0) sub = '当前';
    else if (diffH < 0) sub = `过去 ${-diffH} 小时`;
    else sub = `预报 +${diffH} 小时`;
    const radarActive = document.body.dataset.radarActive === '1';
    if (radarActive && diffH > 0.5) sub += ' · 雷达外推';
    this.timeSub.textContent = sub;
    this._refreshNowMarker();
  }
}
