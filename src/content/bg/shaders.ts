import { BUILDER, BUILDER_FRAG } from './builder';
import type { ShaderId } from '../../shared/settings';

// 四款原创背景着色器（WebGL1）。共用 value noise / fbm，配色由 u_c1..u_c3 传入。
const COMMON = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res; uniform float u_t; uniform vec3 u_c1; uniform vec3 u_c2; uniform vec3 u_c3; uniform vec3 u_bg;
float hash(vec2 p){
#ifndef GL_FRAGMENT_PRECISION_HIGH
  p=mod(p,31.);
#endif
  p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0., a=.5; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<5;i++){ v+=a*noise(p); p=m*p; a*=.5; } return v; }
`;

const BODIES: Partial<Record<ShaderId, string>> = {
  // 汇流：点线和粒子由 gate.ts 的 Canvas 2D 叠在上面画（细点线需要整像素清晰），GL 这层只铺纸色底
  gate: `
void main(){ gl_FragColor=vec4(u_bg,1.); }`,
  // 流光：WebGPU 计算着色器的粒子流（flux/）画好后作为 u_tex 传进来；不支持 WebGPU 时画下面的近似流线
  flux: `
uniform sampler2D u_tex; uniform float u_has;
void main(){
  vec2 uv=gl_FragCoord.xy/u_res;
  if(u_has>.5){ gl_FragColor=vec4(texture2D(u_tex,uv).rgb,1.); return; }
  float a=u_res.x/u_res.y; vec2 p=vec2(uv.x*a,uv.y)*2.; float t=u_t*.05;
  vec2 q=vec2(fbm(p+t),fbm(p+5.2-t));
  float n=fbm(p*1.5+q*2.+t);
  float lines=pow(abs(sin((n*8.+q.x*4.)*3.14159)),18.);
  vec3 c=mix(u_c1,u_c2,q.y); c=mix(c,u_c3,n*n);
  float d=lines*.6*smoothstep(.25,.75,n);
  float v=1.-.5*dot(uv-.5,uv-.5);
  gl_FragColor=vec4(mix(u_bg*v,c,d),1.);
}`,
  // 冰蓝：雾面上漂浮的柔光团 + 两道斜向玻璃折光
  ice: `
void main(){
  vec2 uv=gl_FragCoord.xy/u_res; float a=u_res.x/u_res.y; vec2 p=vec2(uv.x*a,uv.y);
  float t=u_t*.06;
  vec2 b1=vec2(a*(.72+.08*sin(t*1.3)), .62+.1*cos(t));
  vec2 b2=vec2(a*(.28+.1*cos(t*.8)), .22+.08*sin(t*1.1));
  vec2 b3=vec2(a*(.9+.05*sin(t*.6)), .15+.06*cos(t*1.7));
  float n=fbm(p*2.2+t);
  float g1=exp(-pow(distance(p,b1)/(.30+.04*n),2.));
  float g2=exp(-pow(distance(p,b2)/(.22+.04*n),2.));
  float g3=exp(-pow(distance(p,b3)/.16,2.));
  vec3 col=u_bg;
  col=mix(col,u_c3,smoothstep(.2,1.,uv.y*.5+n*.6)*.7);
  col=mix(col,u_c2,g2*.75+g3*.5);
  col=mix(col,u_c1,g1*.85);
  float d=p.x*.8-p.y+.15*sin(t);
  float streak=exp(-pow((fract(d*.9+.35)-.5)*14.,2.))*.35 + exp(-pow((fract(d*.9+.05)-.5)*30.,2.))*.25;
  col+=streak*(.6+.4*n)*vec3(1.)*(1.-g1*.5)*.6;
  gl_FragColor=vec4(col,1.);
}`,
  // 极光：竖向光幕，沿 x 方向被噪声推动
  aurora: `
void main(){
  vec2 uv=gl_FragCoord.xy/u_res; vec2 p=vec2(uv.x*u_res.x/u_res.y, uv.y);
  float t=u_t*.05;
  float w=fbm(vec2(p.x*1.4+t, t*.6));
  float band=smoothstep(.0,.55,uv.y-.18+w*.35)*(1.-smoothstep(.45,1.05,uv.y+w*.25));
  float rays=.55+.45*sin(p.x*9.+w*6.+u_t*.15);
  vec3 col=mix(u_c1,u_c2,smoothstep(.2,.8,w));
  col=mix(col,u_c3,smoothstep(.55,1.,uv.y+w*.3));
  vec3 c=mix(u_bg,col,band*rays*.9);
  gl_FragColor=vec4(c,1.);
}`,
  // 丝绸：二次域扭曲的条纹，像布料的反光
  silk: `
void main(){
  vec2 uv=gl_FragCoord.xy/u_res; vec2 p=vec2(uv.x*u_res.x/u_res.y, uv.y)*1.6;
  float t=u_t*.04;
  vec2 q=vec2(fbm(p+t), fbm(p+vec2(5.2,1.3)-t));
  vec2 r=vec2(fbm(p+2.*q+vec2(1.7,9.2)+t*.7), fbm(p+2.*q+vec2(8.3,2.8)));
  float s=.5+.5*sin((p.x+p.y*.6)*3.+r.x*6.);
  float sheen=pow(s,3.);
  vec3 col=mix(u_c1,u_c2,clamp(r.y*1.4-.2,0.,1.));
  col=mix(col,u_c3,sheen*.55);
  gl_FragColor=vec4(mix(u_bg,col,.55+.35*q.x),1.);
}`,
  // 网格渐变：四个缓慢漂移的色点按距离加权混合
  mesh: `
void main(){
  vec2 uv=gl_FragCoord.xy/u_res; float a=u_res.x/u_res.y; vec2 p=vec2(uv.x*a,uv.y);
  float t=u_t*.08;
  p+=.08*vec2(fbm(p*2.+t), fbm(p*2.-t));
  vec2 c1=vec2(a*(.2+.15*sin(t*1.1)), .25+.15*cos(t*.9));
  vec2 c2=vec2(a*(.8+.12*cos(t*.7)), .3+.2*sin(t*1.3));
  vec2 c3=vec2(a*(.55+.2*sin(t*.5)), .85+.1*cos(t*1.7));
  vec2 c4=vec2(a*(.1+.1*cos(t*1.5)), .9+.08*sin(t));
  float w1=1./pow(distance(p,c1)+.08,2.), w2=1./pow(distance(p,c2)+.08,2.), w3=1./pow(distance(p,c3)+.08,2.), w4=1./pow(distance(p,c4)+.08,2.)*.6;
  vec3 col=(u_c1*w1+u_c2*w2+u_c3*w3+u_bg*w4)/(w1+w2+w3+w4);
  gl_FragColor=vec4(col,1.);
}`,
  // 颗粒渐变：柔和的大块渐变 + 静态胶片颗粒
  // v0.46：颗粒以前每帧重新随机、强度 .07，大屏上像电视雪花（B 站评论反馈），改成固定在屏幕像素上、强度减半
  grain: `
void main(){
  vec2 uv=gl_FragCoord.xy/u_res; vec2 p=vec2(uv.x*u_res.x/u_res.y, uv.y);
  float t=u_t*.03;
  float n=fbm(p*1.2+vec2(t,-t*.7));
  float m=fbm(p*.8-vec2(t*.5,t));
  vec3 col=mix(u_c1,u_c2,smoothstep(.25,.75,n));
  col=mix(col,u_c3,smoothstep(.5,.85,m)*.8);
  col=mix(u_bg,col,smoothstep(-.1,.9,uv.y*.6+n*.7));
  float g=hash(floor(gl_FragCoord.xy))-.5;
  gl_FragColor=vec4(col+g*.035,1.);
}`,
};

export const SHADER_IDS: ShaderId[] = ['veil', 'smoke', 'neuro', 'flow', 'rays', 'blend', 'aurora', 'silk', 'mesh', 'grain', 'ice', 'flux', 'gate'];
export const BUILDER_IDS = ['veil', 'smoke', 'neuro', 'flow', 'rays', 'blend'] as const;
export const isBuilder = (id: ShaderId): id is typeof BUILDER_IDS[number] => (BUILDER_IDS as readonly string[]).includes(id);
export const SHADER_NAMES: Record<ShaderId, string> = { gate: '汇流', aurora: '极光', silk: '丝绸', mesh: '网格渐变', grain: '颗粒', ice: '冰蓝', veil: '丝缎', smoke: '烟霞', neuro: '流萤', flow: '流沙', rays: '天光', blend: '弥散', flux: '流光' };

export function fragment(id: ShaderId): string {
  if (isBuilder(id)) return BUILDER_FRAG.replace('/*SHADE*/', BUILDER[id].shade);
  return COMMON + BODIES[id];
}

type RGB = [number, number, number];
const hex = (s: string): RGB => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as RGB;

type Pal = { bg: RGB; c: [RGB, RGB, RGB] };

export const PALETTES: Record<'light' | 'dark', Partial<Record<ShaderId, Pal>>> = {
  dark: {
    aurora: { bg: hex('#0d0e12'), c: [hex('#1fd1a5'), hex('#2b6cff'), hex('#b44cff')] },
    silk: { bg: hex('#0f0f13'), c: [hex('#2a2440'), hex('#123a52'), hex('#8fb6d9')] },
    mesh: { bg: hex('#101015'), c: [hex('#173b6b'), hex('#5b2a6e'), hex('#0e5a5a')] },
    grain: { bg: hex('#0e0e10'), c: [hex('#3a1f2b'), hex('#1c3350'), hex('#c06a3c')] },
    ice: { bg: hex('#0f1014'), c: [hex('#2b5fd9'), hex('#1b2f5e'), hex('#1a1d26')] },
    gate: { bg: hex('#000000'), c: [hex('#ffffff'), hex('#ffffff'), hex('#ffffff')] },
    flux: { bg: hex('#0c0d11'), c: [hex('#3d7bff'), hex('#a35cff'), hex('#5ff0d0')] },
  },
  light: {
    aurora: { bg: hex('#f5f4f1'), c: [hex('#9de8d2'), hex('#a9c4ff'), hex('#e0b8ff')] },
    silk: { bg: hex('#f4f2ee'), c: [hex('#e8e1f2'), hex('#d4e8f2'), hex('#ffffff')] },
    mesh: { bg: hex('#f5f4f1'), c: [hex('#bfe0ff'), hex('#ffd1e3'), hex('#c9f2e3')] },
    grain: { bg: hex('#f3f1ec'), c: [hex('#f7d9c4'), hex('#cfdcf2'), hex('#f2b48f')] },
    ice: { bg: hex('#f5f4f1'), c: [hex('#6f9cf2'), hex('#c3d6fb'), hex('#e9eef8')] },
    gate: { bg: hex('#eef1f6'), c: [hex('#1a1f2a'), hex('#1a1f2a'), hex('#1a1f2a')] },
    flux: { bg: hex('#f4f3ef'), c: [hex('#7d9ff5'), hex('#e59bc4'), hex('#4fbfa8')] },
  },
};
