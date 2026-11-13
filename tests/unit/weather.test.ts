import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleWeatherLocation } from '../../src/background/weather-location';
import { AUTO_LOCATION_TTL, WEATHER_LOCATION_KEY, type WeatherLocationMessage } from '../../src/shared/weather-location';

const LOC_KEY = 'margin:weather-loc', CACHE_KEY = 'margin:weather-cache';
const zhuhai = { name: '珠海市', lat: 22.2716, lon: 113.5769, region: '广东省 · 中国' };
const beijing = { name: '北京市', lat: 39.9, lon: 116.4 };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const forecast = (temp = 25) => ({ utc_offset_seconds: 28800,
  current: { time: '2026-11-10T20:00', temperature_2m: temp, apparent_temperature: temp, weather_code: 3, wind_speed_10m: 9 },
  hourly: { time: ['2026-11-10T20:00'], temperature_2m: [temp], weather_code: [3], precipitation_probability: [20] },
  daily: { time: ['2026-11-10'], weather_code: [3], temperature_2m_min: [temp - 2], temperature_2m_max: [temp + 2] } });
const deferred = () => { let resolve!: (r: Response) => void; const promise = new Promise<Response>(done => { resolve = done; }); return { promise, resolve }; };
let api: typeof import('../../src/content/api/weather');
let store: Record<string, any>, listeners: ((changes: Record<string, any>, area: string) => void)[];
beforeEach(async () => {
  vi.resetModules(); store = { 'margin:settings': { privacyExternal: true } }; listeners = [];
  let queue = Promise.resolve<unknown>(undefined);
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn((m: WeatherLocationMessage) => {
    const result = queue.then(() => handleWeatherLocation(m)); queue = result.catch(() => {}); return result;
  }) }, storage: { local: {
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      const changes: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(items)) { changes[key] = { oldValue: store[key], newValue: value }; store[key] = value; }
      for (const callback of listeners) callback(changes, 'local');
    }),
  }, onChanged: { addListener: vi.fn((callback) => listeners.push(callback)) } } });
  const local = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => local.set(key, value), removeItem: (key: string) => local.delete(key) });
  vi.stubGlobal('dispatchEvent', vi.fn()); api = await import('../../src/content/api/weather');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('中文城市候选', () => {
  it('珠海与新乡直接命中行政城市，无街道排序和单城市补丁', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await api.geocodeList('珠海'))[0]).toEqual(zhuhai);
    expect((await api.geocodeList('河南新乡市'))[0]).toMatchObject({ name: '新乡市', region: '河南省 · 中国' });
    expect(fetcher).not.toHaveBeenCalled(); expect(api.savedLoc()).toBeNull();
  });
  it('同名地区可按省市限定，明确区县查询不混入地级市', async () => {
    const all = await api.geocodeList('朝阳');
    expect(all[0]).toMatchObject({ name: '朝阳市', region: '辽宁省 · 中国' });
    expect(all.some(p => p.region.includes('北京市'))).toBe(true);
    expect((await api.geocodeList('北京市朝阳区'))[0]).toMatchObject({ name: '朝阳', region: '北京市 · 中国' });
    expect((await api.geocodeList('朝阳区')).some(p => p.name === '朝阳市')).toBe(false);
  });
  it('中英文、直辖市、台湾城市和候选数量', async () => {
    expect((await api.geocodeList('Zhuhai'))[0].name).toBe('珠海市');
    expect((await api.geocodeList('上海市'))[0].name).toBe('上海市');
    expect((await api.geocodeList('台北'))[0].region).toBe('台湾省 · 中国');
    expect(await api.geocodeList('')).toEqual([]); expect(await api.geocodeList('朝阳', 1)).toHaveLength(1);
  });
  it('联网关闭时本地搜索不请求，海外搜索仍遵守隐私开关', async () => {
    store['margin:settings'].privacyExternal = false; const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await api.geocodeList('珠海'))[0].name).toBe('珠海市');
    await expect(api.geocodeList('UnlistedTown')).rejects.toMatchObject({ name: 'PrivacyBlocked' }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('在线候选优先行政中心、去重、显示地区且不自动保存', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ results: [
      { name: 'UnlistedTown', latitude: 1, longitude: 2, feature_code: 'PPLX', admin1: '村镇' },
      { name: 'UnlistedTown', latitude: 3, longitude: 4, feature_code: 'PPLA', admin1: '行政城市' },
      { name: 'UnlistedTown', latitude: 3, longitude: 4, feature_code: 'PPLA' },
    ] })));
    const places = await api.geocodeList('UnlistedTown'); expect(places).toHaveLength(2);
    expect(places[0].region).toBe('行政城市'); expect(api.savedLoc()).toBeNull();
  });
  it('HTTP错误区别于成功的空结果', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({}, 503)));
    await expect(api.geocodeList('UnlistedTown')).rejects.toThrow('城市搜索暂时不可用');
    vi.stubGlobal('fetch', vi.fn(async () => response({ results: [] }))); expect(await api.geocodeList('UnlistedTown')).toEqual([]);
  });
});

describe('共享位置与迁移', () => {
  it('保留旧手动城市并迁移到扩展存储', async () => {
    localStorage.setItem(LOC_KEY, JSON.stringify({ ...zhuhai, manual: true })); await api.loadLoc();
    expect(api.savedLoc()).toEqual({ ...zhuhai, manual: true }); expect(store[WEATHER_LOCATION_KEY].loc).toEqual(api.savedLoc()); expect(localStorage.getItem(LOC_KEY)).toBeNull();
  });
  it('旧自动位置没有可靠有效期，不能作为定位成功迁移', async () => {
    localStorage.setItem(LOC_KEY, JSON.stringify({ name: '上海', lat: 31.23, lon: 121.47 })); await api.loadLoc(); expect(api.savedLoc()).toBeNull();
  });
  it('共享选择不被其他子域旧记录覆盖', async () => {
    store[WEATHER_LOCATION_KEY] = { revision: 3, loc: { ...beijing, manual: true } };
    localStorage.setItem(LOC_KEY, JSON.stringify({ ...zhuhai, manual: true })); await api.loadLoc(); expect(api.savedLoc()?.name).toBe('北京市');
  });
  it('跨页存储事件更新城市并清除旧天气缓存', async () => {
    await api.setLoc(zhuhai); localStorage.setItem(CACHE_KEY, '{}');
    await handleWeatherLocation({ margin: 'weather-location', op: 'manual', loc: beijing });
    expect(api.savedLoc()?.name).toBe('北京市'); expect(localStorage.getItem(CACHE_KEY)).toBeNull(); expect(dispatchEvent).toHaveBeenCalled();
  });
  it('恢复自动后不再被旧手动数据复活', async () => {
    await api.setLoc(zhuhai); await api.clearLoc();
    const r = await handleWeatherLocation({ margin: 'weather-location', op: 'read', legacy: { ...beijing, manual: true } });
    expect(r.state.loc).toBeNull(); expect(api.savedLoc()).toBeNull();
  });
  it('拒绝越界坐标，保留当前选择', async () => {
    await api.setLoc(zhuhai); const r = await handleWeatherLocation({ margin: 'weather-location', op: 'manual', loc: { ...beijing, lat: 200 } });
    expect(r.ok).toBe(false); expect(r.state.loc?.name).toBe('珠海市');
  });
});

describe('定位与预报请求', () => {
  it('读取本地天气不请求网络，重新加载模块后仍能读取', async () => {
    await api.setLoc(zhuhai); vi.stubGlobal('fetch', vi.fn(async () => response(forecast())));
    await api.weather(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    vi.resetModules(); api = await import('../../src/content/api/weather');
    expect(await api.localWeather()).toMatchObject({ temp: 25, cached: true, stale: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('有效缓存优先于过期自动定位，即使断网也立即返回', async () => {
    await api.setLoc(zhuhai); vi.stubGlobal('fetch', vi.fn(async () => response(forecast()))); await api.weather();
    api.savedLoc()!.manual = false; api.savedLoc()!.at = Date.now() - AUTO_LOCATION_TTL - 1;
    const fetcher = vi.fn(async () => { throw new TypeError('offline'); }); vi.stubGlobal('fetch', fetcher);
    expect(await api.weather()).toMatchObject({ temp: 25, cached: true, stale: false }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('定位与预报均失败时保留历史缓存，更新时间不刷新', async () => {
    await api.setLoc(zhuhai); vi.stubGlobal('fetch', vi.fn(async () => response(forecast()))); const cached = await api.weather();
    cached.at = Date.now() - 3 * 86400_000; localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
    api.savedLoc()!.manual = false; api.savedLoc()!.at = Date.now() - AUTO_LOCATION_TTL - 1;
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await api.weather()).toMatchObject({ temp: 25, at: cached.at, cached: true, stale: true });
    expect(await api.localWeather()).toMatchObject({ at: cached.at, stale: true });
  });
  it('自动定位刷新到相同城市而预报失败时，恢复被位置版本清理的缓存', async () => {
    await api.setLoc(zhuhai); vi.stubGlobal('fetch', vi.fn(async () => response(forecast()))); const cached = await api.weather();
    cached.at = Date.now() - 31 * 60_000; localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
    api.savedLoc()!.manual = false; api.savedLoc()!.at = Date.now() - AUTO_LOCATION_TTL - 1;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('ipwho.is') ? response({ success: true, city: 'Zhuhai', latitude: zhuhai.lat, longitude: zhuhai.lon }) : response({}, 503)));
    expect(await api.weather()).toMatchObject({ temp: 25, at: cached.at, stale: true });
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toMatchObject({ at: cached.at });
  });
  it('损坏的缓存不展示，改用新预报', async () => {
    await api.setLoc(zhuhai); localStorage.setItem(CACHE_KEY, JSON.stringify({ loc: zhuhai, temp: 25, at: Date.now(), hours: [null] }));
    vi.stubGlobal('fetch', vi.fn(async () => response(forecast(12))));
    expect(await api.localWeather()).toBeNull(); expect((await api.weather()).temp).toBe(12);
  });
  it.each([{}, { success: false }, { success: true, city: 'bad', latitude: 91, longitude: 0 }])('IP无效响应不保存假位置 %j', async body => {
    const fetcher = vi.fn(async () => response(body)); vi.stubGlobal('fetch', fetcher);
    await expect(api.weather()).rejects.toThrow(); expect(api.savedLoc()).toBeNull(); expect(store[WEATHER_LOCATION_KEY]).toBeUndefined(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('IP HTTP失败不继续请求上海天气', async () => {
    const fetcher = vi.fn(async () => response({}, 503)); vi.stubGlobal('fetch', fetcher);
    await expect(api.weather()).rejects.toThrow('粗定位'); expect(api.savedLoc()).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('自动位置有效期内不重新定位，相同预报复用缓存', async () => {
    store[WEATHER_LOCATION_KEY] = { revision: 1, loc: { ...zhuhai, manual: false, at: Date.now() } };
    const fetcher = vi.fn(async (_url: string) => response(forecast())); vi.stubGlobal('fetch', fetcher);
    await api.weather(); await api.weather(); expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toContain('/v1/forecast');
  });
  it('过期自动位置刷新，手动位置永不被自动替换', async () => {
    store[WEATHER_LOCATION_KEY] = { revision: 1, loc: { ...zhuhai, manual: false, at: Date.now() - AUTO_LOCATION_TTL - 1 } };
    const fetcher = vi.fn(async (url: string) => url.includes('ipwho.is') ? response({ success: true, city: 'Beijing', latitude: 39.9, longitude: 116.4 }) : response(forecast())); vi.stubGlobal('fetch', fetcher);
    await api.weather(); expect(api.savedLoc()?.name).toBe('北京市'); await api.setLoc(zhuhai); await api.weather();
    expect(fetcher.mock.calls.filter(([url]) => url.includes('ipwho.is'))).toHaveLength(1);
  });
  it('同页并发首次读取合并定位和预报', async () => {
    const ip = deferred(); const fetcher = vi.fn(async (url: string) => url.includes('ipwho.is') ? ip.promise : response(forecast())); vi.stubGlobal('fetch', fetcher);
    const first = api.weather(), second = api.weather(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    ip.resolve(response({ success: true, city: 'Zhuhai', latitude: zhuhai.lat, longitude: zhuhai.lon }));
    const result = await Promise.all([first, second]); expect(result[0].loc.name).toBe('珠海市'); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('迟到的IP结果不能覆盖后选的手动城市', async () => {
    const ip = deferred(); const fetcher = vi.fn(async (url: string) => url.includes('ipwho.is') ? ip.promise : response(forecast())); vi.stubGlobal('fetch', fetcher);
    const pending = api.weather(), rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); await api.setLoc(zhuhai); await api.weather();
    ip.resolve(response({ success: true, city: 'Beijing', latitude: 39.9, longitude: 116.4 })); await rejected; expect(api.savedLoc()).toMatchObject({ ...zhuhai, manual: true });
  });
  it('换城后的旧预报不得覆盖新缓存', async () => {
    const old = deferred(); vi.stubGlobal('fetch', vi.fn(async (url: string) => new URL(url).searchParams.get('latitude') === String(zhuhai.lat) ? old.promise : response(forecast(12))));
    await api.setLoc(zhuhai); const pending = api.weather(), rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); await api.setLoc(beijing); await api.weather(); old.resolve(response(forecast())); await rejected;
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!).loc.name).toBe('北京市');
  });
  it.each([false, true])('恢复自动会使旧预报失效，包括重新选择相同坐标 %s', async reselect => {
    const old = deferred(); vi.stubGlobal('fetch', vi.fn(() => old.promise));
    await api.setLoc(zhuhai); const pending = api.weather(), rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); await api.clearLoc(); if (reselect) await api.setLoc(zhuhai);
    old.resolve(response(forecast())); await rejected; expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });
  it.each([false, true])('坐标不同或时间在未来的预报不得复用 %s', async future => {
    await api.setLoc(zhuhai); vi.stubGlobal('fetch', vi.fn(async () => response(forecast()))); const cached = await api.weather();
    if (future) cached.at = Date.now() + 86400_000; else cached.loc = beijing;
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached)); const fetcher = vi.fn(async () => response(forecast(12))); vi.stubGlobal('fetch', fetcher);
    expect((await api.weather()).temp).toBe(12); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('不完整预报不缓存，关闭联网后不再请求', async () => {
    await api.setLoc(zhuhai); const fetcher = vi.fn(async () => response({ current: { temperature_2m: 10 } })); vi.stubGlobal('fetch', fetcher);
    await expect(api.weather()).rejects.toThrow('数据不完整'); expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    store['margin:settings'] = { privacyExternal: false }; for (const cb of listeners) cb({ 'margin:settings': { newValue: store['margin:settings'] } }, 'local');
    await expect(api.weather()).rejects.toMatchObject({ name: 'PrivacyBlocked' }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
