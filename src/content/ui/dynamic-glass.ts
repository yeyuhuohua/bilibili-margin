// The supplied GlassEffect is restricted to a masked rim. Keep the center
// undistorted and use a small displacement that stays constant on long cards.
const NS = 'http://www.w3.org/2000/svg';
export function addDynamicGlassFilter(svg: SVGSVGElement): void {
  const node = (name: string, attrs: Record<string, string>) => {
    const el = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
  };
  const filter = node('filter', { id: 'lg-dynamic', x: '0%', y: '0%', width: '100%', height: '100%', filterUnits: 'objectBoundingBox', 'color-interpolation-filters': 'sRGB' });
  filter.append(
    node('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.001 0.005', numOctaves: '1', seed: '17', result: 'turbulence' }),
    node('feGaussianBlur', { in: 'turbulence', stdDeviation: '3', result: 'softMap' }),
    node('feDisplacementMap', { in: 'SourceGraphic', in2: 'softMap', scale: '6', xChannelSelector: 'R', yChannelSelector: 'G' }),
  );
  svg.append(filter);
}

let visible: IntersectionObserver | undefined;
export function observeDynamicGlass(panel: HTMLElement): void {
  visible ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      entry.target.classList.toggle('dy-refract', entry.isIntersecting);
      if (!entry.target.isConnected) { entry.target.classList.remove('dy-refract'); visible!.unobserve(entry.target); }
    }
  }, { rootMargin: '120px 0px' });
  visible.observe(panel);
}
