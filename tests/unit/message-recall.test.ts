import { afterEach, describe, expect, it, vi } from 'vitest';
import { canRecallMessage, messages, msgText, recallMessage, type Msg } from '../../src/content/api/msg';

const message: Msg = { sender: 1, type: 1, text: '你好', image: '', ts: 1000, key: '900001234567890123', seq: 1 };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('原生私信撤回协议', () => {
  it('只允许自己的两分钟内消息，拒绝未来、过期和已撤回消息', () => {
    expect(canRecallMessage(message, 1, 1120)).toBe(true);
    expect(canRecallMessage(message, 1, 1121)).toBe(false);
    expect(canRecallMessage(message, 1, 999)).toBe(false);
    expect(canRecallMessage(message, 2, 1050)).toBe(false);
    expect(canRecallMessage({ ...message, type: 5 }, 1, 1050)).toBe(false);
  });
  it('发送 type 5 与未经 JSON 再编码的长 msg_key，保留 CSRF', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1050000);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 0 }))); vi.stubGlobal('fetch', fetcher);
    await recallMessage(1, 2, message, 'test-csrf');
    const body = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const fields = new URLSearchParams(body[1].body as string);
    expect(fields.get('msg[msg_type]')).toBe('5'); expect(fields.get('msg[content]')).toBe(message.key);
    expect(fields.get('msg[receiver_id]')).toBe('2'); expect(fields.get('csrf')).toBe('test-csrf');
  });
  it('过期不请求，服务端拒绝不把原消息改成已撤回', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1121000); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(recallMessage(1, 2, message, 'csrf')).rejects.toThrow('两分钟'); expect(fetcher).not.toHaveBeenCalled();
    vi.setSystemTime(1050000); fetcher.mockResolvedValue(new Response(JSON.stringify({ code: -1 })));
    await expect(recallMessage(1, 2, message, 'csrf')).rejects.toThrow('撤回失败'); expect(message.type).toBe(1);
  });
  it('服务端撤回状态和原始撤回 key 均显示系统提示', async () => {
    expect(msgText(5, message.key)).toEqual({ text: '撤回了一条消息', image: '' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { messages: [
      { sender_uid: 1, msg_type: 1, msg_status: 1, content: '{"content":"旧消息"}', timestamp: 1000, msg_key: message.key },
    ] } }))));
    expect((await messages(2))[0]).toMatchObject({ type: 5, key: message.key, image: '' });
  });
});
