// 每颗粒子一个小四边形，加法混合累进拖尾画布：rgb = 颜色×权重，a = 权重（合成时再除回来）
struct Particle { pos: vec2f, vel: vec2f, age: f32, life: f32, seed: f32, pad: f32 }
struct View { res: vec2f, aspect: f32, size: f32, c1: vec4f, c2: vec4f, c3: vec4f, dt: f32, exposure: f32, pad1: f32, pad2: f32 }

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> view: View;

struct Out {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec4f,
}

@vertex fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Out {
  var quad = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
  let c = quad[vi];
  let p = particles[ii];
  let ndc = vec2f(p.pos.x / view.aspect * 2.0 - 1.0, p.pos.y * 2.0 - 1.0);
  // 沿速度方向拉成一小段线：这一帧走过的距离，补上帧间空隙，拖尾就是连续的线而不是虚线
  let segPx = p.vel * view.dt * view.res.y;
  let len = length(segPx);
  let dir = select(vec2f(1.0, 0.0), segPx / max(len, 1e-4), len > 1e-3);
  let half = max(view.size, len * 0.5 + view.size * 0.5);
  let px = dir * (c.x * half - len * 0.5) + vec2f(-dir.y, dir.x) * (c.y * view.size * 0.55);
  var o: Out;
  o.position = vec4f(ndc + px * 2.0 / view.res, 0.0, 1.0);
  o.local = c;
  // 淡入淡出 + 按速度和种子在三种颜色间取色
  let fade = smoothstep(0.0, 1.2, p.age) * (1.0 - smoothstep(p.life - 1.5, p.life, p.age));
  let sp = clamp(length(p.vel) * 13.0, 0.0, 1.0);
  let base = mix(view.c1.rgb, view.c2.rgb, fract(p.seed * 3.7));
  let col = mix(base, view.c3.rgb, sp * sp * sp * sp);
  let w = fade * (0.07 + 0.2 * sp) * view.exposure;
  o.color = vec4f(col * w, w);
  return o;
}

@fragment fn fs_main(in: Out) -> @location(0) vec4f {
  let d = (1.0 - smoothstep(0.3, 1.0, abs(in.local.y))) * (1.0 - smoothstep(0.7, 1.0, abs(in.local.x)));
  return in.color * d;
}
