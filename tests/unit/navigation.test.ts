import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let app = false;
let click: (event: any) => void;
let auxclick: (event: any) => void;
let nav: typeof import('../../src/content/navigation');
const assign = vi.fn(); const open = vi.fn();
class Anchor {
  target = '_blank'; download = false;
  constructor(public href: string) {}
  hasAttribute(name: string) { return name === 'download' && this.download; }
}
const event = (anchor: Anchor, patch = {}) => ({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
  defaultPrevented: false, preventDefault: vi.fn(), composedPath: () => [anchor], ...patch });
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); app = false;
  vi.stubGlobal('matchMedia', () => ({ matches: app }));
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('location', { href: 'https://www.bilibili.com/', assign });
  vi.stubGlobal('window', { open });
  vi.stubGlobal('HTMLAnchorElement', Anchor);
  vi.stubGlobal('document', { addEventListener: (type: string, cb: typeof click) => {
    if (type === 'click') click = cb;
    if (type === 'auxclick') auxclick = cb;
  } });
  nav = await import('../../src/content/navigation');
});
afterEach(() => vi.unstubAllGlobals());

describe('应用窗口站内导航', () => {
  it('普通浏览器保留新标签页', () => {
    nav.openBili('https://search.bilibili.com/all?keyword=test');
    expect(open).toHaveBeenCalled(); expect(assign).not.toHaveBeenCalled();
  });
  it.each(['https://search.bilibili.com/all?keyword=test', 'https://space.bilibili.com/1', '/video/BVtest'])('应用窗口留在同一窗口：%s', (url) => {
    app = true; nav.openBili(url);
    expect(assign).toHaveBeenCalledWith(new URL(url, 'https://www.bilibili.com/').href); expect(open).not.toHaveBeenCalled();
  });
  it.each(['https://example.com/', 'https://bilibili.com.evil.test/', 'javascript:alert(1)'])('外部地址不套用站内规则：%s', (url) => {
    app = true; nav.openBili(url); expect(assign).not.toHaveBeenCalled(); expect(open).toHaveBeenCalled();
  });
  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 2 }])('显式新开手势不改成当前页：%j', (patch) => {
    app = true; nav.openBili('/video/BVtest', '_blank', 'noopener', event(new Anchor(''), patch));
    expect(assign).not.toHaveBeenCalled(); expect(open).toHaveBeenCalled();
  });
  it('处理跨 Shadow DOM 的链接，并跟随扩展开关', () => {
    app = true; nav.installAppNavigation(true);
    const e = event(new Anchor('https://space.bilibili.com/1')); click(e);
    expect(e.preventDefault).toHaveBeenCalled(); expect(assign).toHaveBeenCalledTimes(1);
    nav.installAppNavigation(false); click(e); expect(assign).toHaveBeenCalledTimes(1);
  });
  it('下载链接和已处理事件交给原有处理器', () => {
    app = true; nav.installAppNavigation(true);
    const a = new Anchor('https://www.bilibili.com/'); a.download = true;
    click(event(a)); a.download = false; click(event(a, { defaultPrevented: true }));
    expect(assign).not.toHaveBeenCalled();
  });
  it('应用里的动态卡片中键通过 openBili 留在当前窗口', () => {
    app = true; nav.openBili('/opus/123', '_blank', 'noopener', event(new Anchor(''), { button: 1 }));
    expect(assign).toHaveBeenCalledWith('https://www.bilibili.com/opus/123');
    expect(open).not.toHaveBeenCalled();
  });
  it.each(['_blank', '', '_self'])('应用中键链接留在当前窗口，target=%s', (target) => {
    app = true; nav.installAppNavigation(true);
    const a = new Anchor('https://space.bilibili.com/2'); a.target = target;
    const e = event(a, { button: 1 }); auxclick(e);
    expect(e.preventDefault).toHaveBeenCalled(); expect(assign).toHaveBeenCalledWith(a.href);
  });
  it('普通标签页的中键继续由浏览器处理', () => {
    nav.installAppNavigation(true); auxclick(event(new Anchor('https://space.bilibili.com/2'), { button: 1 }));
    expect(assign).not.toHaveBeenCalled();
  });
  it('应用中键排除外链、下载、修饰键、右键、已处理事件与停用状态', () => {
    app = true; nav.installAppNavigation(true);
    auxclick(event(new Anchor('https://example.com/'), { button: 1 }));
    const a = new Anchor('https://space.bilibili.com/2');
    a.download = true; auxclick(event(a, { button: 1 })); a.download = false;
    for (const patch of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 2 }, { defaultPrevented: true }]) {
      auxclick(event(a, { button: 1, ...patch }));
    }
    nav.installAppNavigation(false); auxclick(event(a, { button: 1 }));
    expect(assign).not.toHaveBeenCalled();
  });
});
