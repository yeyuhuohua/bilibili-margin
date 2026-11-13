import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordVersionInstall } from '../../src/background/updates';
import { UPDATE_PENDING, UPDATE_SEEN } from '../../src/shared/updates';

const store: Record<string, unknown> = {};
const set = vi.fn(async (patch: Record<string, unknown>) => { Object.assign(store, patch); });
beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]; set.mockClear();
  vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: '0.60.25' }) }, storage: { local: { set } } });
});
describe('installed update notification', () => {
  it('first install records the version without opening an upgrade notice', async () => {
    await recordVersionInstall('install'); expect(store[UPDATE_SEEN]).toBe('0.60.25'); expect(store[UPDATE_PENDING]).toBeUndefined();
  });
  it('a changed extension version queues a notice without overwriting its acknowledgement', async () => {
    store[UPDATE_SEEN] = '0.60.24'; await recordVersionInstall('update', '0.60.24');
    expect(store[UPDATE_PENDING]).toBe('0.60.25'); expect(store[UPDATE_SEEN]).toBe('0.60.24');
  });
  it('reloading the same unpacked version does not queue another notice', async () => {
    await recordVersionInstall('update', '0.60.25'); expect(set).not.toHaveBeenCalled();
  });
  it('a same-version reload preserves an unacknowledged notice', async () => {
    store[UPDATE_PENDING] = '0.60.25'; await recordVersionInstall('update', '0.60.25'); expect(store[UPDATE_PENDING]).toBe('0.60.25');
  });
  it('browser upgrades do not trigger extension release notes', async () => {
    await recordVersionInstall('chrome_update', '0.60.24'); expect(set).not.toHaveBeenCalled();
  });
});
