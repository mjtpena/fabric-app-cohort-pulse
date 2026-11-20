import { PermissionError, RuleError } from '@x10/shared/data';
import { FIXED_NOW, testStore } from '@x10/shared/test';

import { personas } from '../app.config';
import { CODE_ALPHABET } from '../config';
import { defs } from '../model';
import { EXTRA_PARTICIPANTS, SEED_CODES, seed } from '../seed';
import {
  addModule,
  checkIn,
  closeSession,
  createSession,
  findByCode,
  listHostedSessions,
  listJoinedSessions,
  loadHostConsole,
  loadParticipantView,
  loadReport,
  moveToModule,
  recordJoin,
  validateNewSession,
} from './sessions';

const later = (min: number) => new Date(FIXED_NOW.getTime() + min * 60_000);
const [host, sam, priya, jamie] = personas.map((p) => ({ sub: p.sub, displayName: p.name }));
const extra = (i: number) => ({ sub: EXTRA_PARTICIPANTS[i].sub, displayName: EXTRA_PARTICIPANTS[i].name });

async function setup() {
  const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
  const live = (await findByCode(store, SEED_CODES.live))!;
  const closed = (await findByCode(store, SEED_CODES.closed))!;
  return { store, live, closed };
}

async function ready(store: Awaited<ReturnType<typeof setup>>['store'], me: { sub: string; displayName: string }, code: string, now = FIXED_NOW) {
  const v = await loadParticipantView(store, me, code, { join: true, now });
  if (v.kind !== 'ready') throw new Error(`expected ready, got ${v.kind}`);
  return v;
}

describe('seed', () => {
  it('has a live session with a current module and 18 check-ins (10 on the recap), and a closed session with 14 participants', async () => {
    const { store, live, closed } = await setup();
    expect(live.status).toBe('open');
    expect(live.currentModuleId).not.toBeNull();
    expect(await store.repo('CheckIn').list({ where: { sessionId: live.id } })).toHaveLength(18);
    expect(await store.repo('CheckIn').list({ where: { sessionId: live.id, moduleId: live.currentModuleId! } })).toHaveLength(8);
    const r = await loadReport(store, host, closed.id);
    expect(r.report!.participants).toBe(14);
    expect(r.report!.modules.map((m) => m.name)).toEqual(['Agent anatomy', 'Tools and actions', 'Memory', 'Guardrails', 'Evaluation']);
  });

  it('lists the facilitator sessions, open first', async () => {
    const { store } = await setup();
    const list = await listHostedSessions(store, host);
    expect(list.map((s) => s.code)).toEqual([SEED_CODES.live, SEED_CODES.closed]);
    expect(await listHostedSessions(store, sam)).toEqual([]);
  });
});

describe('host console (acceptance 1 and 2)', () => {
  it('gauge percentages equal the hand calculation for the seed', async () => {
    const { store, live } = await setup();
    const v = await loadHostConsole(store, host, live.id, FIXED_NOW);
    // 10 active: lost 2, unsure 2, got it 3, no answer yet 3 (Sam and two other late joiners).
    expect(v.current?.name).toBe('Planning and reasoning');
    expect(v.gauge.active).toBe(10);
    expect(v.gauge.counts).toEqual({ lost: 2, unsure: 2, got_it: 3, none: 3 });
    expect(v.gauge.shares).toEqual({ lost: 20, unsure: 20, got_it: 30, none: 30 });
    expect(v.alert.kind).toBe('calm');
    expect(v.notes).toEqual(['Is chain-of-thought the same as planning?', 'Could you show the planning loop diagram again?']);
  });

  it('fires the alert when a third of ten taps Lost', async () => {
    const { store, live } = await setup();
    const view = await ready(store, sam, SEED_CODES.live);
    await checkIn(store, sam, { sessionId: live.id, moduleId: view.module!.id, level: 'lost' }, later(0.1));
    const v = await loadHostConsole(store, host, live.id, later(0.2));
    expect(v.gauge.active).toBe(10);
    expect(v.alert).toMatchObject({ kind: 'alert', message: 'Consider pausing: 3 of 10 are lost' });
  });

  it('a late joiner counts from joining, as "no answer yet"', async () => {
    const { store, live } = await setup();
    await ready(store, jamie, SEED_CODES.live);
    const v = await loadHostConsole(store, host, live.id, FIXED_NOW);
    expect(v.gauge.active).toBe(11);
    expect(v.gauge.counts.none).toBe(4);
  });

  it('participants drop out of the active window after 10 minutes', async () => {
    const { store, live } = await setup();
    const v = await loadHostConsole(store, host, live.id, later(15));
    expect(v.gauge.active).toBe(0);
    expect(v.alert.kind).toBe('waiting');
  });

  it('never carries a participant sub or name in the console view', async () => {
    const { store, live } = await setup();
    await checkIn(store, priya, { sessionId: live.id, moduleId: live.currentModuleId!, level: 'lost', note: 'Slow down please' }, later(0.1));
    const json = JSON.stringify(await loadHostConsole(store, host, live.id, later(0.2)));
    for (const p of [...personas.slice(1), ...EXTRA_PARTICIPANTS]) {
      expect(json).not.toContain(p.sub);
      expect(json).not.toContain(p.name);
    }
    expect(json).toContain('Slow down please');
  });

  it('is for the host only', async () => {
    const { store, live } = await setup();
    await expect(loadHostConsole(store, sam, live.id)).rejects.toBeInstanceOf(PermissionError);
    await expect(moveToModule(store, sam, live.id, live.currentModuleId!)).rejects.toBeInstanceOf(PermissionError);
    await expect(closeSession(store, sam, live.id)).rejects.toBeInstanceOf(PermissionError);
    await expect(addModule(store, sam, live.id, 'Sneaky module')).rejects.toBeInstanceOf(PermissionError);
    await expect(loadReport(store, sam, live.id)).rejects.toBeInstanceOf(PermissionError);
  });

  it('ignores modules a non-host inserted into the session', async () => {
    const { store, live } = await setup();
    await store.repo('PulseModule').create({ sessionId: live.id, hostSub: sam.sub, name: 'Injected', sortOrder: 0, startedAt: null, endedAt: null });
    const v = await loadHostConsole(store, host, live.id, FIXED_NOW);
    expect(v.modules.map((m) => m.name)).not.toContain('Injected');
  });
});

describe('participant flow', () => {
  it('shows my own latest answer for the current module', async () => {
    const { store } = await setup();
    const v = await ready(store, priya, SEED_CODES.live);
    expect(v.module?.name).toBe('Planning and reasoning');
    expect(v.mine?.level).toBe('unsure');
    expect((await ready(store, sam, SEED_CODES.live)).mine).toBeNull();
  });

  it('latest wins when I change my mind', async () => {
    const { store, live } = await setup();
    await checkIn(store, priya, { sessionId: live.id, moduleId: live.currentModuleId!, level: 'got_it' }, later(0.5));
    expect((await ready(store, priya, SEED_CODES.live, later(1))).mine?.level).toBe('got_it');
    const v = await loadHostConsole(store, host, live.id, later(1));
    expect(v.gauge.counts).toMatchObject({ unsure: 1, got_it: 4 });
  });

  it('moving to the next module resets what participants see', async () => {
    const { store, live } = await setup();
    const before = await loadHostConsole(store, host, live.id, FIXED_NOW);
    await moveToModule(store, host, live.id, before.next!.id, later(1));
    const v = await ready(store, priya, SEED_CODES.live, later(1.5));
    expect(v.module?.name).toBe('Multi-agent patterns');
    expect(v.mine).toBeNull();
    const modules = await store.repo('PulseModule').list({ where: { sessionId: live.id } });
    const old = modules.find((m) => m.id === before.current!.id)!;
    const next = modules.find((m) => m.id === before.next!.id)!;
    expect(old.endedAt).toBe(later(1).toISOString());
    expect(next.startedAt).toBe(later(1).toISOString());
    const after = await loadHostConsole(store, host, live.id, later(1.5));
    expect(after.gauge.counts.none).toBe(after.gauge.active);
    expect(after.notes).toEqual([]);
  });

  it('going back to an earlier module starts it fresh: old answers do not return', async () => {
    const { store, live } = await setup();
    const before = await loadHostConsole(store, host, live.id, FIXED_NOW);
    await moveToModule(store, host, live.id, before.next!.id, later(1));
    await moveToModule(store, host, live.id, before.current!.id, later(2));
    const back = await loadHostConsole(store, host, live.id, later(2.5));
    expect(back.current?.name).toBe('Planning and reasoning');
    expect(back.gauge.counts).toEqual({ lost: 0, unsure: 0, got_it: 0, none: back.gauge.active });
    expect(back.notes).toEqual([]);
    expect((await ready(store, priya, SEED_CODES.live, later(2.5))).mine).toBeNull();
    await checkIn(store, priya, { sessionId: live.id, moduleId: before.current!.id, level: 'lost' }, later(3));
    const after = await loadHostConsole(store, host, live.id, later(3.5));
    expect(after.gauge.counts.lost).toBe(1);
    expect((await ready(store, priya, SEED_CODES.live, later(3.5))).mine?.level).toBe('lost');
  });

  it('a participant with a slow clock still counts in a module that just started', async () => {
    const { store, live } = await setup();
    const before = await loadHostConsole(store, host, live.id, FIXED_NOW);
    await moveToModule(store, host, live.id, before.next!.id, later(1));
    // Priya's device is 2.5 minutes behind the facilitator's.
    const row = await checkIn(store, priya, { sessionId: live.id, moduleId: before.next!.id, level: 'unsure' }, later(-1.5));
    expect(row.createdAt).toBe(later(1).toISOString());
    const v = await loadHostConsole(store, host, live.id, later(1.5));
    expect(v.gauge.counts.unsure).toBe(1);
  });

  it('refuses an answer filed under a module the facilitator already left', async () => {
    const { store, live } = await setup();
    const v = await ready(store, sam, SEED_CODES.live);
    const nav = await loadHostConsole(store, host, live.id);
    await moveToModule(store, host, live.id, nav.next!.id, later(1));
    await expect(checkIn(store, sam, { sessionId: live.id, moduleId: v.module!.id, level: 'lost' }, later(2))).rejects.toThrow(
      /moved on to "Multi-agent patterns"/,
    );
  });

  it('validates the level and the note length', async () => {
    const { store, live } = await setup();
    const input = { sessionId: live.id, moduleId: live.currentModuleId! };
    await expect(checkIn(store, sam, { ...input, level: 'meh' as never })).rejects.toBeInstanceOf(RuleError);
    await expect(checkIn(store, sam, { ...input, level: 'lost', note: 'x'.repeat(141) })).rejects.toThrow(/140 characters/);
    const row = await checkIn(store, sam, { ...input, level: 'lost', note: '  ' });
    expect(row.note).toBeNull();
  });

  it('handles unknown, invalid, closed and own codes', async () => {
    const { store } = await setup();
    expect((await loadParticipantView(store, sam, 'ZZZZZZ')).kind).toBe('unknown');
    expect((await loadParticipantView(store, sam, 'abc')).kind).toBe('invalid');
    expect((await loadParticipantView(store, sam, SEED_CODES.closed)).kind).toBe('closed');
    expect((await loadParticipantView(store, host, SEED_CODES.live)).kind).toBe('host');
  });

  it('the host cannot check in to their own session', async () => {
    const { store, live } = await setup();
    await expect(checkIn(store, host, { sessionId: live.id, moduleId: live.currentModuleId!, level: 'lost' })).rejects.toThrow(/Facilitators/);
  });

  it('records a join once per minute and lists sessions I joined', async () => {
    const { store, live } = await setup();
    expect(await recordJoin(store, jamie, live, FIXED_NOW)).toBe(true);
    expect(await recordJoin(store, jamie, live, later(0.5))).toBe(false);
    expect(await recordJoin(store, jamie, live, later(2))).toBe(true);
    expect((await listJoinedSessions(store, jamie)).map((s) => s.code)).toEqual([SEED_CODES.live]);
    expect(await listJoinedSessions(store, host)).toEqual([]);
  });
});

describe('closing and the report (acceptance 4)', () => {
  it('ranks the seeded confusing module (Memory) first', async () => {
    const { store, closed } = await setup();
    const { report } = await loadReport(store, host, closed.id);
    const ranking = report!.ranking.map((r) => [r.name, Math.round(r.confusionIndex! * 100)]);
    expect(ranking).toEqual([
      ['Memory', 50],
      ['Guardrails', 21],
      ['Evaluation', 15],
      ['Tools and actions', 14],
      ['Agent anatomy', 7],
    ]);
    const memory = report!.modules[2];
    expect(memory.counts).toEqual({ lost: 7, unsure: 4, got_it: 3 });
    expect(memory.shares).toEqual({ lost: 50, unsure: 29, got_it: 21 });
    expect(memory.notes).toHaveLength(3);
  });

  it('closing mid-module takes final states at close and refuses later check-ins', async () => {
    const { store, live } = await setup();
    await closeSession(store, host, live.id, later(1));
    const { session, report } = await loadReport(store, host, live.id);
    expect(session.status).toBe('closed');
    expect(session.closedAt).toBe(later(1).toISOString());
    const current = report!.modules.find((m) => m.name === 'Planning and reasoning')!;
    expect(current.endAt).toBe(later(1).toISOString());
    expect(current.counts).toEqual({ lost: 2, unsure: 2, got_it: 3 });
    expect(report!.modules.find((m) => m.name === 'Multi-agent patterns')!.ran).toBe(false);
    await expect(checkIn(store, sam, { sessionId: live.id, moduleId: live.currentModuleId!, level: 'lost' })).rejects.toThrow(/ended/);
    expect((await loadParticipantView(store, sam, SEED_CODES.live)).kind).toBe('closed');
  });

  it('has no report while the session is open', async () => {
    const { store, live } = await setup();
    expect((await loadReport(store, host, live.id)).report).toBeNull();
  });
});

describe('retrying after a failed write', () => {
  /** A store whose next update to `entity` fails once, like a dropped connection. */
  function failNextUpdate(store: Awaited<ReturnType<typeof setup>>['store'], entity: 'PulseSession' | 'PulseModule') {
    let armed = true;
    return {
      kind: store.kind,
      repo(name: string) {
        const r = store.repo(name as never) as unknown as { update: (id: string, patch: unknown) => Promise<unknown> };
        if (name !== entity) return r;
        return {
          ...r,
          update: async (id: string, patch: unknown) => {
            if (armed) {
              armed = false;
              throw new Error('Network down');
            }
            return r.update(id, patch);
          },
        };
      },
    } as unknown as typeof store;
  }

  it('moving to the next module can simply be retried', async () => {
    const { store, live } = await setup();
    const before = await loadHostConsole(store, host, live.id, FIXED_NOW);
    const flaky = failNextUpdate(store, 'PulseSession');
    await expect(moveToModule(flaky, host, live.id, before.next!.id, later(1))).rejects.toThrow('Network down');
    // Half done: the old module ended but is still current.
    expect((await loadHostConsole(store, host, live.id, later(1))).current?.name).toBe('Planning and reasoning');
    await moveToModule(store, host, live.id, before.next!.id, later(2));
    const v = await loadHostConsole(store, host, live.id, later(2));
    expect(v.current?.name).toBe('Multi-agent patterns');
    expect(v.modules.find((m) => m.id === before.current!.id)!.endedAt).toBe(later(1).toISOString());
    expect(v.current?.startedAt).toBe(later(2).toISOString());
    // Pressing it again once done changes nothing.
    await moveToModule(store, host, live.id, before.next!.id, later(3));
    expect((await loadHostConsole(store, host, live.id, later(3))).current?.startedAt).toBe(later(2).toISOString());
  });

  it('closing can simply be retried, keeping the first end time', async () => {
    const { store, live } = await setup();
    await expect(closeSession(failNextUpdate(store, 'PulseSession'), host, live.id, later(1))).rejects.toThrow('Network down');
    await closeSession(store, host, live.id, later(2));
    await closeSession(store, host, live.id, later(3));
    const { session, report } = await loadReport(store, host, live.id);
    expect(session.closedAt).toBe(later(2).toISOString());
    expect(report!.modules.find((m) => m.name === 'Planning and reasoning')!.endAt).toBe(later(1).toISOString());
  });
});

describe('creating a session', () => {
  it('validates the form', () => {
    expect(validateNewSession({ title: 'ab', modulesText: '' })).toEqual({
      title: expect.stringMatching(/at least 3/),
      modules: expect.stringMatching(/at least one module/),
    });
    expect(validateNewSession({ title: 'Fine title', modulesText: 'One\nTwo' })).toEqual({});
  });

  it('creates the session with modules and a code that is not already taken', async () => {
    const { store } = await setup();
    // The first draw spells the seeded code AGENT5, which is taken, so a second code is drawn.
    const draws = [...SEED_CODES.closed, ...'NEWXYZ'].map((c) => (CODE_ALPHABET.indexOf(c) + 0.5) / CODE_ALPHABET.length);
    let i = 0;
    const s = await createSession(
      store,
      extra(0),
      { title: '  Data modelling clinic ', modulesText: 'Star schemas\nSlowly changing dimensions' },
      FIXED_NOW,
      () => draws[i++],
    );
    expect(s.code).toBe('NEWXYZ');
    expect(s.title).toBe('Data modelling clinic');
    expect(s.hostSub).toBe(extra(0).sub);
    const v = await loadHostConsole(store, extra(0), s.id);
    expect(v.modules.map((m) => [m.name, m.sortOrder])).toEqual([
      ['Star schemas', 1],
      ['Slowly changing dimensions', 2],
    ]);
    expect(v.current).toBeNull();
    expect(v.next?.name).toBe('Star schemas');
    await addModule(store, extra(0), s.id, 'Q and A');
    await expect(addModule(store, extra(0), s.id, 'star schemas')).rejects.toThrow(/appears twice/);
    expect((await loadHostConsole(store, extra(0), s.id)).modules.at(-1)).toMatchObject({ name: 'Q and A', sortOrder: 3 });
  });
});

describe("the room's heartbeat (stage aggregates)", () => {
  it('gives totals per module: the recap at its end, the current module from the gauge, the rest not run', async () => {
    const { store, live } = await setup();
    const v = await loadHostConsole(store, host, live.id, FIXED_NOW);
    expect(v.byModule.map((m) => [m.name, m.state])).toEqual([
      ['Day 1 recap', 'done'],
      ['Planning and reasoning', 'current'],
      ['Multi-agent patterns', 'upcoming'],
      ['Wrap-up and questions', 'upcoming'],
    ]);
    expect(v.byModule[0].counts).toEqual({ lost: 0, unsure: 1, got_it: 6, none: 0 });
    expect(v.byModule[1].counts).toEqual(v.gauge.counts);
    expect(v.byModule[1].responses).toBe(7);
    expect(v.byModule[1].confusionIndex).toBeCloseTo(2 / 7);
    expect(v.byModule[2].responses).toBe(0);
  });

  it('samples the session over time, per module, with totals only', async () => {
    const { store, live } = await setup();
    const { trend } = await loadHostConsole(store, host, live.id, FIXED_NOW);
    expect(trend).not.toBeNull();
    expect(trend!.segments.map((s) => s.name)).toEqual(['Day 1 recap', 'Planning and reasoning']);
    expect(trend!.end).toBe(FIXED_NOW.getTime());
    const last = trend!.samples[trend!.samples.length - 1];
    expect(last.counts).toEqual({ lost: 2, unsure: 2, got_it: 3 });
    const recapEnd = trend!.samples.filter((s) => s.moduleId === trend!.segments[0].moduleId).pop()!;
    expect(recapEnd.counts).toEqual({ lost: 0, unsure: 1, got_it: 6 });
    // Nothing in a sample can identify a participant.
    expect(JSON.stringify(trend)).not.toMatch(/demo-/);
  });

  it('has no trend before the first module starts, and a trend for a closed report', async () => {
    const { store, closed } = await setup();
    const fresh = await createSession(store, host, { title: 'Fresh cohort', modulesText: 'One\nTwo' }, FIXED_NOW);
    expect((await loadHostConsole(store, host, fresh.id, FIXED_NOW)).trend).toBeNull();
    const r = await loadReport(store, host, closed.id);
    expect(r.trend!.segments).toHaveLength(5);
  });
});
