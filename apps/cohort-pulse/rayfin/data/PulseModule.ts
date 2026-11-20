import { date, entity, int, role, text, uuid } from '@microsoft/rayfin-core';

/**
 * One module (agenda item) of a session. `hostSub` is denormalised from the session so the row policy can restrict
 * writes to the host. A malicious user can still insert a module with their own hostSub and someone else's sessionId;
 * the app ignores modules whose hostSub differs from the session's hostSub. No delete.
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', 'create', {
  policy: (claims, item) => claims.sub.eq(item.hostSub),
})
@role('authenticated', 'update', {
  policy: (claims, item) => claims.sub.eq(item.hostSub),
  exclude: ['hostSub', 'sessionId'],
})
export class PulseModule {
  @uuid() id!: string;
  @uuid() sessionId!: string;
  @text({ min: 1, max: 255 }) hostSub!: string;
  @text({ min: 3, max: 80 }) name!: string;
  @int() sortOrder!: number;
  @date({ optional: true }) startedAt?: Date;
  @date({ optional: true }) endedAt?: Date;
}
