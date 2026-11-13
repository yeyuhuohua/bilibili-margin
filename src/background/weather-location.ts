import { WEATHER_LOCATION_KEY, validLocation, type WeatherLocation, type WeatherLocationMessage } from '../shared/weather-location';

/** Called through the worker's existing serial queue so late IP replies cannot overwrite manual choices. */
export async function handleWeatherLocation(m: WeatherLocationMessage): Promise<{ ok: boolean; state: WeatherLocation }> {
  const raw = (await chrome.storage.local.get(WEATHER_LOCATION_KEY))[WEATHER_LOCATION_KEY] as WeatherLocation | undefined;
  const state: WeatherLocation = { revision: Number.isSafeInteger(raw?.revision) ? raw!.revision : 0, loc: validLocation(raw?.loc) ? raw!.loc : null };
  if (m.op === 'read') {
    // Only migrate an old explicit selection; old automatic positions have no expiry or reliable source.
    if (!raw && validLocation(m.legacy) && m.legacy.manual === true) {
      state.loc = { ...m.legacy, manual: true }; state.revision++;
      await chrome.storage.local.set({ [WEATHER_LOCATION_KEY]: state });
    }
    return { ok: true, state };
  }
  if (m.op === 'auto' && (m.revision !== state.revision || state.loc?.manual)) return { ok: false, state };
  if (m.op !== 'clear' && (m.op !== 'manual' && m.op !== 'auto' || !validLocation(m.loc))) return { ok: false, state };
  state.loc = m.op === 'clear' ? null : { name: m.loc.name, lat: m.loc.lat, lon: m.loc.lon,
    ...(m.loc.region ? { region: m.loc.region } : {}), manual: m.op === 'manual', at: Date.now() };
  state.revision++;
  await chrome.storage.local.set({ [WEATHER_LOCATION_KEY]: state });
  return { ok: true, state };
}
