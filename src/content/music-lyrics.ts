export interface LyricLine { at: number; text: string }

/** LRC is local text only; multiple timestamps and the standard millisecond offset are supported. */
export function parseLrc(text: string): LyricLine[] {
  const offset = Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  const lines: LyricLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const words = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!words) continue;
    for (const match of line.matchAll(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)) {
      const at = Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || 0}`) + offset;
      if (Number.isFinite(at)) lines.push({ at: Math.max(0, at), text: words.slice(0, 500) });
    }
    if (lines.length > 10000) throw new Error('歌词行数过多');
  }
  return lines.sort((a, b) => a.at - b.at);
}

export function lyricIndex(lines: LyricLine[], time: number): number {
  let left = 0, right = lines.length;
  while (left < right) { const mid = (left + right) >>> 1; if (lines[mid].at <= time) left = mid + 1; else right = mid; }
  return left - 1;
}
