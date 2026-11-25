import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isReleaseUrl } from '../../src/shared/update-reminder';

const mocks = vi.hoisted(() => ({
  checkRelease: vi.fn(),
  readReminder: vi.fn(async (): Promise<{ tag: string; url: string; at: number; seen?: boolean } | null> => null),
  writeReminder: vi.fn(async () => {}),
  clearReminder: vi.fn(async () => {}),
}));

vi.mock('../../src/shared/releases', () => ({
  checkRelease: mocks.checkRelease,
  newerRelease: (tag: string, current: string) => tag !== current,
}));
vi.mock('../../src/shared/update-reminder', () => ({
  readReminder: mocks.readReminder,
  writeReminder: mocks.writeReminder,
  clearReminder: mocks.clearReminder,
  isReleaseUrl: (url: unknown) => typeof url === 'string' && /^https:\/\/github\.com\/jiuyang5354\/bilibili-margin\/releases\/tag\/v\d+(?:\.\d+){1,3}$/.test(url),
}));

import { runCheck, syncSchedule } from '../../src/background/update-reminder';

const settings: Record<string, unknown> = {};
const alarms = { create: vi.fn(), clear: vi.fn(), get: vi.fn() };
const badge = { setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}) };
let existing: chrome.alarms.Alarm | undefined;
let manifest: chrome.runtime.Manifest = { version: '0.60.90' } as chrome.runtime.Manifest;

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(settings)) delete settings[key];
  existing = undefined;
  manifest = { version: '0.60.90' } as chrome.runtime.Manifest;
  alarms.get.mockImplementation((_name: string, cb: (alarm?: chrome.alarms.Alarm) => void) => cb(existing));
  alarms.clear.mockImplementation((_name: string, cb: (done: boolean) => void) => cb(true));
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (key: string) => (key in settings ? { [key]: settings[key] } : {}),
        set: async (obj: Record<string, unknown>) => { Object.assign(settings, obj); },
      },
      onChanged: { addListener: () => {} },
    },
    alarms: { ...alarms, onAlarm: { addListener: () => {} } },
    runtime: { getManifest: () => manifest },
    management: { getSelf: async () => ({ installType: 'development' }) },
    action: badge,
  };
  mocks.readReminder.mockResolvedValue(null);
});

describe('更新提醒的定时任务', () => {
  it('商店安装即使无 update_url 也会撤销任务、提醒和角标', async () => {
    settings['margin:settings'] = { updateInterval: 6, privacyExternal: true };
    vi.spyOn(chrome.management, 'getSelf').mockResolvedValue({ installType: 'normal' } as chrome.management.ExtensionInfo);
    existing = { name: 'margin:update-check', periodInMinutes: 360 } as chrome.alarms.Alarm;
    mocks.readReminder.mockResolvedValue({ tag: '0.60.99', url: '', at: 1 });
    await syncSchedule(); await runCheck();
    expect(alarms.clear).toHaveBeenCalled();
    expect(mocks.clearReminder).toHaveBeenCalled();
    expect(badge.setBadgeText).toHaveBeenCalledWith({ text: '' });
    expect(mocks.checkRelease).not.toHaveBeenCalled();
  });

  it('默认关闭时不排任务', async () => {
    await syncSchedule();
    expect(alarms.create).not.toHaveBeenCalled();
  });

  it('按设置排任务，小时换算成分钟', async () => {
    settings['margin:settings'] = { updateInterval: 6, privacyExternal: true };
    await syncSchedule();
    expect(alarms.create).toHaveBeenCalledWith('margin:update-check', { periodInMinutes: 360 });
  });

  it('周期没变就不重复排', async () => {
    existing = { name: 'margin:update-check', periodInMinutes: 360 } as chrome.alarms.Alarm;
    settings['margin:settings'] = { updateInterval: 6, privacyExternal: true };
    await syncSchedule();
    expect(alarms.create).not.toHaveBeenCalled();
  });
});

describe('更新提醒的检查', () => {
  it('周期为关闭、隐私开关关掉时不查版本', async () => {
    settings['margin:settings'] = { updateInterval: 0, privacyExternal: true };
    await runCheck();
    settings['margin:settings'] = { updateInterval: 6, privacyExternal: false };
    await runCheck();
    expect(mocks.checkRelease).not.toHaveBeenCalled();
  });

  it('商店安装的版本不查（浏览器自己更新）', async () => {
    manifest = { version: '0.60.90', update_url: 'https://example.test/update.xml' } as chrome.runtime.Manifest;
    settings['margin:settings'] = { updateInterval: 6, privacyExternal: true };
    await runCheck();
    expect(mocks.checkRelease).not.toHaveBeenCalled();
  });

  it('发现新版本就记下来并在图标上标「新」', async () => {
    settings['margin:settings'] = { updateInterval: 6, privacyExternal: true };
    mocks.checkRelease.mockResolvedValue({ tag: '0.60.91', name: 'v0.6.91', url: 'https://github.com/jiuyang5354/bilibili-margin/releases/tag/v0.60.91' });
    await runCheck();
    expect(mocks.writeReminder).toHaveBeenCalledWith(expect.objectContaining({ tag: '0.60.91', url: 'https://github.com/jiuyang5354/bilibili-margin/releases/tag/v0.60.91' }));
    expect(badge.setBadgeText).toHaveBeenCalledWith({ text: '新' });
  });

  it('发布页地址不合规就不记', async () => {
    settings['margin:settings'] = { updateInterval: 6, privacyExternal: true };
    mocks.checkRelease.mockResolvedValue({ tag: '0.60.91', name: 'v0.6.91', url: 'https://evil.test/releases/tag/v0.60.91' });
    await runCheck();
    expect(mocks.writeReminder).not.toHaveBeenCalled();
  });

  it('已经追上最新版本时清掉提醒与角标', async () => {
    settings['margin:settings'] = { updateInterval: 6, privacyExternal: true };
    mocks.checkRelease.mockResolvedValue({ tag: '0.60.90', name: 'v0.6.90', url: 'https://github.com/jiuyang5354/bilibili-margin/releases/tag/v0.60.90' });
    mocks.readReminder.mockResolvedValue({ tag: '0.60.89', url: 'https://github.com/jiuyang5354/bilibili-margin/releases/tag/v0.60.89', at: Date.now() });
    await runCheck();
    expect(mocks.clearReminder).toHaveBeenCalled();
    expect(badge.setBadgeText).toHaveBeenCalledWith({ text: '' });
  });
});

describe('发布页地址校验', () => {
  it('只认官方仓库的发布页', () => {
    expect(isReleaseUrl('https://github.com/jiuyang5354/bilibili-margin/releases/tag/v0.60.91')).toBe(true);
    expect(isReleaseUrl('https://github.com/other/repo/releases/tag/v0.60.91')).toBe(false);
    expect(isReleaseUrl('https://evil.test/releases/tag/v0.60.91')).toBe(false);
    expect(isReleaseUrl('https://github.com/jiuyang5354/bilibili-margin/releases/latest')).toBe(false);
    expect(isReleaseUrl(undefined)).toBe(false);
  });
});
