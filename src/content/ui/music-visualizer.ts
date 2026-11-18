// Canvas forms adapted from the user-supplied chatcn / 21st Audio Visualizer.
// All forms share the current video's FFT samples and the caller's frame loop.
export type VisualizerMode = 'bars' | 'radial' | 'grid' | 'line' | 'dots';

const counts: Record<VisualizerMode, number> = { bars: 24, radial: 48, grid: 24, line: 48, dots: 11 };

export function createVisualizer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  const values = new Float32Array(48);
  let mode: VisualizerMode = 'grid';
  let width = 0, height = 0, color = '#c9d1c2', last = 0;
  let current: Uint8Array<ArrayBuffer> | null = null, live = false;
  let gridPaths: Path2D[][] = [];

  function prepareGrid() {
    gridPaths = [];
    if (mode !== 'grid' || width <= 0 || height <= 0) return;
    const count = counts.grid, gap = 2;
    const cell = Math.max(1, Math.min(6, (width - (count - 1) * gap) / count));
    const rowCount = Math.max(3, Math.min(11, Math.floor((height + gap) / (cell + gap))));
    const rows = rowCount % 2 ? rowCount : rowCount - 1;
    const left = (width - (count * cell + (count - 1) * gap)) / 2;
    const top = (height - (rows * cell + (rows - 1) * gap)) / 2;
    for (let column = 0; column < count; column++) {
      const paths: Path2D[] = [];
      for (let row = 0; row < rows; row++) {
        const path = new Path2D(), x = left + column * (cell + gap), radius = Math.min(1.5, cell / 3);
        path.roundRect(x, top + row * (cell + gap), cell, cell, radius);
        paths.push(path);
      }
      gridPaths.push(paths);
    }
  }

  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    prepareGrid();
    paint(current, live);
  }

  function refresh() {
    color = getComputedStyle(canvas).color || '#c9d1c2';
    paint(current, live);
  }

  function paint(bins: Uint8Array<ArrayBuffer> | null, active: boolean) {
    current = bins;
    live = active;
    if (!ctx || width <= 0 || height <= 0) return 0;
    const now = performance.now();
    const dt = last ? Math.min(.05, (now - last) / 1000) : 1 / 30;
    last = now;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = ctx.strokeStyle = color;
    ctx.lineJoin = ctx.lineCap = 'round';
    const count = counts[mode];
    const attack = active ? 1 - Math.exp(-22 * dt) : 0;
    const release = active ? 1 - Math.exp(-7 * dt) : 0;
    let energy = 0;
    for (let i = 0; i < count; i++) {
      const distance = Math.abs(i - (count - 1) / 2) / ((count - 1) / 2);
      const bin = Math.min((bins?.length || 2) - 1, Math.floor(distance ** 1.7 * 170) + 1);
      const target = active && bins?.length ? Math.min(1, (bins[bin] / 255) ** .8) : 0;
      const previous = values[i];
      values[i] = active ? previous + (target - previous) * (target > previous ? attack : release) : 0;
      energy += values[i];
    }

    switch (mode) {
      case 'bars': {
        const pitch = width / count, barWidth = Math.min(7, pitch * .58);
        for (let i = 0; i < count; i++) {
          const value = values[i], barHeight = Math.max(barWidth, value * (height - 4));
          ctx.globalAlpha = .25 + .75 * Math.min(1, value * 2.4);
          ctx.beginPath();
          ctx.roundRect(pitch * (i + .5) - barWidth / 2, (height - barHeight) / 2, barWidth, barHeight, barWidth / 2);
          ctx.fill();
        }
        break;
      }
      case 'radial': {
        const outer = Math.max(2, Math.min(width, height) / 2 - 2);
        const inner = outer * .48;
        const stroke = Math.max(1, Math.min(2.5, Math.PI * 2 * inner / count * .42));
        ctx.lineWidth = stroke;
        for (let i = 0; i < count; i++) {
          const angle = i / count * Math.PI * 2 - Math.PI / 2;
          const length = stroke + values[i] * (outer - inner - stroke);
          ctx.globalAlpha = .23 + .77 * Math.min(1, values[i] * 2.4);
          ctx.beginPath();
          ctx.moveTo(width / 2 + Math.cos(angle) * inner, height / 2 + Math.sin(angle) * inner);
          ctx.lineTo(width / 2 + Math.cos(angle) * (inner + length), height / 2 + Math.sin(angle) * (inner + length));
          ctx.stroke();
        }
        break;
      }
      case 'grid': {
        for (let column = 0; column < count; column++) {
          const paths = gridPaths[column];
          const half = (paths.length - 1) / 2;
          const lit = values[column] * (half + 1);
          for (let row = 0; row < paths.length; row++) {
            const amount = Math.max(0, Math.min(1, lit - Math.abs(row - half)));
            ctx.globalAlpha = .09 + amount * .91;
            ctx.fill(paths[row]);
          }
        }
        break;
      }
      case 'line': {
        const amplitude = height / 2 - 3, step = width / (count - 1);
        const y = (index: number) => values[index] * amplitude * Math.sin(Math.PI * index / (count - 1)) ** .8;
        ctx.lineWidth = 1.6;
        for (const direction of [-1, 1]) {
          ctx.globalAlpha = direction < 0 ? 1 : .35;
          ctx.beginPath();
          ctx.moveTo(0, height / 2);
          for (let i = 1; i < count - 1; i++) {
            ctx.quadraticCurveTo(i * step, height / 2 + direction * y(i), (i + .5) * step, height / 2 + direction * (y(i) + y(i + 1)) / 2);
          }
          ctx.lineTo(width, height / 2);
          ctx.stroke();
        }
        break;
      }
      case 'dots': {
        const pitch = width / count;
        const maximum = Math.max(0, Math.min(pitch * .4, height / 2 - 2));
        const minimum = Math.min(maximum, Math.max(1.5, maximum * .22));
        for (let i = 0; i < count; i++) {
          const value = values[i];
          ctx.globalAlpha = .25 + .75 * Math.min(1, value * 2.4);
          ctx.beginPath();
          ctx.arc(pitch * (i + .5), height / 2, minimum + Math.min(1, value * 1.3) * (maximum - minimum), 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
    }
    ctx.globalAlpha = 1;
    return energy / count;
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  return {
    draw: paint,
    refresh,
    setMode(next: VisualizerMode) { mode = next; values.fill(0); prepareGrid(); paint(current, live); },
    destroy() { observer.disconnect(); },
  };
}
