/**
 * The room's light: a full-stage WebGL fragment shader (slow aurora plumes over the sky gradient). Its tint is the
 * room's state: warm coral when calm, shifting to a deeper red as the share of lost answers nears the alert line, and
 * swelling slightly on each beat of the pulse line. No textures or assets; everything is computed in the shader.
 */

export type RGB = [number, number, number];

export interface LightUniforms {
  time: number;
  /** 0 calm … 1 alert. */
  mix: number;
  /** 0 … 1 beat envelope. */
  beat: number;
  dark: boolean;
  top: RGB;
  bottom: RGB;
  calm: RGB;
  alert: RGB;
  cool: RGB;
}

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uMix;
uniform float uBeat;
uniform float uDark;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uCalm;
uniform vec3 uAlert;
uniform vec3 uCool;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime * 0.03;
  vec3 col = mix(uBottom, uTop, uv.y);

  float n1 = fbm(p * 1.4 + vec2(t, -t * 0.6));
  float n2 = fbm(p * 2.2 - vec2(t * 0.7, t * 0.25) + n1 * 1.3);
  float plume = smoothstep(0.38, 0.92, n2);
  vec3 tint = mix(uCalm, uAlert, uMix);
  // The alert light gathers at the top of the stage, where the lost band is.
  float weight = mix(0.75, 0.55 + 0.9 * uv.y, uMix);
  float strength = (uDark > 0.5 ? 0.95 : 0.85) + 0.3 * uMix;
  col = mix(col, tint, clamp(plume * strength * weight * (1.0 + 0.3 * uBeat), 0.0, 1.0));

  float c = smoothstep(0.45, 0.95, fbm(p * 1.1 + vec2(-t * 0.5, t)));
  col = mix(col, uCool, c * (uDark > 0.5 ? 0.55 : 0.35) * (1.0 - uMix) * (1.0 - uv.y * 0.6));

  float v = smoothstep(1.3, 0.3, length((uv - 0.5) * vec2(1.1, 1.0)));
  col *= mix(uDark > 0.5 ? 0.7 : 0.95, 1.0, v);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class RoomLightRenderer {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private loc: Record<string, WebGLUniformLocation | null> = {};

  constructor(public readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uRes', 'uTime', 'uMix', 'uBeat', 'uDark', 'uTop', 'uBottom', 'uCalm', 'uAlert', 'uCool']) {
      this.loc[n] = gl.getUniformLocation(prog, n);
    }
  }

  render(u: LightUniforms) {
    const { gl, canvas } = this;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(this.loc.uRes, canvas.width, canvas.height);
    gl.uniform1f(this.loc.uTime, u.time);
    gl.uniform1f(this.loc.uMix, u.mix);
    gl.uniform1f(this.loc.uBeat, u.beat);
    gl.uniform1f(this.loc.uDark, u.dark ? 1 : 0);
    gl.uniform3fv(this.loc.uTop, u.top);
    gl.uniform3fv(this.loc.uBottom, u.bottom);
    gl.uniform3fv(this.loc.uCalm, u.calm);
    gl.uniform3fv(this.loc.uAlert, u.alert);
    gl.uniform3fv(this.loc.uCool, u.cool);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose() {
    this.gl.deleteProgram(this.prog);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** '#rrggbb', '#rgb' or 'rgb(a)(r g b / a)' → 0..1 floats. Unknown strings fall back to `fallback`. */
export function parseColor(input: string, fallback: RGB = [0.5, 0.5, 0.5]): RGB {
  const s = input.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  return fallback;
}

export const toCss = ([r, g, b]: RGB, a = 1) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${a})`;
