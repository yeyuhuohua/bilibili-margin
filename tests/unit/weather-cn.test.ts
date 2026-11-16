import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleWeatherLocation } from '../../src/background/weather-location';
import { WEATHER_LOCATION_KEY } from '../../src/shared/weather-location';
const loc = { name: '珠海市', lat: 22.2716, lon: 113.5769, region: '广东省 · 中国', manual: true };
const record = () => ({ code: 0, data: {
  real: { station: { code: 'sdnjf', province: '广东省', city: '珠海' }, publish_time: '2026-11-14 20:45', weather: { temperature: 22, feelst: 24.6, info: '-', img: '9999' }, wind: { speed: 1.3 } },
  predict: { detail: [
    { date: '2026-11-14', day: { weather: { temperature: '9999', info: '9999' } }, night: { weather: { temperature: '21', info: '晴' } } },
    { date: '2026-11-15', day: { weather: { temperature: '25', info: '晴' } }, night: { weather: { temperature: '22', info: '晴' } } },
    { date: '2026-11-16', day: { weather: { temperature: '26', info: '多云' } }, night: { weather: { temperature: '23', info: '多云' } } },
  ] },
} });
let store: Record<string, any>, fetcher: ReturnType<typeof vi.fn>, body: ReturnType<typeof record>;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T13:20:00Z'));
  store = { 'margin:settings': { enabled: true, privacyExternal: true }, [WEATHER_LOCATION_KEY]: { revision: 1, loc } };
  vi.stubGlobal('chrome', { storage: { local: { get: async (key: string) => ({ [key]: store[key] }), set: async (patch: any) => Object.assign(store, patch) }, onChanged: { addListener: vi.fn() } }, runtime: { sendMessage: handleWeatherLocation } });
  const local = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => local.set(k, v), removeItem: (k: string) => local.delete(k) });
  vi.stubGlobal('dispatchEvent', vi.fn()); body = record();
  fetcher = vi.fn(async (address: string) => {
    const u = new URL(address); let data: unknown;
    if (u.host !== 'www.nmc.cn') throw new Error('原预报源超时');
    if (u.pathname === '/rest/province') data = [{ code: 'AGD', name: '广东省' }, { code: 'ABJ', name: '北京市' }, { code: 'ASH', name: '上海市' }, { code: 'ALN', name: '辽宁省' }];
    else if (u.pathname === '/rest/province/AGD') data = [{ code: 'sdnjf', province: '广东省', city: '珠海' }, { code: 'SZcap', province: '广东省', city: '深圳' }];
    else if (u.pathname === '/rest/province/ABJ') data = [{ code: 'Bjabc', province: '北京市', city: '朝阳' }, { code: 'BJcap', province: '北京市', city: '北京' }];
    else if (u.pathname === '/rest/province/ASH') data = [{ code: 'SHcap', province: '上海市', city: '上海' }];
    else if (u.pathname === '/rest/weather') data = body;
    else throw new Error('Unexpected station lookup');
    return new Response(JSON.stringify(data));
  }); vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('国内天气直连', () => {
  it('原预报源不可达时仍取得新实况，记录真实来源和发布时间', async () => {
    const { weather } = await import('../../src/content/api/weather');
    const wx = await weather();
    expect(wx).toMatchObject({ temp: 22, feels: 24.6, rainPct: null, source: 'nmc', condition: '晴（预报）', hours: [] });
    expect(wx.wind).toBeCloseTo(4.68);
    expect(wx.sourceAt).toBe(Date.parse('2026-11-14T20:45:00+08:00'));
    expect(wx.days[0]).toMatchObject({ date: '2026-11-15', name: '明天', high: 25, low: 22 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.every(([u]) => new URL(u).hostname === 'www.nmc.cn')).toBe(true);
    expect(JSON.parse(localStorage.getItem('margin:weather-cache')!).source).toBe('nmc');
    await weather(); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('冷启动并发调用合并查询，不重复加载省份、城市和实况', async () => {
    const { weather } = await import('../../src/content/api/weather');
    const [a, b] = await Promise.all([weather(), weather()]); expect(a.temp).toBe(22); expect(b.temp).toBe(22); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('按坐标和省份区分同名朝阳，不采用另一个省的第一个结果', async () => {
    body.data.real.station = { code: 'Bjabc', province: '北京市', city: '朝阳' };
    const { chinaWeather } = await import('../../src/content/api/weather-cn');
    expect((await chinaWeather({ name: '朝阳', lat: 39.9215, lon: 116.4434, region: '北京市 · 中国' }))?.temp).toBe(22);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/rest/province/ABJ'))).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/rest/province/ALN'))).toBe(false);
  });
  it('海外或本地无法确认的城市不请求国内源', async () => {
    const { chinaWeather } = await import('../../src/content/api/weather-cn');
    expect(await chinaWeather({ name: 'London', lat: 51.5, lon: -.1 })).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('匹配深圳市时不被坐标更近的模糊区县候选替代', async () => {
    body.data.real.station = {code:'SZcap',city:'深圳',province:'广东省'};
    const { chinaWeather } = await import('../../src/content/api/weather-cn');
    expect((await chinaWeather({name:'深圳市',lat:22.54,lon:114.06}))?.temp).toBe(22);
  });
  it.each([{name:'北京市',lat:39.9075,lon:116.3972,code:'BJcap',city:'北京'},{name:'上海市',lat:31.23,lon:121.47,code:'SHcap',city:'上海'}])('直辖市 $name 的本地地区只有“中国”时仍可匹配省级站点', async ({code,city,...place}) => {
    body.data.real.station = {code,city,province:place.name};
    const { chinaWeather } = await import('../../src/content/api/weather-cn');
    expect((await chinaWeather(place))?.temp).toBe(22);
  });
  it('夜间升温时按两个预报值形成范围，不丢弃这一天', async () => {
    body.data.predict.detail[1].day.weather.temperature = '21'; body.data.predict.detail[1].night.weather.temperature = '24';
    const { chinaWeather } = await import('../../src/content/api/weather-cn');
    expect((await chinaWeather(loc))?.days[0]).toMatchObject({ date: '2026-11-15', low: 21, high: 24 });
  });
  it('源缺少的体感、风速、概率保持缺失，不显示 9999 或零概率', async () => {
    body.data.real.weather.feelst = 9999; body.data.real.wind.speed = 9999;
    const { chinaWeather } = await import('../../src/content/api/weather-cn');
    expect(await chinaWeather(loc)).toMatchObject({ feels: null, wind: null, rainPct: null, hours: [] });
  });
  it.each(['missing-temperature', 'wrong-station', 'expired', 'missing-days'])('拒绝不可信实况：%s', async scenario => {
    if (scenario === 'missing-temperature') body.data.real.weather.temperature = 9999;
    if (scenario === 'wrong-station') body.data.real.station.city = '广州';
    if (scenario === 'expired') body.data.real.publish_time = '2026-11-13 20:45';
    if (scenario === 'missing-days') body.data.predict.detail = [];
    const { chinaWeather } = await import('../../src/content/api/weather-cn'); await expect(chinaWeather(loc)).rejects.toThrow();
  });
  it('国内源失败后沿用原源，不伪造国内成功数据', async () => {
    fetcher.mockImplementation(async address => {
      if (new URL(address).host === 'www.nmc.cn') return new Response('{}', { status: 503 });
      return new Response(JSON.stringify({ utc_offset_seconds: 28800, current: { time: '2026-11-14T21:00', temperature_2m: 18, apparent_temperature: 17, weather_code: 3, wind_speed_10m: 9 }, hourly: { time: ['2026-11-14T21:00'], temperature_2m: [18], weather_code: [3] }, daily: { time: ['2026-11-14'], weather_code: [3], temperature_2m_min: [16], temperature_2m_max: [19] } }));
    });
    const { weather } = await import('../../src/content/api/weather'); const wx = await weather(); expect(wx.temp).toBe(18); expect(wx.source).toBeUndefined();
  });
  it('关闭外部服务时零请求，包括新的国内源', async () => {
    store['margin:settings'].privacyExternal = false;
    const { weather } = await import('../../src/content/api/weather'); await expect(weather()).rejects.toMatchObject({ name: 'PrivacyBlocked' }); expect(fetcher).not.toHaveBeenCalled();
  });
});
