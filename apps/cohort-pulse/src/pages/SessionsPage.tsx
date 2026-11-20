import { Link } from 'react-router-dom';
import { ArrowRight, CalendarPlus, FileBarChart2, Plus } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { formatDateTime, useAsync } from '@x10/shared/lib';
import { DataState, EmptyState, LinkButton, PageHeader, Skeleton, StatusDot } from '@x10/shared/ui';

import { listHostedSessions } from '../domain/sessions';
import type { PulseSession, Schema } from '../model';

/** Sessions you facilitate: live ones open the pulse, closed ones open their session report. */
export function SessionsPage() {
  const { store, me } = useApp<Schema>();
  const sessions = useAsync(() => listHostedSessions(store, me), [store, me.sub]);
  const live = sessions.data?.filter((s) => s.status === 'open') ?? [];
  const closed = sessions.data?.filter((s) => s.status === 'closed') ?? [];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Sessions"
        meta={sessions.data ? <span className="num">{live.length} live · {closed.length} closed</span> : undefined}
        actions={
          <LinkButton to="/new" variant="primary" icon={<Plus aria-hidden="true" />}>
            New session
          </LinkButton>
        }
      />
      <DataState
        state={sessions}
        isEmpty={(d) => d.length === 0}
        skeleton={<SessionsSkeleton />}
        empty={
          <EmptyState icon={<CalendarPlus />} title="No sessions yet" action={<LinkButton to="/new" variant="primary">Plan a session</LinkButton>}>
            List your modules, share the join code, and watch the room&apos;s pulse as you teach.
          </EmptyState>
        }
      >
        {() => (
          <div data-testid="hosted-sessions" className="flex flex-col gap-8">
            {live.length > 0 && <Group title="Live" rows={live} />}
            {closed.length > 0 && <Group title="Closed" rows={closed} />}
          </div>
        )}
      </DataState>
    </div>
  );
}

function Group({ title, rows }: { title: string; rows: PulseSession[] }) {
  return (
    <section aria-label={title}>
      <h2 className="x-legend-label m-0 mb-1 text-muted">{title}</h2>
      <ul className="m-0 list-none divide-y divide-[var(--line)] border-y border-line p-0">
        {rows.map((s) => (
          <Row key={s.id} s={s} />
        ))}
      </ul>
    </section>
  );
}

function Row({ s }: { s: PulseSession }) {
  const open = s.status === 'open';
  const to = open ? `/host/${s.id}` : `/report/${s.id}`;
  return (
    <li className="group relative flex flex-wrap items-center gap-x-4 gap-y-2 py-4 transition-colors">
      <div className="min-w-0 flex-1 basis-60">
        <div className="flex items-center gap-2">
          <StatusDot tone={open ? 'ok' : 'neutral'} size={8} pulse={open} label={open ? 'Live' : 'Closed'} />
          <Link to={to} className="min-w-0 truncate text-sm font-semibold text-fg no-underline hover:text-brand-text" tabIndex={-1} aria-hidden="true">
            {s.title}
          </Link>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 pl-4 text-ui text-muted">
          <span className="font-mono text-fg/80">{s.code}</span>
          <span aria-hidden="true">·</span>
          <span className="num">{open ? `started ${formatDateTime(s.createdAt)}` : `closed ${formatDateTime(s.closedAt)}`}</span>
        </div>
      </div>
      {open ? (
        <LinkButton to={to} variant="primary" iconRight={<ArrowRight aria-hidden="true" />} aria-label={`Open pulse for ${s.title}`} className="max-sm:w-full">
          Open pulse
        </LinkButton>
      ) : (
        <LinkButton to={to} icon={<FileBarChart2 aria-hidden="true" />} aria-label={`Session report for ${s.title}`} className="max-sm:w-full">
          Session report
        </LinkButton>
      )}
    </li>
  );
}

function SessionsSkeleton() {
  return (
    <div className="border-y border-line">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-4 border-b border-line py-4 last:border-b-0">
          <div className="flex-1">
            <Skeleton width="55%" height={14} />
            <Skeleton width="30%" height={12} className="mt-2" />
          </div>
          <Skeleton width={120} height={32} />
        </div>
      ))}
    </div>
  );
}
