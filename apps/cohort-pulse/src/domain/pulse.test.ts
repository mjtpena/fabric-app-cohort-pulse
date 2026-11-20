import { FIXED_NOW } from '@x10/shared/test';

import type { CheckIn, Level, PulseJoin, PulseModule, PulseSession } from '../model';
import {
  activeParticipants,
  agoShort,
  checkInTime,
  computeGauge,
  confusionAlert,
  currentStates,
  generateCode,
  moduleEndAt,
  moduleNav,
  moduleNotes,
  moduleReport,
  myLatest,
  normalizeCode,
  parseModuleLines,
  rankByConfusion,
  reportMarkdown,
  roundShares,
  sessionModules,
  sessionReport,
  validateCode,
  validateNote,
  validateTitle,
} from './pulse';

const NOW = FIXED_NOW.getTime();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
let n = 0;
const ci = (sub: string, level: Level, minAgo: number, moduleId = 'm1', note: string | null = null): CheckIn => ({
  id: `c${++n}`,
  sessionId: 's1',
  moduleId,
  participantSub: sub,
  level,
  note,
  createdAt: ago(minAgo),
});
const join = (sub: string, minAgo: number): PulseJoin => ({ id: `j${++n}`, sessionId: 's1', participantSub: sub, createdAt: ago(minAgo) });
const mod = (id: string, sortOrder: number, extra: Partial<PulseModule> = {}): PulseModule => ({
  id,
  sessionId: 's1',
  hostSub: 'host',
  name: `Module ${sortOrder}`,
  sortOrder,
  startedAt: null,
  endedAt: null,
  ...extra,
});
const session: PulseSession = {
  id: 's1',
  title: 'Test session',
  code: 'ABC234',
  hostSub: 'host',
  hostName: 'Host',
  status: 'closed',
  currentModuleId: null,
  createdAt: ago(200),
  closedAt: ago(10),
};

/** `n` participants with the given levels; the rest have only joined. */
function room(levels: Level[], total: number) {
  const checkIns = levels.map((l, i) => ci(`p${i}`, l, 1));
  const joins = Array.from({ length: total }, (_, i) => join(`p${i}`, 2));
  return { checkIns, joins };
}

describe('current state per participant', () => {
  it('latest check-in wins when a participant changes their mind', () => {
    const rows = [ci('a', 'unsure', 5), ci('a', 'got_it', 2), ci('b', 'lost', 3)];
    const s = currentStates(rows, 'm1', NOW);
    expect(s.get('a')?.level).toBe('got_it');
    expect(s.get('b')?.level).toBe('lost');
    expect(s.size).toBe(2);
  });

  it('is per module, so a new module starts with no state', () => {
    const rows = [ci('a', 'lost', 5, 'm1')];
    expect(currentStates(rows, 'm2', NOW).size).toBe(0);
  });

  it('can be taken as at a moment (rows after it are ignored)', () => {
    const rows = [ci('a', 'unsure', 20), ci('a', 'lost', 5)];
    expect(currentStates(rows, 'm1', ago(10)).get('a')?.level).toBe('unsure');
  });

  it("counts only rows since the module's latest start (a reopened module starts fresh)", () => {
    const rows = [ci('a', 'lost', 30), ci('b', 'unsure', 30), ci('b', 'got_it', 2)];
    const s = currentStates(rows, 'm1', NOW, ago(5));
    expect([...s.keys()]).toEqual(['b']);
    expect(s.get('b')?.level).toBe('got_it');
    expect(myLatest(rows, 'm1', 'a', FIXED_NOW, ago(5))).toBeNull();
    const g = computeGauge(rows, [join('a', 1)], { id: 'm1', startedAt: ago(5) }, NOW);
    expect(g.counts).toEqual({ lost: 0, unsure: 0, got_it: 1, none: 1 });
    const notes = [ci('a', 'lost', 30, 'm1', 'old run'), ci('b', 'lost', 1, 'm1', 'new run')];
    expect(moduleNotes(notes, 'm1', NOW, ago(5))).toEqual(['new run']);
  });

  it('stamps a check-in no earlier than the module start and after my previous tap', () => {
    expect(checkInTime(ago(1), ago(5), null)).toBe(ago(1));
    expect(checkInTime(ago(8), ago(5), null)).toBe(ago(5)); // slow clock
    expect(checkInTime(ago(8), ago(5), ago(3))).toBe(new Date(NOW - 3 * 60_000 + 1).toISOString());
    expect(checkInTime(ago(1), null, null)).toBe(ago(1));
  });

  it('finds my own latest answer', () => {
    const rows = [ci('me', 'unsure', 5), ci('me', 'got_it', 1), ci('other', 'lost', 0)];
    expect(myLatest(rows, 'm1', 'me', FIXED_NOW)?.level).toBe('got_it');
    expect(myLatest(rows, 'm2', 'me', FIXED_NOW)).toBeNull();
  });
});

describe('active participants', () => {
  it('counts check-ins and joins in the last 10 minutes, inclusive of the boundary', () => {
    const active = activeParticipants([ci('a', 'lost', 10), ci('b', 'lost', 10.02)], [join('c', 9), join('d', 11)], NOW);
    expect([...active].sort()).toEqual(['a', 'c']);
  });

  it('counts a check-in on any module of the session', () => {
    expect(activeParticipants([ci('a', 'got_it', 3, 'other-module')], [], NOW).has('a')).toBe(true);
  });

  it('excludes the host and ignores rows dated more than 5 minutes in the future', () => {
    const rows = [ci('host', 'lost', 1), ci('future', 'lost', -5.1)];
    expect(activeParticipants(rows, [], NOW, { excludeSub: 'host' }).size).toBe(0);
  });

  it('still counts a participant whose clock runs up to 5 minutes fast', () => {
    expect(activeParticipants([ci('fast', 'lost', -4.5)], [], NOW).has('fast')).toBe(true);
    const g = computeGauge([ci('fast', 'lost', -4.5)], [], 'm1', NOW);
    expect(g.counts.lost).toBe(1);
  });

  it('uses the configured window', () => {
    expect(activeParticipants([ci('a', 'lost', 4)], [], NOW, { windowMinutes: 3 }).size).toBe(0);
  });
});

describe('gauge shares', () => {
  it('rounds to whole percentages that add up to 100', () => {
    expect(roundShares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(roundShares([2, 2, 3, 3])).toEqual([20, 20, 30, 30]);
    expect(roundShares([1, 2, 5])).toEqual([13, 25, 62]);
    expect(roundShares([0, 0, 0])).toEqual([0, 0, 0]);
    expect(roundShares([1, 6]).reduce((a, b) => a + b)).toBe(100);
  });

  it('counts active participants without an answer as "no answer yet"', () => {
    const { checkIns, joins } = room(['lost', 'lost', 'unsure', 'unsure', 'got_it', 'got_it', 'got_it'], 10);
    const g = computeGauge(checkIns, joins, 'm1', NOW);
    expect(g.active).toBe(10);
    expect(g.counts).toEqual({ lost: 2, unsure: 2, got_it: 3, none: 3 });
    expect(g.shares).toEqual({ lost: 20, unsure: 20, got_it: 30, none: 30 });
  });

  it('a late joiner counts from joining, and an inactive participant drops out', () => {
    const checkIns = [ci('a', 'lost', 1), ci('old', 'lost', 30)];
    const g = computeGauge(checkIns, [join('late', 0.5)], 'm1', NOW);
    expect(g.active).toBe(2);
    expect(g.counts).toEqual({ lost: 1, unsure: 0, got_it: 0, none: 1 });
  });

  it('with no current module everyone active is "no answer yet"', () => {
    const g = computeGauge([ci('a', 'lost', 1)], [], null, NOW);
    expect(g.counts.none).toBe(1);
    expect(g.shares.none).toBe(100);
  });

  it('excludes the host from the gauge', () => {
    const g = computeGauge([ci('host', 'lost', 1), ci('a', 'got_it', 1)], [], 'm1', NOW, 'host');
    expect(g.active).toBe(1);
    expect(g.counts.lost).toBe(0);
  });
});

describe('confusion alert', () => {
  it('fires at 3 of 10 lost', () => {
    const { checkIns, joins } = room(['lost', 'lost', 'lost'], 10);
    const a = confusionAlert(computeGauge(checkIns, joins, 'm1', NOW));
    expect(a.kind).toBe('alert');
    expect(a.message).toBe('Consider pausing: 3 of 10 are lost');
  });

  it('does not fire at 2 of 10 lost', () => {
    const { checkIns, joins } = room(['lost', 'lost', 'got_it'], 10);
    expect(confusionAlert(computeGauge(checkIns, joins, 'm1', NOW)).kind).toBe('calm');
  });

  it('matches the spec example: 4 of 12', () => {
    expect(confusionAlert({ active: 12, counts: { lost: 4 } }).message).toBe('Consider pausing: 4 of 12 are lost');
  });

  it('waits for more check-ins below 3 active participants, even if all are lost', () => {
    const a = confusionAlert({ active: 2, counts: { lost: 2 } });
    expect(a.kind).toBe('waiting');
    expect(a.message).toMatch(/^Waiting for more check-ins/);
    expect(confusionAlert({ active: 3, counts: { lost: 1 } }).kind).toBe('alert');
    expect(confusionAlert({ active: 3, counts: { lost: 0 } }).kind).toBe('calm');
  });

  it('honours custom thresholds', () => {
    expect(confusionAlert({ active: 10, counts: { lost: 3 } }, { lostPercent: 40 }).kind).toBe('calm');
    expect(confusionAlert({ active: 4, counts: { lost: 4 } }, { minActive: 5 }).kind).toBe('waiting');
  });
});

describe('modules and notes', () => {
  it('keeps only modules of the session host, in agenda order', () => {
    const list = [mod('b', 2), mod('a', 1), mod('x', 0, { hostSub: 'intruder' }), mod('y', 3, { sessionId: 'other' })];
    expect(sessionModules(session, list).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('navigates previous and next', () => {
    const list = [mod('a', 1), mod('b', 2), mod('c', 3)];
    expect(moduleNav(list, null)).toMatchObject({ index: -1, current: null, prev: null, next: { id: 'a' } });
    expect(moduleNav(list, 'b')).toMatchObject({ prev: { id: 'a' }, next: { id: 'c' } });
    expect(moduleNav(list, 'c').next).toBeNull();
  });

  it('lists notes newest first, without attribution', () => {
    const rows = [ci('a', 'lost', 5, 'm1', 'first'), ci('b', 'unsure', 1, 'm1', 'second'), ci('c', 'lost', 1, 'm2', 'other')];
    expect(moduleNotes(rows, 'm1', NOW)).toEqual(['second', 'first']);
  });

  it('takes a module end from endedAt, or from the close when the host closed mid-module', () => {
    expect(moduleEndAt(mod('a', 1, { startedAt: ago(30), endedAt: ago(20) }), session)).toBe(ago(20));
    expect(moduleEndAt(mod('a', 1, { startedAt: ago(30) }), session)).toBe(session.closedAt);
    expect(moduleEndAt(mod('a', 1), session)).toBeNull();
  });
});

describe('module report', () => {
  it('uses final states at the module end and ignores later rows', () => {
    const m = mod('m1', 1, { startedAt: ago(60), endedAt: ago(30) });
    const rows = [ci('a', 'unsure', 50), ci('a', 'lost', 40), ci('b', 'got_it', 45), ci('c', 'lost', 35), ci('c', 'got_it', 10)];
    const r = moduleReport(m, rows, m.endedAt);
    expect(r.responses).toBe(3);
    expect(r.counts).toEqual({ lost: 2, unsure: 0, got_it: 1 });
    expect(r.shares).toEqual({ lost: 67, unsure: 0, got_it: 33 });
    expect(r.confusionIndex).toBeCloseTo(2 / 3);
  });

  it('counts fast-clock rows just after the end and ignores rows from before the latest start', () => {
    const m = mod('m1', 1, { startedAt: ago(60), endedAt: ago(30) });
    const rows = [ci('a', 'lost', 90), ci('b', 'unsure', 28), ci('c', 'got_it', 20)];
    expect(moduleReport(m, rows, m.endedAt).counts).toEqual({ lost: 0, unsure: 1, got_it: 0 });
  });

  it('marks modules that never ran', () => {
    const r = moduleReport(mod('m9', 9), [], null);
    expect(r.ran).toBe(false);
    expect(r.confusionIndex).toBeNull();
  });

  it('ranks by confusion index, then unsure share, then agenda order', () => {
    const base = { ran: true, endAt: ago(1), notes: [], shares: { lost: 0, unsure: 0, got_it: 0 } };
    const r = (id: string, sortOrder: number, lost: number, unsure: number, got: number) => ({
      ...base,
      moduleId: id,
      name: id,
      sortOrder,
      responses: lost + unsure + got,
      counts: { lost, unsure, got_it: got },
      confusionIndex: lost / (lost + unsure + got),
    });
    const ranked = rankByConfusion([r('a', 1, 1, 0, 9), r('b', 2, 5, 0, 5), r('c', 3, 1, 5, 4), r('d', 4, 0, 0, 0)].map((x) =>
      x.responses ? x : { ...x, confusionIndex: null },
    ));
    expect(ranked.map((x) => x.moduleId)).toEqual(['b', 'c', 'a']);
  });

  it('builds a session report and Markdown without participant data', () => {
    const m1 = mod('m1', 1, { name: 'Intro', startedAt: ago(100), endedAt: ago(60) });
    const m2 = mod('m2', 2, { name: 'Hard part', startedAt: ago(60) });
    const m3 = mod('m3', 3, { name: 'Skipped' });
    const rows = [
      ci('alice-sub', 'got_it', 80, 'm1'),
      ci('bob-sub', 'got_it', 80, 'm1'),
      ci('alice-sub', 'lost', 30, 'm2', 'What | why?'),
      ci('bob-sub', 'unsure', 30, 'm2'),
    ];
    const report = sessionReport(session, [m1, m2, m3], rows, [join('carol-sub', 100)]);
    expect(report.participants).toBe(3);
    expect(report.ranking.map((r) => r.name)).toEqual(['Hard part', 'Intro']);
    const md = reportMarkdown(session, report, '20 Nov 2026');
    expect(md).toContain('| 1 | Hard part | 50% | 50% | 50% | 0% | 2 |');
    expect(md).toContain('Not run: Skipped.');
    expect(md).toContain('- What | why?');
    expect(md).not.toMatch(/alice|bob|carol/);
  });
});

describe('validation and codes', () => {
  it('normalises and validates join codes', () => {
    expect(normalizeCode(' pul-se7 ')).toBe('PULSE7');
    expect(validateCode('pulse7')).toBeNull();
    expect(validateCode('')).toMatch(/Enter the 6-character code/);
    expect(validateCode('ABC')).toMatch(/6 letters and digits/);
    expect(validateCode('ABC!23')).toMatch(/6 letters and digits/);
  });

  it('generates 6-character codes without look-alike characters', () => {
    let i = 0;
    const seq = [0, 0.99, 0.5, 0.25, 0.75, 0.1];
    const code = generateCode(() => seq[i++ % seq.length]);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(code).not.toMatch(/[01OIL]/);
    expect(validateCode(code)).toBeNull();
  });

  it('validates titles and notes with the entity limits', () => {
    expect(validateTitle('ab')).toMatch(/at least 3/);
    expect(validateTitle('x'.repeat(101))).toMatch(/100 characters/);
    expect(validateTitle('Day 2')).toBeNull();
    expect(validateNote('')).toBeNull();
    expect(validateNote('x'.repeat(141))).toMatch(/140 characters/);
  });

  it('parses one module per line', () => {
    expect(parseModuleLines('  Intro \n\n Deep  dive\n')).toEqual({ names: ['Intro', 'Deep dive'], error: null });
    expect(parseModuleLines('').error).toMatch(/at least one module/);
    expect(parseModuleLines('ok module\nab').error).toMatch(/Line 2: Module name needs at least 3/);
    expect(parseModuleLines('Intro\nintro').error).toMatch(/appears twice/);
    expect(parseModuleLines(Array.from({ length: 13 }, (_, i) => `Module ${i}`).join('\n')).error).toMatch(/at most 12/);
    expect(parseModuleLines('Intro', ['INTRO']).error).toMatch(/appears twice/);
  });
});

describe('agoShort', () => {
  it('formats the "you said" age', () => {
    expect(agoShort(ago(0.5), NOW)).toBe('just now');
    expect(agoShort(ago(-0.5), NOW)).toBe('just now');
    expect(agoShort(ago(2.4), NOW)).toBe('2 min ago');
    expect(agoShort(ago(125), NOW)).toBe('2 h ago');
  });
});
