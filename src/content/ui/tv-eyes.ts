/**
 * 顶栏小电视「活过来」：移植 21st Live Orb 的做法（用户 2026-10-29 贴的代码）。
 * 屏幕当作一块微凸的显像管曲面，两只胶囊眼睛贴在曲面上，随指针在 3D 里转向（yaw/pitch 旋转后再投影，
 * 越偏越被透视压扁），偶尔眨眼；指针停下 3 秒后自己东张西望，时不时看回来。
 * 只在眼睛还在动、眨眼进行中才跑 rAF；静止时零帧，下一次眨眼/张望用定时器唤醒。
 * 不可见、离屏、减少动态效果时停住。WebGL 不可用就保留 SVG 原来的眼睛。
 */
import { introActive, onIntroEnd } from './intro/gate';
import { BILI_TIGHT } from './intro/logo';
import { setMarkup } from './dom';
import { onUiMotionChange as onMotionChange, uiReducedMotion as reducedMotion } from '../motion';

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

// 坐标单位：屏幕半高 = 1。眼睛位置、尺寸都按 B 站图标 SVG 实测（viewBox 24 宽，屏幕 18.667×12.76）
const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform vec2 u_look;
uniform float u_blink;
uniform vec3 u_eye;
const float R = 2.2;          // 显像管曲率半径（屏幕对角半长约 1.77，整块屏都在球冠上）
const float ASP = 1.4629;     // 屏幕宽高比 18.667 / 12.76
vec3 orient(vec3 p, vec2 look){
  float yaw = look.x * 0.42, pitch = -look.y * 0.34;
  float cy = cos(yaw), sy = sin(yaw), cp = cos(pitch), sp = sin(pitch);
  vec3 q = vec3(p.x, p.y * cp - p.z * sp, p.y * sp + p.z * cp);
  return vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
}
vec3 onSphere(vec2 s){ return normalize(vec3(s, sqrt(max(R * R - dot(s, s), 0.)))); }
float eyeMask(vec3 n, vec3 e, vec3 right, vec3 up, float halfH, float rad, float aa){
  float facing = dot(n, e);
  float x = dot(n, right) - dot(e, right);
  float y = dot(n, up) - dot(e, up);
  y -= clamp(y, -halfH, halfH);
  float d = length(vec2(x, y)) - rad;
  return (1. - smoothstep(-aa, aa, d)) * smoothstep(0.80, 0.93, facing);
}
void main(){
  vec2 s = (gl_FragCoord.xy / u_res) * 2. - 1.;
  s.x *= ASP;
  vec3 n = onSphere(s);
  vec2 look = u_look; float lm = length(look); if (lm > 1.) look /= lm;
  vec3 right = orient(vec3(1., 0., 0.), look);
  vec3 up = orient(vec3(0., 1., 0.), look);
  vec3 eL = orient(onSphere(vec2(-0.627, 0.114)), look);
  vec3 eR = orient(onSphere(vec2(0.627, 0.114)), look);
  float aa = 0.55 / (u_res.y * 0.5) / R;
  float halfH = mix(0.0319, 0.0015, u_blink);
  float rad = mix(0.0950, 0.0985, u_blink);
  float m = max(eyeMask(n, eL, right, up, halfH, rad, aa), eyeMask(n, eR, right, up, halfH, rad, aa));
  // 屏幕圆角内收一点，眼睛转到边缘时被显像管边框吃掉而不是画出框
  vec2 q = abs(s) - vec2(ASP - 0.16, 1. - 0.16);
  float box = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - 0.12;
  m *= 1. - smoothstep(-aa * R, aa * R, box);
  gl_FragColor = vec4(u_eye, m);
}`;

/** BILI_TIGHT 去掉两只眼睛的子路径：只剩机身、天线和屏幕框 */
const FRAME = BILI_TIGHT.replace(/M8 11\.107[^"]*Z/, '');

const IDLE_MS = 3000;

function rgb(css: string): [number, number, number] {
  const m = css.match(/[\d.]+/g);
  return m ? [+m[0] / 255, +m[1] / 255, +m[2] / 255] : [0, 0.68, 0.93];
}

export function liveTv(span: HTMLElement): void {
  const canvas = document.createElement('canvas');
  canvas.className = 'tv-eyes';
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: false });
  if (!gl) return;
  const sh = (t: number, src: string) => { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, 'u_res'), uLook = gl.getUniformLocation(prog, 'u_look');
  const uBlink = gl.getUniformLocation(prog, 'u_blink'), uEye = gl.getUniformLocation(prog, 'u_eye');
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  setMarkup(span, FRAME);
  span.append(canvas);
  span.classList.add('live');

  const look = { x: 0, y: 0 }, target = { x: 0, y: 0 }, glance = { x: 0, y: 0 };
  let color = rgb(getComputedStyle(span).color);
  let raf = 0, timer = 0, lost = false, onScreen = true;
  let pointerAt = -Infinity, blinkAt = -1e9;
  let nextBlink = performance.now() + 1800 + Math.random() * 2400;
  let nextGlance = performance.now() + 1500 + Math.random() * 1500;

  // 尺寸来自 ResizeObserver 的缓存：动画帧里读 clientWidth 会在滚动时强制同步布局（v0.44 性能）
  let cw = 0, ch = 0;
  const resize = () => {
    const w = cw, hgt = ch;
    if (!w || !hgt) return;
    const dpr = Math.min(devicePixelRatio || 1, 3);
    const W = Math.round(w * dpr), H = Math.round(hgt * dpr);
    if (W !== canvas.width || H !== canvas.height) { canvas.width = W; canvas.height = H; gl.viewport(0, 0, W, H); }
  };
  const awake = () => onScreen && !lost && span.isConnected && document.visibilityState !== 'hidden';

  const draw = (b: number) => {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform2f(uLook, look.x, look.y);
    gl.uniform1f(uBlink, b);
    gl.uniform3f(uEye, color[0], color[1], color[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const tick = (now: number) => {
    raf = 0;
    if (!awake() || !cw) return;
    const still = reducedMotion();
    const steering = now - pointerAt < IDLE_MS;
    if (steering) steer();
    if (!steering && !still && now >= nextGlance) {
      const back = Math.random() < 0.3;
      glance.x = back ? 0 : (Math.random() * 2 - 1) * 0.8;
      glance.y = back ? 0 : (Math.random() * 2 - 1) * 0.5;
      nextGlance = now + 900 + Math.random() * 2100;
    }
    const goal = still ? { x: 0, y: 0 } : steering ? target : glance;
    const k = still ? 1 : steering ? 0.16 : 0.1;
    look.x += (goal.x - look.x) * k;
    look.y += (goal.y - look.y) * k;
    if (!still && now >= nextBlink) { blinkAt = now; nextBlink = now + 2200 + Math.random() * 3800; }
    const bt = (now - blinkAt) / 1000;
    const b = still ? 0 : bt < 0.055 ? bt / 0.055 : bt < 0.1 ? 1 : bt < 0.18 ? 1 - (bt - 0.1) / 0.08 : 0;
    resize();
    draw(b);
    const moving = Math.abs(goal.x - look.x) + Math.abs(goal.y - look.y) > 0.002 || bt < 0.18;
    if (moving) { raf = requestAnimationFrame(tick); return; }
    // 静止：睡到下一次眨眼或张望
    if (still) return;
    const wakeAt = steering ? Math.min(nextBlink, pointerAt + IDLE_MS) : Math.min(nextBlink, nextGlance);
    clearTimeout(timer);
    timer = window.setTimeout(wake, Math.max(16, wakeAt - now));
  };
  function wake() {
    if (introActive()) { onIntroEnd(wake); return; }
    if (raf || !awake()) return;
    clearTimeout(timer);
    raf = requestAnimationFrame(tick);
  }

  // 指针事件里只记坐标，位置换算放到动画帧里做：每次 pointermove 都读 getBoundingClientRect 会强制布局
  let px = 0, py = 0, aim = false;
  addEventListener('pointermove', (e) => {
    px = e.clientX; py = e.clientY; aim = true;
    pointerAt = performance.now();
    wake();
  }, { passive: true });
  const steer = () => {
    if (!aim) return;
    aim = false;
    const r = span.getBoundingClientRect();
    if (!r.width) return;
    // 距离越远看得越偏，指针在页面另一头时基本看到底；不像原组件那样一出圆就顶满
    const dx = px - (r.left + r.width / 2), dy = r.top + r.height / 2 - py;
    target.x = dx / (Math.abs(dx) + 200);
    target.y = dy / (Math.abs(dy) + 160);
  };
  new IntersectionObserver(([en]) => { onScreen = en?.isIntersecting ?? true; wake(); }).observe(span);
  document.addEventListener('visibilitychange', wake);
  onMotionChange(wake);
  new ResizeObserver(([en]) => { if (!cw) syncColor(); cw = en.contentRect.width; ch = en.contentRect.height; resize(); if (!raf) draw(0); wake(); }).observe(canvas);
  // 昼夜切换：图标颜色跟着 .app[data-theme] 变
  const syncColor = () => { const c = rgb(getComputedStyle(span).color); if (c.join() !== color.join()) { color = c; if (!raf) draw(0); } };
  const hook = () => {
    const app = span.closest('.app');
    if (app) new MutationObserver(syncColor).observe(app, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] });
    // 颜色、尺寸和第一帧都交给 ResizeObserver（布局完成后才回调，这时读样式不会强制整页重算）
    wake();
  };
  if (span.isConnected) hook(); else { let n = 0; requestAnimationFrame(function wait() { if (span.isConnected) hook(); else if (++n < 600) requestAnimationFrame(wait); }); }

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; setMarkup(span, BILI_TIGHT); span.classList.remove('live'); });
}
