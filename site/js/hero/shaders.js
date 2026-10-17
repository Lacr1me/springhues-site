// 首屏着色器：一个 draw call 的全屏三角形。布料流动 + 刀光 + 窗格光影 + 昼夜。
// 昼间 (uDay=1) 等于原图，不提亮不增加白面积；夜间向 #0D1850 压暗约 28%。
export const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uMask;
uniform float uTime;
uniform float uDay;

void main() {
  vec2 uv = vUv;
  float m = texture2D(uMask, uv).r;                 // 1：被 occluder 遮挡的形状，不位移，保证与 occluder 对齐
  float n1 = sin(uv.x * 5.0 + uTime * 0.35 + sin(uv.y * 4.0 + uTime * 0.2) * 1.5);
  float n2 = sin(uv.y * 7.0 - uTime * 0.28 + sin(uv.x * 3.0 - uTime * 0.15) * 2.0);
  vec2 disp = vec2(n1, n2) * 0.0055;
  uv += disp * (1.0 - m);
  vec3 col = texture2D(uTex, clamp(uv, 0.0, 1.0)).rgb;

  // 刀光：窄带，硬边，只在亮部把颜色向勃艮第红混 <=35%
  float ang = 0.62;
  float t = dot(vUv - vec2(0.5), vec2(cos(ang), sin(ang)));
  float pos = (fract(uTime * 0.045) * 2.0 - 1.0) * 0.8;
  float band = 1.0 - step(0.012, abs(t - pos));
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(0.565, 0.027, 0.165), band * smoothstep(0.55, 0.9, lum) * 0.35);

  // 窗格光影：右侧窗口区域亮度缓慢横移
  float win = smoothstep(0.70, 0.78, vUv.x);
  col *= 1.0 - win * 0.07 * (0.5 + 0.5 * sin(vUv.x * 11.0 + uTime * 0.22));

  // 夜间压暗
  vec3 night = mix(col, vec3(0.051, 0.094, 0.314), 0.28);
  col = mix(night, col, uDay);
  gl_FragColor = vec4(col, 1.0);
}`;
