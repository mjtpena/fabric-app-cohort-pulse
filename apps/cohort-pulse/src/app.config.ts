/**
 * App configuration. No React imports here: tools/seed-fabric.mjs loads this file in Node to export seed rows.
 */
import type { Persona } from '@x10/shared/identity';
import type { AppConfig } from '@x10/shared/runtime';

import { defs, type Schema } from './model';
import { seed } from './seed';

/**
 * Demo personas. The facilitator hosts both seeded sessions. In the live session Sam has joined but not answered
 * yet (one tap on Lost fires the alert: 3 of 10), Priya said Unsure, and Jamie has not joined (a late joiner).
 */
export const personas: Persona[] = [
  { sub: 'demo-facilitator', name: 'Alex Rivera', email: 'alex@example.com', isAdmin: true, role: 'Facilitator' },
  { sub: 'demo-sam', name: 'Sam Taylor', email: 'sam@example.com', isAdmin: false, role: 'Participant' },
  { sub: 'demo-priya', name: 'Priya Shah', email: 'priya@example.com', isAdmin: false, role: 'Participant' },
  { sub: 'demo-jamie', name: 'Jamie Chen', email: 'jamie@example.com', isAdmin: false, role: 'Late joiner' },
];

export const config: AppConfig<Schema> = {
  appId: 'cohort-pulse',
  title: 'Cohort Pulse',
  tagline: 'Know when the room is lost before anyone has to say so.',
  defs,
  personas,
  seed,
  accent: 'coral',
  /** A heartbeat trace: the room's pulse. */
  logoPaths: ['M2.5 12.5h3.8l2.2-5.5 3.6 11 2.9-8.2 1.7 2.7h4.8'],
  nav: [
    { to: '/', label: 'Pulse', end: true },
    { to: '/checkin', label: 'Check-in' },
    { to: '/sessions', label: 'Sessions' },
    { to: '/new', label: 'New session' },
    { to: '/about', label: 'About' },
  ],
};
