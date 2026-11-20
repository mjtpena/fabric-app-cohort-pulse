import type { ReactNode } from 'react';

import { PageHeader } from '@x10/shared/ui';

import { LEVEL_TONE, PrivacyLine } from '../components/levels';
import {
  ACTIVE_WINDOW_MINUTES,
  ALERT_LOST_PERCENT,
  ALERT_MIN_ACTIVE,
  CODE_LENGTH,
  FUTURE_SKEW_MS,
  JOIN_DEDUPE_MINUTES,
  MAX_MODULES,
  POLL_MS,
} from '../config';
import { limits } from '../model';

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-x-10 gap-y-2 border-t border-line py-7 md:grid-cols-[200px_minmax(0,1fr)]">
      <h2 className="m-0 text-base font-semibold">{title}</h2>
      <div className="flex min-w-0 flex-col gap-3 text-sm leading-6 text-fg/90 [&_p]:m-0 [&_ul]:m-0 [&_ul]:flex [&_ul]:list-none [&_ul]:flex-col [&_ul]:gap-2.5 [&_ul]:p-0">{children}</div>
    </section>
  );
}

const N = ({ children }: { children: ReactNode }) => <span className="font-mono text-fg num">{children}</span>;

/** About: what the heartbeat shows, the rules and thresholds from config.ts, privacy and audience notes. */
export function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="About Cohort Pulse" subtitle="Know when the room is lost before anyone has to say so." />

      <Block title="The room's heartbeat">
        <p>
          Participants tap <strong>Lost</strong>, <strong>Unsure</strong> or <strong>Got it</strong> as the session moves through its modules.
          The facilitator sees the room as lights: one light per current answer, drifting in its band.
        </p>
        <ul>
          <li className="flex items-center gap-3">
            <span className="flex shrink-0 gap-1.5" aria-hidden="true">
              {(['lost', 'unsure', 'got_it'] as const).map((l) => (
                <span key={l} className="size-2.5 rounded-full" style={{ background: LEVEL_TONE[l].solid }} />
              ))}
            </span>
            Bands, top to bottom: lost, unsure, got it, and hollow rings for active people with no answer yet.
          </li>
          <li>
            <strong>Room pulse.</strong> The line beats faster as more of the room is lost (unsure counts half), and turns red at the pause line.
          </li>
          <li>
            <strong>Room light.</strong> The stage warms and reddens as confusion nears {ALERT_LOST_PERCENT}%.
          </li>
          <li>
            <strong>Lenses.</strong> Current module, all modules side by side, and the trend over the session (thickness is the number of answers).
          </li>
        </ul>
      </Block>

      <Block title="How to use it">
        <p>
          <strong>Facilitator.</strong> Plan a session with up to <N>{MAX_MODULES}</N> modules, share the <N>{CODE_LENGTH}</N>-character code,
          and start the first module. Move on with Next; close the session to get the session report, which you can copy as Markdown.
        </p>
        <p>
          <strong>Participant.</strong> Enter the code on Check-in and tap how you are doing. Tap again whenever that changes; only your latest
          answer counts. Add a note of up to <N>{limits.note.max}</N> characters if something would help.
        </p>
      </Block>

      <Block title="Rules">
        <ul>
          <li>Your current state for a module is your most recent tap for it. Rows are never edited, only added.</li>
          <li>
            <strong>Active</strong> means tapped in any module, or joined, in the last <N>{ACTIVE_WINDOW_MINUTES}</N> minutes.
          </li>
          <li>
            <strong>Consider pausing</strong> appears with at least <N>{ALERT_MIN_ACTIVE}</N> active and at least <N>{ALERT_LOST_PERCENT}%</N> of them lost,
            for example 3 of 10. With fewer active, the pulse waits.
          </li>
          <li>Moving on ends the current module and starts the next with no answers carried over. Reopening a module starts it fresh.</li>
          <li>The session report takes each module&apos;s final states at its end (or at close) and ranks modules by the share that were lost.</li>
          <li>
            Screens refresh every <N>{POLL_MS / 1000}</N> seconds. Reopening the check-in screen within <N>{JOIN_DEDUPE_MINUTES}</N> minute counts as one join.
          </li>
        </ul>
      </Block>

      <Block title="Privacy">
        <PrivacyLine />
        <p>
          Lights carry no identity: they are drawn from totals and reshuffle when totals change, and notes are shown without names. The database is a
          different matter. Each tap is stored with the participant&apos;s sign-in id (so each person counts once), and every signed-in user of the app
          can read those rows and the people list through the app&apos;s data API, because the pulse needs every row to compute its totals. Treat taps
          and notes as visible in principle, not as anonymous. A server-side function that returns totals only is on the roadmap.
        </p>
      </Block>

      <Block title="Clocks">
        <p>
          Taps and joins carry the participant&apos;s device time. A device up to <N>{FUTURE_SKEW_MS / 60_000}</N> minutes ahead still counts; a tap from a
          device that is behind is never dated before the start of the current module. A device far behind may drop out of the active window early.
        </p>
      </Block>

      <Block title="Who can join">
        <p>
          On Microsoft Fabric everyone signs in with their work account and needs access to the app item. Add outside attendees as guests in your tenant or
          as workspace members before the session.
        </p>
      </Block>

      <p className="m-0 border-t border-line pt-5 text-ui text-muted">Built by Datachain Consulting for AI @Work. Runs on Microsoft Fabric Apps.</p>
    </div>
  );
}
