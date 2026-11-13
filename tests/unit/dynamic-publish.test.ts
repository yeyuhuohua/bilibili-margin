import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { publishDynamic, uploadDynamicImage, requireDynamicLogin } from '../../src/content/api/dynamic-publish';
import { nav } from '../../src/content/api/http';
vi.mock('../../src/content/api/http', () => ({ nav: vi.fn(async () => ({ isLogin: true })) }));
const request = vi.fn();
beforeEach(() => { vi.stubGlobal('document', { cookie: 'bili_jct=fixture-csrf' }); vi.stubGlobal('fetch', request); request.mockReset(); vi.mocked(nav).mockResolvedValue({ isLogin: true } as any); });
afterEach(() => vi.unstubAllGlobals());
describe('publish dynamics with explicit user action', () => {
  it('refreshes login state without navigating to the original page', async () => {
    await requireDynamicLogin(); expect(nav).toHaveBeenCalledWith(true); expect(request).not.toHaveBeenCalled();
    vi.mocked(nav).mockResolvedValueOnce({ isLogin: false } as any); await expect(requireDynamicLogin()).rejects.toThrow('草稿会保留');
  });
  it('submits text with the existing authenticated JSON endpoint', async () => {
    request.mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { dyn_id_str: '123456' } }) });
    expect(await publishDynamic('第一行\n第二行', [])).toBe('123456');
    const [url, init] = request.mock.calls[0]; expect(url).toContain('/x/dynamic/feed/create/dyn?'); expect(init.credentials).toBe('include');
    const body = JSON.parse(init.body); expect(body.dyn_req.scene).toBe(1); expect(body.dyn_req.content.contents[0].raw_text).toBe('第一行\n第二行'); expect(body.web_repost_src).toBeUndefined();
  });
  it('uses the daily public-image upload category, not the private-message business', async () => {
    request.mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { image_url: 'https://i0.hdslb.com/bfs/new_dyn/example.png', image_width: 640, image_height: 480 } }) });
    const pic = await uploadDynamicImage(new File(['fake'], 'example.png', { type: 'image/png' }));
    const [, init] = request.mock.calls[0]; expect(init.body.get('category')).toBe('daily'); expect(init.body.get('biz')).toBe('draw'); expect(pic.img_width).toBe(640);
  });
  it('rejects empty text, excessive attachments and invalid images before requesting', async () => {
    await expect(publishDynamic('', [])).rejects.toThrow(); await expect(publishDynamic('x', Array(10).fill({}))).rejects.toThrow();
    await expect(uploadDynamicImage(new File(['x'], 'x.svg', { type: 'image/svg+xml' }))).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
  });
  it('reports an uncertain response without retrying a possibly accepted post', async () => {
    request.mockRejectedValue(Error('timeout')); await expect(publishDynamic('内容', [])).rejects.toThrow('确认是否已发布'); expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not call missing identifiers a confirmed success', async () => {
    request.mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: {} }) });
    await expect(publishDynamic('内容', [])).rejects.toThrow('未提供动态编号');
  });
});
