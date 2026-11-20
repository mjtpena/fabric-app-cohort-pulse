/**
 * App data types and runtime entity definitions. Keep these in step with rayfin/data/*.ts:
 * every field listed here must exist on the entity class with the matching decorator.
 * Dates are ISO strings in the app; optional fields are `| null`.
 */
import type { EntityDefs } from '@x10/shared/data';
import { AppMarkerDef, PersonDef, type AppMarker, type Person } from '@x10/shared/identity';

/** The same numbers as the @text decorators on the entities. */
export const limits = {
  sessionTitle: { min: 3, max: 100 },
  code: { min: 6, max: 6 },
  hostName: { min: 1, max: 100 },
  sub: { min: 1, max: 255 },
  moduleName: { min: 3, max: 80 },
  note: { max: 140 },
} as const;

export type SessionStatus = 'open' | 'closed';
export const SESSION_STATUSES: SessionStatus[] = ['open', 'closed'];

export type Level = 'lost' | 'unsure' | 'got_it';
export const LEVELS: Level[] = ['lost', 'unsure', 'got_it'];

export interface PulseSession {
  id: string;
  title: string;
  code: string;
  hostSub: string;
  hostName: string;
  status: SessionStatus;
  currentModuleId: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface PulseModule {
  id: string;
  sessionId: string;
  hostSub: string;
  name: string;
  sortOrder: number;
  startedAt: string | null;
  endedAt: string | null;
}

export interface CheckIn {
  id: string;
  sessionId: string;
  moduleId: string;
  participantSub: string;
  level: Level;
  note: string | null;
  createdAt: string;
}

export interface PulseJoin {
  id: string;
  sessionId: string;
  participantSub: string;
  createdAt: string;
}

export type Schema = {
  Person: Person;
  AppMarker: AppMarker;
  PulseSession: PulseSession;
  PulseModule: PulseModule;
  CheckIn: CheckIn;
  PulseJoin: PulseJoin;
};

export const defs: EntityDefs<Schema> = {
  Person: PersonDef,
  AppMarker: AppMarkerDef,
  PulseSession: {
    name: 'PulseSession',
    fields: {
      id: 'uuid',
      title: 'text',
      code: 'text',
      hostSub: 'text',
      hostName: 'text',
      status: 'set',
      currentModuleId: 'uuid',
      createdAt: 'date',
      closedAt: 'date',
    },
  },
  PulseModule: {
    name: 'PulseModule',
    fields: {
      id: 'uuid',
      sessionId: 'uuid',
      hostSub: 'text',
      name: 'text',
      sortOrder: 'int',
      startedAt: 'date',
      endedAt: 'date',
    },
  },
  CheckIn: {
    name: 'CheckIn',
    fields: {
      id: 'uuid',
      sessionId: 'uuid',
      moduleId: 'uuid',
      participantSub: 'text',
      level: 'set',
      note: 'text',
      createdAt: 'date',
    },
  },
  PulseJoin: {
    name: 'PulseJoin',
    fields: { id: 'uuid', sessionId: 'uuid', participantSub: 'text', createdAt: 'date' },
  },
};
