import { compute, draw, effect, frame, init, storage, surface, target, type Gpu, type InitOptions, type Surface, type Target } from 'vgpu';
import simWgsl from './sim.wgsl';
import dotsWgsl from './dots.wgsl';
import fadeWgsl from './fade.wgsl';
import compositeWgsl from './composite.wgsl';
import { fluxTiming } from './timing';

/**
 * 「流光」：WebGPU 计算着色器版背景（基于 vgpu，vercel-labs，MIT）。
 * 2.4 万颗粒子在旋度噪声流场里漂移，带拖尾。画到一张不进 DOM 的 WebGPU 画布上，
 * 再由背景层上传成 WebGL 纹理——这样热力图玻璃、昼夜渐变、滚动暂停都沿用原来的 GL 管线。
 */
const COUNT = 24000;
const FLOATS = 8;

/**
 * Windows 上的 Chromium 会忽略 requestAdapter() 的 powerPreference，并且每次调用都往
 * 控制台打一条警告（crbug.com/369219127）。在 Windows 上干脆不提这个要求，其他平台
 * 仍保留 low-power 偏好。优先用扩展自带的 getPlatformInfo（不受 UA 冻结/缩减影响），
 * 取不到（非扩展上下文、旧运行时）再退回 UA 与 navigator.platform。
 */
async function isWindows(): Promise<boolean> {
  try {
    return (await chrome.runtime.getPlatformInfo()).os === 'win';
  } catch { /* 非扩展上下文或 API 不可用 */ }
  const ua = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = ua.userAgentData?.platform ?? navigator.platform ?? '';
  return /win/i.test(platform) || /Windows NT/i.test(navigator.userAgent);
}

type RGB = readonly [number, number, number];
export interface FluxColors { bg: RGB; c1: RGB; c2: RGB; c3: RGB }

export class FluxField {
  readonly canvas = document.createElement('canvas');
  ready = false;
  private gpu: Gpu | null = null;
  private surf: Surface | null = null;
  private sim!: ReturnType<typeof compute>;
  private dots!: ReturnType<typeof draw>;
  private fades: ReturnType<typeof effect>[] = [];
  private comps: ReturnType<typeof effect>[] = [];
  private trails: Target[] = [];
  private flip = 0;
  private size: [number, number] = [0, 0];
  private lastT = -1;
  private dead = false;

  static supported(): boolean { return typeof navigator !== 'undefined' && 'gpu' in navigator; }

  async start(): Promise<boolean> {
    try {
      const options: InitOptions = (await isWindows())
        ? { requiredLimits: { maxStorageBuffersInVertexStage: 1 } }
        : { powerPreference: 'low-power', requiredLimits: { maxStorageBuffersInVertexStage: 1 } };
      if (this.dead) return false;
      const gpu = await init(options);
      if (this.dead) { gpu.dispose(); return false; }
      this.gpu = gpu;
      const buf = new Float32Array(COUNT * FLOATS);
      for (let i = 0; i < COUNT; i++) {
        const o = i * FLOATS, life = 4 + Math.random() * 8;
        buf[o] = Math.random() * 1.8; buf[o + 1] = Math.random();
        buf[o + 4] = Math.random() * life; buf[o + 5] = life; buf[o + 6] = Math.random() * 100;
      }
      const particles = storage(gpu, buf.byteLength, 'read-write');
      particles.write(buf);
      this.sim = compute(gpu, simWgsl, { label: 'flux-sim', set: { particles, sim: { time: 0, dt: 0, aspect: 1.6, count: COUNT, damping: 0.2, pad0: 0, pad1: 0, pad2: 0 } } });
      this.dots = draw(gpu, {
        shader: dotsWgsl, vertices: 6, instances: COUNT, label: 'flux-dots',
        blend: { color: { src: 'one', dst: 'one' }, alpha: { src: 'one', dst: 'one' } },
        set: { particles, view: { res: [1, 1], aspect: 1.6, size: 1.6, c1: [1, 1, 1, 1], c2: [1, 1, 1, 1], c3: [1, 1, 1, 1], dt: 1 / 60, exposure: 1, pad1: 0, pad2: 0 } },
      });
      gpu.lost.then(() => { this.ready = false; });
      await this.sim.compile();
      this.ready = true;
      return true;
    } catch (e) {
      console.info('[MARGIN] WebGPU 不可用，流光退回 WebGL 版', (e as { code?: string }).code ?? e);
      return false;
    }
  }

  private resize(w: number, h: number): void {
    const gpu = this.gpu!;
    this.size = [w, h];
    this.canvas.width = w; this.canvas.height = h;
    if (!this.surf) this.surf = surface(gpu, this.canvas, { autoResize: false, size: [w, h], dpr: 1, alphaMode: 'opaque' });
    else this.surf.resize([w, h]);
    for (const t of this.trails) (t as unknown as { destroy?: () => void }).destroy?.();
    this.trails = [0, 1].map((i) => target(gpu, { size: [w, h], format: 'rgba16float', label: `flux-trail-${i}` }));
    this.fades = this.trails.map((src) => effect(gpu, fadeWgsl, { label: 'flux-fade', set: { src, fade: { decay: 0.92, pad0: 0, pad1: 0, pad2: 0 } } }));
    this.comps = this.trails.map((src) => effect(gpu, compositeWgsl, { label: 'flux-comp', set: { src, comp: { bg: [0, 0, 0, 1], gain: 1.4, glow: 0.5, pad0: 0, pad1: 0 } } }));
    this.dots.set({ view: { res: [w, h], aspect: w / h, size: Math.max(1.2, h / 330) } });
    this.sim.set({ sim: { aspect: w / h } });
    this.lastT = -1;
  }

  /** 推进一帧并画到 this.canvas；t 秒，k 0 亮 1 暗 */
  render(w: number, h: number, t: number, col: FluxColors, dark: number): boolean {
    if (!this.ready || !this.gpu) return false;
    if (w !== this.size[0] || h !== this.size[1]) this.resize(w, h);
    const { dt, decay, damping, exposure } = fluxTiming(t, this.lastT);
    this.lastT = t;
    const a = this.flip, b = 1 - a;
    this.sim.set({ sim: { time: t, dt, damping } });
    this.fades[a].set({ fade: { decay } });
    this.dots.set({ view: { c1: [...col.c1, 1], c2: [...col.c2, 1], c3: [...col.c3, 1], dt, exposure } });
    // 暗色上粒子发光更明显；亮色上压一点，免得把页面搞花
    this.comps[b].set({ comp: { bg: [...col.bg, 1], gain: 1.25 - 0.4 * dark } });
    try {
      frame(this.gpu, (f) => {
        f.computePass((p) => p.dispatch(this.sim, Math.ceil(COUNT / 64)));
        f.pass({ target: this.trails[b], clear: [0, 0, 0, 0] }, (p) => { p.draw(this.fades[a]); p.draw(this.dots); });
        f.pass({ target: this.surf!, clear: [0, 0, 0, 1] }, (p) => p.draw(this.comps[b]));
      });
    } catch (e) {
      console.info('[MARGIN] 流光渲染失败，退回 WebGL 版', e);
      this.ready = false;
      return false;
    }
    this.flip = b;
    return true;
  }

  dispose(): void { this.dead = true; this.ready = false; this.gpu?.dispose(); this.gpu = null; }
}
