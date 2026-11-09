import { h } from './dom';
import { uiReducedMotion, onUiMotionChange } from '../motion';

type Theme = 'light' | 'dark';
export interface SunMoon {
  el: HTMLButtonElement;
  glass: HTMLElement;
  set(theme: Theme, animate?: boolean): void;
  /** 页面颜色淡入时长；滑块弹簧单独计时。 */
  readonly duration: number;
  destroy(): void;
}
// Generate the glass microtexture once. It is static while the control animates.
const grain = document.createElement('canvas');
grain.width = grain.height = 64;
const grainContext = grain.getContext('2d')!;
const texture = grainContext.createImageData(64, 64);
let seed = 74;
for (let i = 0; i < texture.data.length; i += 4) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  texture.data[i] = texture.data[i + 1] = texture.data[i + 2] = seed >>> 24;
  texture.data[i + 3] = 255;
}
grainContext.putImageData(texture, 0, 0);
const grainUrl = grain.toDataURL();
const moon: { x: number; y: number }[] = [];
const sun: { x: number; y: number }[] = [];
for (let y = -8; y <= 8; y++) {
  for (let x = -8; x <= 8; x++) {
    const radius = Math.hypot(x, y);
    if (radius < 6.4 && Math.hypot(x - 3.1, y + 2.6) > 5.7) moon.push({ x, y });
    const ray = (x === 0 || y === 0 || Math.abs(x) === Math.abs(y)) && radius > 5.6 && radius < 8.3;
    if (radius < 3.8 || ray) sun.push({ x, y });
  }
}
moon.push({ x: 4, y: -6 }, { x: 5, y: -6 }, { x: 5, y: -7 }, { x: 5, y: -5 }, { x: 6, y: -6 });
const byAngle = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x);
moon.sort(byAngle);
sun.sort(byAngle);
const particles = Array.from({ length: Math.max(moon.length, sun.length) }, (_, i) => ({
  start: moon[i % moon.length], end: sun[i % sun.length],
  inMoon: i < moon.length, inSun: i < sun.length,
  phase: Math.sin(i * 1.7), drift: Math.sin(i * 2.4),
}));

// Analytic damped spring, tuned to a 0.5-second settling envelope and 20% bounce.
const decay = Math.log(1000) / .5;
const ratio = -Math.log(.2) / Math.hypot(Math.PI, Math.log(.2));
const frequency = decay / ratio * Math.sqrt(1 - ratio * ratio);
function advanceSpring(value: number, velocity: number, target: number, seconds: number): [number, number] {
  const offset = value - target;
  const coefficient = (velocity + decay * offset) / frequency;
  const attenuation = Math.exp(-decay * seconds);
  const sine = Math.sin(frequency * seconds);
  const cosine = Math.cos(frequency * seconds);
  return [
    target + attenuation * (offset * cosine + coefficient * sine),
    attenuation * (velocity * cosine - (decay * coefficient + frequency * offset) * sine),
  ];
}

export function createSunMoon(onToggle: () => void, duration = 380): SunMoon {
  const canvas = h('canvas');
  const light = h('span', { class: 'ts-glass-light' });
  const day = h('span', { class: 'ts-edge ts-edge-day' });
  const nightLayer = h('span', { class: 'ts-edge ts-edge-night' });
  const track = h('span', { class: 'ts-c lg', 'aria-hidden': 'true' });
  const thumb = h('span', { class: 'ts-sm', 'aria-hidden': 'true' }, light, nightLayer, day, canvas);
  const button = h('button', { class: 'ts', type: 'button', role: 'switch' },
    track, thumb);
  button.style.setProperty('--glass-grain', `url("${grainUrl}")`);
  const lightLayers = [light, day];
  let theme: Theme | null = null;
  let destroyed = false;
  let mounted = false;
  let onScreen = true;
  const context = canvas.getContext('2d')!;
  const glyph = document.createElement('canvas');
  const glyphContext = glyph.getContext('2d')!;
  let dotBed = new Path2D();
  let paintedProgress = -1;
  let position = 0;
  let velocity = 0;
  let pressure = 0;
  let pressureVelocity = 0;
  let target = 0;
  let frame = 0;
  let lastTime = 0;
  let gesture: { id: number; start: number; position: number; travel: number; moved: boolean } | null = null;
  let pixels = 64;

  function draw() {
    const progress = Math.min(1, Math.max(0, position));
    const overshoot = position - progress;
    const stretch = uiReducedMotion() ? 0 : Math.min(.16, Math.abs(velocity) * .009) - Math.abs(overshoot) * .5;
    const scaleX = 1 + stretch + pressure * .075;
    const scaleY = 1 - stretch * .5 - pressure * .065;
    thumb.style.transform = `translateX(${(progress + overshoot * .18) * 2.75}em) scale(${scaleX}, ${scaleY})`;
    // Press and rebound only transform the cached image when the icon is unchanged.
    if (progress === paintedProgress) return;
    paintedProgress = progress;
    button.dataset.progress = progress.toFixed(4);
    for (const layer of lightLayers) layer.style.opacity = String(progress);
    nightLayer.style.opacity = String(1 - progress);
    context.clearRect(0, 0, pixels, pixels);
    const scale = pixels / 19;
    const travel = Math.sin(progress * Math.PI);
    // A dim dot bed behind the moon gives the illuminated particles depth.
    context.shadowBlur = 0;
    context.fillStyle = `rgba(193, 211, 222, ${(1 - progress) * .1})`;
    context.fill(dotBed);
    glyphContext.clearRect(0, 0, pixels, pixels);
    glyphContext.fillStyle = `rgb(${Math.round(221 - 79 * progress)}, ${Math.round(236 - 135 * progress)}, ${Math.round(244 - 185 * progress)})`;
    const opaqueDots = new Path2D();
    for (const particle of particles) {
      const { start, end } = particle;
      const morph = Math.min(1, Math.max(0, progress + particle.phase * travel * .075));
      const alpha = (particle.inMoon ? 1 - morph : 0) + (particle.inSun ? morph : 0);
      if (alpha === 0) continue;
      const drift = particle.drift * travel * 1.3;
      const x = start.x + (end.x - start.x) * morph + drift;
      const y = start.y + (end.y - start.y) * morph;
      const cx = pixels / 2 + x * scale;
      const cy = pixels / 2 + y * scale;
      if (alpha === 1) {
        opaqueDots.moveTo(cx + scale * .35, cy);
        opaqueDots.arc(cx, cy, scale * .35, 0, Math.PI * 2);
      } else {
        glyphContext.globalAlpha = alpha;
        glyphContext.beginPath();
        glyphContext.arc(cx, cy, scale * .35, 0, Math.PI * 2);
        glyphContext.fill();
      }
    }
    glyphContext.globalAlpha = 1;
    glyphContext.fill(opaqueDots);
    // Apply the glow once to the complete icon instead of blurring each particle.
    context.shadowColor = `rgba(198, 225, 241, ${(1 - progress) * .6})`;
    context.shadowBlur = scale * 1.2 * (1 - progress);
    context.drawImage(glyph, 0, 0);
  }

  function tick(time: number) {
    frame = 0;
    if (destroyed) return;
    if (!button.isConnected || document.hidden || !onScreen || uiReducedMotion()) { settle(); return; }
    const elapsed = Math.min(64, time - lastTime || 16) / 1000;
    lastTime = time;
    // Slow the travel and particle morph to roughly 0.9 seconds; press feedback uses real time.
    if (!gesture) [position, velocity] = advanceSpring(position, velocity, target, elapsed * .55);
    const pressureTarget = gesture && !uiReducedMotion() ? 1 : 0;
    [pressure, pressureVelocity] = advanceSpring(pressure, pressureVelocity, pressureTarget, elapsed);
    const moving = !gesture && (Math.abs(target - position) > .001 || Math.abs(velocity) > .01);
    const pressing = Math.abs(pressureTarget - pressure) > .001 || Math.abs(pressureVelocity) > .01;
    if (!moving && !gesture) { position = target; velocity = 0; }
    if (!pressing) { pressure = pressureTarget; pressureVelocity = 0; }
    draw();
    if (moving || pressing) frame = requestAnimationFrame(tick);
    else button.classList.remove('moving');
  }

  function settle(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    gesture = null;
    position = target;
    velocity = pressure = pressureVelocity = 0;
    button.classList.remove('moving', 'pressing', 'dragging');
    draw();
  }

  function set(t: Theme, animate = true): void {
    if (destroyed) return;
    const first = theme === null;
    theme = t;
    target = t === 'light' ? 1 : 0;
    const label = t === 'dark' ? '切换到亮色' : '切换到暗色';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-checked', String(t === 'dark'));
    button.dataset.state = t;
    if (first || !animate || uiReducedMotion() || document.hidden || !onScreen) settle();
    else if (!frame && (position !== target || pressure !== 0)) {
      button.classList.add('moving');
      lastTime = 0;
      frame = requestAnimationFrame(tick);
    }
  }

  button.addEventListener('pointerdown', event => {
    if (destroyed || event.button !== 0 || !event.isPrimary) return;
    const rect = button.getBoundingClientRect();
    gesture = { id: event.pointerId, start: event.clientX, position, travel: rect.width / 2, moved: false };
    button.classList.add('pressing');
    if (!uiReducedMotion()) button.classList.add('moving');
    if (!uiReducedMotion() && !frame) { lastTime = 0; frame = requestAnimationFrame(tick); }
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const distance = event.clientX - gesture.start;
    if (Math.abs(distance) > 4) gesture.moved = true;
    if (!gesture.moved) return;
    button.classList.add('dragging');
    if (!uiReducedMotion()) button.classList.add('moving');
    position = Math.min(1, Math.max(0, gesture.position + distance / gesture.travel));
    velocity = 0;
    if (!frame) { lastTime = 0; frame = requestAnimationFrame(tick); }
  });
  function release(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const next = gesture.moved ? (position >= .5 ? 'light' : 'dark') : (theme === 'dark' ? 'light' : 'dark');
    gesture = null;
    button.classList.remove('dragging', 'pressing');
    if (event.type === 'pointerup' && next !== theme) onToggle();
    else if (theme) set(theme);
  }
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
  button.addEventListener('click', event => {
    if (event.detail === 0 && !destroyed) onToggle();
  });
  const resize = new ResizeObserver(() => {
    if (!button.isConnected && mounted) { destroy(); return; }
    mounted ||= button.isConnected;
    const size = canvas.clientWidth;
    if (!size) return;
    pixels = Math.max(1, Math.round(size * Math.min(devicePixelRatio, 2)));
    canvas.width = canvas.height = pixels;
    glyph.width = glyph.height = pixels;
    dotBed = new Path2D();
    const scale = pixels / 19;
    for (let y = -6; y <= 6; y++) {
      for (let x = -6; x <= 6; x++) {
        if (Math.hypot(x, y) >= 6.4) continue;
        const cx = pixels / 2 + x * scale;
        const cy = pixels / 2 + y * scale;
        dotBed.moveTo(cx + scale * .32, cy);
        dotBed.arc(cx, cy, scale * .32, 0, Math.PI * 2);
      }
    }
    paintedProgress = -1;
    draw();
  });
  resize.observe(canvas);
  const visibility = () => { if (document.hidden) settle(); };
  document.addEventListener('visibilitychange', visibility);
  const stopMotion = onUiMotionChange(() => { if (uiReducedMotion()) settle(); });
  const intersection = new IntersectionObserver(entries => {
    onScreen = entries[0]?.isIntersecting ?? false;
    if (!onScreen) settle();
  });
  intersection.observe(button);

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(frame);
    frame = 0;
    resize.disconnect();
    intersection.disconnect();
    document.removeEventListener('visibilitychange', visibility);
    stopMotion();
  }
  return { el: button, glass: track, duration, set, destroy };
}
