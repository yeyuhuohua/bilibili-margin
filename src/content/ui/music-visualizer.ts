// Adapted from Audio Visualizer by aadixc0de / chatcn on 21st.dev.
// Only live FFT bands are drawn; no synthesized signal or additional audio source.
export function createVisualizer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  const values = new Float32Array(48);
  let mode: 'bars' | 'line' = 'bars', width = 0, height = 0, color = '#c9d1c2', last = 0;
  let current: Uint8Array<ArrayBuffer> | null = null, live = false;
  function resize() {
    width = canvas.clientWidth; height = canvas.clientHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr)); canvas.height = Math.max(1, Math.round(height * dpr));
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0); paint(current, live);
  }
  function refresh() { color = getComputedStyle(canvas).color || '#c9d1c2'; paint(current, live); }
  function paint(bins: Uint8Array<ArrayBuffer> | null, active: boolean) {
    current = bins; live = active;
    if (!ctx || width <= 0 || height <= 0) return 0;
    const now = performance.now(), dt = last ? Math.min(.05, (now - last) / 1000) : 1 / 30; last = now;
    ctx.clearRect(0, 0, width, height); ctx.fillStyle = ctx.strokeStyle = color;
    let energy = 0;
    for (let i = 0; i < values.length; i++) {
      const distance = Math.abs(i - (values.length - 1) / 2) / ((values.length - 1) / 2);
      const bin = Math.min((bins?.length || 2) - 1, Math.floor(distance ** 1.7 * 170) + 1);
      const target = active && bins ? Math.min(1, (bins[bin] / 255) ** .8) : 0;
      const prior = values[i]; values[i] = active ? prior + (target - prior) * (1 - Math.exp(-(target > prior ? 24 : 8) * dt)) : 0;
      energy += values[i];
    }
    if (mode === 'bars') {
      const pitch = width / values.length, barWidth = Math.min(5, pitch * .57);
      for (let i = 0; i < values.length; i++) {
        const value = values[i], h = Math.max(barWidth, value * (height - 4));
        ctx.globalAlpha = .28 + .72 * Math.min(1, value * 2.4);
        ctx.beginPath(); ctx.roundRect(pitch * (i + .5) - barWidth / 2, (height - h) / 2, barWidth, h, barWidth / 2); ctx.fill();
      }
    } else {
      const amp = height / 2 - 3, step = width / (values.length - 1);
      const y = (i: number) => values[i] * amp * Math.sin(Math.PI * i / (values.length - 1)) ** .8;
      ctx.lineWidth = 1.6; ctx.lineJoin = ctx.lineCap = 'round';
      for (const direction of [-1, 1]) {
        ctx.globalAlpha = direction < 0 ? 1 : .35; ctx.beginPath(); ctx.moveTo(0, height / 2);
        for (let i = 1; i < values.length - 1; i++) ctx.quadraticCurveTo(i * step, height / 2 + direction * y(i), (i + .5) * step, height / 2 + direction * (y(i) + y(i+1)) / 2);
        ctx.lineTo(width, height / 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1; return energy / values.length;
  }
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  return { draw: paint, refresh, setMode(next: 'bars' | 'line') { mode = next; values.fill(0); paint(current, live); }, destroy() { observer.disconnect(); } };
}
