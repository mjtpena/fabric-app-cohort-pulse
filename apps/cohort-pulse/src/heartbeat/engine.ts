/**
 * The heartbeat renderer: one requestAnimationFrame loop that draws the bands, the module columns, the trend streams,
 * the lights and the pulse line on a 2D canvas, and (when WebGL is available) the room's light shader underneath.
 * Inputs are totals only (see geometry.ts).
 */
import { ecgAt, seeded, type Lane, type LensKey, type LightSpec, type ModuleColumn, type Rhythm, type StageLayout, type TrendGeometry } from './geometry';
import { RoomLightRenderer, type RGB } from './roomLight';

export type StageFocus = { kind: 'lane'; lane: Lane } | { kind: 'module'; id: string } | { kind: 'notes' };

export interface EngineScene {
  lens: LensKey;
  layout: StageLayout;
  lights: LightSpec[];
  columns: ModuleColumn[];
  stream: TrendGeometry | null;
  focus: StageFocus | null;
  currentId: string | null;
  rhythm: Rhythm;
  /** Where each band's lights reach (its share of the room), for the current-module lens. */
  spans: Record<Lane, { x0: number; x1: number }>;
  /** The pause line's x on the lost band, or null while waiting. */
  pauseX: number | null;
}

export interface EnginePalette {
  dark: boolean;
  lane: Record<Lane, RGB>;
  /** Definition ring for lights in the light theme (status text colours). */
  laneInk: Record<Lane, RGB>;
  accent: RGB;
  bad: RGB;
  muted: RGB;
  grid: RGB;
  gridAlpha: number;
  light: { top: RGB; bottom: RGB; calm: RGB; alert: RGB; cool: RGB };
}

interface LightState extends LightSpec {
  tx: number;
  ty: number;
  tr: number;
  a: number;
  ta: number;
  born: number;
  ph: number;
  fx: number;
  fy: number;
}

const rgba = ([r, g, b]: RGB, a: number) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${Math.max(0, Math.min(1, a))})`;
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE: RGB = [1, 1, 1];
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);

export class HeartbeatEngine {
  private ctx: CanvasRenderingContext2D;
  private light: RoomLightRenderer | null = null;
  private scene: EngineScene | null = null;
  private palette: EnginePalette | null = null;
  private lights = new Map<string, LightState>();
  private raf = 0;
  private last = 0;
  private t0 = performance.now();
  private dpr = 1;
  private w = 0;
  private h = 0;
  private first = true;
  private rand = seeded(7);
  // lens cross-fade
  private mix: Record<LensKey, number> = { now: 1, modules: 0, trend: 0 };
  private reveal = 1;
  // pulse line
  private ecg = new Float32Array(0);
  private head = 0;
  private acc = 0;
  private sim = 0;
  private beatStart = 0;
  private interval = 1;
  private lastR = -10;
  private beatEnv = 0;
  private lightMix = 0;
  private frame = 0;
  private reduced = false;
  private lightShown = false;

  constructor(
    private canvas: HTMLCanvasElement,
    lightCanvas: HTMLCanvasElement | null,
    onLightFail: () => void,
  ) {
    this.ctx = canvas.getContext('2d')!;
    if (lightCanvas) {
      try {
        this.light = new RoomLightRenderer(lightCanvas);
      } catch {
        this.light = null;
        onLightFail();
      }
    }
  }

  setReduced(reduced: boolean) {
    this.reduced = reduced;
    this.restart();
  }

  setPalette(p: EnginePalette) {
    this.palette = p;
    this.kick();
  }

  resize(w: number, h: number, lightW: number, lightH: number) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    if (this.light) {
      const lc = this.light.canvas;
      // The light is soft by nature: a quarter-resolution buffer upscaled by the browser looks the same and costs 1/16.
      lc.width = Math.max(1, Math.round(lightW * 0.25));
      lc.height = Math.max(1, Math.round(lightH * 0.25));
    }
    this.kick();
  }

  setScene(scene: EngineScene) {
    const prevLens = this.scene?.lens;
    const ecgW = Math.max(1, Math.round(scene.layout.ecg.x1 - scene.layout.ecg.x0));
    if (ecgW !== this.ecg.length) {
      this.ecg = new Float32Array(ecgW).fill(NaN);
      this.head = 0;
    }
    if (prevLens !== scene.lens && scene.lens === 'trend') this.reveal = this.reduced ? 1 : 0;
    const now = this.time();
    const seen = new Set<string>();
    scene.lights.forEach((spec, i) => {
      seen.add(spec.key);
      const cur = this.lights.get(spec.key);
      if (cur) {
        Object.assign(cur, { lane: spec.lane, hollow: spec.hollow, moduleId: spec.moduleId, tx: spec.x, ty: spec.y, tr: spec.r, ta: 1 });
      } else {
        this.lights.set(spec.key, {
          ...spec,
          tx: spec.x,
          ty: spec.y,
          tr: spec.r,
          a: 0,
          ta: 1,
          born: now + (this.first ? Math.min(i * 0.045, (1.2 * i) / Math.max(1, scene.lights.length)) : (i % 6) * 0.03),
          ph: this.rand() * Math.PI * 2,
          fx: 0.25 + this.rand() * 0.35,
          fy: 0.2 + this.rand() * 0.3,
        });
      }
    });
    for (const [k, l] of this.lights) if (!seen.has(k)) l.ta = 0;
    this.first = false;
    this.scene = scene;
    if (this.reduced) this.restart();
    this.kick();
  }

  /** Current beat envelope (0..1), for anything that wants to pulse with the line. */
  get beat() {
    return this.beatEnv;
  }

  start() {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose() {
    this.stop();
    this.light?.dispose();
  }

  private time() {
    return (performance.now() - this.t0) / 1000;
  }

  /** Reduced motion: no loop, one settled frame per change. */
  private kick() {
    if (this.reduced) {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.settle();
        this.draw(this.time(), 0);
      });
    } else this.start();
  }

  private settle() {
    for (const k of Object.keys(this.mix) as LensKey[]) this.mix[k] = this.scene?.lens === k ? 1 : 0;
    this.reveal = 1;
    for (const [k, l] of this.lights) {
      if (l.ta === 0) {
        this.lights.delete(k);
        continue;
      }
      l.x = l.tx;
      l.y = l.ty;
      l.r = l.tr;
      l.a = 1;
      l.born = -10;
    }
    this.lightMix = this.targetLightMix();
    this.fillStaticEcg();
  }

  private restart() {
    this.ecg.fill(NaN);
    this.head = 0;
  }

  private tick = (ms: number) => {
    const t = (ms - this.t0) / 1000;
    const dt = this.last ? Math.min(0.1, t - this.last) : 0.016;
    this.last = t;
    this.raf = requestAnimationFrame(this.tick);
    this.draw(t, dt);
  };

  private targetLightMix() {
    const r = this.scene?.rhythm;
    if (!r) return 0;
    return r.mode === 'alert' ? 1 : r.intensity * 0.45;
  }

  /* -------------------------------------------------------------- frame */

  private draw(t: number, dt: number) {
    const { scene, palette: p } = this;
    if (!scene || !p || !this.w) return;
    const ctx = this.ctx;
    for (const k of Object.keys(this.mix) as LensKey[]) this.mix[k] += ((scene.lens === k ? 1 : 0) - this.mix[k]) * ease(dt, 7);
    if (scene.lens === 'trend') this.reveal = Math.min(1, this.reveal + dt / 1.1);
    this.lightMix += (this.targetLightMix() - this.lightMix) * ease(dt, 0.9);

    if (!this.reduced) this.advanceEcg(t, dt, scene.rhythm);
    this.beatEnv = t >= this.lastR ? Math.exp(-(t - this.lastR) * 4.5) : this.beatEnv;

    // Room light (quarter resolution, every third frame: it drifts slowly).
    this.frame++;
    if (this.light && (this.reduced || this.frame % 3 === 0)) {
      this.light.render({
        time: this.reduced ? 12 : t,
        mix: this.lightMix,
        beat: this.reduced ? 0 : this.beatEnv,
        dark: p.dark,
        ...p.light,
      });
      if (!this.lightShown) {
        this.lightShown = true;
        this.light.canvas.style.opacity = '1';
      }
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (this.mix.now > 0.01) this.drawLanes(scene, p, this.mix.now);
    if (this.mix.modules > 0.01) this.drawColumns(scene, p, this.mix.modules);
    if (this.mix.trend > 0.01) this.drawStream(scene, p, this.mix.trend);
    if (scene.lens !== 'trend') this.drawConstellations(scene, p, t);
    this.drawLights(scene, p, t, dt);
    this.drawEcg(scene, p);
  }

  /* -------------------------------------------------------------- bands */

  private drawLanes(scene: EngineScene, p: EnginePalette, alpha: number) {
    const ctx = this.ctx;
    const { lanes } = scene.layout;
    const focusLane = scene.focus?.kind === 'lane' ? scene.focus.lane : null;
    for (const lane of Object.keys(lanes) as Lane[]) {
      const r = lanes[lane];
      const span = scene.spans[lane];
      const on = focusLane === lane;
      const dim = focusLane && !on ? 0.35 : 1;
      const col = lane === 'none' ? p.muted : p.lane[lane];
      const cy = (r.y0 + r.y1) / 2;
      const ry = (r.y1 - r.y0) / 2;
      const len = span.x1 - span.x0;
      // The band's whole axis, dotted: the scale its share is read against.
      ctx.strokeStyle = rgba(col, (on ? 0.4 : 0.2) * alpha * dim);
      ctx.lineWidth = 1;
      ctx.setLineDash([1, 5]);
      ctx.beginPath();
      ctx.moveTo(r.x0, Math.round(cy) + 0.5);
      ctx.lineTo(r.x1, Math.round(cy) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      if (len > 0) {
        // A soft nebula over the band's share of the room.
        const rx = len / 2 + (scene.layout.compact ? 16 : 48);
        const strength = (p.dark ? 0.3 : 0.24) * (lane === 'none' ? 0.45 : 1) * (on ? 1.7 : 1) * alpha * dim;
        ctx.save();
        ctx.translate(span.x0 + len / 2, cy);
        ctx.scale(rx / ry, 1);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry * 1.08);
        g.addColorStop(0, rgba(col, strength));
        g.addColorStop(0.6, rgba(col, strength * 0.42));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, ry * 1.08, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // The share itself: a bright filament along the axis.
        const fil = ctx.createLinearGradient(span.x0, 0, span.x1, 0);
        fil.addColorStop(0, rgba(col, 0.75 * alpha * dim));
        fil.addColorStop(1, rgba(col, 0.25 * alpha * dim));
        ctx.strokeStyle = fil;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(span.x0, cy);
        ctx.lineTo(span.x1, cy);
        ctx.stroke();
        ctx.fillStyle = rgba(col, 0.8 * alpha * dim);
        ctx.beginPath();
        ctx.arc(span.x1, cy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // Short tick at the band's start.
      ctx.strokeStyle = rgba(col, 0.6 * alpha * dim);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(r.x0 - 10, cy - ry * 0.45);
      ctx.lineTo(r.x0 - 10, cy + ry * 0.45);
      ctx.stroke();
    }
    // The pause line: where the lost band's share calls for a pause.
    if (scene.pauseX !== null) {
      const r = lanes.lost;
      const crossed = scene.spans.lost.x1 >= scene.pauseX - 0.5 && scene.rhythm.mode === 'alert';
      ctx.strokeStyle = rgba(p.lane.lost, (crossed ? 0.9 : 0.45) * alpha);
      ctx.lineWidth = crossed ? 1.5 : 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(Math.round(scene.pauseX) + 0.5, r.y0 + 4);
      ctx.lineTo(Math.round(scene.pauseX) + 0.5, r.y1 - 4);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** Faint constellation lines between neighbouring lights of the same band (same answer, never the same person). */
  private drawConstellations(scene: EngineScene, p: EnginePalette, t: number) {
    const ctx = this.ctx;
    const groups = new Map<string, LightState[]>();
    for (const l of this.lights.values()) {
      if (l.hollow || l.a < 0.05) continue;
      const g = `${l.moduleId}:${l.lane}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(l);
    }
    const focus = scene.focus;
    const amp = scene.layout.compact ? 2.5 : 5;
    const pos = (l: LightState) =>
      this.reduced ? [l.x, l.y] : [l.x + Math.sin(t * l.fx + l.ph) * amp, l.y + Math.cos(t * l.fy + l.ph * 1.3) * amp * 0.7];
    ctx.lineWidth = 1;
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => a.tx - b.tx || a.ty - b.ty);
      const lane = sorted[0].lane;
      let dim = 1;
      if (focus?.kind === 'lane' && focus.lane !== lane) dim = 0.25;
      if (focus?.kind === 'module' && focus.id !== sorted[0].moduleId) dim = 0.25;
      ctx.beginPath();
      for (let i = 0; i < sorted.length; i++) {
        const [x, y] = pos(sorted[i]);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      const a = Math.min(...sorted.map((l) => l.a));
      ctx.strokeStyle = rgba(p.lane[lane], (p.dark ? 0.28 : 0.32) * a * dim);
      ctx.stroke();
    }
  }

  private drawColumns(scene: EngineScene, p: EnginePalette, alpha: number) {
    const ctx = this.ctx;
    const focusId = scene.focus?.kind === 'module' ? scene.focus.id : null;
    const { lanes } = scene.layout;
    for (const c of scene.columns) {
      const r = c.rect;
      const on = focusId === c.id;
      const current = c.state === 'current';
      const dim = focusId && !on ? 0.45 : 1;
      ctx.save();
      roundRect(ctx, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 14);
      ctx.fillStyle = rgba(current ? p.accent : p.muted, (current ? (p.dark ? 0.1 : 0.07) : p.dark ? 0.06 : 0.045) * alpha * dim);
      ctx.fill();
      if (c.state === 'upcoming') ctx.setLineDash([3, 5]);
      ctx.strokeStyle = on ? rgba(p.accent, 0.95 * alpha) : current ? rgba(p.accent, 0.5 * alpha * dim) : rgba(p.grid, p.gridAlpha * 2.2 * alpha * dim);
      ctx.lineWidth = on ? 2 : 1;
      ctx.stroke();
      ctx.restore();
      // Band separators inside the column.
      ctx.strokeStyle = rgba(p.grid, p.gridAlpha * 1.6 * alpha * dim);
      ctx.lineWidth = 1;
      for (const lane of ['unsure', 'got_it', 'none'] as Lane[]) {
        const y = Math.round(lanes[lane].y0) + 0.5;
        ctx.beginPath();
        ctx.moveTo(r.x0 + 10, y);
        ctx.lineTo(r.x1 - 10, y);
        ctx.stroke();
      }
    }
  }

  private drawStream(scene: EngineScene, p: EnginePalette, alpha: number) {
    const geo = scene.stream;
    if (!geo) return;
    const ctx = this.ctx;
    const { plot } = scene.layout;
    const clipX = plot.x0 + (plot.x1 - plot.x0) * easeOut(this.reveal);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, clipX + 2, this.h);
    ctx.clip();
    const mid = (plot.y0 + plot.y1) / 2;
    // baseline and module boundaries
    ctx.strokeStyle = rgba(p.grid, p.gridAlpha * 2.5 * alpha);
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(plot.x0, mid);
    ctx.lineTo(plot.x1, mid);
    for (const s of geo.segments) {
      ctx.moveTo(Math.round(s.x0) + 0.5, plot.y0);
      ctx.lineTo(Math.round(s.x0) + 0.5, plot.y1);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const layers: [Lane, 'y0' | 'y1' | 'y2', 'y1' | 'y2' | 'y3'][] = [
      ['lost', 'y0', 'y1'],
      ['unsure', 'y1', 'y2'],
      ['got_it', 'y2', 'y3'],
    ];
    if (p.dark) ctx.globalCompositeOperation = 'lighter';
    for (const s of geo.segments) {
      if (s.points.length < 2) continue;
      for (const [lane, a, b] of layers) {
        ctx.beginPath();
        trace(ctx, s.points.map((pt) => [pt.x, pt[a]]), true);
        trace(ctx, [...s.points].reverse().map((pt) => [pt.x, pt[b]]), false);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, plot.y0, 0, plot.y1);
        const col = p.lane[lane];
        g.addColorStop(0, rgba(col, (p.dark ? 0.55 : 0.62) * alpha));
        g.addColorStop(0.5, rgba(col, (p.dark ? 0.42 : 0.5) * alpha));
        g.addColorStop(1, rgba(col, (p.dark ? 0.55 : 0.62) * alpha));
        ctx.fillStyle = g;
        ctx.fill();
      }
      // top and bottom edges glow
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = rgba(p.lane.lost, 0.9 * alpha);
      ctx.beginPath();
      trace(ctx, s.points.map((pt) => [pt.x, pt.y0]), true);
      ctx.stroke();
      ctx.strokeStyle = rgba(p.lane.got_it, 0.9 * alpha);
      ctx.beginPath();
      trace(ctx, s.points.map((pt) => [pt.x, pt.y3]), true);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  /* -------------------------------------------------------------- lights */

  private drawLights(scene: EngineScene, p: EnginePalette, t: number, dt: number) {
    const ctx = this.ctx;
    const reduced = this.reduced;
    const focus = scene.focus;
    const amp = scene.layout.compact ? 2.5 : 5;
    const beat = reduced ? 0 : this.beatEnv;
    const moveK = ease(dt, 4.2);
    const fadeK = ease(dt, 5);
    for (const [k, l] of this.lights) {
      if (!reduced) {
        if (t >= l.born) l.a += (l.ta - l.a) * fadeK;
        l.x += (l.tx - l.x) * moveK;
        l.y += (l.ty - l.y) * moveK;
        l.r += (l.tr - l.r) * moveK;
      }
      if (l.ta === 0 && l.a < 0.02) {
        this.lights.delete(k);
        continue;
      }
      if (l.a <= 0.003) continue;
      let dim = 1;
      if (focus?.kind === 'lane' && focus.lane !== l.lane) dim = 0.22;
      if (focus?.kind === 'module' && focus.id !== l.moduleId) dim = 0.22;
      if (focus?.kind === 'notes') dim = 0.3;
      const x = l.x + (reduced ? 0 : Math.sin(t * l.fx + l.ph) * amp);
      const y = l.y + (reduced ? 0 : Math.cos(t * l.fy + l.ph * 1.3) * amp * 0.7);
      const tw = reduced ? 1 : 0.86 + 0.14 * Math.sin(t * 1.9 + l.ph * 3);
      const A = l.a * dim * tw;
      const R = l.r * (1 + 0.18 * beat);
      if (l.hollow) {
        const br = reduced ? 1 : 1 + 0.12 * Math.sin(t * 1.3 + l.ph);
        ctx.strokeStyle = rgba(p.muted, 0.7 * A);
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(x, y, R * 1.05 * br, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      const col = p.lane[l.lane];
      if (p.dark) ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(x, y, 0, x, y, R * 5.4);
      halo.addColorStop(0, rgba(col, (p.dark ? 0.5 : 0.36) * A));
      halo.addColorStop(0.32, rgba(col, (p.dark ? 0.17 : 0.13) * A));
      halo.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, R * 5.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgba(p.dark ? mixRGB(col, WHITE, 0.5) : col, A);
      ctx.beginPath();
      ctx.arc(x, y, R, 0, Math.PI * 2);
      ctx.fill();
      if (!p.dark) {
        ctx.strokeStyle = rgba(p.laneInk[l.lane], 0.35 * A);
        ctx.lineWidth = 0.75;
        ctx.stroke();
      }
      ctx.fillStyle = rgba(WHITE, (p.dark ? 0.85 : 0.7) * A);
      ctx.beginPath();
      ctx.arc(x - R * 0.28, y - R * 0.28, R * 0.42, 0, Math.PI * 2);
      ctx.fill();
      // Ignition: a ring opens when a new answer arrives.
      const age = t - l.born;
      if (!reduced && age >= 0 && age < 1.1) {
        const q = age / 1.1;
        ctx.strokeStyle = rgba(col, (1 - q) ** 2 * 0.75 * dim);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, R + q * 26, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /* -------------------------------------------------------------- pulse line */

  private nextInterval(r: Rhythm) {
    if (r.mode === 'flat') return 1.2;
    const base = 60 / Math.max(30, r.bpm);
    return base * (1 + r.irregularity * (this.rand() - 0.5));
  }

  private sample(s: number, r: Rhythm) {
    if (r.mode === 'flat') return (this.rand() - 0.5) * 0.015;
    const v = ecgAt(s, this.interval, r.intensity);
    const noise = (this.rand() - 0.5) * (0.012 + r.irregularity * 0.03);
    return (r.mode === 'waiting' ? v * 0.42 : v) + noise;
  }

  private advanceEcg(t: number, dt: number, r: Rhythm) {
    const n = this.ecg.length;
    if (!n) return;
    const speed = n / (this.scene?.layout.compact ? 3.6 : 4.6);
    this.acc += speed * dt;
    const steps = Math.min(n, Math.floor(this.acc));
    this.acc -= Math.floor(this.acc);
    const colDt = 1 / speed;
    let h = this.head;
    for (let i = 0; i < steps; i++) {
      this.sim += colDt;
      let s = this.sim - this.beatStart;
      if (s >= this.interval) {
        this.beatStart += this.interval;
        this.interval = this.nextInterval(r);
        s = this.sim - this.beatStart;
      }
      if (r.mode !== 'flat' && s >= 0.23 * Math.min(1, this.interval / 0.78) && s - colDt < 0.23 * Math.min(1, this.interval / 0.78)) {
        this.lastR = t;
      }
      h = (h + 1) % n;
      this.ecg[h] = this.sample(s, r);
    }
    this.head = h;
  }

  private fillStaticEcg() {
    const r = this.scene?.rhythm;
    const n = this.ecg.length;
    if (!r || !n) return;
    const speed = n / 4.6;
    this.sim = 0;
    this.beatStart = -0.15;
    this.interval = 60 / Math.max(30, r.bpm || 60);
    const rand = seeded(3);
    for (let i = 0; i < n; i++) {
      this.sim += 1 / speed;
      let s = this.sim - this.beatStart;
      if (s >= this.interval) {
        this.beatStart += this.interval;
        this.interval = (60 / Math.max(30, r.bpm || 60)) * (1 + r.irregularity * (rand() - 0.5));
        s = this.sim - this.beatStart;
      }
      this.ecg[i] = r.mode === 'flat' ? 0 : ecgAt(s, this.interval, r.intensity) * (r.mode === 'waiting' ? 0.42 : 1);
    }
    this.head = n - 1;
  }

  private drawEcg(scene: EngineScene, p: EnginePalette) {
    const ctx = this.ctx;
    const e = scene.layout.ecg;
    const n = this.ecg.length;
    const r = scene.rhythm;
    const hgt = e.y1 - e.y0;
    const base = e.y0 + hgt * 0.68;
    const amp = hgt * 0.58;
    // monitor grid
    ctx.strokeStyle = rgba(p.grid, p.gridAlpha * 1.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = e.x0; x <= e.x1; x += 24) {
      ctx.moveTo(Math.round(x) + 0.5, e.y0);
      ctx.lineTo(Math.round(x) + 0.5, e.y1);
    }
    for (const y of [e.y0, base, e.y1]) {
      ctx.moveTo(e.x0, Math.round(y) + 0.5);
      ctx.lineTo(e.x1, Math.round(y) + 0.5);
    }
    ctx.stroke();
    if (!n) return;
    const col = r.mode === 'alert' ? p.bad : r.mode === 'flat' || r.mode === 'waiting' ? p.muted : p.accent;
    const head = this.head;
    const gap = this.reduced ? 0 : Math.round(Math.min(28, n * 0.05));
    const y = (i: number) => base - this.ecg[i] * amp;
    const path = (from: number, to: number) => {
      ctx.beginPath();
      let started = false;
      for (let i = from; i <= to; i++) {
        const v = this.ecg[i];
        if (Number.isNaN(v)) {
          started = false;
          continue;
        }
        if (started) ctx.lineTo(e.x0 + i, y(i));
        else {
          ctx.moveTo(e.x0 + i, y(i));
          started = true;
        }
      }
    };
    const stroke = (from: number, to: number, a0: number, a1: number) => {
      if (to <= from) return;
      const g = ctx.createLinearGradient(e.x0 + from, 0, e.x0 + to, 0);
      g.addColorStop(0, rgba(col, a0));
      g.addColorStop(1, rgba(col, a1));
      const glow = ctx.createLinearGradient(e.x0 + from, 0, e.x0 + to, 0);
      glow.addColorStop(0, rgba(col, a0 * (p.dark ? 0.3 : 0.18)));
      glow.addColorStop(1, rgba(col, a1 * (p.dark ? 0.3 : 0.18)));
      path(from, to);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = glow;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.75;
      ctx.stroke();
    };
    if (this.reduced) {
      stroke(0, n - 1, 0.85, 0.85);
      return;
    }
    const ageAlpha = (cols: number) => 1 - 0.85 * (cols / n);
    // older part: right of the gap to the end
    stroke(Math.min(n - 1, head + gap), n - 1, ageAlpha(n - gap), ageAlpha(head));
    // newer part: start to the head
    stroke(0, head, ageAlpha(head), 1);
    // head
    if (!Number.isNaN(this.ecg[head])) {
      const hx = e.x0 + head;
      const hy = y(head);
      if (p.dark) ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(hx, hy, 0, hx, hy, 14);
      halo.addColorStop(0, rgba(col, 0.55));
      halo.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(hx, hy, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgba(p.dark ? mixRGB(col, WHITE, 0.6) : col, 1);
      ctx.beginPath();
      ctx.arc(hx, hy, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

const easeOut = (x: number) => 1 - (1 - x) ** 3;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** A smooth line through points (quadratic curves through the midpoints). */
function trace(ctx: CanvasRenderingContext2D, pts: [number, number][], move: boolean) {
  if (!pts.length) return;
  if (move) ctx.moveTo(pts[0][0], pts[0][1]);
  else ctx.lineTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}
