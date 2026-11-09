// 流光：粒子沿随时间演化的旋度噪声流场漂移（无散度，所以粒子不会扎堆或抽空）
struct Particle { pos: vec2f, vel: vec2f, age: f32, life: f32, seed: f32, pad: f32 }
struct Sim { time: f32, dt: f32, aspect: f32, count: f32, damping: f32, pad0: f32, pad1: f32, pad2: f32 }

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> sim: Sim;

fn hash3(p: vec3f) -> vec3f {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx) * 2.0 - 1.0;
}

// 3D 梯度噪声
fn gnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var n = 0.0;
  let a = mix(mix(dot(hash3(i), f), dot(hash3(i + vec3f(1, 0, 0)), f - vec3f(1, 0, 0)), u.x),
              mix(dot(hash3(i + vec3f(0, 1, 0)), f - vec3f(0, 1, 0)), dot(hash3(i + vec3f(1, 1, 0)), f - vec3f(1, 1, 0)), u.x), u.y);
  let b = mix(mix(dot(hash3(i + vec3f(0, 0, 1)), f - vec3f(0, 0, 1)), dot(hash3(i + vec3f(1, 0, 1)), f - vec3f(1, 0, 1)), u.x),
              mix(dot(hash3(i + vec3f(0, 1, 1)), f - vec3f(0, 1, 1)), dot(hash3(i + vec3f(1, 1, 1)), f - vec3f(1, 1, 1)), u.x), u.y);
  n = mix(a, b, u.z);
  return n;
}

fn potential(p: vec2f, t: f32) -> f32 {
  return gnoise(vec3f(p * 1.05, t * 0.04)) + 0.35 * gnoise(vec3f(p * 2.6 + 7.3, t * 0.07));
}

fn curl(p: vec2f, t: f32) -> vec2f {
  let e = 0.01;
  let dx = potential(p + vec2f(e, 0.0), t) - potential(p - vec2f(e, 0.0), t);
  let dy = potential(p + vec2f(0.0, e), t) - potential(p - vec2f(0.0, e), t);
  return vec2f(dy, -dx) / (2.0 * e);
}

fn rand(s: f32) -> f32 { return fract(sin(s * 12.9898) * 43758.5453); }

override WG: u32 = 64;
@compute @workgroup_size(WG)
fn cs_main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (f32(i) >= sim.count) { return; }
  var p = particles[i];
  let dt = min(sim.dt, 0.1);
  p.age += dt;
  let out = p.pos.x < -0.05 || p.pos.x > sim.aspect + 0.05 || p.pos.y < -0.05 || p.pos.y > 1.05;
  if (p.age > p.life || out) {
    let s = p.seed + floor(sim.time * 3.0) * 1.618 + f32(i) * 0.001;
    p.pos = vec2f(rand(s) * sim.aspect, rand(s + 3.1));
    p.age = 0.0;
    p.life = 4.0 + rand(s + 7.7) * 8.0;
  }
  let v = curl(p.pos, sim.time) * 0.03 + vec2f(0.01, 0.003);
  p.vel = mix(p.vel, v, sim.damping);
  p.pos += p.vel * dt;
  particles[i] = p;
}
