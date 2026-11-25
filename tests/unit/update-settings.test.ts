import { beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, saveSettings, sanitizeSettings } from '../../src/shared/settings';

/** chrome.storage.local 的最小模拟 */
const store = new Map<string, unknown>();
beforeEach(() => {
  store.clear();
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
        set: async (obj: Record<string, unknown>) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
      },
      onChanged: { addListener: () => {} },
    },
  };
});

describe('更新提醒的设置', () => {
  it('默认关闭', async () => {
    expect((await loadSettings()).updateInterval).toBe(0);
  });
  it('周期只接受约定的档位，非法值回落成关闭', async () => {
    await saveSettings({ updateInterval: 24 });
    expect((await loadSettings()).updateInterval).toBe(24);
    await saveSettings({ updateInterval: 5 });
    expect((await loadSettings()).updateInterval).toBe(0);
    for (const hours of [1, 6, 12, 24, 72, 168]) {
      expect(sanitizeSettings({ updateInterval: hours })?.updateInterval).toBe(hours);
    }
    expect(sanitizeSettings({ updateInterval: 3 })?.updateInterval).toBe(0);
    expect(sanitizeSettings({ updateInterval: '6' })?.updateInterval).toBe(0);
  });
});
