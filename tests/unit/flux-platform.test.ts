import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const init = vi.hoisted(() => vi.fn());
vi.mock('vgpu', () => ({ init, compute: vi.fn(), draw: vi.fn(), effect: vi.fn(), frame: vi.fn(), storage: vi.fn(), surface: vi.fn(), target: vi.fn() }));
vi.mock('../../src/content/bg/flux/sim.wgsl', () => ({ default: '' }));
vi.mock('../../src/content/bg/flux/dots.wgsl', () => ({ default: '' }));
vi.mock('../../src/content/bg/flux/fade.wgsl', () => ({ default: '' }));
vi.mock('../../src/content/bg/flux/composite.wgsl', () => ({ default: '' }));
import { FluxField } from '../../src/content/bg/flux';
beforeEach(() => {
  init.mockReset().mockRejectedValue(new Error('test stops after init options'));
  vi.stubGlobal('document', { createElement: () => ({ remove: vi.fn() }) });
  vi.stubGlobal('navigator', { platform: 'Linux', userAgent: '', userAgentData: { platform: 'Linux' } });
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('流光 WebGPU 平台选项', () => {
  it.each(['win', 'mac', 'linux'])('扩展平台 %s', async os => {
    vi.stubGlobal('chrome', { runtime: { getPlatformInfo: async () => ({ os }) } });
    await new FluxField().start();
    expect(init.mock.calls[0][0]).toEqual(os === 'win' ? { requiredLimits: { maxStorageBuffersInVertexStage: 1 } } : { requiredLimits: { maxStorageBuffersInVertexStage: 1 }, powerPreference: 'low-power' });
  });
  it('内容脚本没有平台 API 时按 Windows UA 回退', async () => {
    vi.stubGlobal('chrome', { runtime: {} });
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows NT 10.0' });
    await new FluxField().start();
    expect(init.mock.calls[0][0]).not.toHaveProperty('powerPreference');
  });
  it('等待平台信息期间销毁则跳过 GPU 初始化', async () => {
    let resolve!: (value: { os: string }) => void;
    vi.stubGlobal('chrome', { runtime: { getPlatformInfo: () => new Promise(r => { resolve = r; }) } });
    const field = new FluxField();
    const pending = field.start();
    field.dispose(); resolve({ os: 'win' });
    expect(await pending).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });
});
