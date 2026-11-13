export interface Candidate { bvid: string; title: string }
export interface Context { enabled: boolean; category: string; order: string }

export const normalizeTitle = (text: string): string =>
  text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();

/** Only exact targets move; both groups retain native relative order. */
export function exactFirst<T extends Candidate>(items: readonly T[], query: string, context: Context): T[] {
  const original = [...items];
  if (!context.enabled || context.category !== 'video' || context.order !== 'totalrank') return original;
  const raw = query.trim();
  const isBvid = /^BV[0-9A-Za-z]{10}$/.test(raw);
  const title = normalizeTitle(raw);
  if (!isBvid && Array.from(title.replace(/\s/gu, '')).length < 6) return original;
  const matches: T[] = [], rest: T[] = [];
  for (const item of items) {
    const match = isBvid ? item.bvid === raw : normalizeTitle(item.title) === title;
    (match ? matches : rest).push(item);
  }
  return matches.concat(rest);
}
