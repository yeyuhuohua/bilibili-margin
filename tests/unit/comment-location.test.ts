import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/content/api/http', () => ({ getJSON: vi.fn(), postForm: vi.fn(), postJSON: vi.fn() }));
import { getJSON } from '../../src/content/api/http';
import { dynReplies } from '../../src/content/api/dyn';
describe('评论接口公开属地', () => {
  it.each([
    [{ location: 'IP属地：浙江' }, 'IP属地：浙江'],
    [{}, undefined],
    [{ location: null }, undefined],
  ])('按返回字段显示 %j', async (reply_control, expected) => {
    vi.mocked(getJSON).mockResolvedValue({ replies: [{ rpid_str: '123', content: { message: '正文' }, reply_control }] });
    const result = await dynReplies(17, '1');
    expect(result.list[0].location).toBe(expected);
  });
});
