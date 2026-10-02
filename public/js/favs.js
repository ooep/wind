/* 收藏地点管理:顶栏按钮 + 下拉列表。
 * 数据与点位面板共享(localStorage 'fy_favs'),面板里点 ☆ 收藏/取消会派发 favs-changed,这里实时刷新。
 */
import { ForecastPanel } from './panel.js';

export class FavoritesUI {
  constructor({ go }) {
    this.go = go;
    this.btn = document.getElementById('fav-btn');
    this.list = document.getElementById('fav-list');
    this.btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    document.addEventListener('click', (e) => {
      if (!this.list.hidden && !this.list.contains(e.target)) this.close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    document.addEventListener('favs-changed', () => { if (!this.list.hidden) this.render(); });
    this.render();
  }

  toggle() {
    if (this.list.hidden) { this.render(); this.list.hidden = false; }
    else this.close();
  }
  close() { this.list.hidden = true; }

  render() {
    const favs = ForecastPanel.favs();
    if (!favs.length) {
      this.list.innerHTML = '<div class="fav-empty">暂无收藏<br><span>点击地图任意位置,在面板右上角点 ☆ 收藏该地点</span></div>';
      return;
    }
    this.list.innerHTML = favs.map((f, i) => `
      <div class="fav-item" data-i="${i}">
        <div class="fav-main"><b>★ ${f.name}</b><span>${f.lat.toFixed(2)}°, ${f.lon.toFixed(2)}°</span></div>
        <button class="fav-del" data-i="${i}" title="删除收藏">✕</button>
      </div>`).join('');
    this.list.querySelectorAll('.fav-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('fav-del')) return;
        const f = favs[Number(el.dataset.i)];
        this.close();
        this.go(f);
      });
    });
    this.list.querySelectorAll('.fav-del').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = ForecastPanel.favs();
        next.splice(Number(el.dataset.i), 1);
        try { localStorage.setItem('fy_favs', JSON.stringify(next)); } catch { /* 隐私模式 */ }
        this.render();
        document.dispatchEvent(new CustomEvent('favs-changed'));
      });
    });
  }
}
