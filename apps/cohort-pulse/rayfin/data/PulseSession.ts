import { date, entity, role, set, text, uuid } from '@microsoft/rayfin-core';

/**
 * A pulse session run by one facilitator (the host). Everyone signed in can read sessions (participants look them up
 * by code). Only the host creates and updates their own session; nobody can change the host, the code or the creation
 * time after insert. There is no delete. The code is unique at database level, so a second session cannot reuse it.
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', 'create', {
  policy: (claims, item) => claims.sub.eq(item.hostSub),
})
@role('authenticated', 'update', {
  policy: (claims, item) => claims.sub.eq(item.hostSub),
  exclude: ['hostSub', 'code', 'createdAt'],
})
export class PulseSession {
  @uuid() id!: string;
  @text({ min: 3, max: 100 }) title!: string;
  @text({ min: 6, max: 6, unique: true }) code!: string;
  @text({ min: 1, max: 255 }) hostSub!: string;
  @text({ min: 1, max: 100 }) hostName!: string;
  @set('open', 'closed') status!: 'open' | 'closed';
  @uuid({ optional: true }) currentModuleId?: string;
  @date() createdAt!: Date;
  @date({ optional: true }) closedAt?: Date;
}
