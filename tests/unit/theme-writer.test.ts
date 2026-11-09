import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULTS, loadSettings, saveSettings, type Settings } from '../../src/shared/settings';
import { ThemeWriter } from '../../src/content/ui/theme-writer';

vi.mock('../../src/shared/settings', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/shared/settings')>(),
  loadSettings: vi.fn(), saveSettings: vi.fn(),
}));
let stored: Settings;
beforeEach(() => {
  vi.resetAllMocks();
  stored = { ...DEFAULTS, theme: 'light' };
  vi.mocked(loadSettings).mockImplementation(async () => stored);
});

it('coalesces rapid choices and masks earlier acknowledgements while keeping other settings', async () => {
  const releases: (() => void)[] = [];
  vi.mocked(saveSettings).mockImplementation(async patch => {
    await new Promise<void>(resolve => releases.push(resolve));
    stored = { ...stored, ...patch };
    return stored;
  });
  const writer = new ThemeWriter();
  const saving = writer.save('dark');
  await vi.waitFor(() => expect(releases).toHaveLength(1));
  await writer.save('light');
  await writer.save('dark');
  await writer.save('light');
  stored = { ...stored, theme: 'dark', cols: 6 };
  const incoming = writer.sync(stored);
  expect(incoming.theme).toBe('light');
  expect(incoming.cols).toBe(6);
  releases[0]();
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  releases[1]();
  await saving;
  // The final storage event can arrive after storage.set resolves.
  expect(writer.sync({ ...stored, theme: 'dark' }).theme).toBe('light');
  expect(writer.sync(stored).theme).toBe('light');
  expect(writer.sync({ ...stored, theme: 'dark' }).theme).toBe('dark');
  expect(saveSettings).toHaveBeenCalledTimes(2);
  expect(stored.cols).toBe(6);
});

it('releases the pending choice when the stored value already matches and no event is emitted', async () => {
  const writer = new ThemeWriter();
  await writer.save('light');
  expect(saveSettings).not.toHaveBeenCalled();
  expect(writer.sync({ ...stored, theme: 'dark' }).theme).toBe('dark');
});

it('accepts stored settings after a failed write and allows the next attempt', async () => {
  const writer = new ThemeWriter();
  vi.mocked(saveSettings).mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(writer.save('dark')).rejects.toThrow('storage unavailable');
  expect(writer.sync(stored).theme).toBe('light');
  vi.mocked(saveSettings).mockImplementation(async patch => {
    stored = { ...stored, ...patch };
    writer.sync(stored);
    return stored;
  });
  await writer.save('dark');
  expect(stored.theme).toBe('dark');
  expect(writer.sync({ ...stored, theme: 'light' }).theme).toBe('light');
});
