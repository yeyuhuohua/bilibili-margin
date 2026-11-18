/**
 * 折射玻璃透镜 —— 算法直接取自 movements.dev「Refractive Glass」（@movements/react-glass，MIT，@n___vc）：
 * 圆角矩形 SDF 的外法线 × 边缘轮廓（smootherstep 再 ^1.6，向中心衰减，rim 决定伸进去多深），
 * 按 feDisplacementMap 的方式位移取样，R/G/B 分别用 bend+aber / bend / bend-aber 产生色差，
 * 再 blur + saturate(1.4) + 白色 tint，顶部叠一层 screen 光泽。原版是 backdrop-filter:url(#svg)，
 * 这里背景本来就是我们自己的 WebGL，所以把同一套数学搬进片元着色器，边框/投影仍由 CSS box-shadow 负责。
 */
const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FRAG = `precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform vec4 u_rect;    // x, y (左下角), w, h —— 画布像素，y 向上
uniform float u_rad;
uniform float u_span;   // rim 伸进去的距离（画布像素）
uniform vec3 u_bend;    // R/G/B 位移量（画布像素）
uniform float u_blur;   // 模糊半径（画布像素）
uniform float u_tint;   // 白色 tint alpha
uniform float u_sheen;  // 顶部光泽强度
uniform vec3 u_canvas;  // 页面底色
uniform float u_o;      // 背景强度

vec3 seen(vec2 px) {
  vec3 c = mix(u_canvas, texture2D(u_tex, px / u_res).rgb, u_o);
  float t = 1.0 - px.y / u_res.y;
  float a = t < 0.55 ? t : mix(0.55, 0.88, (t - 0.55) / 0.45);
  return mix(c, u_canvas, a);
}

float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

// 和 feDisplacementMap 一样先位移再模糊。画布本身只有 ~0.45 倍分辨率，blur(2px) 只相当于 ~1 个画布像素，
// 4 个半像素对角取样（借双线性插值）就够了，比 3×3 高斯省一半以上的取样
vec3 tap(vec2 at) {
  vec2 o = vec2(u_blur * 0.5);
  return (seen(at + o) + seen(at - o) + seen(at + vec2(o.x, -o.y)) + seen(at + vec2(-o.x, o.y))) * 0.25;
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec3 bg = seen(fc);
  vec2 hb = u_rect.zw * 0.5;
  vec2 p = fc - (u_rect.xy + hb);
  float sd = sdRound(p, hb, u_rad);
  float inside = clamp(0.5 - sd, 0.0, 1.0);
  if (inside <= 0.0) { gl_FragColor = vec4(bg, 1.0); return; }

  vec2 e = vec2(1.0, 0.0);
  vec2 n = vec2(sdRound(p + e.xy, hb, u_rad) - sdRound(p - e.xy, hb, u_rad),
                sdRound(p + e.yx, hb, u_rad) - sdRound(p - e.yx, hb, u_rad));
  n /= max(length(n), 1e-5);
  float l = 1.0 - min(-sd / max(u_span, 1.0), 1.0);
  l = l * l * l * (l * (l * 6.0 - 15.0) + 10.0);
  vec2 d = n * pow(l, 1.6) * (127.0 / 255.0);   // 位移贴图 (C - 0.5)

  vec3 col = vec3(tap(fc + d * u_bend.r).r, tap(fc + d * u_bend.g).g, tap(fc + d * u_bend.b).b);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = clamp(mix(vec3(lum), col, 1.4), 0.0, 1.0);          // saturate(1.4)
  col = mix(col, vec3(1.0), u_tint);                         // rgb(255 255 255 / tint)
  float ty = (u_rect.y + u_rect.w - fc.y) / u_rect.w;        // 0 = 顶边
  float sh = 0.55 * clamp(1.0 - ty / 0.38, 0.0, 1.0) * u_sheen;
  col = mix(col, 1.0 - (1.0 - col) * (1.0 - sh), 0.8);       // SHEEN, mix-blend-mode: screen, opacity .8
  gl_FragColor = vec4(mix(bg, col, inside), 1.0);
}`;

/** movements.dev Glass 的参数（CSS 像素）；默认值即官网默认 */
export const LENS = { rim: 18, bend: 36, blur: 2, aberration: 5, tint: 0.1 };  // 用户：边缘不要太明显 → bend/aberration 调低

export class GlassLens {
  private prog: WebGLProgram;
  private fbo: WebGLFramebuffer;
  private tex: WebGLTexture;
  private w = 0;
  private h = 0;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private position: number;

  constructor(private gl: WebGLRenderingContext) {
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn('[MARGIN] lens', gl.getShaderInfoLog(s)); return s; };
    this.prog = gl.createProgram()!;
    gl.attachShader(this.prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(this.prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(this.prog);
    this.position = gl.getAttribLocation(this.prog, 'p');
    for (const n of ['u_tex', 'u_res', 'u_rect', 'u_rad', 'u_span', 'u_bend', 'u_blur', 'u_tint', 'u_sheen', 'u_canvas', 'u_o']) this.loc[n] = gl.getUniformLocation(this.prog, n);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fbo = gl.createFramebuffer()!;
  }

  /** 之后的绘制先进纹理 */
  target(w: number, h: number): void {
    const gl = this.gl;
    if (w !== this.w || h !== this.h) {
      this.w = w; this.h = h;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
  }

  /** 纹理整屏回画到画布，矩形内做玻璃 */
  present(w: number, h: number, r: { x: number; y: number; w: number; h: number; r: number; px: number }, theme: 'light' | 'dark' | number, o = 0.6): void {
    const gl = this.gl, L = this.loc;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    const a = this.position;
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(L.u_tex, 0);
    gl.uniform2f(L.u_res, w, h);
    gl.uniform4f(L.u_rect, r.x, r.y, r.w, r.h);
    gl.uniform1f(L.u_rad, Math.min(r.r, r.h / 2, r.w / 2));
    const k = typeof theme === 'number' ? theme : theme === 'dark' ? 1 : 0;
    const dark = k >= 0.5;
    const rimT = (Math.min(70, Math.max(6, LENS.rim)) - 6) / 64;
    gl.uniform1f(L.u_span, Math.min(r.w, r.h) / 2 * (0.16 + 0.84 * rimT));
    gl.uniform3fv(L.u_bend, [(LENS.bend + LENS.aberration) * r.px, LENS.bend * r.px, (LENS.bend - LENS.aberration) * r.px]);
    gl.uniform1f(L.u_blur, LENS.blur * r.px);
    gl.uniform1f(L.u_tint, LENS.tint * (1 - 0.64 * k));         // 暗色 tint × 0.36
    gl.uniform1f(L.u_sheen, 1 - 0.55 * k);
    gl.uniform3fv(L.u_canvas, dark ? [0x11 / 255, 0x11 / 255, 0x12 / 255] : [0xf5 / 255, 0xf4 / 255, 0xf1 / 255]);
    gl.uniform1f(L.u_o, o);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
