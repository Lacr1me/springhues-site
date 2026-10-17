// 站内跳转：菜单、命令面板、旧链接映射、#cat= 共用。
import { app } from '../core/app.js';
import { scrollToEl } from '../core/scroll.js';

export function go(name, { immediate = false } = {}) {
  if (name === 'works') { app.setCategory && app.setCategory('all'); scrollToEl('works', { immediate }); }
  else if (name === 'daily') { app.setCategory && app.setCategory('daily'); scrollToEl('works', { immediate }); }
  else if (name === 'about') scrollToEl('about', { immediate });
  else if (name === 'top') scrollToEl('top', { immediate });
}
