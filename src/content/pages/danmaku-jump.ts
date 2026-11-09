import { every } from '../sched';
import { fmtDuration, h } from '../ui/dom';
import { danmakuJumpCandidates, type JumpCandidate, type JumpComment } from '../../shared/danmaku-jump';

let stop: (() => void) | null = null;
const currentVideo = () => {
  const bvid = location.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1];
  const part = new URLSearchParams(location.search).get('p') ?? '1';
  return location.hostname === 'www.bilibili.com' && bvid && /^[1-9]\d*$/.test(part) ? { bvid, part: Number(part), key: `${bvid}:${part}` } : null;
};

async function commentsFor(cid: string, signal: AbortSignal): Promise<JumpComment[]> {
  const response = await fetch(`https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`, { credentials: 'omit', signal });
  if (!response.ok || !response.body) return [];
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) { await reader.cancel(); return []; }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  const xml = new DOMParser().parseFromString(text, 'text/xml');
  if (xml.querySelector('parsererror') || xml.querySelector('chatid')?.textContent !== cid) return [];
  return [...xml.querySelectorAll('d')].slice(0, 10_000).flatMap(node => {
    const fields = node.getAttribute('p')?.split(',') ?? [];
    if (!['1', '4', '5', '6'].includes(fields[1])) return [];
    return [{ text: node.textContent ?? '', at: Number(fields[0]), author: fields[6] ?? '' }];
  });
}

/** 默认关闭，只在播放到候选附近时提示；点击后才修改原生媒体的时间。 */
export function setDanmakuJump(enabled: boolean): void {
  if (!enabled) { stop?.(); stop = null; return; }
  if (stop || !currentVideo()) return;
  let key = '', generation = 0, duration = 0;
  let video: HTMLVideoElement | null = null, candidates: JumpCandidate[] = [];
  let request: AbortController | null = null, requestTimer = 0;
  let notice: HTMLElement | null = null, noticeTimer = 0;
  const shown = new Set<number>();
  const clearNotice = () => { clearTimeout(noticeTimer); notice?.remove(); notice = null; };
  const tick = () => {
    if (notice && !notice.isConnected) clearNotice();
    const source = video, currentGeneration = generation;
    if (!source || source.paused || source.seeking || source.ended || document.hidden || notice || currentVideo()?.key !== key || !Number.isFinite(source.duration) || Math.abs(source.duration - duration) > 2) return;
    const candidate = candidates.find(item => source.currentTime >= Math.max(0, item.from - 2) && source.currentTime <= item.until && !shown.has(item.time));
    if (!candidate || document.querySelector('#margin-sponsor-notice, #margin-danmaku-airborne')) return;
    const player = source.closest<HTMLElement>('.bpx-player-video-area, .bpx-player-container');
    if (!player) return;
    shown.add(candidate.time);
    const host = h('div', { id: 'margin-danmaku-jump' });
    host.style.cssText = 'position:absolute;left:20px;bottom:64px;max-width:calc(100% - 40px);z-index:100;pointer-events:auto';
    const root = host.attachShadow({ mode: 'open' });
    const style = h('style', {}, ':host{font:13px/1.5 system-ui;color:#fff}div{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 14px;border-radius:10px;background:#202124;box-shadow:0 2px 12px #0004}button{font:inherit;border:0;border-radius:6px;padding:4px 8px;background:#fff;color:#202124;cursor:pointer}button:focus-visible{outline:2px solid #00aeec;outline-offset:2px}');
    const label = h('span', {}, `弹幕建议 ${fmtDuration(candidate.time)} · ${candidate.votes} 人`);
    const button = h('button', { type: 'button' }, '跳转');
    const close = h('button', { type: 'button', 'aria-label': '忽略本次建议', onclick: clearNotice }, '忽略');
    let resume: number | null = null;
    button.addEventListener('click', () => {
      if (video !== source || generation !== currentGeneration || currentVideo()?.key !== key || !Number.isFinite(source.duration) || Math.abs(source.duration - duration) > 2) { clearNotice(); return; }
      if (resume !== null) { source.currentTime = resume; clearNotice(); return; }
      if (candidate.time <= source.currentTime + 1 || candidate.time >= source.duration) { clearNotice(); return; }
      resume = source.currentTime;
      source.currentTime = candidate.time;
      label.textContent = `已跳到 ${fmtDuration(candidate.time)}`;
      button.textContent = '撤销跳转'; close.textContent = '关闭';
      clearTimeout(noticeTimer); noticeTimer = window.setTimeout(clearNotice, 10_000);
    });
    root.append(style, h('div', { role: 'status' }, label, button, close));
    player.append(host); notice = host;
    noticeTimer = window.setTimeout(clearNotice, 10_000);
  };
  const sync = () => {
    const current = currentVideo();
    const next = current ? document.querySelector<HTMLVideoElement>('.bpx-player-video-wrap video, .bpx-player-container video') : null;
    if (video !== next) {
      clearNotice();
      video?.removeEventListener('timeupdate', tick);
      video = next; video?.addEventListener('timeupdate', tick);
    }
    if ((current?.key ?? '') === key) return;
    key = current?.key ?? ''; const ownGeneration = ++generation;
    request?.abort(); clearTimeout(requestTimer); clearNotice(); candidates = []; duration = 0; shown.clear();
    if (!current) return;
    request = new AbortController(); const signal = request.signal;
    requestTimer = window.setTimeout(() => request?.abort(), 8000);
    void (async () => {
      try {
        const response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${current.bvid}`, { credentials: 'omit', signal });
        if (!response.ok) return;
        const meta = await response.json();
        const part = meta.code === 0 && meta.data?.pages?.find((item: { page: number }) => item.page === current.part);
        if (!part || !/^\d+$/.test(String(part.cid)) || !Number.isFinite(part.duration) || part.duration <= 0) return;
        const comments = await commentsFor(String(part.cid), signal);
        if (ownGeneration !== generation) return;
        duration = part.duration; candidates = danmakuJumpCandidates(comments, duration); tick();
      } catch { /* 弹幕不可用时继续原生播放；本页不自动重试。 */ }
      finally { if (ownGeneration === generation) clearTimeout(requestTimer); }
    })();
  };
  const cancel = every(1000, sync);
  stop = () => {
    ++generation; request?.abort(); clearTimeout(requestTimer); cancel(); clearNotice();
    video?.removeEventListener('timeupdate', tick);
  };
  sync();
}
