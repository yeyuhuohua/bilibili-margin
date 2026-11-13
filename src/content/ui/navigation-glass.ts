import type { Header } from './header';
import { attachGlass } from './liquid-glass';

export function attachNavigationGlass(header: Header, filters: SVGSVGElement): void {
  header.glass.forEach(el => attachGlass(el, filters, { profile: 'lens', blur: .5, strength: .6, sat: '135%' }));
  const upload = header.el.querySelector<HTMLElement>('.upload');
  if (upload) attachGlass(upload, filters, { profile: 'gradient', blur: 1, strength: .4, sat: '130%' });
}
