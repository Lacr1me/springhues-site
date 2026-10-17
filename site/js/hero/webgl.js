// 原生 WebGL1 渲染器。NPOT 纹理：CLAMP_TO_EDGE + LINEAR，不生成 mipmap。DPR 上限 1.5。
import { VERT, FRAG } from './shaders.js';

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('着色器编译失败：' + gl.getShaderInfoLog(s));
  return s;
}
function upload(gl, tex, source) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

// 返回渲染器；任何一步失败返回 null（调用方降级到静态图 + CSS）。
export function createHeroGL(canvas, { img, maskCanvas, onLost }) {
  let gl;
  try {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  } catch { gl = null; }
  if (!gl) return null;
  try {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('着色器链接失败');
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = n => gl.getUniformLocation(prog, n);
    const U = { tex: u('uTex'), mask: u('uMask'), time: u('uTime'), day: u('uDay') };
    const tex = gl.createTexture(), maskTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0); upload(gl, tex, img);
    gl.activeTexture(gl.TEXTURE1); upload(gl, maskTex, maskCanvas);
    gl.uniform1i(U.tex, 0); gl.uniform1i(U.mask, 1);
    let lost = false;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; onLost && onLost(); });
    let day = 1, dayTarget = 1;
    return {
      resize(cssW, cssH) {
        const dpr = Math.min(1.5, window.devicePixelRatio || 1);
        const w = Math.max(2, Math.min(2560, Math.round(cssW * dpr)));
        const h = Math.max(2, Math.round(w * cssH / cssW));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        gl.viewport(0, 0, w, h);
      },
      reupload() { if (lost) return; gl.activeTexture(gl.TEXTURE0); upload(gl, tex, img); },
      setDay(v) { dayTarget = v; },
      setDayNow(v) { day = dayTarget = v; },
      render(t, dt) {
        if (lost) return;
        day += Math.sign(dayTarget - day) * Math.min(Math.abs(dayTarget - day), dt / 600);
        gl.uniform1f(U.time, t);
        gl.uniform1f(U.day, day);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      destroy() {
        try { const ext = gl.getExtension('WEBGL_lose_context'); ext && ext.loseContext(); } catch { /* 忽略 */ }
        lost = true;
      },
      get lost() { return lost; }
    };
  } catch (e) {
    console.info('[hero] WebGL 初始化失败，使用静态图', e.message);
    return null;
  }
}
