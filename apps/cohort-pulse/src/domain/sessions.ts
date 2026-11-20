/**
 * Data flows for Cohort Pulse. Components call these, never the store. Host-only actions are checked here (and by the
 * PulseSession / PulseModule row policies in Fabric); participant writes are append-only CheckIn and PulseJoin rows.
 */
import { NotFoundError, PermissionError, RuleError, uniqueBy, type DataStore } from '@x10/shared/data';
import type { Person } from '@x10/shared/identity';
import { MINUTE, toMs } from '@x10/shared/lib';

import { FUTURE_SKEW_MS, JOIN_DEDUPE_MINUTES } from '../config';
import type { CheckIn, Level, PulseModule, PulseSession, Schema } from '../model';
import {
  computeGauge,
  confusionAlert,
  checkInTime,
  generateCode,
  isLevel,
  LEVEL_LABEL,
  moduleNav,
  moduleNotes,
  moduleTotals,
  myLatest,
  normalizeCode,
  parseModuleLines,
  sessionModules,
  sessionReport,
  sessionTrend,
  validateCode,
  validateModuleName,
  validateNote,
  validateTitle,
  type AlertState,
  type Gauge,
  type ModuleTotals,
  type SessionReport,
  type SessionTrend,
} from './pulse';

type Store = DataStore<Schema>;
type Me = Pick<Person, 'sub' | 'displayName'>;

const iso = (d: Date) => d.toISOString();

/* ------------------------------------------------------------------ lookups */

async function getSession(store: Store, id: string): Promise<PulseSession> {
  const s = await store.repo('PulseSession').get(id);
  if (!s) throw new NotFoundError('Session', id);
  return s;
}

function requireHost(session: PulseSession, me: Me, action: string) {
  if (session.hostSub !== me.sub) throw new PermissionError(`Only the facilitator of this session can ${action}.`);
}

async function listModules(store: Store, session: PulseSession): Promise<PulseModule[]> {
  return sessionModules(session, await store.repo('PulseModule').list({ where: { sessionId: session.id } }));
}

/** Sessions with this code; prefers an open one, then the oldest (the code column is unique in Fabric anyway). */
export async function findByCode(store: Store, code: string): Promise<PulseSession | null> {
  const rows = await store.repo('PulseSession').list({ where: { code: normalizeCode(code) } });
  if (!rows.length) return null;
  return [...rows].sort((a, b) => (a.status === b.status ? a.createdAt.localeCompare(b.createdAt) : a.status === 'open' ? -1 : 1))[0];
}

/* ------------------------------------------------------------------ home */

export async function listHostedSessions(store: Store, me: Me): Promise<PulseSession[]> {
  const rows = await store.repo('PulseSession').list({ where: { hostSub: me.sub } });
  return rows.sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'open' ? -1 : 1));
}

/** Open sessions the viewer joined recently (not hosted by them), newest join first. */
export async function listJoinedSessions(store: Store, me: Me, limit = 5): Promise<PulseSession[]> {
  const joins = await store.repo('PulseJoin').list({ where: { participantSub: me.sub } });
  const ids = uniqueBy(
    [...joins].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    (j) => j.sessionId,
  ).map((j) => j.sessionId);
  const out: PulseSession[] = [];
  for (const id of ids) {
    const s = await store.repo('PulseSession').get(id);
    if (s && s.status === 'open' && s.hostSub !== me.sub) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/* ------------------------------------------------------------------ create */

export interface NewSessionInput {
  title: string;
  modulesText: string;
}

export function validateNewSession(input: NewSessionInput): { title?: string; modules?: string } {
  const out: { title?: string; modules?: string } = {};
  const t = validateTitle(input.title);
  if (t) out.title = t;
  const m = parseModuleLines(input.modulesText).error;
  if (m) out.modules = m;
  return out;
}

async function uniqueCode(store: Store, rand: () => number): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateCode(rand);
    const clash = await store.repo('PulseSession').list({ where: { code }, limit: 1 });
    if (!clash.length) return code;
  }
  throw new RuleError('Could not find a free join code. Please try again.');
}

export async function createSession(
  store: Store,
  me: Me,
  input: NewSessionInput,
  now = new Date(),
  rand: () => number = Math.random,
): Promise<PulseSession> {
  const errors = validateNewSession(input);
  if (errors.title || errors.modules) throw new RuleError(errors.title ?? errors.modules!);
  const { names } = parseModuleLines(input.modulesText);
  const session = await store.repo('PulseSession').create({
    title: input.title.trim(),
    code: await uniqueCode(store, rand),
    hostSub: me.sub,
    hostName: me.displayName.slice(0, 100),
    status: 'open',
    currentModuleId: null,
    createdAt: iso(now),
    closedAt: null,
  });
  for (const [i, name] of names.entries()) {
    await store.repo('PulseModule').create({
      sessionId: session.id,
      hostSub: me.sub,
      name,
      sortOrder: i + 1,
      startedAt: null,
      endedAt: null,
    });
  }
  return session;
}

/* ------------------------------------------------------------------ participant */

export type ParticipantView =
  | { kind: 'invalid'; code: string; message: string }
  | { kind: 'unknown'; code: string }
  | { kind: 'closed'; session: PulseSession }
  | { kind: 'host'; session: PulseSession }
  | { kind: 'ready'; session: PulseSession; module: PulseModule | null; mine: CheckIn | null };

/** Record that the viewer joined, unless they already did within JOIN_DEDUPE_MINUTES (page reloads). */
export async function recordJoin(store: Store, me: Me, session: PulseSession, now = new Date()): Promise<boolean> {
  const mine = await store.repo('PulseJoin').list({ where: { sessionId: session.id, participantSub: me.sub } });
  const recent = mine.some((j) => Math.abs(now.getTime() - toMs(j.createdAt)) < JOIN_DEDUPE_MINUTES * MINUTE);
  if (recent) return false;
  await store.repo('PulseJoin').create({ sessionId: session.id, participantSub: me.sub, createdAt: iso(now) });
  return true;
}

/**
 * Everything the participant screen shows: the session, its current module, and the viewer's own latest check-in for
 * that module (never anyone else's). With `join`, also records the join (the first load of the screen).
 */
export async function loadParticipantView(
  store: Store,
  me: Me,
  rawCode: string,
  opts: { join?: boolean; now?: Date } = {},
): Promise<ParticipantView> {
  const now = opts.now ?? new Date();
  const code = normalizeCode(rawCode);
  const invalid = validateCode(code);
  if (invalid) return { kind: 'invalid', code, message: invalid };
  const session = await findByCode(store, code);
  if (!session) return { kind: 'unknown', code };
  if (session.hostSub === me.sub) return { kind: 'host', session };
  if (session.status === 'closed') return { kind: 'closed', session };
  if (opts.join) await recordJoin(store, me, session, now);
  const modules = await listModules(store, session);
  const module = modules.find((m) => m.id === session.currentModuleId) ?? null;
  let mine: CheckIn | null = null;
  if (module) {
    const rows = await store.repo('CheckIn').list({ where: { sessionId: session.id, moduleId: module.id, participantSub: me.sub } });
    mine = myLatest(rows, module.id, me.sub, now, module.startedAt);
  }
  return { kind: 'ready', session, module, mine };
}

/**
 * Append a check-in for the module the participant is looking at. Refuses when the session closed or the facilitator
 * moved on in the meantime, so an answer is never filed under the wrong module.
 */
export async function checkIn(
  store: Store,
  me: Me,
  input: { sessionId: string; moduleId: string; level: Level; note?: string | null },
  now = new Date(),
): Promise<CheckIn> {
  if (!isLevel(input.level)) throw new RuleError('Choose Lost, Unsure or Got it.');
  const noteMsg = validateNote(input.note ?? '');
  if (noteMsg) throw new RuleError(noteMsg);
  const session = await getSession(store, input.sessionId);
  if (session.hostSub === me.sub) throw new RuleError('Facilitators cannot check in to their own session.');
  if (session.status === 'closed') throw new RuleError('This session has ended, so check-ins are closed.');
  const modules = await listModules(store, session);
  const current = modules.find((m) => m.id === session.currentModuleId);
  if (!current || current.id !== input.moduleId) {
    throw new RuleError(
      current
        ? `Your facilitator has moved on to "${current.name}". Your answer was not saved; please answer for this module.`
        : 'Your facilitator has not started a module yet.',
    );
  }
  const mine = await store.repo('CheckIn').list({ where: { sessionId: session.id, moduleId: current.id, participantSub: me.sub } });
  const previous = mine.reduce<string | null>((max, c) => (!max || c.createdAt > max ? c.createdAt : max), null);
  const note = (input.note ?? '').trim();
  return store.repo('CheckIn').create({
    sessionId: session.id,
    moduleId: input.moduleId,
    participantSub: me.sub,
    level: input.level,
    note: note || null,
    createdAt: checkInTime(now, current.startedAt, previous),
  });
}

export function describeMine(mine: CheckIn | null): string | null {
  return mine ? LEVEL_LABEL[mine.level] : null;
}

/* ------------------------------------------------------------------ host console */

/** What the host console renders. Aggregates and unattributed notes only: no participant subs or names. */
export interface HostConsoleView {
  session: PulseSession;
  modules: PulseModule[];
  current: PulseModule | null;
  prev: PulseModule | null;
  next: PulseModule | null;
  gauge: Gauge;
  alert: AlertState;
  notes: string[];
  /** Totals per module (the "all modules" lens). */
  byModule: ModuleTotals[];
  /** Totals over time (the "trend" lens); null before the first module starts. */
  trend: SessionTrend | null;
  loadedAt: string;
}

export async function loadHostConsole(store: Store, me: Me, sessionId: string, now = new Date()): Promise<HostConsoleView> {
  const session = await getSession(store, sessionId);
  requireHost(session, me, 'open its console');
  const modules = await listModules(store, session);
  const [checkIns, joins] = await Promise.all([
    store.repo('CheckIn').list({ where: { sessionId } }),
    store.repo('PulseJoin').list({ where: { sessionId } }),
  ]);
  const nav = moduleNav(modules, session.currentModuleId);
  const gauge = computeGauge(checkIns, joins, nav.current, now, session.hostSub);
  const live = session.status === 'open' && nav.current ? gauge : null;
  return {
    session,
    modules,
    current: nav.current,
    prev: nav.prev,
    next: nav.next,
    gauge,
    alert: confusionAlert(gauge),
    notes: nav.current ? moduleNotes(checkIns, nav.current.id, now.getTime() + FUTURE_SKEW_MS, nav.current.startedAt) : [],
    byModule: moduleTotals(session, modules, checkIns, live),
    trend: sessionTrend(session, modules, checkIns, now),
    loadedAt: iso(now),
  };
}

/**
 * Make `targetId` the current module: the old one gets endedAt, the new one a fresh startedAt and no endedAt.
 * Participants then see the new module with no previous answer; going back to a module reopens it fresh (only rows
 * since its latest start count, in the gauge, in "you said" and in the report).
 *
 * Three writes with no transaction. Each step is safe to repeat, so if one fails the host just presses the button
 * again: an already-ended module keeps its first endedAt, the target is (re)started, and the session pointer is set
 * last, so until it succeeds the console still shows the old module as current.
 */
export async function moveToModule(store: Store, me: Me, sessionId: string, targetId: string, now = new Date()): Promise<void> {
  const session = await getSession(store, sessionId);
  requireHost(session, me, 'change the module');
  if (session.status === 'closed') throw new RuleError('This session is closed.');
  if (session.currentModuleId === targetId) return;
  const modules = await listModules(store, session);
  const target = modules.find((m) => m.id === targetId);
  if (!target) throw new RuleError('That module is not part of this session.');
  const current = modules.find((m) => m.id === session.currentModuleId);
  if (current && !current.endedAt) await store.repo('PulseModule').update(current.id, { endedAt: iso(now) });
  await store.repo('PulseModule').update(target.id, { startedAt: iso(now), endedAt: null });
  await store.repo('PulseSession').update(session.id, { currentModuleId: target.id });
}

export async function addModule(store: Store, me: Me, sessionId: string, name: string): Promise<PulseModule> {
  const session = await getSession(store, sessionId);
  requireHost(session, me, 'add modules');
  if (session.status === 'closed') throw new RuleError('This session is closed.');
  const msg = validateModuleName(name);
  if (msg) throw new RuleError(msg);
  const modules = await listModules(store, session);
  const parsed = parseModuleLines(name, modules.map((m) => m.name));
  if (parsed.error) throw new RuleError(parsed.error);
  return store.repo('PulseModule').create({
    sessionId: session.id,
    hostSub: me.sub,
    name: parsed.names[0],
    sortOrder: Math.max(0, ...modules.map((m) => m.sortOrder)) + 1,
    startedAt: null,
    endedAt: null,
  });
}

/**
 * Close the session. A module still running ends now, so its final states are taken at close.
 * Two writes with no transaction; repeating after a failure is safe (an already-set endedAt is kept).
 */
export async function closeSession(store: Store, me: Me, sessionId: string, now = new Date()): Promise<void> {
  const session = await getSession(store, sessionId);
  requireHost(session, me, 'close it');
  if (session.status === 'closed') return;
  const modules = await listModules(store, session);
  const current = modules.find((m) => m.id === session.currentModuleId);
  if (current && current.startedAt && !current.endedAt) await store.repo('PulseModule').update(current.id, { endedAt: iso(now) });
  await store.repo('PulseSession').update(session.id, { status: 'closed', closedAt: iso(now) });
}

/* ------------------------------------------------------------------ report */

export interface ReportView {
  session: PulseSession;
  report: SessionReport | null;
  /** The session's answer totals over time (closed sessions only). */
  trend: SessionTrend | null;
}

/** The per-module report. Host only, and only once the session is closed (`report` is null while it is open). */
export async function loadReport(store: Store, me: Me, sessionId: string): Promise<ReportView> {
  const session = await getSession(store, sessionId);
  requireHost(session, me, 'see its report');
  if (session.status !== 'closed') return { session, report: null, trend: null };
  const [modules, checkIns, joins] = await Promise.all([
    store.repo('PulseModule').list({ where: { sessionId } }),
    store.repo('CheckIn').list({ where: { sessionId } }),
    store.repo('PulseJoin').list({ where: { sessionId } }),
  ]);
  return {
    session,
    report: sessionReport(session, modules, checkIns, joins),
    trend: sessionTrend(session, modules, checkIns, session.closedAt ?? new Date()),
  };
}
