/* eslint-disable @typescript-eslint/no-explicit-any */
/** 天气：Open-Meteo（免密钥、CORS 开放）+ ipwho.is 按 IP 粗定位；城市可手动改（Open-Meteo 地理编码）。 */
import { optionalFetch, PrivacyBlocked } from '../../shared/privacy';
import { loadSettings } from '../../shared/settings';
import { AUTO_LOCATION_TTL, WEATHER_LOCATION_KEY, validLocation, type Loc, type WeatherLocation, type WeatherLocationMessage } from '../../shared/weather-location';
import { localCities } from './weather-city-search';
export type { Loc } from '../../shared/weather-location';

export type WeatherKind = 'clear' | 'partly' | 'cloud' | 'rain' | 'drizzle' | 'storm' | 'snow' | 'sleet' | 'mist' | 'windy' | 'heat';
export interface WxHour { label: string; hour: number; kind: WeatherKind; temp: number }
export interface WxDay { name: string; kind: WeatherKind; low: number; high: number }
export interface Wx {
  loc: Loc; temp: number; feels: number; wind: number; rainPct: number; kind: WeatherKind; condition: string;
  offset: number; hours: WxHour[]; days: WxDay[]; at: number;
  cached?: boolean;
  stale?: boolean;
}

const LOC_KEY = 'margin:weather-loc';
const CACHE_KEY = 'margin:weather-cache';
const TTL = 30 * 60e3;
let locRevision = 0;
let location: WeatherLocation | null = null, watchingLocation = false;
let readingLocation: Promise<void> | null = null;
let locating: { revision: number; promise: Promise<Loc> } | null = null;
let fetchingWeather: { revision: number; promise: Promise<Wx> } | null = null;

function acceptLocation(next: WeatherLocation): void {
  const previous = location;
  if (previous && next.revision < previous.revision) return;
  location = next;
  if (previous && previous.revision !== next.revision) {
    locRevision++;
    localStorage.removeItem(CACHE_KEY);
    dispatchEvent(new Event('margin:wx-loc'));
  }
}

async function locationMessage(message: WeatherLocationMessage): Promise<void> {
  const reply = await chrome.runtime.sendMessage(message);
  if (reply?.state) acceptLocation(reply.state);
  if (!reply?.ok) {
    if (reply?.state) throw new DOMException('天气位置已更改', 'AbortError');
    throw new Error('天气位置保存失败，请重试');
  }
}

export async function loadLoc(): Promise<void> {
  if (!watchingLocation) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[WEATHER_LOCATION_KEY]) return;
      const next = changes[WEATHER_LOCATION_KEY].newValue as WeatherLocation | undefined;
      if (!next) { location = null; locRevision++; localStorage.removeItem(CACHE_KEY); dispatchEvent(new Event('margin:wx-loc')); }
      else if (Number.isSafeInteger(next.revision) && (next.loc === null || validLocation(next.loc))) acceptLocation(next);
    });
    watchingLocation = true;
  }
  if (!readingLocation) {
    readingLocation = (async () => {
      let legacy: Loc | null = null;
      try { legacy = JSON.parse(localStorage.getItem(LOC_KEY) || 'null'); } catch { /* Ignore corrupt legacy data. */ }
      await locationMessage({ margin: 'weather-location', op: 'read', legacy });
      localStorage.removeItem(LOC_KEY);
    })().finally(() => { readingLocation = null; });
  }
  return readingLocation;
}

/** WMO 天气代码 → 天空种类 + 中文 */
export function wmo(code: number): [WeatherKind, string] {
  if (code === 0) return ['clear', '晴'];
  if (code === 1) return ['partly', '晴间多云'];
  if (code === 2) return ['partly', '多云'];
  if (code === 3) return ['cloud', '阴'];
  if (code === 45 || code === 48) return ['mist', '雾'];
  if (code >= 51 && code <= 55) return ['drizzle', '毛毛雨'];
  if (code === 56 || code === 57 || code === 66 || code === 67) return ['sleet', '冻雨'];
  if (code === 61) return ['rain', '小雨'];
  if (code === 63) return ['rain', '中雨'];
  if (code === 65) return ['rain', '大雨'];
  if (code >= 71 && code <= 77) return ['snow', code >= 75 ? '大雪' : '雪'];
  if (code >= 80 && code <= 82) return ['rain', '阵雨'];
  if (code === 85 || code === 86) return ['snow', '阵雪'];
  if (code >= 95) return ['storm', '雷雨'];
  return ['cloud', '多云'];
}

export function savedLoc(): Loc | null {
  return location?.loc ?? null;
}

export async function setLoc(loc: Loc): Promise<void> {
  await loadLoc();
  locRevision++;
  await locationMessage({ margin: 'weather-location', op: 'manual', loc });
}
/** 回到按 IP 自动定位（#3：移动宽带的 IP 定位常常不准，所以设置里可以手动选城市，也能退回自动） */
export async function clearLoc(): Promise<void> {
  await loadLoc();
  locRevision++;
  await locationMessage({ margin: 'weather-location', op: 'clear' });
}

async function ipLoc(): Promise<Loc> {
  const response = await optionalFetch('ip', 'https://ipwho.is/?fields=success,city,latitude,longitude');
  if (!response.ok) throw new Error('IP 粗定位暂时不可用，请选择城市');
  const r = await response.json();
  const loc = { name: r.city || '当前位置', lat: r.latitude, lon: r.longitude };
  if (!r.success || !validLocation(loc)) throw new Error('IP 粗定位失败，请选择城市');
  const names = await localCities(loc.name, 6);
  const nearby = names.find(p => Math.abs(p.lat - loc.lat) < .5 && Math.abs(p.lon - loc.lon) < .5);
  return nearby ? { ...loc, name: nearby.name, region: nearby.region } : loc;
}

export interface Place extends Loc { region: string }
/** 城市候选：同名城市很多（如「朝阳」），带上省份 / 国家给人挑 */
export async function geocodeList(q: string, n = 6): Promise<Place[]> {
  const query = q.trim();
  if (!query) return [];
  const local = await localCities(query, n);
  if (local.length) return local;
  const queries = [query];
  if (/^[\u3400-\u9fff]{2,}$/.test(query) && !/(?:省|市|区|县|自治州|盟|旗|镇|乡|村)$/.test(query)) queries.push(`${query}市`);
  const results = await Promise.allSettled(queries.map(async name => {
    const response = await optionalFetch('city', `https://geocoding-api.open-meteo.com/v1/search?count=${n}&language=zh&name=${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error(`城市搜索失败（HTTP ${response.status}）`);
    const data = await response.json();
    if (data?.error) throw new Error(data.reason || '城市搜索暂时不可用');
    return (data?.results ?? []) as any[];
  }));
  const successful = results.filter(result => result.status === 'fulfilled');
  const blocked = results.find(result => result.status === 'rejected' && result.reason instanceof PrivacyBlocked);
  if (blocked?.status === 'rejected') throw blocked.reason;
  if (!successful.length) throw new Error('城市搜索暂时不可用');
  const places = new Map<string, Place>();
  const candidates = successful.flatMap(result => result.value);
  candidates.sort((a, b) => Number(/^PPL[AC]/.test(b.feature_code ?? '')) - Number(/^PPL[AC]/.test(a.feature_code ?? '')) || (Number(b.population) || 0) - (Number(a.population) || 0));
  for (const g of candidates) {
    if (!validLocation({ name: g.name, lat: g.latitude, lon: g.longitude })) continue;
    const key = `${g.latitude},${g.longitude}`;
    if (places.has(key)) continue;
    const name = g.name;
    const country = g.country_code === 'TW' ? '中国' : g.country;
    const admin1 = g.country_code === 'TW' && g.admin1 ? '台湾省' : g.admin1;
    const region = [...new Set([admin1, g.admin2, country].filter((part: unknown) => typeof part === 'string' && part && part !== name))].join(' · ');
    places.set(key, { name, lat: g.latitude, lon: g.longitude, region });
  }
  return [...places.values()].slice(0, n);
}

const WEEK = '日一二三四五六';

function readCache(loc: Loc | null): Wx | null {
  if (!loc) return null;
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') as Wx | null;
    if (!c || !validLocation(c.loc) || c.loc.lat !== loc.lat || c.loc.lon !== loc.lon
      || ![c.temp, c.feels, c.wind, c.rainPct, c.offset, c.at].every(Number.isFinite)
      || c.at <= 0 || c.at > Date.now() || typeof c.condition !== 'string' || typeof c.kind !== 'string'
      || !Array.isArray(c.hours) || !c.hours.every(x => x && Number.isFinite(x.temp) && Number.isFinite(x.hour) && typeof x.label === 'string' && typeof x.kind === 'string')
      || !Array.isArray(c.days) || !c.days.every(x => x && Number.isFinite(x.low) && Number.isFinite(x.high) && typeof x.name === 'string' && typeof x.kind === 'string')) return null;
    return { ...c, loc, cached: true, stale: Date.now() - c.at >= TTL };
  } catch { return null; }
}

/** Read saved data without contacting location or forecast services. */
export async function localWeather(): Promise<Wx | null> {
  const settings = await loadSettings();
  if (!settings.enabled || !settings.privacyExternal) return null;
  await loadLoc();
  return readCache(savedLoc());
}

export async function weather(): Promise<Wx> {
  const settings = await loadSettings();
  if (!settings.enabled || !settings.privacyExternal) throw new PrivacyBlocked();
  await loadLoc();
  let loc = savedLoc();
  const cached = readCache(loc);
  if (cached && !cached.stale) return cached;
  if (!loc?.manual && (!loc?.at || Date.now() - loc.at >= AUTO_LOCATION_TTL || loc.at > Date.now())) {
    const stateRevision = location!.revision;
    if (!locating || locating.revision !== stateRevision) {
      const promise = (async () => {
        const found = await ipLoc();
        await locationMessage({ margin: 'weather-location', op: 'auto', loc: found, revision: stateRevision });
        return savedLoc()!;
      })();
      locating = { revision: stateRevision, promise };
    }
    const request = locating;
    try { loc = await request.promise; }
    catch (error) {
      if (!loc || location!.revision !== stateRevision || error instanceof PrivacyBlocked) throw error;
      // An unavailable location service must not discard the last known city.
    } finally { if (locating === request) locating = null; }
  }
  if (!loc) throw new Error('请选择天气城市');
  const revision = locRevision, stateRevision = location!.revision;
  if (fetchingWeather?.revision === stateRevision) return fetchingWeather.promise;
  const getForecast = async (): Promise<Wx> => {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&timezone=auto&forecast_days=7`
      + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m'
      + '&hourly=temperature_2m,weather_code,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min';
    const response = await optionalFetch('weather', u);
    if (!response.ok) throw new Error(`天气加载失败（HTTP ${response.status}）`);
    const d: any = await response.json();
    await loadLoc();
    if (revision !== locRevision || location!.revision !== stateRevision) throw new DOMException('天气位置已更改', 'AbortError');
    if (!d?.current || typeof d.current.time !== 'string' || !Number.isFinite(d.current.temperature_2m)
      || !['time', 'weather_code', 'temperature_2m'].every(k => Array.isArray(d.hourly?.[k]))
      || !['time', 'weather_code', 'temperature_2m_min', 'temperature_2m_max'].every(k => Array.isArray(d.daily?.[k]))) throw new Error('天气数据不完整，请重试');
    const offset = Number(d.utc_offset_seconds) || 0;
    const nowIso: string = d.current.time; // 当地时间 "2026-10-29T01:15"
    const nowH = new Date(`${nowIso.slice(0, 13)}:00Z`).getTime();
    const times: string[] = d.hourly.time;
    let i0 = times.findIndex((t) => new Date(`${t}Z`).getTime() >= nowH);
    if (i0 < 0) i0 = 0;
    const hours: WxHour[] = [];
    for (let k = 0; k < 6; k++) {
      const i = i0 + k * 3;
      if (i >= times.length) break;
      const hr = Number(times[i].slice(11, 13));
      hours.push({ label: k === 0 ? '现在' : String(hr).padStart(2, '0'), hour: hr, kind: wmo(d.hourly.weather_code[i])[0], temp: d.hourly.temperature_2m[i] });
    }
    const days: WxDay[] = (d.daily.time as string[]).map((t, i) => ({
      name: i === 0 ? '今天' : i === 1 ? '明天' : `周${WEEK[new Date(`${t}T00:00Z`).getUTCDay()]}`,
      kind: wmo(d.daily.weather_code[i])[0], low: d.daily.temperature_2m_min[i], high: d.daily.temperature_2m_max[i],
    }));
    const [kind, condition] = wmo(d.current.weather_code);
    const wx: Wx = {
      loc, temp: d.current.temperature_2m, feels: d.current.apparent_temperature, wind: d.current.wind_speed_10m,
      rainPct: d.hourly.precipitation_probability?.[i0] ?? 0, kind, condition, offset, hours, days, at: Date.now(),
    };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(wx)); } catch { /* Fresh weather remains usable when storage is full. */ }
    return wx;
  };
  const pending = { revision: stateRevision, promise: getForecast() };
  fetchingWeather = pending;
  try { return await pending.promise; }
  catch (error) {
    if (revision !== locRevision || location!.revision !== stateRevision || error instanceof PrivacyBlocked) throw error;
    const fallback = readCache(loc) ?? (cached?.loc.lat === loc.lat && cached.loc.lon === loc.lon ? { ...cached, loc, cached: true, stale: true } : null);
    if (fallback) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(fallback)); } catch { /* Continue displaying the readable cache. */ }
      return fallback;
    }
    throw error;
  } finally { if (fetchingWeather === pending) fetchingWeather = null; }
}
