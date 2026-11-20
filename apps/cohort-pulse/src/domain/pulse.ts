/**
 * Pure pulse logic: current state per participant (latest wins), active participants, gauge shares, the confusion
 * alert, per-module reports and the confusion ranking. No I/O here; everything is unit tested.
 *
 * Privacy by construction: the functions that feed the host UI (`computeGauge`, `confusionAlert`, `moduleNotes`,
 * `sessionReport`) return counts, shares and note text only. Participant subs are used for de-duplication inside
 * these functions and never leave them.
 */
import { latestBy } from '@x10/shared/data';
import { checkText, mdTable, MINUTE, toMs } from '@x10/shared/lib';

import {
  ACTIVE_WINDOW_MINUTES,
  ALERT_LOST_PERCENT,
  ALERT_MIN_ACTIVE,
  CODE_ALPHABET,
  CODE_LENGTH,
  FUTURE_SKEW_MS,
  MAX_MODULES,
} from '../config';
import { LEVELS, limits, type CheckIn, type Level, type PulseJoin, type PulseModule, type PulseSession } from '../model';

type When = string | Date | number;
const ms = (w: When): number => (typeof w === 'number' ? w : toMs(w));

export const LEVEL_LABEL: Record<Level | 'none', string> = {
  lost: 'Lost',
  unsure: 'Unsure',
  got_it: 'Got it',
  none: 'No answer yet',
};

export const isLevel = (v: unknown): v is Level => typeof v === 'string' && (LEVELS as string[]).includes(v);

/* ------------------------------------------------------------------ state per participant */

/**
 * Each participant's current state for one module: their most recent CheckIn for it at `asOf` (rows dated later are
 * ignored, so a report can be taken "as at" a module's end). With `since` (the module's latest start), rows from an
 * earlier run of a reopened module are ignored too. Returns a map of participantSub to that CheckIn.
 */
export function currentStates(
  checkIns: CheckIn[],
  moduleId: string,
  asOf: When,
  since: When | null = null,
): Map<string, CheckIn> {
  const until = ms(asOf);
  const from = since === null ? -Infinity : ms(since);
  const rows = checkIns.filter((c) => {
    if (c.moduleId !== moduleId) return false;
    const t = toMs(c.createdAt);
    return t >= from && t <= until;
  });
  const latest = latestBy(rows, (c) => c.participantSub, (c) => toMs(c.createdAt));
  return new Map(latest.map((c) => [c.participantSub, c]));
}

/** The viewer's own latest check-in for a module (since its latest start), or null. */
export function myLatest(
  checkIns: CheckIn[],
  moduleId: string,
  sub: string,
  now: When,
  since: When | null = null,
): CheckIn | null {
  const mine = checkIns.filter((c) => c.participantSub === sub);
  return currentStates(mine, moduleId, ms(now) + FUTURE_SKEW_MS, since).get(sub) ?? null;
}

/**
 * The timestamp to store on a new check-in: the participant's clock, but never before the module's latest start and
 * never at or before their own previous check-in for it. So a participant whose clock runs slow still counts in a
 * freshly (re)started module, and "latest wins" follows the order of their taps whatever their clock says.
 */
export function checkInTime(now: When, moduleStartedAt: string | null, previous: string | null): string {
  let t = ms(now);
  if (moduleStartedAt) t = Math.max(t, toMs(moduleStartedAt));
  if (previous) t = Math.max(t, toMs(previous) + 1);
  return new Date(t).toISOString();
}

/**
 * Participants who checked in to any module, or joined, within the active window ending at `now`.
 * Rows dated more than FUTURE_SKEW_MS ahead of `now` are ignored. The host is never a participant.
 */
export function activeParticipants(
  checkIns: Pick<CheckIn, 'participantSub' | 'createdAt'>[],
  joins: Pick<PulseJoin, 'participantSub' | 'createdAt'>[],
  now: When,
  opts: { windowMinutes?: number; excludeSub?: string | null } = {},
): Set<string> {
  const end = ms(now);
  const since = end - (opts.windowMinutes ?? ACTIVE_WINDOW_MINUTES) * MINUTE;
  const until = end + FUTURE_SKEW_MS;
  const out = new Set<string>();
  for (const r of [...checkIns, ...joins]) {
    if (opts.excludeSub && r.participantSub === opts.excludeSub) continue;
    const t = toMs(r.createdAt);
    if (t >= since && t <= until) out.add(r.participantSub);
  }
  return out;
}

/* ------------------------------------------------------------------ gauge */

export interface LevelCounts {
  lost: number;
  unsure: number;
  got_it: number;
  none: number;
}

export interface Gauge {
  /** Active participants (the denominator). */
  active: number;
  counts: LevelCounts;
  /** Whole percentages of `active`, summing to 100 when anyone is active (largest-remainder rounding). */
  shares: LevelCounts;
}

/**
 * Round parts to whole percentages that add up to exactly 100 (largest remainder). All zeros stay zeros.
 * Ties on the remainder go to the earlier part.
 */
export function roundShares(values: number[]): number[] {
  const total = values.reduce((s, v) => s + v, 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((s, v) => s + v, 0);
  const order = raw.map((r, i) => ({ i, rem: r - floors[i] })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

/**
 * The live gauge for the current module: among active participants, how many are currently lost, unsure, got it,
 * or have not answered this module yet. Only rows since the module's latest start count (a reopened module starts
 * fresh). A bare module id means "no start time known" and counts every row for it.
 */
export function computeGauge(
  checkIns: CheckIn[],
  joins: PulseJoin[],
  module: string | Pick<PulseModule, 'id' | 'startedAt'> | null,
  now: When,
  excludeSub?: string | null,
): Gauge {
  const active = activeParticipants(checkIns, joins, now, { excludeSub });
  const mod = typeof module === 'string' ? { id: module, startedAt: null } : module;
  const states = mod ? currentStates(checkIns, mod.id, ms(now) + FUTURE_SKEW_MS, mod.startedAt) : new Map<string, CheckIn>();
  const counts: LevelCounts = { lost: 0, unsure: 0, got_it: 0, none: 0 };
  for (const sub of active) {
    const state = states.get(sub);
    counts[state ? state.level : 'none'] += 1;
  }
  const [lost, unsure, got_it, none] = roundShares([counts.lost, counts.unsure, counts.got_it, counts.none]);
  return { active: active.size, counts, shares: { lost, unsure, got_it, none } };
}

/* ------------------------------------------------------------------ alert */

export type AlertState =
  | { kind: 'waiting'; active: number; needed: number; message: string }
  | { kind: 'alert'; active: number; lost: number; message: string }
  | { kind: 'calm'; active: number; lost: number; message: string };

/**
 * Confusion alert: with at least `minActive` active participants and at least `lostPercent` percent of them lost,
 * say "Consider pausing: 4 of 12 are lost". Integer maths, so 3 of 10 at 30 % is exactly on the threshold.
 */
export function confusionAlert(
  gauge: Pick<Gauge, 'active'> & { counts: Pick<LevelCounts, 'lost'> },
  opts: { minActive?: number; lostPercent?: number } = {},
): AlertState {
  const minActive = opts.minActive ?? ALERT_MIN_ACTIVE;
  const lostPercent = opts.lostPercent ?? ALERT_LOST_PERCENT;
  const { active } = gauge;
  const lost = gauge.counts.lost;
  if (active < minActive) {
    return {
      kind: 'waiting',
      active,
      needed: minActive,
      message: `Waiting for more check-ins: the alert needs at least ${minActive} active participants (now ${active}).`,
    };
  }
  if (lost > 0 && lost * 100 >= lostPercent * active) {
    return { kind: 'alert', active, lost, message: `Consider pausing: ${lost} of ${active} are lost` };
  }
  return { kind: 'calm', active, lost, message: `${lost} of ${active} are lost, below the ${lostPercent}% alert line.` };
}

/** Notes left on a module (since `since`, up to `asOf`), newest first, without any attribution. */
export function moduleNotes(checkIns: CheckIn[], moduleId: string, asOf: When, since: When | null = null): string[] {
  const until = ms(asOf);
  const from = since === null ? -Infinity : ms(since);
  return checkIns
    .filter((c) => {
      if (c.moduleId !== moduleId || !c.note?.trim()) return false;
      const t = toMs(c.createdAt);
      return t >= from && t <= until;
    })
    .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
    .map((c) => c.note!.trim());
}

/* ------------------------------------------------------------------ modules */

/** Modules that really belong to the session (same sessionId and same host), in agenda order. */
export function sessionModules(session: Pick<PulseSession, 'id' | 'hostSub'>, modules: PulseModule[]): PulseModule[] {
  return modules
    .filter((m) => m.sessionId === session.id && m.hostSub === session.hostSub)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function moduleNav(modules: PulseModule[], currentId: string | null) {
  const index = currentId ? modules.findIndex((m) => m.id === currentId) : -1;
  return {
    index,
    current: index >= 0 ? modules[index] : null,
    prev: index > 0 ? modules[index - 1] : null,
    next: index >= 0 ? (modules[index + 1] ?? null) : (modules[0] ?? null),
  };
}

/**
 * The moment a module's final states are taken: when it ended, or when the session closed mid-module.
 * Null when it never started or is still running.
 */
export function moduleEndAt(module: PulseModule, session: Pick<PulseSession, 'closedAt'>): string | null {
  if (!module.startedAt) return null;
  return module.endedAt ?? session.closedAt ?? null;
}

/* ------------------------------------------------------------------ report */

export interface ModuleReport {
  moduleId: string;
  name: string;
  sortOrder: number;
  /** False when the module never started. */
  ran: boolean;
  endAt: string | null;
  /** Participants with a state for this module at its end. */
  responses: number;
  counts: Omit<LevelCounts, 'none'>;
  /** Whole percentages of `responses`. */
  shares: Omit<LevelCounts, 'none'>;
  /** Share of responses that were "lost" at the end (0..1), or null with no responses. */
  confusionIndex: number | null;
  notes: string[];
}

/**
 * One module's report: final state per participant at `endAt` (latest wins), shares and the confusion index.
 * Rows count from the module's latest start up to its end plus the clock-skew allowance (check-ins for a module that
 * is no longer current are refused, so rows dated just after the end come from participants with a fast clock).
 */
export function moduleReport(module: PulseModule, checkIns: CheckIn[], endAt: string | null): ModuleReport {
  const base = { moduleId: module.id, name: module.name, sortOrder: module.sortOrder, endAt };
  if (!module.startedAt || !endAt) {
    return {
      ...base,
      ran: !!module.startedAt,
      responses: 0,
      counts: { lost: 0, unsure: 0, got_it: 0 },
      shares: { lost: 0, unsure: 0, got_it: 0 },
      confusionIndex: null,
      notes: [],
    };
  }
  const until = toMs(endAt) + FUTURE_SKEW_MS;
  const states = [...currentStates(checkIns, module.id, until, module.startedAt).values()];
  const counts = { lost: 0, unsure: 0, got_it: 0 };
  for (const s of states) counts[s.level] += 1;
  const [lost, unsure, got_it] = roundShares([counts.lost, counts.unsure, counts.got_it]);
  return {
    ...base,
    ran: true,
    responses: states.length,
    counts,
    shares: { lost, unsure, got_it },
    confusionIndex: states.length ? counts.lost / states.length : null,
    notes: moduleNotes(checkIns, module.id, until, module.startedAt).reverse(),
  };
}

/** Modules with responses, most confusing first (then more unsure, then agenda order). */
export function rankByConfusion(reports: ModuleReport[]): ModuleReport[] {
  return reports
    .filter((r) => r.ran && r.responses > 0 && r.confusionIndex !== null)
    .sort(
      (a, b) =>
        b.confusionIndex! - a.confusionIndex! ||
        b.counts.unsure / b.responses - a.counts.unsure / a.responses ||
        a.sortOrder - b.sortOrder,
    );
}

export interface SessionReport {
  modules: ModuleReport[];
  ranking: ModuleReport[];
  /** Distinct participants who joined or checked in (the host excluded). */
  participants: number;
}

export function sessionReport(
  session: PulseSession,
  modules: PulseModule[],
  checkIns: CheckIn[],
  joins: PulseJoin[],
): SessionReport {
  const mine = sessionModules(session, modules);
  const rows = checkIns.filter((c) => c.sessionId === session.id && c.participantSub !== session.hostSub);
  const reports = mine.map((m) => moduleReport(m, rows, moduleEndAt(m, session)));
  const people = new Set(
    [...rows, ...joins.filter((j) => j.sessionId === session.id)]
      .map((r) => r.participantSub)
      .filter((s) => s !== session.hostSub),
  );
  return { modules: reports, ranking: rankByConfusion(reports), participants: people.size };
}

export const formatIndex = (v: number | null): string => (v === null ? '—' : `${Math.round(v * 100)}%`);

/** The report as Markdown, for pasting into a follow-up email or a wiki. Contains no participant data. */
export function reportMarkdown(session: PulseSession, report: SessionReport, when: string): string {
  const lines: string[] = [];
  lines.push(`# ${session.title}: pulse report`);
  lines.push('');
  lines.push(`${when} · code ${session.code} · ${report.participants} participants`);
  lines.push('');
  lines.push('## Confusion ranking');
  lines.push('');
  if (report.ranking.length) {
    lines.push(
      mdTable(
        ['Rank', 'Module', 'Confusion index', 'Lost', 'Unsure', 'Got it', 'Responses'],
        report.ranking.map((r, i) => [
          i + 1,
          r.name,
          formatIndex(r.confusionIndex),
          `${r.shares.lost}%`,
          `${r.shares.unsure}%`,
          `${r.shares.got_it}%`,
          r.responses,
        ]),
      ),
    );
  } else {
    lines.push('No module received check-ins.');
  }
  const notRun = report.modules.filter((m) => !m.ran);
  if (notRun.length) {
    lines.push('');
    lines.push(`Not run: ${notRun.map((m) => m.name).join(', ')}.`);
  }
  const withNotes = report.modules.filter((m) => m.notes.length);
  if (withNotes.length) {
    lines.push('');
    lines.push('## Notes from participants');
    for (const m of withNotes) {
      lines.push('');
      lines.push(`### ${m.name}`);
      lines.push('');
      for (const n of m.notes) lines.push(`- ${n.replace(/\r?\n/g, ' ')}`);
    }
  }
  lines.push('');
  lines.push('Shares are taken at the end of each module. The confusion index is the share of responses that were "lost".');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ validation and codes */

export function normalizeCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export function validateCode(input: string): string | null {
  const v = normalizeCode(input);
  if (!v) return 'Enter the 6-character code your facilitator shared.';
  if (!new RegExp(`^[A-Z0-9]{${CODE_LENGTH}}$`).test(v)) return `A code is ${CODE_LENGTH} letters and digits, like PULSE7.`;
  return null;
}

export function generateCode(rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return out;
}

export function validateTitle(title: string): string | null {
  return checkText(title, { ...limits.sessionTitle, label: 'Title' });
}

export function validateModuleName(name: string): string | null {
  return checkText(name, { ...limits.moduleName, label: 'Module name' });
}

export function validateNote(note: string): string | null {
  return checkText(note, { ...limits.note, optional: true, label: 'Note' });
}

/** Parse "one module per line" input. Blank lines are ignored. */
export function parseModuleLines(text: string, existing: string[] = []): { names: string[]; error: string | null } {
  const names = text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  if (!names.length) return { names, error: 'Add at least one module, one per line.' };
  if (names.length + existing.length > MAX_MODULES) {
    return { names, error: `A session can have at most ${MAX_MODULES} modules (now ${names.length + existing.length}).` };
  }
  for (const [i, n] of names.entries()) {
    const msg = validateModuleName(n);
    if (msg) return { names, error: `Line ${i + 1}: ${msg}` };
  }
  const seen = new Set(existing.map((n) => n.toLowerCase()));
  for (const n of names) {
    const k = n.toLowerCase();
    if (seen.has(k)) return { names, error: `"${n}" appears twice. Module names must be different.` };
    seen.add(k);
  }
  return { names, error: null };
}

/** "just now", "2 min ago", "3 h ago", for the participant's "you said" line. */
export function agoShort(iso: string, now: When): string {
  const diff = Math.max(0, ms(now) - toMs(iso));
  if (diff < MINUTE) return 'just now';
  if (diff < 60 * MINUTE) return `${Math.floor(diff / MINUTE)} min ago`;
  return `${Math.floor(diff / (60 * MINUTE))} h ago`;
}

/* ------------------------------------------------------------------ the room's heartbeat (aggregates for the stage) */

export type ModuleState = 'done' | 'current' | 'upcoming';

/** One module's totals for the "all modules" lens. Counts only, never who. */
export interface ModuleTotals {
  moduleId: string;
  name: string;
  sortOrder: number;
  state: ModuleState;
  /** Final states for a finished module; the live gauge (with `none`) for the current one; zeros if not run. */
  counts: LevelCounts;
  /** Answers among `counts` (lost + unsure + got it). */
  responses: number;
  /** Share of responses that are "lost" (0..1), or null with no responses. */
  confusionIndex: number | null;
}

/**
 * Totals per module, in agenda order: finished modules at their end (as in the report), the current module from the
 * live gauge (active participants, with "no answer yet"), modules not run yet as zeros. The host's own rows never count.
 */
export function moduleTotals(
  session: PulseSession,
  modules: PulseModule[],
  checkIns: CheckIn[],
  gauge: Gauge | null,
): ModuleTotals[] {
  const rows = checkIns.filter((c) => c.sessionId === session.id && c.participantSub !== session.hostSub);
  return sessionModules(session, modules).map((m) => {
    const base = { moduleId: m.id, name: m.name, sortOrder: m.sortOrder };
    if (session.status === 'open' && m.id === session.currentModuleId && gauge) {
      const responses = gauge.counts.lost + gauge.counts.unsure + gauge.counts.got_it;
      return {
        ...base,
        state: 'current' as const,
        counts: { ...gauge.counts },
        responses,
        confusionIndex: responses ? gauge.counts.lost / responses : null,
      };
    }
    const endAt = moduleEndAt(m, session);
    if (m.startedAt && endAt) {
      const r = moduleReport(m, rows, endAt);
      return {
        ...base,
        state: 'done' as const,
        counts: { ...r.counts, none: 0 },
        responses: r.responses,
        confusionIndex: r.confusionIndex,
      };
    }
    return { ...base, state: 'upcoming' as const, counts: { lost: 0, unsure: 0, got_it: 0, none: 0 }, responses: 0, confusionIndex: null };
  });
}

export interface TrendSegment {
  moduleId: string;
  name: string;
  /** Epoch ms. */
  start: number;
  end: number;
}

export interface TrendSample {
  /** Epoch ms. */
  t: number;
  moduleId: string;
  /** Latest answer per participant for that module at `t` (since its latest start). */
  counts: Omit<LevelCounts, 'none'>;
  responses: number;
}

export interface SessionTrend {
  start: number;
  end: number;
  segments: TrendSegment[];
  samples: TrendSample[];
}

/**
 * The session over time, for the "trend" lens and the report: for each module that ran, samples of its answer totals
 * from its start to its end (or `now` while it runs). Totals only. Null when no module has started.
 */
export function sessionTrend(
  session: PulseSession,
  modules: PulseModule[],
  checkIns: CheckIn[],
  now: When,
  totalSamples = 72,
): SessionTrend | null {
  const rows = checkIns.filter((c) => c.sessionId === session.id && c.participantSub !== session.hostSub);
  const nowMs = ms(now);
  const segments: TrendSegment[] = [];
  for (const m of sessionModules(session, modules)) {
    if (!m.startedAt) continue;
    const start = toMs(m.startedAt);
    const endIso = moduleEndAt(m, session);
    const end = endIso ? toMs(endIso) : session.status === 'open' && m.id === session.currentModuleId ? nowMs : start;
    if (end <= start) continue;
    segments.push({ moduleId: m.id, name: m.name, start, end });
  }
  if (!segments.length) return null;
  segments.sort((a, b) => a.start - b.start);
  const start = segments[0].start;
  const end = Math.max(...segments.map((s) => s.end));
  const span = Math.max(1, segments.reduce((s, g) => s + (g.end - g.start), 0));
  const samples: TrendSample[] = [];
  for (const g of segments) {
    const k = Math.max(2, Math.round((totalSamples * (g.end - g.start)) / span));
    for (let i = 0; i < k; i++) {
      const t = g.start + ((g.end - g.start) * i) / (k - 1);
      const counts = { lost: 0, unsure: 0, got_it: 0 };
      const states = currentStates(rows, g.moduleId, t, g.start);
      for (const s of states.values()) counts[s.level] += 1;
      samples.push({ t, moduleId: g.moduleId, counts, responses: states.size });
    }
  }
  return { start, end, segments, samples };
}
