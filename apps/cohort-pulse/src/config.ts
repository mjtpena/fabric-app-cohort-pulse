/**
 * Rules and thresholds. The About page reads these, so changing a number here changes the app and its explanation.
 */

/** A participant is active if they checked in to any module, or joined, within this many minutes. */
export const ACTIVE_WINDOW_MINUTES = 10;

/** The confusion alert needs at least this many active participants. Below it the console says "waiting". */
export const ALERT_MIN_ACTIVE = 3;

/** The alert fires when at least this percentage of active participants are currently "lost". */
export const ALERT_LOST_PERCENT = 30;

/** Live screens (host console and participant screen) refresh this often. */
export const POLL_MS = 5_000;

/** Reloading the participant screen within this many minutes of the last join does not record another join. */
export const JOIN_DEDUPE_MINUTES = 1;

/**
 * Clock-skew allowance. Check-ins and joins carry the participant's device time; rows dated up to this far ahead of
 * the facilitator's clock still count (a fast device clock), anything later is ignored (a wrong clock or a tampered
 * client). The report also accepts rows dated up to this long after a module's end.
 */
export const FUTURE_SKEW_MS = 5 * 60_000;

/** Modules per session. */
export const MAX_MODULES = 12;

/** Join codes: 6 characters from an alphabet without look-alikes (no 0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
