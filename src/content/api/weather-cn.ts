/** 中央气象台公开城市实况与日预报；不读取网页、执行第三方脚本或推算缺失数据。 */
import { optionalFetch } from '../../shared/privacy';
import { localCities } from './weather-city-search';
import type { Loc } from '../../shared/weather-location';
import type { WeatherKind, Wx, WxDay } from './weather';

const BASE = 'https://www.nmc.cn';
const trim = (name: string) => name.replace(/(?:特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|省|市|区|县)$/, '');
type Province = { code: string; name: string };
type Station = { code: string; province: string; city: string };
let provinces: Promise<Province[]> | undefined;
const stations = new Map<string, Promise<Station[]>>();
async function read<T>(path: string): Promise<T> {
  const r = await optionalFetch('weather-cn', BASE + path);
  if (!r.ok) throw new Error(`国内天气请求失败（HTTP ${r.status}）`);
  return r.json() as Promise<T>;
}
const number = (value: unknown, low: number, high: number): number | null => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value))) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= low && n <= high ? n : null;
};
const condition = (value: unknown): string => typeof value === 'string' && value !== '-' && value !== '9999' && value.length < 30 ? value : '';
function kind(text: string): WeatherKind {
  if (/雷/.test(text)) return 'storm';
  if (/雨夹雪|冻雨/.test(text)) return 'sleet';
  if (/雪/.test(text)) return 'snow';
  if (/雨/.test(text)) return 'rain';
  if (/雾|霾/.test(text)) return 'mist';
  if (/沙|尘|风/.test(text)) return 'windy';
  if (/多云/.test(text)) return 'partly';
  if (/晴/.test(text)) return 'clear';
  return 'cloud';
}

export async function chinaWeather(loc: Loc): Promise<Wx | null> {
  // Resolve the province from the bundled coordinates, never by choosing the first homonymous city.
  const candidates = (await localCities(loc.name, 12)).filter(p => Math.abs(p.lat - loc.lat) < .6 && Math.abs(p.lon - loc.lon) < .6);
  const exact = candidates.filter(p => trim(p.name) === trim(loc.name));
  const nearby = (exact.length ? exact : candidates.slice(0, 1))
    .sort((a, b) => Math.hypot(a.lat - loc.lat, a.lon - loc.lon) - Math.hypot(b.lat - loc.lat, b.lon - loc.lon))[0];
  if (!nearby) return null;
  if (!provinces) { provinces = read<Province[]>('/rest/province'); provinces.catch(() => { provinces = undefined; }); }
  const provinceList = await provinces;
  if (!Array.isArray(provinceList)) { provinces = undefined; throw new Error('国内天气省份列表暂时不可用'); }
  const validProvinces = provinceList.filter(p => p && typeof p.name === 'string' && /^A[A-Z]{2}$/.test(p.code));
  // Municipalities omit their repeated city/province name from the local region label.
  const province = validProvinces.find(p => nearby.region.split(' · ').some(part => trim(part) === trim(p.name)))
    ?? validProvinces.find(p => trim(p.name) === trim(nearby.name));
  if (!province) return null;
  let list = stations.get(province.code);
  if (!list) { list = read<Station[]>(`/rest/province/${province.code}`); list.catch(() => stations.delete(province.code)); stations.set(province.code, list); }
  const stationList = await list;
  if (!Array.isArray(stationList)) { stations.delete(province.code); throw new Error('国内天气城市列表暂时不可用'); }
  const station = stationList.find(s => s && typeof s.city === 'string' && typeof s.province === 'string' && /^[a-zA-Z0-9]{5}$/.test(s.code) && trim(s.city) === trim(nearby.name) && trim(s.province) === trim(province.name));
  if (!station) return null;
  // The site uses 9999 for missing observations. Never display it as a temperature or probability.
  const reply = await read<{ code: number; data?: any }>(`/rest/weather?stationid=${station.code}`);
  const data = reply.data, real = data?.real;
  if (reply.code !== 0 || real?.station?.code !== station.code || trim(real.station.city || '') !== trim(station.city)) throw new Error('国内天气数据与所选城市不符');
  const temp = number(real.weather?.temperature, -100, 70);
  const sourceAt = typeof real.publish_time === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(real.publish_time) ? Date.parse(real.publish_time.replace(' ', 'T') + ':00+08:00') : NaN;
  if (temp === null || !Number.isFinite(sourceAt) || sourceAt > Date.now() + 5 * 60e3 || Date.now() - sourceAt > 6 * 3600e3) throw new Error('国内天气实况缺失或已过期');
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const hour = new Date(Date.now() + 8 * 3600e3).getUTCHours();
  const detail = Array.isArray(data.predict?.detail) ? data.predict.detail : [];
  const current = detail.find((d: any) => d.date === today);
  const predicted = condition(current?.[hour >= 6 && hour < 18 ? 'day' : 'night']?.weather?.info);
  const observed = condition(real.weather?.info);
  const text = observed || (predicted ? `${predicted}（预报）` : '天气实况');
  const days: WxDay[] = detail.flatMap((d: any) => {
    const high = number(d.day?.weather?.temperature, -100, 70), low = number(d.night?.weather?.temperature, -100, 70);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || d.date < today || high === null || low === null) return [];
    const date = Date.parse(d.date + 'T00:00:00+08:00');
    const distance = Math.round((date - Date.parse(today + 'T00:00:00+08:00')) / 86400e3);
    return [{ date: d.date, name: distance === 0 ? '今天' : distance === 1 ? '明天' : `周${'日一二三四五六'[new Date(date + 8 * 3600e3).getUTCDay()]}`, low: Math.min(low, high), high: Math.max(low, high), kind: kind(condition(d.day.weather.info) || condition(d.night.weather.info)) }];
  }).slice(0, 7);
  if (!days.length) throw new Error('国内天气预报暂时不可用');
  const wind = number(real.wind?.speed, 0, 150);
  return { loc, temp, feels: number(real.weather?.feelst, -120, 100), wind: wind === null ? null : wind * 3.6,
    rainPct: null, kind: kind(text), condition: text, offset: 28800, hours: [], days,
    at: Date.now(), source: 'nmc', sourceAt };
}
