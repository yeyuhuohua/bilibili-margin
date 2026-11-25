// 映间 MARGIN · 连播方式扩展（v0.61）
// 跑在页面主环境：官方「播放方式」为自动切集时才接管，播完暂停则开关置灰、不介入。
// 接管期间把播放器内存临时设为「播完暂停」，持久配置始终是用户自己的值。

type SceneKind = 'bangumi' | 'multiPage' | 'collection' | 'single';
type PrefKey = 'bangumi' | 'multiPage' | 'collection' | 'recommend';

interface SceneInfo {
  pref: PrefKey;
  /** true=应该连播 false=到末集该停 null=进度未知，不介入 */
  ok: boolean | null;
}

interface Progress {
  current: number;
  total: number;
}

interface Prefs {
  collection: boolean;
  multiPage: boolean;
  bangumi: boolean;
  recommend: boolean;
}

(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('margin') === 'off' || sessionStorage.getItem('margin:off')) return;

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  async function waitFor<T>(fn: () => T | null | undefined | false, opts?: { timeout?: number; interval?: number }): Promise<T | null> {
    const timeout = opts?.timeout ?? 30000;
    const interval = opts?.interval ?? 250;
    const t0 = Date.now();
    while (extEnabled && Date.now() - t0 < timeout) {
      try {
        const v = fn();
        if (v) return v;
      } catch { /* 继续等 */ }
      await sleep(interval);
    }
    return null;
  }

  interface PlayerLike {
    on?(name: string, fn: () => void): void;
    off?(name: string, fn: () => void): void;
    setHandoff?(value: number): void;
    getHandoff?(): number;
  }

  const getPlayer = (): PlayerLike | null =>
    (window as { player?: PlayerLike }).player ?? null;

  const hasPlayer = (): boolean => getPlayer() !== null;

  const Scene = {
    settle(): SceneKind {
      if (/\/bangumi\/play\/ep\d+/.test(location.pathname)) return 'bangumi';
      if (document.querySelector('.multip, .multi-page, .multi-page-v1')) return 'multiPage';
      // .section 是合集，没有 .section 的 .video-pod__list 是分P
      const podList = document.querySelector('.video-pod__list');
      if (podList && !document.querySelector('.video-pod__list.section')) return 'multiPage';
      if (document.querySelector('.video-pod__list.section, .base-video-sections, .base-video-sections-v1')) {
        return 'collection';
      }
      return 'single';
    },

    collectionProgress(): Progress | null {
      const el = document.querySelector('.video-pod__header .amt, .list-count');
      if (!el) return null;
      const m = (el.textContent ?? '').match(/(\d+)\s*\/\s*(\d+)/);
      return m ? { current: Number(m[1]), total: Number(m[2]) } : null;
    },

    bangumiProgress(): Progress | null {
      const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="/bangumi/play/ep"]');
      if (!links.length) return null;
      const cur = (location.pathname.match(/ep(\d+)/) || [])[1];
      if (!cur) return null;

      // 番剧导航里 listItem 是 PV，numberItem 才是正片
      let total = 0;
      let current = 0;
      for (const a of links) {
        const holder = a.closest('[class*="EpisodeVirtualList_numberItem"], [class*="EpisodeVirtualList_listItem"]');
        if (!holder || /listItem/.test(String(holder.className))) continue;
        total++;
        if (current === 0) {
          const m = (a.getAttribute('href') ?? '').match(/ep(\d+)/);
          if (m && m[1] === cur) current = total;
        }
      }
      if (!total) return null;
      return { current, total };
    },
  };

  const EXT_KEY = 'margin:autoplay-ext';
  const EXT_EVENT = 'margin:autoplay-ext';
  const EXT_ATTR = 'data-margin-autoplay-ext';

  const readExtEnabled = (): boolean => {
    try {
      return localStorage.getItem(EXT_KEY) === '1';
    } catch {
      return false;
    }
  };
  let extEnabled = readExtEnabled();

  /** 读官方「播放方式」：0=自动切集 2=播完暂停。只读，一次都不写 */
  function readOfficialMode(): number | null {
    try {
      const raw = JSON.parse(localStorage.getItem('bpx_player_profile') ?? '{}') as {
        media?: { handoff?: unknown };
      };
      return typeof raw.media?.handoff === 'number' ? raw.media.handoff : null;
    } catch {
      return null;
    }
  }

  const STORE_KEY = 'margin-patch:autoplay';
  const DEFAULTS: Prefs = {
    collection: true,
    multiPage: true,
    bangumi: true,
    recommend: false,
  };
  let prefs: Prefs = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Prefs> | null;
    if (saved && typeof saved === 'object') prefs = { ...DEFAULTS, ...saved };
  } catch { /* 忽略损坏存储 */ }
  const savePrefs = (): void => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
    } catch { /* 隐私模式 */ }
  };

  const AutoPlay = {
    current(): SceneInfo {
      const kind = Scene.settle();

      if (kind === 'bangumi') {
        const p = Scene.bangumiProgress();
        if (!p || p.current <= 0) return { pref: 'bangumi', ok: null };
        return { pref: 'bangumi', ok: p.current < p.total };
      }
      if (kind === 'single') return { pref: 'recommend', ok: true };

      const p = Scene.collectionProgress();
      if (!p) return { pref: kind, ok: null };
      return { pref: kind, ok: p.current < p.total };
    },

    /** 当前是否应该连播；null 表示不确定 */
    want(): boolean | null {
      const s = this.current();
      if (s.ok === null) return null;
      return prefs[s.pref] && s.ok;
    },
  };

  /**
   * 是否拦下这次的播放结束跳转。
   * 只在「插件开着 + 官方是自动切集 + 明确不该连播」时才拦，
   * 其余情况一律放行，交给 B 站自己处理。
   */
  function shouldBlock(): boolean {
    if (!extEnabled) return false;
    if (readOfficialMode() !== 0) return false;
    return AutoPlay.want() === false;
  }

  const SWITCH_ITEMS: ReadonlyArray<{ key: PrefKey; label: string }> = [
    { key: 'collection', label: '合集连播' },
    { key: 'multiPage', label: '分P连播' },
    { key: 'bangumi', label: '番剧连播' },
    { key: 'recommend', label: '推荐连播' },
  ];

  /** 尺寸对齐 B 站原生 .bui-switch-body（30x20） */
  function makeSwitch({ key, label }: { key: PrefKey; label: string }): HTMLDivElement {
    const ROW_H = 32;
    const TRACK_W = 30;
    const TRACK_H = 20;
    const KNOB = 16;
    const TRAVEL = TRACK_W - KNOB - 4;

    const area = document.createElement('div');
    area.className = 'margin-patch-switch';
    area.dataset.pref = key;
    area.style.cssText = `display:flex;align-items:center;justify-content:space-between;
      width:100%;height:${ROW_H}px;padding:0 12px;box-sizing:border-box;cursor:pointer;
      transition:opacity .15s ease;`;

    const lab = document.createElement('span');
    lab.className = 'margin-patch-label';
    lab.textContent = label;
    lab.style.cssText = 'font-size:12px;color:#fff;line-height:1;flex:0 0 auto;';

    const track = document.createElement('span');
    track.className = 'margin-patch-track';
    track.style.cssText = `position:relative;display:inline-block;
      width:${TRACK_W}px;height:${TRACK_H}px;border-radius:${TRACK_H / 2}px;
      flex:0 0 auto;transition:background .18s ease;box-sizing:border-box;`;

    const knob = document.createElement('span');
    knob.className = 'margin-patch-knob';
    knob.style.cssText = `position:absolute;top:2px;left:2px;
      width:${KNOB}px;height:${KNOB}px;border-radius:50%;background:#fff;
      transition:transform .18s ease;box-sizing:border-box;`;
    track.append(knob);

    const paint = (on: boolean): void => {
      track.style.background = on ? '#00a1d6' : '#7f7f7f';
      knob.style.transform = on ? `translateX(${TRAVEL}px)` : 'translateX(0)';
    };
    paint(prefs[key]);

    area.append(lab, track);

    area.addEventListener('click', (e) => {
      e.stopPropagation();
      if (area.dataset.disabled === '1') return;
      prefs[key] = !prefs[key];
      paint(prefs[key]);
      savePrefs();
    });

    return area;
  }

  /**
   * 官方「播放方式」是自动切集时才让四个开关可操作；
   * 播完暂停时置灰，因为这时候接管没有意义。
   */
  function syncSwitchUsability(): void {
    const usable = extEnabled && readOfficialMode() === 0;
    for (const el of document.querySelectorAll<HTMLElement>('.margin-patch-switch')) {
      el.dataset.disabled = usable ? '0' : '1';
      el.style.opacity = usable ? '1' : '0.42';
      el.style.pointerEvents = usable ? 'auto' : 'none';
    }
    const hint = document.querySelector<HTMLElement>('.margin-patch-hint');
    if (hint) hint.style.display = usable ? 'none' : '';
  }

  function mountSettingSwitches(): boolean {
    const right = document.querySelector('.bpx-player-ctrl-setting-menu-right');
    if (!right) return false;

    const existing = right.querySelector('.margin-patch-group');
    if (!extEnabled) {
      existing?.remove();
      return true;
    }
    if (existing) {
      syncSwitchUsability();
      return true;
    }

    const group = document.createElement('div');
    group.className = 'margin-patch-group';
    group.style.cssText = 'padding:8px 0 4px;';

    const title = document.createElement('div');
    title.textContent = '连播';
    title.style.cssText = 'padding:2px 0 6px;font-size:13px;opacity:.72;';
    group.append(title);

    const hint = document.createElement('div');
    hint.className = 'margin-patch-hint';
    hint.textContent = '需将「播放方式」设为自动切集';
    hint.style.cssText = 'padding:0 12px 6px;font-size:11px;opacity:.5;line-height:1.4;';
    group.append(hint);

    for (const item of SWITCH_ITEMS) group.append(makeSwitch(item));

    right.append(group);
    syncSwitchUsability();
    return true;
  }

  const disposers: Array<() => void> = [];

  function startFunctionalWatch(): void {
    if (disposers.length || !extEnabled) return;
    mountSettingSwitches();

    // 视频元素的 ended 早于播放器自己的 Player_Ended：这段窗口里把内存设成
    // 「播完暂停」，B 站会走完整暂停路径——结束页照常渲染、不跳下一集。
    // 持久配置全程保持用户的选择；接管结束或被停用时把内存恢复回去。
    let genSeq = 0;
    let takeover: { gen: number; baseline: number; player: PlayerLike } | null = null;
    let settleTimer = 0;
    // 用户在本轮接管期间动过播放方式设置。改值必然经过设置面板，
    // 用它区分「用户选的 2」和「我们临时设的 2」。
    let userTouchedMode = false;

    // 只有仍持有接管的代次才能释放；用户动过设置就让位
    const release = (mine: number): void => {
      if (!takeover || takeover.gen !== mine) return;
      const { baseline, player: p } = takeover;
      takeover = null;
      if (userTouchedMode) return;
      if (getPlayer() !== p || !p.getHandoff || !p.setHandoff || readOfficialMode() !== baseline) return;
      try {
        // 内存被别的东西改过就别碰；还是 2 才说明仍是我们设的
        if (p.getHandoff() !== 2) return;
        try { p.setHandoff(baseline); } catch { /* 忽略 */ }
      } catch { /* 忽略 */ }
    };

    const onEnded = (e: Event): void => {
      const t = e.target;
      if (!(t instanceof HTMLVideoElement)) return;
      if (!t.closest('.bpx-player-container')) return;   // 只认主播放器的视频
      if (takeover || !shouldBlock()) return;
      const p = getPlayer();
      const baseline = readOfficialMode();
      if (!p?.setHandoff || baseline === null) return;
      try {
        p.setHandoff(2);
      } catch {
        return;
      }
      genSeq += 1;
      const mine = genSeq;
      takeover = { gen: mine, baseline, player: p };
      userTouchedMode = false;   // 新一轮接管，重新计

      const settle = (left: number): void => {
        if (!takeover || takeover.gen !== mine) return;   // 已停用
        const wrap = document.querySelector('.bpx-player-ending-wrap');
        const len = wrap ? (wrap.textContent ?? '').replace(/\s+/g, '').length : 0;
        if (len > 0 || left <= 0) {
          release(mine);
          return;
        }
        settleTimer = window.setTimeout(() => settle(left - 1), 16);
      };
      settleTimer = window.setTimeout(() => settle(186), 0);   // 3 秒兜底
    };
    document.addEventListener('ended', onEnded, true);

    // 切集时播放器实例复用，若内存里还留着 2，纠正回用户设置
    const onMeta = (): void => {
      if (takeover) return;
      const p = getPlayer();
      const off = readOfficialMode();
      if (!p?.getHandoff || !p.setHandoff || off === null) return;
      try {
        if (p.getHandoff() !== off) p.setHandoff(off);
      } catch { /* 忽略 */ }
    };
    document.addEventListener('loadedmetadata', onMeta, true);

    // 换页后播放器可能带着上一页的内存值，而 loadedmetadata 早于这里注册，
    // onMeta 来不及纠正；启动时先对齐一次，避免这一页第一次播完不连播
    try {
      const p0 = getPlayer();
      const off0 = readOfficialMode();
      if (p0?.getHandoff && p0.setHandoff && off0 !== null && p0.getHandoff() !== off0) {
        p0.setHandoff(off0);
      }
    } catch { /* 忽略 */ }

    // 齿轮悬停、点击或键盘聚焦时才等待面板挂载，避开弹幕和列表的高频 DOM 变化。
    let menuTimer = 0;
    const onSettings = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('.bpx-player-ctrl-setting')) return;
      if (mountSettingSwitches() || menuTimer) return;
      let attempts = 0;
      const retry = (): void => {
        menuTimer = 0;
        if (!mountSettingSwitches() && ++attempts < 30) menuTimer = window.setTimeout(retry, 100);
      };
      menuTimer = window.setTimeout(retry, 100);
    };
    for (const type of ['pointerover', 'focusin', 'click']) document.addEventListener(type, onSettings, true);

    // 官方「播放方式」变了：记下用户动过设置，并刷新开关灰度
    const onModeChange = (e: Event): void => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (!t.closest('.bpx-player-ctrl-setting-handoff')) return;
      userTouchedMode = true;
      window.setTimeout(() => syncSwitchUsability(), 150);
    };
    document.addEventListener('change', onModeChange, true);
    document.addEventListener('click', onModeChange, true);

    disposers.push(() => {
      document.removeEventListener('ended', onEnded, true);
      document.removeEventListener('loadedmetadata', onMeta, true);
      for (const type of ['pointerover', 'focusin', 'click']) document.removeEventListener(type, onSettings, true);
      clearTimeout(menuTimer);
      document.removeEventListener('change', onModeChange, true);
      document.removeEventListener('click', onModeChange, true);
      // 停用时若仍在接管中，恢复用户自己的值；用户动过设置就不动
      clearTimeout(settleTimer);
      if (takeover) release(takeover.gen);
    });
  }

  function stopFunctionalWatch(): void {
    for (const fn of disposers) {
      try {
        fn();
      } catch { /* 忽略 */ }
    }
    disposers.length = 0;
  }

  /** 总开关切换：启用则挂开关起监听，停用则拆干净 */
  function onExtChanged(): void {
    if (extEnabled) {
      mountSettingSwitches();
      // 启用时才等播放器，避免停用状态下白等
      void (async () => {
        if (await waitFor(hasPlayer, { timeout: 30000, interval: 200 })) {
          startFunctionalWatch();
        }
      })();
    } else {
      stopFunctionalWatch();
      mountSettingSwitches();
    }
  }

  /** 配置监听常驻，很轻；否则关掉后就收不到重新开启 */
  function listenExtChanges(): void {
    const sync = (incoming?: string): void => {
      const next = incoming === '0' ? false
                 : incoming === '1' ? true
                 : readExtEnabled();
      if (next === extEnabled) return;
      extEnabled = next;
      onExtChanged();
    };

    document.addEventListener(EXT_EVENT, (e) => {
      const detail = (e as CustomEvent<string>).detail;
      sync(typeof detail === 'string' ? detail : undefined);
    }, true);

    new MutationObserver(() => sync()).observe(document.documentElement, {
      attributes: true,
      attributeFilter: [EXT_ATTR],
    });

    window.addEventListener('storage', (e) => {
      if (e.key === EXT_KEY) sync();
    });
  }

  async function main(): Promise<void> {
    listenExtChanges();

    // 停用状态下只保留配置监听，不等播放器
    extEnabled = readExtEnabled();
    if (!extEnabled) return;

    if (!await waitFor(hasPlayer)) return;

    // 给内容脚本一拍时间写进当前设置
    await sleep(300);
    extEnabled = readExtEnabled();
    if (!extEnabled) return;

    mountSettingSwitches();
    startFunctionalWatch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void main(), { once: true });
  } else {
    void main();
  }
})();