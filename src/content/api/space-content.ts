import { getJSON } from './http';

export interface SpaceContent {
  id: string; title: string; cover: string; url: string;
  author?: string; duration?: number; views?: number; likes?: string; published?: number;
}
const https = (url: unknown) => String(url || '').replace(/^http:/, 'https:').replace(/^\/\//, 'https://');

export async function spaceArticles(mid: number, offset: string): Promise<{ list: SpaceContent[]; offset: string; more: boolean }> {
  const data = await getJSON<{
    items?: { opus_id: string; content: string; jump_url?: string; cover?: { url: string }; stat?: { like?: string } }[];
    offset?: string; has_more?: boolean;
  }>('/x/polymer/web-dynamic/v1/opus/feed/space', { host_mid: mid, offset, type: 'all' });
  const next = data?.offset || '';
  return {
    list: (data?.items || []).map(item => ({ id: String(item.opus_id), title: item.content || '查看图文',
      cover: https(item.cover?.url), url: https(item.jump_url) || `https://www.bilibili.com/opus/${item.opus_id}`, likes: item.stat?.like })),
    offset: next, more: !!data?.has_more && !!next && next !== offset,
  };
}

export async function spaceAudio(mid: number, page: number): Promise<{ list: SpaceContent[]; more: boolean }> {
  const data = await getJSON<{
    data?: { id: number; title: string; cover?: string; author?: string; uname?: string; duration?: number; passtime?: number; statistic?: { play?: number } }[];
    pageCount?: number;
  } | null>('/audio/music-service/web/song/upper', { uid: mid, pn: page, ps: 30, order: 1 });
  return {
    list: (data?.data || []).map(item => ({ id: String(item.id), title: item.title || '音频', cover: https(item.cover),
      url: `https://www.bilibili.com/audio/au${item.id}`, author: item.author || item.uname, duration: item.duration,
      views: item.statistic?.play, published: item.passtime })),
    more: page < (data?.pageCount || 0),
  };
}
