// Height-field optics adapted from Aakash Mehra's supplied LiquidGlass; gradient rim from LiquidGlassCta.
// Maps are static; backdrop content moves through them without a JS animation loop.
export function lensData(w: number, h: number, radius: number, bevel: number): Uint8ClampedArray {
  const r = Math.min(radius, w / 2, h / 2), band = Math.max(1, Math.min(bevel, h / 2, w / 2));
  const distance = (x: number, y: number) => {
    const qx = Math.abs(x) - w / 2 + r, qy = Math.abs(y) - h / 2 + r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  const phi = new Float32Array(Math.ceil(band) + 1);
  for (let i = 1; i < phi.length; i++) {
    const u = 1 - i / (phi.length - 1), denominator = (1 - u ** 4) ** .75;
    const angle = Math.atan(Math.min(denominator < 1e-6 ? 0 : u ** 3 / denominator, 8));
    phi[i] = phi[i - 1] + Math.sin(angle - Math.asin(Math.sin(angle) / 1.5));
  }
  const field = new Float32Array(w * h), data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const depth = Math.max(0, Math.min(phi.length - 1, -distance(x - w / 2 + .5, y - h / 2 + .5)));
    const low = Math.floor(depth), high = Math.min(low + 1, phi.length - 1);
    field[y * w + x] = phi[low] + (phi[high] - phi[low]) * (depth - low);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 128;
    if (distance(x - w / 2 + .5, y - h / 2 + .5) > 0) continue;
    const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1), y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
    const dx = (field[y * w + x1] - field[y * w + x0]) / (x1 - x0 || 1);
    const dy = (field[y1 * w + x] - field[y0 * w + x]) / (y1 - y0 || 1);
    data[i] = 128 + Math.max(-1, Math.min(1, dx * 1.35)) * 127;
    data[i + 1] = 128 + Math.max(-1, Math.min(1, dy * 1.35)) * 127; data[i + 3] = 255;
  }
  return data;
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
}
export function materialCanvas(w: number, h: number, radius: number, bezel: number, profile: 'lens' | 'gradient'): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (profile === 'lens') { const pixels = ctx.createImageData(w, h); pixels.data.set(lensData(w, h, radius, bezel)); ctx.putImageData(pixels, 0, 0); return canvas; }
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  const gx = ctx.createLinearGradient(0, 0, w, 0); gx.addColorStop(0, '#f00'); gx.addColorStop(1, '#000');
  ctx.fillStyle = gx; rounded(ctx, 0, 0, w, h, radius);
  const gy = ctx.createLinearGradient(0, 0, 0, h); gy.addColorStop(0, '#00f'); gy.addColorStop(1, '#000');
  ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = gy; rounded(ctx, 0, 0, w, h, radius);
  const band = Math.min(16, bezel, (h - 2) / 2, (w - 2) / 2);
  ctx.globalCompositeOperation = 'source-over'; ctx.filter = `blur(${band / 2.2}px)`; ctx.fillStyle = '#808080';
  rounded(ctx, band, band, w - band * 2, h - band * 2, Math.max(0, radius - band)); ctx.filter = 'none';
  return canvas;
}
