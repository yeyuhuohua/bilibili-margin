export interface Loc { name: string; lat: number; lon: number; manual?: boolean; region?: string; at?: number }
export interface WeatherLocation { revision: number; loc: Loc | null }
export const WEATHER_LOCATION_KEY = 'margin:weather-location-v2';
export const AUTO_LOCATION_TTL = 6 * 60 * 60_000;
export type WeatherLocationMessage = { margin: 'weather-location' } & (
  | { op: 'read'; legacy?: Loc | null }
  | { op: 'manual'; loc: Loc }
  | { op: 'auto'; loc: Loc; revision: number }
  | { op: 'clear' }
);
export function validLocation(value: unknown): value is Loc {
  const v = value as Loc | null;
  return !!v && typeof v.name === 'string' && v.name.length > 0 && v.name.length <= 160
    && Number.isFinite(v.lat) && Math.abs(v.lat) <= 90 && Number.isFinite(v.lon) && Math.abs(v.lon) <= 180
    && (v.region === undefined || typeof v.region === 'string' && v.region.length <= 240);
}
