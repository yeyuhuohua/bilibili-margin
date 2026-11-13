import { nav } from './http';

export interface DynamicPicture { img_src: string; img_width: number; img_height: number; img_size: number }
const csrf = () => document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/)?.[1] ?? '';
export function validateDynamicImage(file: Pick<File, 'type' | 'size'>): void {
  if (!['image/jpeg', 'image/png', 'image/gif'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 GIF 图片');
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('单张图片不能超过 10 MB');
}
export async function requireDynamicLogin(): Promise<void> {
  if (!(await nav(true))?.isLogin || !csrf()) throw new Error('请先登录 B 站，再回来发布；草稿会保留');
}
export async function uploadDynamicImage(file: File): Promise<DynamicPicture> {
  validateDynamicImage(file);
  if (!csrf()) throw new Error('登录状态已失效，请先登录 B 站');
  const form = new FormData(); form.append('file_up', file); form.append('category', 'daily'); form.append('biz', 'draw'); form.append('csrf', csrf());
  const response = await fetch('https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs', { method: 'POST', credentials: 'include', body: form, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`图片上传失败（HTTP ${response.status}）`);
  const reply = await response.json();
  if (reply.code !== 0) throw new Error(reply.message || '图片上传失败');
  const data = reply.data;
  let url: URL; try { url = new URL(String(data?.image_url).replace(/^http:/, 'https:')); } catch { throw new Error('图片上传结果无效'); }
  if (url.protocol !== 'https:' || !/(^|\.)(hdslb\.com|biliimg\.com)$/.test(url.hostname) || !(data.image_width > 0 && data.image_height > 0)) throw new Error('图片上传结果无效');
  return { img_src: url.href, img_width: data.image_width, img_height: data.image_height, img_size: Number.isFinite(data.img_size) ? data.img_size : file.size / 1024 };
}
export async function publishDynamic(text: string, pictures: DynamicPicture[]): Promise<string> {
  const content = text.trim();
  if ((!content && !pictures.length) || content.length > 2000 || pictures.length > 9) throw new Error('请输入内容，文字最多 2000 字、图片最多 9 张');
  if (!csrf()) throw new Error('登录状态已失效，请先登录 B 站');
  const body = { dyn_req: {
    content: { contents: content ? [{ raw_text: content, type: 1, biz_id: '' }] : [] },
    scene: pictures.length ? 2 : 1, ...(pictures.length ? { pics: pictures } : {}),
    meta: { app_meta: { from: 'create.dynamic.web', mobi_app: 'web' } },
  } };
  let response: Response;
  try {
    response = await fetch(`https://api.bilibili.com/x/dynamic/feed/create/dyn?platform=web&csrf=${encodeURIComponent(csrf())}`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
  } catch { throw new Error('未收到发布确认，请先查看动态列表确认是否已发布，再决定重试；草稿已保留'); }
  if (!response.ok) throw new Error(`发布响应异常（HTTP ${response.status}），请先查看动态列表确认结果；草稿已保留`);
  let reply;
  try { reply = await response.json(); } catch { throw new Error('未能确认发布结果，请先查看动态列表；草稿已保留'); }
  if (reply.code !== 0) throw new Error(reply.message || '发布失败，草稿已保留');
  const id = reply.data?.dyn_id_str;
  if (typeof id !== 'string' || !/^\d+$/.test(id)) throw new Error('发布返回成功但未提供动态编号，请先查看动态列表确认结果；草稿已保留');
  return id;
}
