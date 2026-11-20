import type { ModuleTotals, SessionTrend } from '../domain/pulse';
import { bandSpan, ecgAt, LANES, moduleLights, nowLights, r2, rhythmFor, shareX, stageLayout, trendGeometry, trendLights } from './geometry';

const counts = { lost: 2, unsure: 2, got_it: 3, none: 3 };

describe('stage layout', () => {
  it('stacks the four bands top to bottom between the header and the pulse line', () => {
    for (const [w, h, compact] of [
      [924, 720, false],
      [390, 490, true],
    ] as const) {
      const l = stageLayout(w, h, compact);
      expect(l.lanes.lost.y0).toBeGreaterThanOrEqual(l.header.y1);
      for (let i = 1; i < LANES.length; i++) expect(l.lanes[LANES[i]].y0).toBeCloseTo(l.lanes[LANES[i - 1]].y1);
      expect(l.lanes.none.y1).toBeLessThan(l.ecg.y0);
      expect(l.ecg.y1).toBeLessThan(h);
      expect(l.plot.x1).toBeLessThan(w);
    }
  });
});

describe('lights', () => {
  const layout = stageLayout(924, 720, false);

  it('draws one light per answer, hollow for "no answer yet", each inside its band', () => {
    const lights = nowLights(layout, counts, 'm1');
    expect(lights).toHaveLength(10);
    expect(lights.filter((l) => l.hollow)).toHaveLength(3);
    for (const l of lights) {
      const r = layout.lanes[l.lane];
      expect(l.x).toBeGreaterThan(r.x0);
      expect(l.x).toBeLessThan(r.x1);
      expect(l.y).toBeGreaterThan(r.y0);
      expect(l.y).toBeLessThan(r.y1);
    }
  });

  it('keys lights by band and index only', () => {
    const lights = nowLights(layout, counts, 'm1');
    expect(lights.every((l) => /^m1:(lost|unsure|got_it|none):\d+$/.test(l.key))).toBe(true);
  });

  it("stretches each band's lights over its share of the room, so lost can be read against the pause line", () => {
    const two = bandSpan(layout, 'lost', counts);
    const three = bandSpan(layout, 'lost', { ...counts, lost: 3, none: 2 });
    expect(three.x1).toBeGreaterThan(two.x1);
    // 3 of 10 reaches the 30% pause line exactly.
    expect(three.x1).toBeCloseTo(shareX(layout, 30));
    expect(two.x1).toBeLessThan(shareX(layout, 30));
    for (const l of nowLights(layout, counts, 'm1').filter((x) => x.lane === 'lost')) {
      expect(l.x).toBeGreaterThanOrEqual(two.x0);
      expect(l.x).toBeLessThanOrEqual(two.x1);
    }
    expect(bandSpan(layout, 'lost', { lost: 0, unsure: 0, got_it: 0, none: 0 })).toEqual({ x0: two.x0, x1: two.x0 });
    // Each band starts where the one above ended: together they span the room.
    expect(bandSpan(layout, 'unsure', counts).x0).toBeCloseTo(two.x1);
    expect(bandSpan(layout, 'none', counts).x1).toBeCloseTo(shareX(layout, 100));
  });

  it('spreads points (R2 sequence) without repeats', () => {
    const pts = Array.from({ length: 30 }, (_, k) => r2(k).map((v) => v.toFixed(3)).join(','));
    expect(new Set(pts).size).toBe(30);
  });

  it('puts each module in its own column', () => {
    const totals: ModuleTotals[] = [
      { moduleId: 'a', name: 'A', sortOrder: 1, state: 'done', counts: { lost: 0, unsure: 1, got_it: 6, none: 0 }, responses: 7, confusionIndex: 0 },
      { moduleId: 'b', name: 'B', sortOrder: 2, state: 'current', counts, responses: 7, confusionIndex: 2 / 7 },
      { moduleId: 'c', name: 'C', sortOrder: 3, state: 'upcoming', counts: { lost: 0, unsure: 0, got_it: 0, none: 0 }, responses: 0, confusionIndex: null },
    ];
    const { lights, columns } = moduleLights(layout, totals);
    expect(columns.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(lights.filter((l) => l.moduleId === 'a')).toHaveLength(7);
    expect(lights.filter((l) => l.moduleId === 'b')).toHaveLength(10);
    for (const l of lights) {
      const col = columns.find((c) => c.id === l.moduleId)!;
      expect(l.x).toBeGreaterThanOrEqual(col.rect.x0);
      expect(l.x).toBeLessThanOrEqual(col.rect.x1);
    }
  });
});

describe('trend streams', () => {
  const layout = stageLayout(924, 720, false);
  const trend: SessionTrend = {
    start: 0,
    end: 100,
    segments: [
      { moduleId: 'a', name: 'A', start: 0, end: 50 },
      { moduleId: 'b', name: 'B', start: 50, end: 100 },
    ],
    samples: [
      { t: 0, moduleId: 'a', counts: { lost: 0, unsure: 0, got_it: 0 }, responses: 0 },
      { t: 50, moduleId: 'a', counts: { lost: 0, unsure: 1, got_it: 3 }, responses: 4 },
      { t: 50, moduleId: 'b', counts: { lost: 0, unsure: 0, got_it: 0 }, responses: 0 },
      { t: 100, moduleId: 'b', counts: { lost: 2, unsure: 2, got_it: 4 }, responses: 8 },
    ],
  };

  it('makes thickness the number of answers and stacks lost, unsure, got it', () => {
    const g = trendGeometry(layout.plot, trend)!;
    expect(g.maxResponses).toBe(8);
    const end = g.end!;
    expect(end.x).toBeCloseTo(layout.plot.x1);
    const th = end.y3 - end.y0;
    expect(end.y1 - end.y0).toBeCloseTo(th * (2 / 8));
    expect(end.y2 - end.y1).toBeCloseTo(th * (2 / 8));
    const halfway = g.segments[0].points[1];
    expect(halfway.y3 - halfway.y0).toBeCloseTo(th / 2);
    expect(g.segments[1].points[0].y3 - g.segments[1].points[0].y0).toBe(0);
  });

  it('gathers the current lights at the leading edge of their layer', () => {
    const g = trendGeometry(layout.plot, trend)!;
    const lights = trendLights(layout, g, { lost: 2, unsure: 2, got_it: 4, none: 1 }, 'b');
    expect(lights).toHaveLength(8);
    for (const l of lights.filter((x) => x.lane === 'lost')) {
      expect(l.y).toBeGreaterThan(g.end!.y0);
      expect(l.y).toBeLessThan(g.end!.y1);
    }
  });

  it('has nothing to draw without a trend', () => {
    expect(trendGeometry(layout.plot, null)).toBeNull();
  });
});

describe('rhythm', () => {
  it('is flat with nobody active and quickens as more of the room is lost', () => {
    expect(rhythmFor(counts, 0, 'none').mode).toBe('flat');
    const calm = rhythmFor({ lost: 0, unsure: 0, got_it: 10, none: 0 }, 10, 'calm');
    const some = rhythmFor(counts, 10, 'calm');
    const alert = rhythmFor({ ...counts, lost: 3, none: 2 }, 10, 'alert');
    expect(calm.bpm).toBe(58);
    expect(some.bpm).toBeGreaterThan(calm.bpm);
    expect(alert.bpm).toBeGreaterThan(some.bpm);
    expect(alert.mode).toBe('alert');
    expect(some.irregularity).toBeGreaterThan(calm.irregularity);
    expect(rhythmFor(counts, 2, 'waiting').mode).toBe('waiting');
  });

  it('draws a beat with its R wave as the peak', () => {
    const samples = Array.from({ length: 200 }, (_, i) => ecgAt(i / 250, 1, 0));
    const peak = samples.indexOf(Math.max(...samples));
    expect(peak / 250).toBeCloseTo(0.23, 1);
    expect(Math.max(...samples)).toBeCloseTo(1, 1);
  });
});
