/* 城市搜索:Open-Meteo Geocoding,中文联想 */

export class Search {
  constructor({ onSelect }) {
    this.onSelect = onSelect;
    this.input = document.getElementById('search-input');
    this.box = document.getElementById('search-results');
    this.results = [];
    this.sel = -1;
    this._timer = null;

    this.input.addEventListener('input', () => {
      clearTimeout(this._timer);
      const q = this.input.value.trim();
      if (!q) { this._hide(); return; }
      this._timer = setTimeout(() => this._query(q), 260);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : -1) + this.results.length) % Math.max(1, this.results.length);
        this._paint();
      } else if (e.key === 'Enter') {
        const r = this.results[this.sel] || this.results[0];
        if (r) this._pick(r);
      } else if (e.key === 'Escape') this._hide();
    });
    document.addEventListener('click', (e) => {
      if (!this.box.contains(e.target) && e.target !== this.input) this._hide();
    });
  }

  static favs() {
    try { return JSON.parse(localStorage.getItem('fy_favs') || '[]'); } catch { return []; }
  }

  async _query(q) {
    try {
      const { fetchGeocode } = await import('./api.js');
      const results = await fetchGeocode(q);
      this.results = results;
      this.sel = results.length ? 0 : -1;
      if (!results.length) {
        this.box.innerHTML = '<div class="sr-empty">未找到匹配地点</div>';
        this.box.hidden = false;
        return;
      }
      this._paint();
      this.box.hidden = false;
    } catch { this._hide(); }
  }

  _paint() {
    this.box.innerHTML = '';
    // 收藏地点置顶
    const favs = Search.favs();
    if (favs.length) {
      const cap = document.createElement('div');
      cap.className = 'sr-cap';
      cap.textContent = '★ 收藏地点';
      this.box.appendChild(cap);
      favs.forEach((f) => {
        const el = document.createElement('div');
        el.className = 'sr-item';
        el.innerHTML = `<div class="sr-name">★ ${f.name}</div>
          <div class="sr-sub">${f.lat.toFixed(2)}°, ${f.lon.toFixed(2)}°</div>`;
        el.addEventListener('click', () => { this.box.hidden = true; this.onSelect({ lat: f.lat, lon: f.lon, name: f.name }); });
        this.box.appendChild(el);
      });
      const sep = document.createElement('div');
      sep.className = 'sr-cap';
      sep.textContent = '─ 搜索结果 ─';
      this.box.appendChild(sep);
    }
    this.results.forEach((r, i) => {
      const el = document.createElement('div');
      el.className = 'sr-item' + (i === this.sel ? ' sel' : '');
      const sub = [r.admin1, r.country].filter(Boolean).join(' · ');
      el.innerHTML = `<div class="sr-name">${r.name}</div>
        <div class="sr-sub">${sub} ${r.latitude?.toFixed(2)}°, ${r.longitude?.toFixed(2)}°</div>`;
      el.addEventListener('click', () => this._pick(r));
      this.box.appendChild(el);
    });
  }

  _pick(r) {
    this.box.hidden = true;
    this.input.value = r.name;
    this.input.blur();
    this.onSelect({ lat: r.latitude, lon: r.longitude, name: r.name });
  }

  _hide() { this.box.hidden = true; }
}
