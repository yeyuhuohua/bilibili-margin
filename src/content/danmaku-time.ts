/**
 * 弹幕空降的时间解析：从一条弹幕文本里读出可跳转的时间点（秒），读不出来就返回 NaN。
 * 判定规则移植自 Bilibili-Evolved 的 danmakuAirborne 组件（作者 kdxcxs，MIT）：
 * 只认「03:20」「1:02:33」「空降 2 分 15 秒」「315」这类能明确读成时间的写法，
 * 其余（播放量、型号、年份、序号、233 之类）一律放弃，宁可漏认也不要误跳。
 * 和上游的一处差别：秒数（以及时分秒里的分钟）超出 0~59 的畸形数字也丢掉，如「3:99」「1:99:00」。
 */

/** 中文数字逐字对应，用来把「二十五」这类写法转成阿拉伯数字 */
const cnChars = '零一二三四五六七八九'.split('');
/** 优先匹配带显式分隔符的时间写法，兼容冒号、句号、逗号和中英文单位 */
const separatedRegex = /([\d零一二三四五六七八九十]+)\s*(小时|[:：时分.,。，,])\s*([\d零一二三四五六七八九十]+)(?:\s*([:：分.,。，,])\s*([\d零一二三四五六七八九十]+))?/;
/** 紧凑数字只处理 3~4 位，统一按「分秒」解析，避免从更长的数字串里截出错的时间 */
const compactSource = /\d{3,4}/g;
/** B 站最常见的大笑弹幕，不该被当成空降时间 */
const compactBlacklist = new Set(['233', '2333']);
const decimalLikeSeparators = new Set(['.', '。', ',', '，']);
/** 候选时间后面紧跟数值、计量、金额语境的后缀，大概率不是时间，比如「3.9万人+」 */
const countLikeSuffix = /^(?:\s)*(?:[%％+＋]|[wWkK万千百亿人位名个赞倍元])/;
/** 年份和序号语境里的数字更像编号，比如「2025的第一波」 */
const yearLikeSuffix = /^(?:\s)*(?:年|的第|年第|波|批)/;

/** 把「三十一」「十二」「7」这类写法转成数字；转不出来返回 NaN */
function parseCnNumber(text: string | null): number {
  if (!text) return NaN;
  const parts = text.split('十');
  if (parts.length === 1) {
    const converted = text.replace(/[零一二三四五六七八九]/g, (ch) => String(cnChars.indexOf(ch)));
    return parseInt(converted, 10);
  }
  if (parts.length === 2) {
    const first = parts[0] === '' ? 1 : cnChars.indexOf(parts[0]);
    const second = parts[1] === '' ? 0 : cnChars.indexOf(parts[1]);
    if (first < 0 || second < 0) return NaN;
    return first * 10 + second;
  }
  return NaN;
}

/** 从 endIndex 往后看四个字符，是否像「万」「人」「%」这类计量后缀 */
const hasCountLikeSuffix = (text: string, endIndex: number): boolean => countLikeSuffix.test(text.slice(endIndex, endIndex + 4));

/** 从 endIndex 往后看三个字符，是否像「年」「的第」「波」这类年份序号后缀 */
const hasYearLikeSuffix = (text: string, endIndex: number): boolean => yearLikeSuffix.test(text.slice(endIndex, endIndex + 3));

/** 数字紧挨着字母，多半是型号，比如「054A」 */
const hasAlphabetAdjacent = (text: string, startIndex: number, endIndex: number): boolean =>
  /[A-Za-z]/.test(text[startIndex - 1] ?? '') || /[A-Za-z]/.test(text[endIndex] ?? '');

/** 带分隔符的写法：1:02:33 / 2 分 15 秒 / 03:20 / 空降315（无分隔符时留给紧凑规则） */
function separatedTime(text: string): number {
  const m = separatedRegex.exec(text);
  if (!m) return NaN;
  const [, firstText, firstSep, secondText, secondSep, thirdText] = m;
  const endIndex = m.index + m[0].length;
  if (text[m.index - 1] === '-' || separatedRegex.test(text.slice(endIndex))) return NaN;
  if (hasCountLikeSuffix(text, endIndex)) return NaN;
  // 句号逗号更像小数写法，只接受两位秒数，避免把「3.9万人+」当成 3 分 9 秒
  if (decimalLikeSeparators.has(firstSep)) {
    if (!thirdText ? secondText.length !== 2 : secondText.length !== 2 || thirdText.length !== 2) return NaN;
  }
  if (thirdText) {
    if (decimalLikeSeparators.has(secondSep ?? '') && thirdText.length !== 2) return NaN;
    const hour = parseCnNumber(firstText);
    const minute = parseCnNumber(secondText);
    const second = parseCnNumber(thirdText);
    if ([hour, minute, second].some((v) => Number.isNaN(v))) return NaN;
    // 「2 分 15 秒」这种只有分秒的写法会落到三段里，缺「时」就不是时分秒
    if (text.includes('分') && !text.includes('时')) return NaN;
    // 时分秒里的分秒各自不到 60；超出的是别人写的畸形数字，不是时间
    if (minute >= 60 || second >= 60) return NaN;
    return hour * 3600 + minute * 60 + second;
  }
  const minute = parseCnNumber(firstText);
  const second = parseCnNumber(secondText);
  if (![minute, second].every(Number.isFinite)) return NaN;
  // 「3:99」这种秒数超出的直接丢掉；分不设上限，长视频写「100:00」是正常时间轴
  if (second >= 60) return NaN;
  if (firstSep === '小时' || firstSep === '时') return minute * 3600 + second * 60;
  return minute * 60 + second;
}

/** 没有分隔符的紧凑写法：315 → 3 分 15 秒，1030 → 10 分 30 秒 */
function compactTime(text: string): number {
  const re = new RegExp(compactSource.source, 'g');
  let matched: number | null = null;
  let m = re.exec(text);
  while (m !== null) {
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    // 只接受独立的数字段，别从更长的数字串里截出 3~4 位
    if (/\d/.test(text[start - 1] ?? '') || /\d/.test(text[end] ?? '')) {
      m = re.exec(text);
      continue;
    }
    if (compactBlacklist.has(raw) || hasAlphabetAdjacent(text, start, end) || hasCountLikeSuffix(text, end) || hasYearLikeSuffix(text, end)) {
      m = re.exec(text);
      continue;
    }
    const second = parseInt(raw.slice(-2), 10);
    if (second < 60) {
      // 一条弹幕里出现两个都说得通的紧凑时间，语义有歧义，干脆不认
      if (matched !== null) return NaN;
      matched = parseInt(raw.slice(0, -2), 10) * 60 + second;
    }
    m = re.exec(text);
  }
  return matched ?? NaN;
}

/** 弹幕文本 → 可跳转的时间点（秒）；认不出来返回 NaN */
export function parseAirborneTime(text: string | null): number {
  if (!text) return NaN;
  const time = separatedRegex.test(text) ? separatedTime(text) : compactTime(text);
  return Number.isFinite(time) ? time : NaN;
}
