import { useParams } from 'react-router-dom';
import { Activity, ChevronLeft, Hourglass, Printer } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { formatDateTime, formatDuration, minutesBetween, useAsync } from '@x10/shared/lib';
import { Button, CopyButton, cx, DataState, EmptyState, LinkButton, PageHeader, Section, Skeleton, Stat, StatStrip, Table, TableWrap, Td, Th, Tr } from '@x10/shared/ui';

import { MixBar } from '../components/levels';
import { TrendChart } from '../components/TrendChart';
import { ALERT_LOST_PERCENT } from '../config';
import { formatIndex, reportMarkdown, type SessionReport, type SessionTrend } from '../domain/pulse';
import { loadReport } from '../domain/sessions';
import type { PulseSession, Schema } from '../model';

/** Session report: modules ranked by confusion, the session's heartbeat over time, and notes per module. */
export function ReportPage() {
  const { id = '' } = useParams();
  const { store, me } = useApp<Schema>();
  const view = useAsync(() => loadReport(store, me, id), [store, me.sub, id]);
  return (
    <div className="mx-auto max-w-[960px]">
      <DataState state={view} skeleton={<ReportSkeleton />}>
        {({ session, report, trend }) =>
          report ? (
            <Report session={session} report={report} trend={trend} />
          ) : (
            <>
              <PageHeader eyebrow={<Crumb />} title={session.title} />
              <EmptyState
                icon={<Hourglass />}
                title="The report is ready when you close the session"
                action={
                  <LinkButton to={`/host/${session.id}`} variant="primary">
                    Back to the pulse
                  </LinkButton>
                }
              >
                Final states are taken at the end of each module, and at close for the one still running.
              </EmptyState>
            </>
          )
        }
      </DataState>
    </div>
  );
}

function Crumb() {
  return (
    <LinkButton to="/sessions" variant="ghost" size="sm" icon={<ChevronLeft aria-hidden="true" />} className="-ml-2 text-muted">
      Sessions
    </LinkButton>
  );
}

function ReportSkeleton() {
  return (
    <div>
      <Skeleton width={90} height={12} />
      <Skeleton width="60%" height={28} className="mt-3" />
      <Skeleton height={86} className="mt-6 rounded-xl" />
      <Skeleton height={220} className="mt-8 rounded-xl" />
    </div>
  );
}

function Report({ session, report, trend }: { session: PulseSession; report: SessionReport; trend: SessionTrend | null }) {
  const ran = report.modules.filter((m) => m.ran);
  const top = report.ranking[0];
  const when = formatDateTime(session.closedAt);
  const duration = session.closedAt ? minutesBetween(session.createdAt, session.closedAt) : null;
  const answers = ran.reduce((s, m) => s + m.responses, 0);
  const topPct = top ? Math.round((top.confusionIndex ?? 0) * 100) : 0;

  return (
    <>
      <PageHeader
        eyebrow={<Crumb />}
        title={session.title}
        meta={
          <>
            <span>Closed {when}</span>
            <span className="font-mono text-fg/80">{session.code}</span>
            <span className="num">{formatDuration(duration)}</span>
          </>
        }
        actions={
          <>
            <CopyButton text={() => reportMarkdown(session, report, when)} label="Copy as Markdown" size="md" />
            <Button icon={<Printer aria-hidden="true" />} onClick={() => window.print()} className="x-noprint">
              Print
            </Button>
            <LinkButton to={`/host/${session.id}`} icon={<Activity aria-hidden="true" />} className="x-noprint">
              Pulse
            </LinkButton>
          </>
        }
      />

      <StatStrip columns={4}>
        <Stat label="Participants" value={report.participants} hint="Joined or checked in" />
        <Stat label="Modules run" value={<span className="num">{ran.length}<span className="text-lg text-muted"> / {report.modules.length}</span></span>} />
        <Stat label="Final answers" value={answers} hint="Across modules" />
        <Stat
          label="Most confusing"
          value={<span className="block max-w-full truncate text-xl" title={top?.name}>{top ? top.name : '—'}</span>}
          hint={top ? `${topPct}% lost at its end` : 'No check-ins'}
          tone={top && topPct >= ALERT_LOST_PERCENT ? 'bad' : undefined}
        />
      </StatStrip>

      <Section title="Confusion ranking" description={'Confusion index = share of responses that were "lost" at the end of the module. Highest first.'} className="mt-10">
        {report.ranking.length ? (
          <TableWrap label="Modules ranked by confusion index">
            <Table data-testid="confusion-ranking">
              <thead>
                <tr>
                  <Th numeric className="w-10">
                    Rank
                  </Th>
                  <Th>Module</Th>
                  <Th className="w-[28%] max-sm:hidden">Mix at end</Th>
                  <Th numeric>Confusion</Th>
                  <Th numeric className="max-md:hidden">Lost</Th>
                  <Th numeric className="max-md:hidden">Unsure</Th>
                  <Th numeric className="max-md:hidden">Got it</Th>
                  <Th numeric>Answers</Th>
                </tr>
              </thead>
              <tbody>
                {report.ranking.map((r, i) => {
                  const pct = Math.round((r.confusionIndex ?? 0) * 100);
                  const hot = pct >= ALERT_LOST_PERCENT;
                  return (
                    <Tr key={r.moduleId}>
                      <Td numeric muted>
                        {i + 1}
                      </Td>
                      <Td className="font-medium">{r.name}</Td>
                      <Td className="max-sm:hidden">
                        <MixBar counts={r.counts} label={r.name} />
                      </Td>
                      <Td numeric className={cx('text-base font-semibold', hot ? 'text-bad-text' : 'text-fg')}>
                        {formatIndex(r.confusionIndex)}
                      </Td>
                      <Td numeric className="max-md:hidden">{r.shares.lost}%</Td>
                      <Td numeric className="max-md:hidden">{r.shares.unsure}%</Td>
                      <Td numeric className="max-md:hidden">{r.shares.got_it}%</Td>
                      <Td numeric muted>
                        {r.responses}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState compact title="No module received check-ins">
            Nobody tapped during this session, so there is nothing to rank.
          </EmptyState>
        )}
      </Section>

      {trend && (
        <Section title="The session's heartbeat" description="Answers over time: thickness is the number of answers, colours the mix." className="mt-10">
          <div className="rounded-xl border border-line bg-surface px-4 pt-3 pb-3">
            <TrendChart trend={trend} label={`Answers over time across ${trend.segments.length} modules`} />
          </div>
        </Section>
      )}

      <Section title="Module by module" className="mt-10">
        <ol className="m-0 list-none border-y border-line p-0" data-testid="module-bars">
          {report.modules.map((m, i) => (
            <li key={m.moduleId} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 border-b border-line py-4 last:border-b-0">
              <span className="pt-0.5 font-mono text-xs text-faint num">{String(i + 1).padStart(2, '0')}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="m-0 text-sm font-semibold break-words">{m.name}</h3>
                  <span className="text-ui text-muted num">
                    {!m.ran ? 'Not run' : m.responses ? `${m.counts.lost} of ${m.responses} lost · ${formatIndex(m.confusionIndex)}` : 'No check-ins'}
                  </span>
                </div>
                {m.ran && m.responses > 0 && <MixBar counts={m.counts} label={`${m.name} at its end`} className="mt-2" height={6} />}
                {m.notes.length > 0 && (
                  <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0" aria-label={`${m.notes.length} ${m.notes.length === 1 ? 'note' : 'notes'}, unattributed`}>
                    {m.notes.map((n, k) => (
                      <li key={k} className="border-l-2 border-accent-6 pl-3 text-sm text-fg/90 break-words">
                        {n}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
        <p className="m-0 mt-3 text-xs text-muted">Notes are shown without names. Shares are taken at the end of each module.</p>
      </Section>
    </>
  );
}
