import { dislike, popular, recommended, type Video } from '../api/feed';
import { appDislike, appRecommended } from '../api/appfeed';
import { noteNegative, rerank, resetRank } from '../rank';
import { followClassics, resetClassics } from '../api/space';
import { account } from '../api/account';
import { normalizeHomeOrder, saveSettings, type HomeSection, type Settings } from '../../shared/settings';
import { BackgroundLayer } from '../bg/background';
import { FilterRuntime } from '../filter-runtime';
import { targetOfVideo } from '../filter-targets';
import { videoCard, skeleton } from './card';
import { toast } from './controls';
import { h, icon, ICONS, guardTyping } from './dom';
import { createFavorites } from './favorites';
import { createHeader, SITE_LINKS, type Header } from './header';
import { shouldPlayIntro, setIntroActive } from './intro/gate';
import { createHeroSearch } from './hero-search';
import { createFootprintCard } from './footprint';
import { createWeather } from './weather';
import type { SunMoon } from './sun-moon';
import { attachPreview } from './preview';
import { createSettingsPanel, type SettingsPanel } from './settings-panel';
import type { Sheet } from './sheet';
import { attachGlass, filtersIn } from './liquid-glass';
import { createCommandPalette } from './command-palette';
import { createContextMenu } from './context-menu';
import { bindCardMenu } from './card-menu';
import { createLaterDrawer } from './drawer';
import { reducedMotion } from '../motion';
import { createBackTop } from './back-top';
import css from '../styles/index';

type Tab = 'rcmd' | 'popular' | 'classic';
type Snap = { tab: Tab; items: Video[]; page: number; appIdx: number; done: boolean; round: number };

export class MarginApp {
  readonly host: HTMLElement;
  private root: ShadowRoot;
  private app!: HTMLElement;
  private grid!: HTMLElement;
  private status!: HTMLElement;
  private sentinel!: HTMLElement;
  private sunMoon!: SunMoon;
  private head!: Header;
  private fadeTimer = 0;
  private bg = new BackgroundLayer();
  private panel!: SettingsPanel;
  private fav!: Sheet;
  private foot!: HTMLElement;
  private dash!: HTMLElement;
  private wx: HTMLElement | null = null;
  private tab: Tab = 'rcmd';
  private round = 1;
  /** App 推荐流的翻页游标（上一批最后一张卡的 idx），换一批时归零 */
  private appIdx = 0;
  private appHinted = false;
  private page = 1;
  private loading = false;
  /** #39：换一批后要恢复的滚动位置；切分类标签或首次加载时为 null（正常回到顶部） */
  private restoreTop: number | null = null;
  private done = false;
  private items: Video[] = [];
  private seen = new Set<string>();
  private filter!: FilterRuntime;
  private gen = 0;
  private media = matchMedia('(prefers-color-scheme: dark)');

  constructor(private settings: Settings) {
    this.filter = new FilterRuntime(settings);
    this.host = h('div', { id: 'margin-root' });
    this.root = this.host.attachShadow({ mode: 'open' });
    guardTyping(this.host);
    this.root.append(h('style', {}, css));
    this.render();
    this.applyTheme();
    this.media.addEventListener('change', () => this.applyTheme());
  }

  update(s: Settings): void {
    const prev = this.settings;
    this.settings = s;
    if (this.filter.update(s)) this.repaint();
    if ((prev.appFeed !== s.appFeed || prev.rerank !== s.rerank) && this.tab === 'rcmd') this.reload();
    if (prev.footprint !== s.footprint || prev.weather !== s.weather) this.syncDash();
    this.app.dataset.cols = String(s.cols || "auto");
    if (prev.homeHide.join() !== s.homeHide.join()) { this.syncHide(); this.repaint(); }
    const order = normalizeHomeOrder(s.homeOrder);
    if (order.join('|') !== this.orderKey) this.applyOrder(order);
    if (prev.reduceMotion !== s.reduceMotion || prev.theme !== s.theme || prev.palette !== s.palette || JSON.stringify(prev.bg) !== JSON.stringify(s.bg)) this.applyTheme();
    this.head.setMsgRemind(s.msgRemind);
    this.panel.sync(s);
  }

  private resolvedTheme(): 'light' | 'dark' {
    const t = this.settings.theme;
    return t === 'auto' ? (this.media.matches ? 'dark' : 'light') : t;
  }

  private applyTheme(): void {
    const t = this.resolvedTheme();
    this.app.dataset.theme = t;
    this.app.dataset.palette = this.settings.palette;
    this.app.dataset.bg = this.settings.bg.mode;
    this.app.dataset.cols = String(this.settings.cols || 'auto');
    this.app.classList.toggle('margin-reduce', this.settings.reduceMotion);
    this.sunMoon.set(t, !reducedMotion());
    this.bg.apply(this.settings.bg, t, this.settings.palette).then(() => this.panel?.sync(this.settings));
  }

  /** 首页顶部的足迹 / 天气：按设置显示；天气卡第一次打开时才创建（关着就不请求天气） */
  private syncDash(): void {
    const s = this.settings;
    if (s.footprint) { if (!this.foot.isConnected) this.dash.prepend(this.foot); } else this.foot.remove();
    if (s.weather) { this.wx ??= createWeather(); if (!this.wx.isConnected) this.dash.append(this.wx); } else this.wx?.remove();
    this.dash.hidden = !s.footprint && !s.weather;
  }

  private cardOpts() { return { onBlock: (x: Video) => this.blockUp(x), onDislike: (x: Video, el: HTMLElement) => this.nope(x, el), hide: new Set<string>(this.settings.homeHide) }; }

  /** 不感兴趣（v0.46）：先从网格里淡出，再把反馈发给 B 站推荐；撤销会一并取消反馈 */
  private async nope(v: Video, el: HTMLElement): Promise<void> {
    const at = this.items.indexOf(v);
    if (at >= 0) this.items.splice(at, 1);
    el.classList.add('gone');
    window.setTimeout(() => { el.remove(); this.fillIfShort(); }, 220);
    try {
      noteNegative(v.mid);
      const fb = (cancel = false) => (v.goto === 'app' ? appDislike(v, 1, cancel) : dislike(v, 1, cancel));
      await fb();
      toast(this.app, '好的，以后少推这类视频', { label: '撤销', run: async () => {
        await fb(true).catch(() => {});
        if (!this.items.includes(v)) { this.items.splice(Math.max(0, at), 0, v); this.repaint(); }
      } });
    } catch (e) {
      toast(this.app, `没能告诉 B 站：${(e as Error).message || '请先登录'}，这张卡片只在本次隐藏`);
    }
  }
  private headEl!: HTMLElement;
  private heroEl!: HTMLElement;
  private mainEl!: HTMLElement;
  private sectionNodes = new Map<HomeSection, Node[]>();
  private orderKey = '';
  /** 首页部件显隐（v0.43）：只切 data-hide，CSS 负责藏；搜索框藏起来时顶栏的小搜索框回来 */
  private syncHide(): void {
    const hide = this.settings.homeHide;
    this.app.dataset.hide = hide.join(' ');
    const noHero = hide.includes('search');
    this.headEl.classList.toggle('no-search', !noHero);
    this.bg.setFocus(noHero ? null : this.heroEl);
  }

  /** 按设置顺序移动同一批节点；不重建 DOM，吸顶/无限滚动/预览/事件都保留 */
  private applyOrder(value: HomeSection[]): void {
    if (!this.mainEl) return;
    const order = normalizeHomeOrder(value);
    this.orderKey = order.join('|');
    for (const id of order) {
      const nodes = this.sectionNodes.get(id);
      if (nodes) this.mainEl.append(...nodes);
    }
  }

  private showFoot(): void {
    if (!this.settings.footprint) { toast(this.app, '足迹热力图已关闭', { label: '打开', run: () => saveSettings({ footprint: true }) }); return; }
    this.app.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    if (!reducedMotion()) this.foot.animate([{ boxShadow: '0 0 0 2px var(--accent)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1200, easing: 'ease-out' });
  }

  private render(): void {
    this.panel = createSettingsPanel(() => this.settings, () => this.bg.shader);
    this.fav = createFavorites((g) => attachPreview(g, () => this.settings.hoverPreview), () => this.settings.favDirect, this.filter);
    this.foot = createFootprintCard();
    this.dash = h('div', { class: 'dash' });
    this.syncDash();
    // v0.20：足迹卡片改用 21st Glass Calendar 的 CSS 玻璃，不再走 GL 折射透镜
    const later = createLaterDrawer(() => this.app, this.filter);
    const palette = createCommandPalette([
      { id: 'refresh', title: '换一批推荐', cat: '操作', icon: ICONS.refresh, keys: ['刷新', 'refresh'], run: () => this.reload() },
      { id: 'rcmd', title: '看推荐', cat: '跳转', icon: ICONS.moments, keys: ['首页'], run: () => (this.app.querySelector('.tab[data-tab=rcmd]') as HTMLElement)?.click() },
      { id: 'classic', title: '看关注的 UP 的老视频', cat: '跳转', icon: ICONS.history, keys: ['老片', 'classic'], run: () => (this.app.querySelector('.tab[data-tab=classic]') as HTMLElement)?.click() },
      { id: 'popular', title: '看热门', cat: '跳转', icon: ICONS.heat, keys: ['popular', '排行'], run: () => (this.app.querySelector('.tab[data-tab=popular]') as HTMLElement)?.click() },
      { id: 'fav', title: '打开收藏夹', cat: '操作', icon: ICONS.fav, keys: ['收藏'], run: () => this.fav.open() },
      { id: 'foot', title: '看足迹', desc: '一年的 B 站热力图', cat: '跳转', icon: ICONS.heat, keys: ['热力图', '足迹'], run: () => this.showFoot() },
      { id: 'theme', title: '切换亮色 / 暗色', cat: '操作', icon: ICONS.moon, keys: ['主题', '夜间', 'dark', 'light'], run: () => this.toggleTheme() },
      { id: 'settings', title: '打开设置', cat: '操作', icon: ICONS.gear, keys: ['背景', '过滤', '屏蔽'], run: () => this.panel.sheet.open() },
      { id: 'top', title: '回到顶部', cat: '操作', icon: ICONS.top, run: () => this.app.scrollTo({ top: 0, behavior: 'smooth' }) },
      { id: 'later', title: '稍后再看', cat: '跳转', icon: ICONS.later, keys: ['watchlater'], run: () => later.open() },
      { id: 'moments', title: '动态', cat: '跳转', icon: ICONS.moments, run: () => window.open('https://t.bilibili.com/', '_blank', 'noopener') },
      { id: 'live', title: '直播', cat: '跳转', icon: ICONS.live, keys: ['live', 'zhibo'], run: () => window.open('https://live.bilibili.com/', '_blank', 'noopener') },
      { id: 'message', title: '消息', cat: '跳转', icon: ICONS.message, run: () => window.open('https://message.bilibili.com/', '_blank', 'noopener') },
      { id: 'history', title: '观看历史', cat: '跳转', icon: ICONS.history, run: () => window.open('https://www.bilibili.com/history', '_blank', 'noopener') },
      { id: 'off', title: '本次回到 B 站原版', cat: '操作', icon: ICONS.exit, keys: ['原版', '关闭'], run: () => { sessionStorage.setItem('margin:off', '1'); location.reload(); } },
    ]);
    const cm = createContextMenu();
    const head = createHeader({ onTheme: () => this.toggleTheme(), onSearch: (q) => palette.open(q), onSettings: () => this.panel.sheet.open(), msgRemind: () => this.settings.msgRemind, filter: this.filter, tabs: [
      ...SITE_LINKS,
      'separator',
      { title: '收藏', icon: ICONS.fav, run: () => this.fav.open() },
      { title: '稍后', icon: ICONS.later, run: () => later.open() },
      { title: '足迹', icon: ICONS.heat, run: () => this.showFoot() },
      { title: '原版', icon: ICONS.exit, run: () => { sessionStorage.setItem('margin:off', '1'); location.reload(); } },
    ] });
    this.sunMoon = head.sunMoon;
    this.head = head;
    const header = head.el;

    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const mkTab = (id: Tab, label: string) => {
      const b = h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(id === this.tab), onclick: () => this.switchTab(id, tabs) }, label);
      b.dataset.tab = id;
      return b;
    };
    tabs.append(mkTab('rcmd', '推荐'), mkTab('popular', '热门'), mkTab('classic', '关注老片'));
    const refresh = h('button', { class: 'ghost refresh', type: 'button', title: '换一批', onclick: () => this.reload(true) }, icon(ICONS.refresh), h('span', {}, '换一批'));
    // 上一批（评论区 K-aloy：习惯 biliplus 的首页回退）：换一批之后可以回到刚才那批，再点一次又回来
    this.backBtn = h('button', { class: 'ghost refresh back', type: 'button', title: '回到上一批', hidden: true, onclick: () => this.restore() }, icon(ICONS.back), h('span', {}, '上一批'));

    // 吸顶时分类栏变成液态玻璃胶囊，日期行收起
    head.el.classList.add('no-search');
    const barMark = h('div', { class: 'bar-mark', 'aria-hidden': 'true' });
    // 首页主搜索：居中大胶囊（和搜索页同款），顶栏的小搜索框在首页隐藏，避免两个入口
    const heroS = createHeroSearch(() => this.app);
    const hero = heroS.el;
    this.headEl = head.el; this.heroEl = hero;
    const bar = h('div', { class: 'bar' }, h('div', { class: 'eyebrow' }, h('span', {}, todayLabel()), h('span', { class: 'en' }, 'For You'), h('span', { class: 'no' }, issueNo())), h('div', { class: 'bar-row' }, tabs, h('div', { class: 'bar-acts' }, this.backBtn, refresh)));

    this.grid = h('section', { class: 'grid home-grid', 'aria-live': 'polite' });
    this.status = h('div', { class: 'status' });
    this.sentinel = h('div', { class: 'sentinel' });
    attachPreview(this.grid, () => this.settings.hoverPreview);

    const exit = h('button', {
      class: 'ghost small', type: 'button', onclick: () => { sessionStorage.setItem('margin:off', '1'); location.reload(); },
    }, icon(ICONS.exit), h('span', {}, '本次回到 B 站原版首页'));

    const footer = h('footer', { class: 'foot' }, exit, h('span', {}, '映间 MARGIN · 非 B 站官方'));
    const main = h('main', { class: 'main' });
    this.mainEl = main;
    this.sectionNodes = new Map<HomeSection, Node[]>([
      ['hero', [heroS.scrim, hero]],
      ['dash', [this.dash]],
      ['toolbar', [barMark, bar]],
      ['feed', [this.grid, this.status, this.sentinel]],
      ['footer', [footer]],
    ]);
    this.app = h('div', { class: 'app home' },
      this.bg.el,
      header,
      main,
      this.panel.sheet.el,
      this.fav.el,
      palette.el,
      later.el,
      cm.el,
    );
    this.app.append(createBackTop(this.app, main));
    // 侧板开着时背景定格：侧板的毛玻璃（backdrop-filter）只有在底下画面变化时才需要每帧重算（v0.45）
    this.app.addEventListener('margin:sheet', () => { const on = !!this.app.querySelector('.sheet-layer[data-open="true"]'); this.app.classList.toggle('sheeted', on); this.bg.hold('sheet', on); });
    this.root.append(this.app);
    this.applyOrder(this.settings.homeOrder);
    // 汇流背景的点线汇向首页搜索栏（搜索框隐藏时汇向屏幕中心）
    this.syncHide();
    if (shouldPlayIntro(this.settings.intro, this.settings.reduceMotion)) {
      // 开场引擎（WebGL，约 37KB）按需加载；加载前先用同色底板盖住首页，避免闪一下
      const theme = this.resolvedTheme();
      const cover = h('div', { class: 'intro', role: 'presentation', style: `background:${theme === 'dark' ? '#111112' : '#f5f4f1'}` });
      this.app.append(cover);
      setIntroActive(true);
      import('./intro/intro').then((m) => { void m.playIntro(this.app, theme); requestAnimationFrame(() => cover.remove()); })
        .catch((e) => { console.error('[MARGIN] intro', e); cover.remove(); setIntroActive(false); });
    }
    let scrollT = 0;
    this.app.addEventListener('scroll', () => {
      this.bg.redraw();
      if (!scrollT) this.app.classList.add('scrolling');
      clearTimeout(scrollT);
      scrollT = window.setTimeout(() => {
        scrollT = 0; this.app.classList.remove('scrolling');
        // 滚过首屏后背景基本被卡片盖住，30 帧就够
        this.bg.cap(this.app.scrollTop > innerHeight * 0.8 ? 30 : 0);
        this.fillIfShort();
      }, 160);
    }, { passive: true });
    const lg = filtersIn(this.root);
    head.glass.forEach((g) => attachGlass(g, lg));
    attachGlass(head.thumb, lg, { blur: 2, strength: 0.4 });
    attachGlass(tabs, lg); attachGlass(refresh, lg);
    bindCardMenu(this.grid, cm, () => this.app, { onBlock: (x) => this.blockUp(x), onLater: () => later.open(), onDislike: (x, el) => this.nope(x, el) });
    const favGrid = this.fav.el.querySelector('.fav-grid') as HTMLElement | null;
    if (favGrid) bindCardMenu(favGrid, cm, () => this.app, { onLater: () => later.open() });
    new IntersectionObserver(([e]) => {
      bar.classList.toggle('stuck', !e.isIntersecting && e.boundingClientRect.top < 80);
    }, { root: this.app, rootMargin: '-72px 0px 0px 0px', threshold: 0 }).observe(barMark);
    // 大搜索框滚出视野后，顶栏的小搜索框淡入（v0.47，评论区：往下滑时搜索栏能跟着走）
    new IntersectionObserver(([e]) => {
      head.el.classList.toggle('hs-away', !e.isIntersecting && e.boundingClientRect.top < 80);
    }, { root: this.app, rootMargin: '-72px 0px 0px 0px', threshold: 0 }).observe(hero);

    new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) this.load(); }, { root: this.app, rootMargin: '900px 0px' }).observe(this.sentinel);
    // 从个人空间等页面的入口跳回首页时直接打开对应面板：bilibili.com/#fav、#later
    const hashOpen = () => {
      const k = location.hash.slice(1);
      if (k !== 'fav' && k !== 'later') return;
      history.replaceState(null, '', location.pathname + location.search);
      if (k === 'fav') this.fav.open(); else later.open();
    };
    hashOpen();
    addEventListener('hashchange', hashOpen);

    this.load();
  }

  private async toggleTheme(): Promise<void> {
    const next = this.resolvedTheme() === 'dark' ? 'light' : 'dark';
    // 页面颜色和日月动画用同一时长淡入淡出（替代原来的 View Transition 圆形揭幕，它会冻结按钮动画）
    if (!reducedMotion()) {
      this.app.classList.add('theme-fading');
      this.app.style.setProperty('--fade', `${this.sunMoon.duration}ms`);
      clearTimeout(this.fadeTimer);
      this.fadeTimer = window.setTimeout(() => this.app.classList.remove('theme-fading'), this.sunMoon.duration + 100);
    }
    this.settings = { ...this.settings, theme: next };
    this.applyTheme();
    await saveSettings({ theme: next });
  }

  private switchTab(id: Tab, tabs: HTMLElement): void {
    // 设置里打开「点击分类标签刷新列表」后，点当前分类标签等于换一批，保留「上一批」可回退（PR #33）
    if (id === this.tab) { if (this.settings.tabRefresh) this.reload(true); return; }
    // 每个 tab 记住自己的列表和滚动位置（v0.50，B 站评论建议）：切回来接着看，不回到顶部
    if (this.items.length) this.tabMem.set(this.tab, { s: this.snapshot()!, top: this.app.scrollTop, back: this.snap });
    this.tab = id;
    tabs.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
    const m = this.tabMem.get(id);
    if (!m) { this.reload(); return; }
    this.tabMem.delete(id);
    const s = m.s!;
    this.gen++;
    this.items = s.items.slice();
    this.seen = new Set(s.items.map((v) => v.bvid));
    this.page = s.page; this.appIdx = s.appIdx; this.done = s.done; this.round = s.round;
    this.loading = false;
    this.snap = m.back;
    if (this.backBtn) this.backBtn.hidden = !this.snap;
    this.status.replaceChildren();
    this.repaint();
    this.app.scrollTo({ top: m.top });
  }

  private tabMem = new Map<Tab, { s: Snap; top: number; back: Snap | null }>();

  private backBtn: HTMLElement | null = null;
  private snap: Snap | null = null;

  private snapshot(): typeof this.snap {
    return { tab: this.tab, items: this.items.slice(), page: this.page, appIdx: this.appIdx, done: this.done, round: this.round };
  }

  private restore(): void {
    const s = this.snap;
    if (!s || s.tab !== this.tab) return;
    this.snap = this.snapshot();
    this.gen++;
    this.items = s.items.slice();
    this.seen = new Set(s.items.map((v) => v.bvid));
    this.page = s.page; this.appIdx = s.appIdx; this.done = s.done; this.round = s.round;
    this.loading = false;
    this.status.replaceChildren();
    this.app.scrollTo({ top: 0 });
    this.repaint();
  }

  private reload(keep = false): void {
    // #39：点「换一批」时记住当前滚动位置，等首批卡片渲染完再恢复；切分类标签（keep=false）仍回到顶部
    this.restoreTop = keep ? this.app.scrollTop || null : null;
    this.snap = keep && this.items.length ? this.snapshot() : null;
    if (this.backBtn) this.backBtn.hidden = !this.snap;
    this.gen++;
    this.grid.replaceChildren();
    this.items = [];
    this.seen.clear();
    this.done = false;
    this.loading = false;
    this.page = 1;
    this.round++;
    this.appIdx = 0;
    resetRank();
    resetClassics();
    // 换一批不动滚动位置（#39）；其余情况回到顶部
    if (!keep) this.app.scrollTo({ top: 0 });
    this.load();
  }

  /** 过滤条件变化后，用已加载的数据重画网格 */
  private repaint(): void {
    const gen = this.gen;
    void this.filter.prepare(this.items.map((v) => v.bvid)).then(() => {
      if (gen !== this.gen) return;
      const shown = this.items.filter((v) => this.filter.allows(targetOfVideo(v)));
      this.grid.replaceChildren(...shown.map((v, i) => videoCard(v, i, this.cardOpts())));
      this.grid.querySelectorAll('.card').forEach((c) => c.classList.add('still'));
      this.fillIfShort();
    });
  }

  private async blockUp(v: Video): Promise<void> {
    const before = this.settings.filters.ups;
    if (before.includes(v.author) || before.includes(String(v.mid))) return;
    await saveSettings({ filters: { ...this.settings.filters, ups: [...before, v.author] } });
    // 顺便告诉 B 站推荐「不想看此 UP 主」（失败不影响本地屏蔽）
    noteNegative(v.mid, 2);
    if (v.goto === 'app') appDislike(v, 4).catch(() => {});
    else if (v.trackId) dislike(v, 4).catch(() => {});
    toast(this.app, `已屏蔽「${v.author}」`, { label: '撤销', run: () => saveSettings({ filters: { ...this.settings.filters, ups: this.settings.filters.ups.filter((u) => u !== v.author) } }) });
  }

  /** IntersectionObserver 只在「进入 / 离开」时触发：加载完哨兵还停在可视范围里、或被过滤掉一整批时不会再响，
   *  所以加载结束和滚动停下后都按滚动容器的剩余高度再查一次（用户反馈：滚到底有概率不再刷新） */
  private fillIfShort(): void {
    if (this.done || this.loading || !this.sentinel.isConnected) return;
    const a = this.app;
    const left = a.scrollHeight - a.scrollTop - a.clientHeight;
    const r = this.sentinel.getBoundingClientRect();
    if (left < 1200 || r.top < innerHeight + 900) this.load();
  }

  private async load(attempt = 0): Promise<void> {
    if (this.loading || this.done) return;
    this.loading = true;
    const gen = this.gen;
    const sk = skeleton(this.grid.children.length ? 4 : 12);
    const skNodes = [...sk.childNodes];
    this.grid.append(sk);
    this.status.replaceChildren();
    let added = 0;
    try {
      let list: Video[];
      if (this.tab === 'rcmd' && this.settings.appFeed) {
        // App 推荐流（v0.48 实验）：一批 10 来个，连取两批凑够一屏
        const a = await appRecommended(this.appIdx);
        const b = await appRecommended(a.next);
        this.appIdx = b.next;
        list = [...a.list, ...b.list];
        if (!a.personal && !this.appHinted) { this.appHinted = true; toast(this.app, '正在用 App 推荐（未授权，不是个性化的）。在设置 → 实验功能里扫码授权'); }
      } else if (this.tab === 'rcmd') {
        const batches = await Promise.all([recommended(this.round), recommended(this.round + 1)]);
        this.round += 2;
        list = batches.flat();
      } else if (this.tab === 'classic') {
        const me = (await account())?.mid;
        if (!me) throw new Error('登录后才能看关注的 UP 主');
        const r = await followClassics(me);
        list = r.list;
        this.done = r.done;
      } else {
        const r = await popular(this.page++);
        list = r.list;
        this.done = r.done;
      }
      if (this.tab === 'rcmd' && this.settings.rerank) list = await rerank(list, this.items.slice(-3).map((x) => x.mid), this.seen).catch(() => list);
      if (gen !== this.gen) return;
      // 关键词也要能命中视频标签：先把这批视频的标签取回来（没有关键词时立即返回）
      await this.filter.prepare(list.map((v) => v.bvid));
      if (gen !== this.gen) return;
      skNodes.forEach((n) => (n as Element).remove());
      const start = this.grid.children.length;
      for (const v of list) {
        if (this.seen.has(v.bvid)) continue;
        this.seen.add(v.bvid);
        this.items.push(v);
        if (!this.filter.allows(targetOfVideo(v))) continue;
        this.grid.append(videoCard(v, start + added++, this.cardOpts()));
      }
      if (this.done) this.status.replaceChildren(h('span', {}, '没有更多了'));
      // #39：首批卡片进 DOM 后再恢复换一批前的滚动位置（列表重建时 scrollTop 会归零）
      if (this.restoreTop != null) {
        const y = Math.max(0, Math.min(this.restoreTop, this.app.scrollHeight - this.app.clientHeight));
        this.restoreTop = null;
        this.app.scrollTo({ top: y });
      }
    } catch (err) {
      if (gen !== this.gen) return;
      skNodes.forEach((n) => (n as Element).remove());
      // 推荐接口偶发风控 / 超时：先静默重试两次，再给出重试按钮
      if (attempt < 2) { this.loading = false; window.setTimeout(() => { if (gen === this.gen) this.load(attempt + 1); }, 800 * (attempt + 1)); return; }
      this.status.replaceChildren(h('span', {}, `加载失败：${(err as Error).message}`), h('button', { class: 'ghost small', type: 'button', onclick: () => this.load() }, '重试'));
      return;
    } finally {
      if (gen === this.gen) this.loading = false;
    }
    // 被过滤掉太多时自动补一批
    if (gen === this.gen && added < 6 && attempt < 4) this.load(attempt + 1);
    else if (gen === this.gen) {
      requestAnimationFrame(() => this.fillIfShort());
      // 连续几批都被过滤或重复：稍等再补，不让列表停在底部
      if (added === 0) window.setTimeout(() => { if (gen === this.gen) this.fillIfShort(); }, 1500);
    }
  }
}

/** 杂志刊号式的眉标：一年中的第几天 */
function issueNo(): string {
  const d = new Date(), y = new Date(d.getFullYear(), 0, 0);
  return `NO. ${String(Math.floor((d.getTime() - y.getTime()) / 864e5)).padStart(3, '0')}`;
}

function todayLabel(): string {
  const d = new Date();
  const w = '日一二三四五六'[d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${w}`;
}
