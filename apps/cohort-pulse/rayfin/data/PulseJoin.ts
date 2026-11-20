import { date, entity, role, text, uuid } from '@microsoft/rayfin-core';

/**
 * A participant opening a session (by code or link). Joining counts as activity for the active window, so a late
 * joiner who has not tapped yet still counts in the gauge denominator as "no answer yet". Append-only like CheckIn:
 * create only with your own sub, no update or delete.
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', 'create', {
  policy: (claims, item) => claims.sub.eq(item.participantSub),
})
export class PulseJoin {
  @uuid() id!: string;
  @uuid() sessionId!: string;
  @text({ min: 1, max: 255 }) participantSub!: string;
  @date() createdAt!: Date;
}
