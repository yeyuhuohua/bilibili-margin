import type { Loc } from '../../shared/weather-location';

const trimSuffix = (s: string) => s.normalize('NFKC').trim().toLowerCase().replace(/[\s,，·/]/g, '').replace(/(?:特别行政区|自治区|省|市|区|县)$/, '');
const shortProvince = (s: string) => s.replace(/(?:壮族|回族|维吾尔)?自治区$|特别行政区$|省$|市$/, '');

/** Compact city/coordinate facts are loaded only when needed, not with the initial page. */
export async function localCities(query: string, n: number): Promise<(Loc & { region: string })[]> {
  const q = trimSuffix(query);
  if (q.length < 2) return [];
  const { CITIES } = await import('./weather-cities');
  const district = /[区县]$/.test(query);
  return CITIES.map((row, index) => {
    const [name, province, city, lat, lon, en, capital] = row;
    if (district && capital) return null;
    const place = trimSuffix(name), p = shortProvince(province), c = trimSuffix(city);
    const aliases = [place, trimSuffix(en), p + place, trimSuffix(province + name), c + place,
      trimSuffix(city + name), p + c + place, trimSuffix(province + city + name)];
    let score = aliases.slice(2).includes(q) ? 1200 : aliases.slice(0, 2).includes(q) ? 1000
      : aliases.some(a => a.startsWith(q)) ? 700 : aliases.some(a => a.includes(q)) ? 400 : 0;
    if (!score) return null;
    score += capital * 30;
    const label = capital && place === c ? city : name;
    const region = [...new Set([province, city, '中国'])].filter(s => s !== label).join(' · ');
    return { score, index, place: { name: label, lat, lon, region } };
  }).filter(r => r !== null).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, n).map(r => r.place);
}
