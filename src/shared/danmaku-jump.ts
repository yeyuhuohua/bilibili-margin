export interface JumpComment { text: string; at: number; author: string }
export interface JumpCandidate { time: number; from: number; until: number; votes: number }

export function jumpTime(text: string): number | null {
  if (text.length > 256 || !/(空降|跳伞|传送门)/.test(text)) return null;
  const matches = [...text.matchAll(/(?<![\d:：-])(\d{1,3})[:：](\d{2})(?:[:：](\d{2}))?(?![\d:：])|(?<![\d-])(\d{1,3})分(?:(\d{1,2})秒)?(?!\d)/g)];
  if (matches.length !== 1) return null;
  const [, first, second, third, minutes, seconds] = matches[0];
  if (minutes !== undefined) return Number(seconds ?? 0) < 60 ? Number(minutes) * 60 + Number(seconds ?? 0) : null;
  if (Number(second) >= 60 || (third !== undefined && Number(third) >= 60)) return null;
  return third === undefined ? Number(first) * 60 + Number(second) : Number(first) * 3600 + Number(second) * 60 + Number(third);
}

/** 只聚合不同发送者一致的明确时间；发送者哈希仅在本次计算中用于去重。 */
export function danmakuJumpCandidates(comments: JumpComment[], duration: number): JumpCandidate[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const groups = new Map<number, { authors: Set<string>; from: number; until: number }>();
  for (const comment of comments.slice(0, 10_000)) {
    const time = jumpTime(comment.text);
    if (time === null || !Number.isFinite(comment.at) || comment.at < 0 || time < comment.at + 5 || time >= duration - 1 || !/^[\da-f]{4,32}$/i.test(comment.author)) continue;
    let group = groups.get(time);
    if (!group) { group = { authors: new Set(), from: comment.at, until: comment.at }; groups.set(time, group); }
    if (group.authors.has(comment.author)) continue;
    group.authors.add(comment.author);
    group.from = Math.min(group.from, comment.at);
    group.until = Math.max(group.until, comment.at);
  }
  return [...groups].filter(([, group]) => group.authors.size >= 3).map(([time, group]) => ({
    time, from: group.from, until: Math.min(time - 5, group.until + 15), votes: group.authors.size,
  })).sort((a, b) => a.from - b.from || a.time - b.time);
}
