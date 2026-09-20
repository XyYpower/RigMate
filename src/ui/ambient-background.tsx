"use client";

import { useEffect, useRef } from "react";

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  p += u_mouse * 0.035;

  float t = u_time * 0.045;
  vec3 base = vec3(0.063, 0.078, 0.075);   // --rm-bg #101413
  vec3 accent = vec3(0.208, 0.788, 0.639); // --rm-accent #35c9a3

  // 缓慢漂移的微光雾
  float mist = fbm(p * 2.4 + vec2(t, -t * 0.6));
  mist = smoothstep(0.52, 0.95, mist);

  // 一团缓慢游走的主题色辉光
  vec2 blobPos = 0.55 * vec2(sin(t * 0.9), cos(t * 0.7));
  float glow = exp(-dot(p - blobPos, p - blobPos) * 2.4);

  // 极淡蓝图网格
  vec2 aspect = vec2(u_res.x / u_res.y, 1.0);
  vec2 g = abs(fract(uv * aspect * 24.0 + u_mouse * 0.012) - 0.5);
  float grid = smoothstep(0.465, 0.5, max(g.x, g.y));

  vec3 col = base + accent * (mist * 0.045 + glow * 0.085 + grid * 0.02);
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * WebGL 微光氛围背景（用户选定方向：页面 3D 氛围感，见 M10）。
 * - 零依赖：原生 WebGL 片元着色器（流动微光雾 + 游走辉光 + 蓝图网格）；
 * - 省电：DPR 上限 1.25、low-power 偏好、标签页隐藏暂停、鼠标视差经 lerp 平滑；
 * - 可访问性：prefers-reduced-motion 只渲染静态单帧；
 * - 兜底：WebGL 不可用时保持透明，body 的静态蓝图网格即背景。
 */
export function AmbientBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) return;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "u_res");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uMouse = gl.getUniformLocation(program, "u_mouse");

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dpr = () => Math.min(window.devicePixelRatio || 1, 1.25);
    const resize = () => {
      const w = Math.max(1, Math.floor(window.innerWidth * dpr()));
      const h = Math.max(1, Math.floor(window.innerHeight * dpr()));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    resize();

    // 鼠标视差目标值，rAF 内 lerp 平滑
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    const onMouseMove = (event: MouseEvent) => {
      target.x = (event.clientX / window.innerWidth) * 2 - 1;
      target.y = (event.clientY / window.innerHeight) * 2 - 1;
    };

    let raf = 0;
    let running = false;
    const draw = (timeMs: number) => {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, timeMs * 0.001);
      current.x += (target.x - current.x) * 0.04;
      current.y += (target.y - current.y) * 0.04;
      gl.uniform2f(uMouse, current.x, -current.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = (timeMs: number) => {
      draw(timeMs);
      raf = window.requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || reduced.matches) return;
      running = true;
      raf = window.requestAnimationFrame(loop);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      window.cancelAnimationFrame(raf);
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    if (reduced.matches) {
      // 静态单帧：保留氛围但不动画
      draw(12000);
    } else {
      start();
    }

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("visibilitychange", onVisibility);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas ref={canvasRef} className="ambient-canvas" aria-hidden="true" />;
}
