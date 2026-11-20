import type { DataStore } from '@x10/shared/data';
import type { Person } from '@x10/shared/identity';
import { addMinutes, DAY } from '@x10/shared/lib';
import type { SeedContext } from '@x10/shared/runtime';

import type { Level, PulseModule, Schema } from './model';

/** Fictional participants besides the personas. They get Person rows (as real sign-ins would) that the UI never shows. */
export const EXTRA_PARTICIPANTS: { sub: string; name: string }[] = [
  { sub: 'demo-p01', name: 'Morgan Ellis' },
  { sub: 'demo-p02', name: 'Riley Brooks' },
  { sub: 'demo-p03', name: 'Casey Nguyen' },
  { sub: 'demo-p04', name: 'Jordan Park' },
  { sub: 'demo-p05', name: 'Taylor Reed' },
  { sub: 'demo-p06', name: 'Avery Collins' },
  { sub: 'demo-p07', name: 'Quinn Foster' },
  { sub: 'demo-p08', name: 'Drew Patel' },
  { sub: 'demo-p09', name: 'Skyler Moss' },
  { sub: 'demo-p10', name: 'Rowan Hayes' },
  { sub: 'demo-p11', name: 'Elliot Grant' },
];

export const SEED_CODES = { live: 'PULSE7', closed: 'AGENT5' } as const;
export const SEED_TITLES = {
  live: 'AI Agents Bootcamp: Day 2 (demo)',
  closed: 'AI Agents Bootcamp: Day 1 (demo)',
} as const;

/**
 * Final states per module of the closed session, in participant order after a per-module rotation.
 * L = lost, U = unsure, G = got it, - = no answer. Memory (the third module) is the confusing one.
 */
export const CLOSED_MODULES: { name: string; states: string }[] = [
  { name: 'Agent anatomy', states: 'LUUUGGGGGGGGGG' }, // 1 of 14 lost
  { name: 'Tools and actions', states: 'LLUUUUGGGGGGGG' }, // 2 of 14
  { name: 'Memory', states: 'LLLLLLLUUUUGGG' }, // 7 of 14
  { name: 'Guardrails', states: 'LLLUUUUUGGGGGG' }, // 3 of 14
  { name: 'Evaluation', states: 'LLUUUGGGGGGGG-' }, // 2 of 13 (one left early)
];

const LEVEL_OF: Record<string, Level> = { L: 'lost', U: 'unsure', G: 'got_it' };

/** Notes left with a check-in, keyed by module; `on` is the level the note was sent with. */
const CLOSED_NOTES: Record<string, { on: string; text: string }[]> = {
  'Agent anatomy': [{ on: 'G', text: 'Clear intro, the diagram helped.' }],
  Memory: [
    { on: 'L', text: 'Lost at the point where the vector store comes in.' },
    { on: 'L', text: 'What is the difference between short-term and long-term memory here?' },
    { on: 'U', text: 'Could we see the memory diagram again?' },
  ],
  Guardrails: [{ on: 'U', text: 'An example of a blocked tool call would help.' }],
  Evaluation: [{ on: 'G', text: 'Good to see real test cases.' }],
};

/** Fictional, generic seed data. Dates are computed from ctx.now. Runs once (runSeed checks a marker row). */
export async function seed(store: DataStore<Schema>, ctx: SeedContext): Promise<void> {
  const [facilitator, sam, priya, jamie] = ctx.people;
  const at = (minutes: number) => addMinutes(ctx.now, minutes);

  // Person rows for the other participants (what their first sign-in would create).
  const extras: Person[] = [];
  for (const p of EXTRA_PARTICIPANTS) {
    extras.push(
      await store.repo('Person').create({
        sub: p.sub,
        displayName: p.name,
        email: `${p.name.split(' ')[0].toLowerCase()}@example.com`,
        isAdmin: false,
        createdAt: new Date(ctx.now.getTime() - 2 * DAY).toISOString(),
      }),
    );
  }
  const sessions = store.repo('PulseSession');
  const modules = store.repo('PulseModule');
  const checkIns = store.repo('CheckIn');
  const joins = store.repo('PulseJoin');

  /* ---------------- closed session: yesterday, 5 modules, 14 participants, Memory is the confusing one */
  const cohort = [sam, priya, jamie, ...extras].map((p) => p.sub); // 14 participants
  const start = -26 * 60; // minutes from now
  const closedAt = at(start + 145); // the facilitator closed mid-way through the last module
  const closed = await sessions.create({
    title: SEED_TITLES.closed,
    code: SEED_CODES.closed,
    hostSub: facilitator.sub,
    hostName: facilitator.displayName,
    status: 'closed',
    currentModuleId: null,
    createdAt: at(start - 15),
    closedAt,
  });
  for (const [i, sub] of cohort.entries()) {
    await joins.create({ sessionId: closed.id, participantSub: sub, createdAt: at(start - 5 + i / 6) });
  }
  let lastModuleId: string | null = null;
  for (const [k, spec] of CLOSED_MODULES.entries()) {
    const mStart = start + k * 30;
    const isLast = k === CLOSED_MODULES.length - 1;
    const mod: PulseModule = await modules.create({
      sessionId: closed.id,
      hostSub: facilitator.sub,
      name: spec.name,
      sortOrder: k + 1,
      startedAt: at(mStart),
      endedAt: isLast ? closedAt : at(mStart + 30),
    });
    lastModuleId = mod.id;
    const notes = [...(CLOSED_NOTES[spec.name] ?? [])];
    for (let i = 0; i < cohort.length; i++) {
      const ch = spec.states[i];
      if (ch === '-') continue;
      const sub = cohort[(i + k * 3) % cohort.length];
      const level = LEVEL_OF[ch];
      // Changing their mind (latest wins): two of the Memory "lost" first said Unsure; one Guardrails "got it" first said Lost.
      const changed = (spec.name === 'Memory' && i < 2) || (spec.name === 'Guardrails' && i === 13);
      if (changed) {
        await checkIns.create({
          sessionId: closed.id,
          moduleId: mod.id,
          participantSub: sub,
          level: spec.name === 'Memory' ? 'unsure' : 'lost',
          note: null,
          createdAt: at(mStart + 3),
        });
      }
      const n = notes.findIndex((x) => x.on === ch);
      const note = n >= 0 ? notes.splice(n, 1)[0].text : null;
      await checkIns.create({
        sessionId: closed.id,
        moduleId: mod.id,
        participantSub: sub,
        level,
        note,
        createdAt: at(mStart + 6 + i),
      });
    }
  }
  // The session ended on its last module.
  await sessions.update(closed.id, { currentModuleId: lastModuleId });

  /* ---------------- live session: current module "Planning and reasoning" (8 check-ins), 10 active participants */
  const live = await sessions.create({
    title: SEED_TITLES.live,
    code: SEED_CODES.live,
    hostSub: facilitator.sub,
    hostName: facilitator.displayName,
    status: 'open',
    currentModuleId: null,
    createdAt: at(-45),
    closedAt: null,
  });
  const plan: { name: string; startedAt: string | null; endedAt: string | null }[] = [
    { name: 'Day 1 recap', startedAt: at(-38), endedAt: at(-9) },
    { name: 'Planning and reasoning', startedAt: at(-9), endedAt: null },
    { name: 'Multi-agent patterns', startedAt: null, endedAt: null },
    { name: 'Wrap-up and questions', startedAt: null, endedAt: null },
  ];
  const liveModules: PulseModule[] = [];
  for (const [i, m] of plan.entries()) {
    liveModules.push(await modules.create({ sessionId: live.id, hostSub: facilitator.sub, sortOrder: i + 1, ...m }));
  }
  const current = liveModules[1];
  await sessions.update(live.id, { currentModuleId: current.id });

  const [p01, p02, p03, p04, p05, p06, p07, p08] = extras.map((p) => p.sub);
  // Everyone who has checked in joined at the start of the day.
  for (const [i, sub] of [priya.sub, p01, p02, p03, p04, p05, p06].entries()) {
    await joins.create({ sessionId: live.id, participantSub: sub, createdAt: at(-40 + i / 6) });
  }
  // Late joiners who have not answered yet (Sam is a persona). Jamie has not joined at all.
  await joins.create({ sessionId: live.id, participantSub: sam.sub, createdAt: at(-2.5) });
  await joins.create({ sessionId: live.id, participantSub: p07, createdAt: at(-2) });
  await joins.create({ sessionId: live.id, participantSub: p08, createdAt: at(-1.5) });

  // Day 1 recap went well: 6 got it and 1 unsure at its end. These rows are older than the 10-minute active window,
  // so they shape the "all modules" and "trend" views without changing who counts as active now.
  const recap = liveModules[0];
  const recapRows: { sub: string; level: Level; minutes: number; note?: string }[] = [
    { sub: priya.sub, level: 'got_it', minutes: -34 },
    { sub: p01, level: 'unsure', minutes: -33 },
    { sub: p02, level: 'got_it', minutes: -32 },
    { sub: p03, level: 'unsure', minutes: -30 },
    { sub: p04, level: 'got_it', minutes: -29 },
    { sub: p05, level: 'got_it', minutes: -27 },
    { sub: p06, level: 'lost', minutes: -25, note: 'Which memory type did we pick for the lab?' },
    { sub: p01, level: 'got_it', minutes: -21 },
    { sub: p06, level: 'unsure', minutes: -18 },
    { sub: p03, level: 'got_it', minutes: -15 },
  ];
  for (const r of recapRows) {
    await checkIns.create({
      sessionId: live.id,
      moduleId: recap.id,
      participantSub: r.sub,
      level: r.level,
      note: r.note ?? null,
      createdAt: at(r.minutes),
    });
  }

  // Hand calculation: 10 active; lost 2 (20%), unsure 2 (20%), got it 3 (30%), no answer yet 3 (30%). No alert.
  const rows: { sub: string; level: Level; minutes: number; note?: string }[] = [
    { sub: p06, level: 'unsure', minutes: -3 }, // changes their mind below
    { sub: priya.sub, level: 'unsure', minutes: -2.75 },
    { sub: p01, level: 'lost', minutes: -2.5, note: 'Could you show the planning loop diagram again?' },
    { sub: p04, level: 'got_it', minutes: -2.25 },
    { sub: p02, level: 'lost', minutes: -2 },
    { sub: p05, level: 'got_it', minutes: -1.75 },
    { sub: p03, level: 'unsure', minutes: -1.5, note: 'Is chain-of-thought the same as planning?' },
    { sub: p06, level: 'got_it', minutes: -1 },
  ];
  for (const r of rows) {
    await checkIns.create({
      sessionId: live.id,
      moduleId: current.id,
      participantSub: r.sub,
      level: r.level,
      note: r.note ?? null,
      createdAt: at(r.minutes),
    });
  }
  void jamie;
}
