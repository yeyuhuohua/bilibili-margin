/**
 * 更新提醒的本地状态（v0.61）。
 *
 * 后台定时查到新版本后写在这里；页面上的提示与扩展图标上的角标都读它。
 * 只记「有哪个新版本、发布页在哪」——不下载、不解包、不碰扩展目录。
 */

export const UPDATE_REMINDER_KEY = 'margin:update-reminder';

export interface UpdateReminder {
  /** 新版本号，例如 0.60.91 */
  tag: string;
  /** 发布页地址：只接受官方仓库的 releases 页面 */
  url: string;
  /** 发现时间 */
  at: number;
  /** 用户已经看过提示，不再重复弹 */
  seen?: boolean;
}

/** 只认官方仓库的发布页地址 */
const RELEASE_URL = /^https:\/\/github\.com\/jiuyang5354\/bilibili-margin\/releases\/tag\/v\d+(?:\.\d+){1,3}$/;

export function isReleaseUrl(url: unknown): url is string {
  return typeof url === 'string' && RELEASE_URL.test(url);
}

export async function readReminder(): Promise<UpdateReminder | null> {
  const raw = (await chrome.storage.local.get(UPDATE_REMINDER_KEY))[UPDATE_REMINDER_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as UpdateReminder;
  return typeof value.tag === 'string' && /^\d+(?:\.\d+){1,3}$/.test(value.tag) && isReleaseUrl(value.url) && Number.isFinite(value.at)
    ? value : null;
}

export async function writeReminder(value: UpdateReminder): Promise<void> {
  await chrome.storage.local.set({ [UPDATE_REMINDER_KEY]: value });
}

export async function clearReminder(): Promise<void> {
  await chrome.storage.local.remove(UPDATE_REMINDER_KEY);
}
