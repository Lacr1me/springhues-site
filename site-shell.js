/* Shared navigation and Lucide/Feather line icons. No remote requests or user data. */
(() => {
  'use strict';
  const page = document.body.dataset.sitePage;
  if (!page) return;
  const root = new URL('.', document.currentScript.src);
  const titles = { game:'游戏日报', minsheng:'民生日报', messages:'留言簿', privacy:'隐私说明', admin:'网站管理' };
  const paths = {
    grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',
    book:'<path d="M12 5v16M12 5C9 3 6 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-3-1-6-1-9 1z"/>',
    message:'<path d="M21 15a3 3 0 0 1-3 3H7l-4 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3zM7 8h10M7 12h7"/>',
    user:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    shield:'<path d="M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z"/><path d="m8 12 3 3 5-6"/>',
    blocks:'<path d="m12 3 9 5-9 5-9-5zM3 8v9l9 5 9-5V8M12 13v9"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    chevron:'<path d="m6 9 6 6 6-6"/>',
    spark:'<path d="M12 2v20M2 12h20M5 5l14 14M5 19 19 5"/>',
    chart:'<path d="M3 3v18h18M7 14l4-4 4 2 6-7"/>',
    arrow:'<path d="M7 17 17 7M7 7h10v10"/>'
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('class','ui-icon');
    svg.setAttribute('aria-hidden','true');
    svg.innerHTML = paths[name] || paths.book;
    return svg;
  }
  function link(label, href, symbol, active = false) {
    const a = document.createElement('a');
    a.className = 'rail-link'; a.href = root.pathname + href;
    a.append(icon(symbol), document.createTextNode(label));
    if (active) a.setAttribute('aria-current','page');
    return a;
  }
  const rail = document.createElement('aside'); rail.className='site-rail';
  rail.setAttribute('aria-label','Springhues 网站导航');
  const brand = document.createElement('a'); brand.className='rail-brand';brand.href=root.pathname;
  const logo = document.createElement('span');logo.className='rail-logo';
  const img = document.createElement('img');img.src=new URL('brand-assets/springhues-logo.png',root).href;img.alt='';logo.append(img);
  const name = document.createElement('span');name.innerHTML='<strong>Springhues</strong><small>作品与日常</small>';
  brand.append(logo,name);rail.append(brand);
  const label = document.createElement('p');label.className='rail-label';label.textContent='我的空间';rail.append(label);
  const nav = document.createElement('nav');nav.setAttribute('aria-label','我的空间');
  nav.append(link('资源库','','grid'),link('我的收藏','?view=saved','bookmark'),link('每日简报','?view=journal','book',['game','minsheng'].includes(page)),link('留言簿','messages/','message',page==='messages'));
  rail.append(nav);
  const reading = document.createElement('p');reading.className='rail-label';reading.textContent='继续阅读';rail.append(reading);
  const sub = document.createElement('nav');sub.className='rail-secondary';sub.setAttribute('aria-label','阅读与说明');
  sub.append(link('民生日报','minsheng/','book',page==='minsheng'),link('游戏日报','game/','blocks',page==='game'),link('关于这里','?view=about','user'),link('隐私说明','privacy/','shield',page==='privacy'));
  rail.append(sub);
  const bottom=document.createElement('div');bottom.className='rail-bottom';bottom.append(icon('spark'));
  const note=document.createElement('p');note.textContent='自己做的\n也有认真整理的';note.className='rail-note';
  const home=document.createElement('a');home.href=root.pathname;home.textContent='Springhues · 作品与日常';bottom.append(note,home);rail.append(bottom);
  const main=document.querySelector('main');
  if(main){if(!main.id)main.id='pageContent';main.tabIndex=-1;const skip=document.createElement('a');skip.className='ui-skip';skip.href='#'+main.id;skip.textContent='跳到正文';document.body.prepend(skip);}
  document.body.prepend(rail);document.body.classList.add('has-site-rail');
  const header=document.querySelector('body > .site-bar, body > .portal-header');
  if(header){const crumbs=document.createElement('div');crumbs.className='ui-breadcrumb';crumbs.append(icon(page==='admin'?'shield':'spark'));const homeLink=document.createElement('a');homeLink.href=root.pathname;homeLink.textContent='Springhues';const slash=document.createElement('span');slash.textContent='/';const title=document.createElement('b');title.textContent=titles[page];crumbs.append(homeLink,slash,title);header.prepend(crumbs);}
  const archive=document.querySelector('.archive-trigger');
  if(archive){archive.querySelector('span:first-child')?.replaceChildren(icon('calendar'));archive.querySelector('i')?.replaceChildren(icon('chevron'));}
  document.querySelector('#closeArchive')?.replaceChildren(icon('close'));
  document.querySelectorAll('.platform-link > span').forEach(span=>span.replaceChildren(icon('arrow')));
  let transition;
  async function update(action) {
    transition?.skipTransition();
    if(!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches){action();return;}
    transition=document.startViewTransition(action);
    transition.ready.catch(()=>{});
    await transition.finished.catch(()=>{});
  }
  window.SpringhuesUI=Object.freeze({icon,update});
})();
