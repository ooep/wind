/* 全局键盘快捷键(Windy 式):+/- 缩放 · F 搜索 · ↑↓ 切图层 · PgUp/PgDn 切气压层
 * 空格 播放/暂停 · ←→ 时间步进。输入框聚焦、输入法组合态、修饰键组合时不拦截。 */

export function initShortcuts({ map, timeline, cycleLayer, cycleLevel, focusSearch }) {
  window.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;

    switch (e.key) {
      case '+': case '=':
        e.preventDefault(); map.zoomIn(); break;
      case '-': case '_':
        e.preventDefault(); map.zoomOut(); break;
      case 'f': case 'F': case '/':
        e.preventDefault(); focusSearch(); break;
      case 'ArrowUp':
        e.preventDefault(); cycleLayer(-1); break;
      case 'ArrowDown':
        e.preventDefault(); cycleLayer(1); break;
      case 'PageUp':
        e.preventDefault(); cycleLevel(1); break;   // 向上一气压层(更接近高空)
      case 'PageDown':
        e.preventDefault(); cycleLevel(-1); break;
      case 'ArrowLeft':
        timeline.nudge(-1); break;
      case 'ArrowRight':
        timeline.nudge(1); break;
      case ' ':
        // 焦点在按钮上时交给原生点击(避免双触发),其余拦截播放
        if (t && t.tagName === 'BUTTON') return;
        e.preventDefault(); timeline.togglePlay(); break;
      default:
        break;
    }
  });
}
