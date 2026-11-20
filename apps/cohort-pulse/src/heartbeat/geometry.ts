/**
 * The room's heartbeat: pure layout and rhythm for the centrepiece. No DOM, no React; unit tested.
 *
 * Privacy: every input here is a total (counts per level, per module, over time). A light is one current answer in a
 * band, keyed only by its band and its index in that band, so it never stands for a person and lights reshuffle
 * freely when totals change.
 */
import type { LevelCounts, ModuleTotals, SessionTrend } from '../domain/pulse';
import type { Level } from '../model';

export type Lane = Level | 'none';
/** Top to bottom: the band that needs attention first. */
export const LANES: Lane[] = ['lost', 'unsure', 'got_it', 'none'];

export type LensKey = 'now' | 'modules' | 'trend';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface StageLayout {
  w: number;
  h: number;
  compact: boolean;
  /** Left edge of the band labels. */
  labelX: number;
  /** Row above the bands for module / segment titles. */
  header: Rect;
  /** Area for the lights and the trend streams (all four bands). */
  plot: Rect;
  lanes: Record<Lane, Rect>;
  /** The pulse line strip. */
  ecg: Rect;
}

const LANE_WEIGHT: Record<Lane, number> = { lost: 1, unsure: 1, got_it: 1, none: 0.62 };

/**
 * Where everything sits on a stage of w × h. Desktop leaves room for the floating title (top left), the conductor
 * and the lens bar (bottom); compact (phones) uses the whole stage.
 */
export function stageLayout(w: number, h: number, compact: boolean): StageLayout {
  const W = Math.max(w, 240);
  const H = Math.max(h, 240);
  const labelX = compact ? 14 : 28;
  const x0 = compact ? 88 : 196;
  const x1 = W - (compact ? 14 : 36);
  const headerY0 = compact ? 10 : Math.min(116, H * 0.16);
  const headerY1 = headerY0 + (compact ? 22 : 28);
  const ecgH = compact ? 50 : Math.max(56, Math.min(80, H * 0.11));
  const ecgY1 = H - (compact ? 54 : 136);
  const ecgY0 = ecgY1 - ecgH;
  const top = headerY1 + 2;
  const bottom = Math.max(top + 120, ecgY0 - (compact ? 8 : 16));
  const total = LANES.reduce((s, l) => s + LANE_WEIGHT[l], 0);
  const lanes = {} as Record<Lane, Rect>;
  let y = top;
  for (const l of LANES) {
    const lh = ((bottom - top) * LANE_WEIGHT[l]) / total;
    lanes[l] = { x0, y0: y, x1, y1: y + lh };
    y += lh;
  }
  return {
    w: W,
    h: H,
    compact,
    labelX,
    header: { x0, y0: headerY0, x1, y1: headerY1 },
    plot: { x0, y0: top, x1, y1: bottom },
    lanes,
    ecg: { x0, y0: ecgY0, x1, y1: ecgY1 },
  };
}

/* ------------------------------------------------------------------ lights */

export interface LightSpec {
  /** Band + index (and module in the all-modules lens). Never a person. */
  key: string;
  lane: Lane;
  x: number;
  y: number;
  /** Core radius in px. */
  r: number;
  /** Hollow ring: active but no answer yet. */
  hollow: boolean;
  /** Module the light belongs to (for focus dimming). */
  moduleId: string | null;
}

const R2_A1 = 0.7548776662466927;
const R2_A2 = 0.5698402909980532;
const frac = (v: number) => v - Math.floor(v);

/** Low-discrepancy point k (R2 sequence): well spread for any n, and adding a point never moves the others. */
export function r2(k: number, offset = 0): [number, number] {
  return [frac(0.5 + (k + offset) * R2_A1), frac(0.5 + (k + offset) * R2_A2)];
}

/** A light's size: smaller when a band is crowded so 40 lights still read as lights. */
export function lightRadius(n: number, compact: boolean): number {
  const base = compact ? 4.4 : 7;
  return Math.max(compact ? 2.6 : 3.4, base - Math.max(0, n - 10) * 0.09);
}

const bandPad = (layout: StageLayout) => (layout.compact ? 10 : 18);

/**
 * Where a band's lights live along the room's width: its share of the active room, starting where the band above
 * ended. Together the four bands are one 100% bar of light, pulled apart into rows (lost first, from the left edge),
 * so lost can be read against the pause line and every band against the whole room. Never narrower than its lights
 * need.
 */
export function bandSpan(layout: StageLayout, lane: Lane, counts: LevelCounts): { x0: number; x1: number } {
  const rect = layout.lanes[lane];
  const pad = bandPad(layout);
  const left = rect.x0 + pad;
  const width = rect.x1 - rect.x0 - 2 * pad;
  const total = LANES.reduce((s, l) => s + counts[l], 0);
  let x = left;
  for (const l of LANES) {
    const n = counts[l];
    const minW = n ? Math.min(width, n * (layout.compact ? 11 : 16) + (layout.compact ? 12 : 24)) : 0;
    const w = total && n ? Math.max(minW, (n / total) * width) : 0;
    const x0 = Math.min(x, left + width - w);
    if (l === lane) return { x0, x1: x0 + w };
    x = x0 + w;
  }
  return { x0: left, x1: left };
}

/** The x of a share (0..100) on the bands' scale, e.g. the pause line. */
export function shareX(layout: StageLayout, percent: number): number {
  const rect = layout.lanes.lost;
  const pad = bandPad(layout);
  return rect.x0 + pad + ((rect.x1 - rect.x0 - 2 * pad) * percent) / 100;
}

/** The current module: one light per answer, spread through its share of its band. */
export function nowLights(layout: StageLayout, counts: LevelCounts, moduleId: string | null): LightSpec[] {
  const out: LightSpec[] = [];
  LANES.forEach((lane, li) => {
    const n = counts[lane];
    const rect = layout.lanes[lane];
    const span = bandSpan(layout, lane, counts);
    const padY = Math.min(16, (rect.y1 - rect.y0) * 0.22);
    const r = lightRadius(n, layout.compact);
    for (let k = 0; k < n; k++) {
      const [u, v] = r2(k, li * 5 + 1);
      out.push({
        key: `${moduleId ?? 'none'}:${lane}:${k}`,
        lane,
        x: span.x0 + 6 + u * Math.max(0, span.x1 - span.x0 - 12),
        y: rect.y0 + padY + v * (rect.y1 - rect.y0 - 2 * padY),
        r: lane === 'none' ? r * 0.85 : r,
        hollow: lane === 'none',
        moduleId,
      });
    }
  });
  return out;
}

export interface ModuleColumn {
  id: string;
  index: number;
  name: string;
  state: ModuleTotals['state'];
  rect: Rect;
  confusionIndex: number | null;
  responses: number;
}

/** All modules: a column per module, each band a cell holding that module's lights in a sunflower cluster. */
export function moduleLights(layout: StageLayout, totals: ModuleTotals[]): { lights: LightSpec[]; columns: ModuleColumn[] } {
  const lights: LightSpec[] = [];
  const columns: ModuleColumn[] = [];
  const n = Math.max(1, totals.length);
  const gap = layout.compact ? 4 : 10;
  const colW = (layout.plot.x1 - layout.plot.x0 - gap * (n - 1)) / n;
  totals.forEach((m, i) => {
    const x0 = layout.plot.x0 + i * (colW + gap);
    const rect = { x0, y0: layout.plot.y0, x1: x0 + colW, y1: layout.plot.y1 };
    columns.push({ id: m.moduleId, index: i, name: m.name, state: m.state, rect, confusionIndex: m.confusionIndex, responses: m.responses });
    LANES.forEach((lane, li) => {
      const count = m.counts[lane];
      if (!count) return;
      const cell = layout.lanes[lane];
      const cx = x0 + colW / 2;
      const cy = (cell.y0 + cell.y1) / 2;
      const radius = Math.max(6, Math.min(colW, cell.y1 - cell.y0) / 2 - 8);
      const step = Math.min(layout.compact ? 6.5 : 11, radius / Math.sqrt(count + 0.5));
      const r = Math.min(lightRadius(count, layout.compact), Math.max(2, step * 0.46));
      for (let k = 0; k < count; k++) {
        const rr = step * Math.sqrt(k + 0.5);
        const th = k * 2.399963 + li * 1.3;
        lights.push({
          key: `${m.moduleId}:${lane}:${k}`,
          lane,
          x: cx + rr * Math.cos(th) * 1.25,
          y: cy + rr * Math.sin(th) * 0.8,
          r: lane === 'none' ? r * 0.85 : r,
          hollow: lane === 'none',
          moduleId: m.moduleId,
        });
      }
    });
  });
  return { lights, columns };
}

/* ------------------------------------------------------------------ trend streams */

export interface StreamPoint {
  x: number;
  /** Band edges top to bottom: lost [y0, y1], unsure [y1, y2], got it [y2, y3]. */
  y0: number;
  y1: number;
  y2: number;
  y3: number;
}

export interface StreamSegment {
  id: string;
  name: string;
  x0: number;
  x1: number;
  points: StreamPoint[];
}

export interface TrendGeometry {
  segments: StreamSegment[];
  maxResponses: number;
  /** The band edges at the right-hand end (now, or the close), for direct labels and the lights' resting place. */
  end: StreamPoint | null;
  endCounts: Omit<LevelCounts, 'none'> | null;
  start: number;
  stop: number;
}

/**
 * Trend over the session as a streamgraph around the middle of the plot: thickness is the number of answers, the
 * layers are lost (top), unsure and got it. Gaps where nobody had answered yet.
 */
export function trendGeometry(plot: Rect, trend: SessionTrend | null, fill = 0.86): TrendGeometry | null {
  if (!trend || !trend.samples.length) return null;
  const span = Math.max(1, trend.end - trend.start);
  const maxResponses = Math.max(1, ...trend.samples.map((s) => s.responses));
  const mid = (plot.y0 + plot.y1) / 2;
  const full = (plot.y1 - plot.y0) * fill;
  const xOf = (t: number) => plot.x0 + ((t - trend.start) / span) * (plot.x1 - plot.x0);
  const segments: StreamSegment[] = trend.segments.map((g) => {
    const points = trend.samples
      .filter((s) => s.moduleId === g.moduleId)
      .map((s) => {
        const th = (s.responses / maxResponses) * full;
        const unit = s.responses ? th / s.responses : 0;
        const y0 = mid - th / 2;
        const y1 = y0 + s.counts.lost * unit;
        const y2 = y1 + s.counts.unsure * unit;
        return { x: xOf(s.t), y0, y1, y2, y3: y2 + s.counts.got_it * unit };
      });
    return { id: g.moduleId, name: g.name, x0: xOf(g.start), x1: xOf(g.end), points };
  });
  const lastSample = trend.samples.reduce((a, b) => (b.t >= a.t ? b : a));
  const lastSeg = segments.find((s) => s.id === lastSample.moduleId);
  const end = lastSeg?.points[lastSeg.points.length - 1] ?? null;
  return { segments, maxResponses, end, endCounts: lastSample.counts, start: trend.start, stop: trend.end };
}

/** In the trend lens the current module's lights gather at the stream's leading edge, inside their layer. */
export function trendLights(layout: StageLayout, geo: TrendGeometry | null, counts: LevelCounts, moduleId: string | null): LightSpec[] {
  if (!geo?.end) return [];
  const e = geo.end;
  const spans: Record<Level, [number, number]> = { lost: [e.y0, e.y1], unsure: [e.y1, e.y2], got_it: [e.y2, e.y3] };
  const out: LightSpec[] = [];
  (['lost', 'unsure', 'got_it'] as Level[]).forEach((lane) => {
    const n = counts[lane];
    const [a, b] = spans[lane];
    for (let k = 0; k < n; k++) {
      out.push({
        key: `${moduleId ?? 'none'}:${lane}:${k}`,
        lane,
        x: e.x - 4 - (k % 3) * 6,
        y: a + ((k + 0.5) / Math.max(1, n)) * (b - a),
        r: layout.compact ? 2.6 : 3.4,
        hollow: false,
        moduleId,
      });
    }
  });
  return out;
}

/* ------------------------------------------------------------------ rhythm */

export type RhythmMode = 'flat' | 'waiting' | 'steady' | 'alert';

export interface Rhythm {
  mode: RhythmMode;
  /** Beats per minute of the drawn pulse line (not a measurement: an encoding of confusion). */
  bpm: number;
  /** 0 calm … 1 at or past the alert line. */
  intensity: number;
  /** 0 regular … 0.5 uneven (rises with "unsure"). */
  irregularity: number;
}

/**
 * The pulse line's rhythm from the room's totals: faster as the share of lost (and, half as much, unsure) answers
 * rises, uneven as unsure grows, flat when nobody is active.
 */
export function rhythmFor(counts: LevelCounts, active: number, alertKind: 'alert' | 'calm' | 'waiting' | 'none'): Rhythm {
  if (active <= 0) return { mode: 'flat', bpm: 0, intensity: 0, irregularity: 0 };
  const lost = counts.lost / active;
  const unsure = counts.unsure / active;
  const intensity = Math.max(0, Math.min(1, (lost + unsure * 0.5) / 0.4));
  const irregularity = Math.max(0, Math.min(0.5, unsure * 1.4));
  if (alertKind === 'waiting') return { mode: 'waiting', bpm: 46, intensity: intensity * 0.4, irregularity: 0.1 };
  return {
    mode: alertKind === 'alert' ? 'alert' : 'steady',
    bpm: Math.round(58 + 62 * intensity),
    intensity,
    irregularity,
  };
}

const gauss = (x: number, c: number, w: number) => Math.exp(-((x - c) ** 2) / (2 * w * w));

/**
 * One heartbeat (P, QRS, T) at `s` seconds after the beat started, for a beat lasting `interval` seconds.
 * Returns -0.35 … 1 (up is positive). The complex is compressed when beats come quickly.
 */
export function ecgAt(s: number, interval: number, intensity: number): number {
  const k = Math.min(1, interval / 0.78);
  const t = s / k;
  return (
    0.11 * gauss(t, 0.1, 0.024) -
    0.12 * gauss(t, 0.205, 0.008) +
    1 * gauss(t, 0.23, 0.0095) -
    0.3 * gauss(t, 0.255, 0.0095) +
    (0.22 + 0.12 * intensity) * gauss(t, 0.43, 0.045)
  );
}

/** Seeded PRNG (mulberry32) for drift phases and beat jitter. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Words for the pulse line's state, shown beside it. */
export function rhythmWords(r: Rhythm): string {
  if (r.mode === 'flat') return 'No one active';
  if (r.mode === 'waiting') return 'Waiting for a pulse';
  if (r.mode === 'alert') return 'Racing';
  if (r.intensity < 0.25) return 'Calm';
  if (r.intensity < 0.6) return 'Steady';
  return 'Quickening';
}
