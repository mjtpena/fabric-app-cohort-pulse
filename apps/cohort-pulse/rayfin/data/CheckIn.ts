import { date, entity, role, set, text, uuid } from '@microsoft/rayfin-core';

/**
 * One tap of Lost / Unsure / Got it. Append-only: a participant may only insert rows stamped with their own sub, and
 * nobody (not even the host) can update or delete a row. The latest row per participant and module wins on read.
 * Rows are readable by every signed-in user because the host needs all of them to compute the gauge; the app never
 * displays participantSub (see README, Known limits).
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', 'create', {
  policy: (claims, item) => claims.sub.eq(item.participantSub),
})
export class CheckIn {
  @uuid() id!: string;
  @uuid() sessionId!: string;
  @uuid() moduleId!: string;
  @text({ min: 1, max: 255 }) participantSub!: string;
  @set('lost', 'unsure', 'got_it') level!: 'lost' | 'unsure' | 'got_it';
  @text({ max: 140, optional: true }) note?: string;
  @date() createdAt!: Date;
}
