import { optionalFetch } from './privacy';

export interface ReleaseInfo { at: number; tag: string; name?: string; url: string }
const KEY = 'margin:update-check';
function valid(value: unknown): value is ReleaseInfo {
  if (!value || typeof value !== 'object') return false;
  const r = value as ReleaseInfo;
  return Number.isFinite(r.at) && typeof r.tag === 'string' && typeof r.url === 'string' && /^\d+(?:\.\d+){1,3}$/.test(r.tag) &&
    /^https:\/\/github\.com\/jiuyang5354\/bilibili-margin\/releases\/tag\/v?\d+(?:\.\d+){1,3}$/.test(r.url);
}
export function newerRelease(tag: string, current: string): boolean {
  const a = tag.split('.').map(Number), b = current.split('.').map(Number);
  for (let i = 0; i < 4; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}
/** 弹窗自动检查复用六小时缓存；设置中的明确检查绕过缓存，仍遵守外部服务选择。 */
export async function checkRelease(force = false): Promise<ReleaseInfo> {
  const cached: unknown = (await chrome.storage.local.get(KEY))[KEY];
  if (!force && valid(cached) && Date.now() >= cached.at && Date.now() - cached.at < 6 * 3600e3) return cached;
  const response = await optionalFetch('update', 'https://api.github.com/repos/jiuyang5354/bilibili-margin/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`更新查询失败（HTTP ${response.status}）`);
  const data = await response.json();
  const info: ReleaseInfo = { at: Date.now(), tag: String(data.tag_name || '').replace(/^v/, ''), name: typeof data.name === 'string' ? data.name : undefined, url: data.html_url };
  if (!valid(info) || data.draft || data.prerelease) throw new Error('正式版信息暂不可用');
  await chrome.storage.local.set({ [KEY]: info });
  return info;
}
