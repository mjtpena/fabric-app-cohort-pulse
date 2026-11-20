/**
 * Pulse: the facilitator console, drawn as the room's heartbeat. The home route for anyone who hosts a session.
 * Lenses re-encode the same totals (current module, all modules, trend); Today ranks what needs attention; the list
 * view is the accessible equivalent. View as "Room screen" hides notes and the console for screen sharing.
 */
import { lazy, Suspense, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, ChevronLeft, CloudOff, Keyboard, ListOrdered, MessageSquareText, MonitorUp, Pause, Plus, Presentation, UserRound, X } from 'lucide-react';

import { AppShell, useApp } from '@x10/shared/runtime';
import { formatDateTime, useAction, useAsync, useNow, usePolling } from '@x10/shared/lib';
import {
  Button,
  ConfirmDialog,
  CopyButton,
  cx,
  Dialog,
  Field,
  IconButton,
  InlineError,
  Input,
  Kbd,
  Legend,
  LensBar,
  LinkButton,
  Menu,
  Skeleton,
  Spinner,
  StageMessage,
  StagePage,
  StatusDot,
  Table,
  TableWrap,
  Td,
  Th,
  TodayPanel,
  Tr,
  ViewAsSwitch,
  ViewToggle,
  supportsWebGL,
  useHotkeys,
  useIsDesktop,
  useReducedMotion,
  type LegendItem,
  type StageView,
  type TodayItem,
  type Tone,
} from '@x10/shared/ui';

import { ACTIVE_WINDOW_MINUTES, ALERT_LOST_PERCENT, MAX_MODULES, POLL_MS } from '../config';
import { formatIndex, LEVEL_LABEL, type ModuleTotals } from '../domain/pulse';
import { addModule, closeSession, listHostedSessions, loadHostConsole, moveToModule, type HostConsoleView } from '../domain/sessions';
import type { StageFocus } from '../heartbeat/engine';
import { LANES, type LensKey } from '../heartbeat/geometry';
import { limits, type Schema } from '../model';
import { CheckInEntry } from './CheckInEntryPage';

const HeartbeatStage = lazy(() => import('../heartbeat/HeartbeatStage'));

/** The join link participants open (works in demo mode and on Fabric static hosting, which uses hash routes). */
export function joinLink(code: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/join/${code}`;
}

/* ------------------------------------------------------------------ routes */

/** `/`: the pulse of your latest session if you facilitate one, otherwise the attendee check-in. */
export function HomeRoute() {
  const { store, me } = useApp<Schema>();
  const hosted = useAsync(() => listHostedSessions(store, me), [store, me.sub]);
  if (hosted.data && hosted.data.length === 0) {
    return (
      <AppShell>
        <CheckInEntry />
      </AppShell>
    );
  }
  return (
    <AppShell immersive>
      {hosted.data ? (
        <PulseConsole sessionId={hosted.data[0].id} />
      ) : hosted.error ? (
        <StageShell message={<StageMessage icon={<CloudOff />} title="Could not load your sessions" action={<Button onClick={() => void hosted.reload()}>Retry</Button>}>{hosted.error.message}</StageMessage>} />
      ) : (
        <StageShell />
      )}
    </AppShell>
  );
}

/** `/host/:id`: the pulse of one session. */
export function HostRoute() {
  const { id = '' } = useParams();
  return (
    <AppShell immersive>
      <PulseConsole sessionId={id} />
    </AppShell>
  );
}

/** Loading and error frames that match the stage. */
function StageShell({ message }: { message?: ReactNode }) {
  return (
    <StagePage
      label="Room heartbeat"
      title={<Skeleton width={260} height={24} />}
      meta={<Skeleton width={180} height={14} />}
      stage={
        message ?? (
          <StageMessage icon={<Spinner small />} title="Finding the room's pulse">
            Reading the latest check-ins.
          </StageMessage>
        )
      }
    />
  );
}

function PulseConsole({ sessionId }: { sessionId: string }) {
  const { store, me } = useApp<Schema>();
  const view = useAsync(() => loadHostConsole(store, me, sessionId), [store, me.sub, sessionId]);
  usePolling(view.reload, POLL_MS, view.data?.session.status === 'open');
  if (!view.data) {
    if (view.error) {
      const denied = view.error.category === 'permission';
      return (
        <StageShell
          message={
            <StageMessage
              icon={<CloudOff />}
              title={denied ? 'This pulse belongs to another facilitator' : 'Could not read the room'}
              action={
                denied ? (
                  <LinkButton to="/checkin" variant="primary">
                    Go to check-in
                  </LinkButton>
                ) : (
                  <Button onClick={() => void view.reload()}>Retry</Button>
                )
              }
            >
              {view.error.message}
            </StageMessage>
          }
        />
      );
    }
    return <StageShell />;
  }
  return <Console key={view.data.session.id} view={view.data} reload={view.reload} error={view.error?.message ?? null} />;
}

/* ------------------------------------------------------------------ console */

type ViewAs = 'facilitator' | 'room';

interface TodayEntry extends TodayItem {
  lensKey: LensKey;
  focus: StageFocus | null;
}

const LENSES: { value: LensKey; label: string; swatch: string; description: string }[] = [
  { value: 'now', label: 'Current module', swatch: 'var(--bad-solid)', description: 'Each light is one current answer' },
  {
    value: 'modules',
    label: 'All modules',
    swatch: 'conic-gradient(var(--bad-solid) 0 33%, var(--warn-solid) 0 66%, var(--ok-solid) 0)',
    description: 'Totals per module, side by side',
  },
  { value: 'trend', label: 'Trend', swatch: 'linear-gradient(90deg, var(--ok-solid), var(--warn-solid), var(--bad-solid))', description: 'Answers over the session' },
];

const LANE_COLOR = { lost: 'var(--bad-solid)', unsure: 'var(--warn-solid)', got_it: 'var(--ok-solid)', none: 'var(--muted)' } as const;

function legendFor(lens: LensKey): LegendItem[] {
  const answers: LegendItem[] = [
    { label: 'Lost', color: LANE_COLOR.lost },
    { label: 'Unsure', color: LANE_COLOR.unsure },
    { label: 'Got it', color: LANE_COLOR.got_it },
  ];
  if (lens === 'trend') return [...answers.map((a) => ({ ...a, shape: 'square' as const })), { label: 'Module change', color: 'var(--muted)', shape: 'dash' }];
  if (lens === 'modules')
    return [...answers, { label: 'Running now', color: 'var(--accent-9)', shape: 'ring' }, { label: 'Not run yet', color: 'var(--muted)', shape: 'dash' }];
  return [...answers, { label: 'No answer yet', color: LANE_COLOR.none, shape: 'ring' }];
}

function buildToday(v: HostConsoleView): TodayEntry[] {
  const { session, current, gauge, alert, notes, byModule } = v;
  const out: TodayEntry[] = [];
  const open = session.status === 'open';
  if (open && !current) {
    out.push({
      id: 'start',
      title: 'Start the first module when the room is ready',
      severity: 'info',
      value: v.modules.length,
      unit: 'modules',
      lens: 'Current module',
      lensKey: 'now',
      focus: null,
    });
  }
  if (open && current) {
    const { counts, active, shares } = gauge;
    if (alert.kind === 'alert') {
      out.push({ id: 'alert', title: alert.message, severity: 'bad', value: `${shares.lost}%`, unit: 'lost', lens: 'Current module', meta: current.name, lensKey: 'now', focus: { kind: 'lane', lane: 'lost' } });
    } else if (alert.kind === 'waiting') {
      out.push({
        id: 'waiting',
        title: `Waiting for check-ins: the pause line needs ${alert.needed} active`,
        severity: 'info',
        value: active,
        unit: 'active',
        lens: 'Current module',
        lensKey: 'now',
        focus: { kind: 'lane', lane: 'none' },
      });
    } else if (counts.lost > 0) {
      out.push({
        id: 'lost',
        title: `${counts.lost} of ${active} are lost`,
        severity: 'warn',
        value: counts.lost,
        unit: `${shares.lost}%`,
        lens: 'Current module',
        meta: current.name,
        lensKey: 'now',
        focus: { kind: 'lane', lane: 'lost' },
      });
    }
    const cur = byModule.find((m) => m.state === 'current');
    const idx = byModule.findIndex((m) => m.state === 'current');
    const prev = [...byModule.slice(0, idx)].reverse().find((m) => m.state === 'done' && m.responses > 0);
    if (cur && prev && cur.confusionIndex !== null && prev.confusionIndex !== null) {
      const pts = Math.round((cur.confusionIndex - prev.confusionIndex) * 100);
      if (pts >= 10)
        out.push({ id: 'trend', title: `Confusion up since ${prev.name}`, severity: 'warn', value: `+${pts}`, unit: 'pts lost', lens: 'Trend', lensKey: 'trend', focus: null });
    }
    if (counts.none > 0 && alert.kind !== 'waiting') {
      out.push({
        id: 'none',
        title: `${counts.none} ${counts.none === 1 ? 'has' : 'have'} not answered yet`,
        severity: 'info',
        value: counts.none,
        unit: 'no answer',
        lens: 'Current module',
        meta: current.name,
        lensKey: 'now',
        focus: { kind: 'lane', lane: 'none' },
      });
    }
    if (notes.length) {
      out.push({ id: 'notes', title: `${notes.length} ${notes.length === 1 ? 'note' : 'notes'} on this module`, severity: 'info', value: notes.length, unit: notes.length === 1 ? 'note' : 'notes', lens: 'Current module', lensKey: 'now', focus: { kind: 'notes' } });
    }
  }
  const ranked = byModule.filter((m) => m.responses > 0 && m.confusionIndex !== null);
  if (ranked.length >= 2) {
    const top = [...ranked].sort((a, b) => b.confusionIndex! - a.confusionIndex! || a.sortOrder - b.sortOrder)[0];
    const pct = Math.round(top.confusionIndex! * 100);
    out.push({
      id: 'top',
      title: `${open ? 'Most confusing so far' : 'Most confusing'}: ${top.name}`,
      severity: (pct >= ALERT_LOST_PERCENT ? 'bad' : 'neutral') as Tone,
      value: `${pct}%`,
      unit: 'lost',
      lens: 'All modules',
      lensKey: 'modules',
      focus: { kind: 'module', id: top.moduleId },
    });
  }
  return out.slice(0, 5);
}

function Console({ view, reload, error }: { view: HostConsoleView; reload: () => Promise<void>; error: string | null }) {
  const { store, me } = useApp<Schema>();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const reduced = useReducedMotion();
  const { session, modules, current, prev, next, gauge, alert, notes } = view;
  const open = session.status === 'open';
  const [lens, setLens] = useState<LensKey>(open ? 'now' : 'modules');
  const [stageView, setStageView] = useState<StageView>('stage');
  const [focus, setFocus] = useState<StageFocus | null>(null);
  const [viewAs, setViewAs] = useState<ViewAs>('facilitator');
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [shortcuts, setShortcuts] = useState(false);
  const [closing, setClosing] = useState(false);
  const [adding, setAdding] = useState(false);
  const room = viewAs === 'room';
  const renderer = useMemo(() => (supportsWebGL() ? 'webgl' : 'css'), []);

  const move = useAction(async (targetId: string) => {
    try {
      await moveToModule(store, me, session.id, targetId);
      setFocus(null);
    } finally {
      await reload();
    }
  });

  const today = useMemo(() => buildToday(view), [view]);
  const activeToday = today.find((t) => t.focus && focus && JSON.stringify(t.focus) === JSON.stringify(focus))?.id ?? null;

  // The pause moment returns if more people get lost after it was dismissed.
  const showMoment =
    open && !room && alert.kind === 'alert' && lens === 'now' && focus?.kind !== 'notes' && (dismissedAt === null || gauge.counts.lost > dismissedAt);
  useEffect(() => {
    if (alert.kind !== 'alert') setDismissedAt(null);
  }, [alert.kind]);

  useHotkeys({
    'shift+?': () => setShortcuts(true),
    escape: () => setFocus(null),
    'shift+arrowright': () => open && !room && next && !move.pending && void move.run(next.id),
    'shift+arrowleft': () => open && !room && prev && !move.pending && void move.run(prev.id),
  });

  const pickToday = (it: TodayItem) => {
    const entry = today.find((t) => t.id === it.id);
    if (!entry) return;
    setStageView('stage');
    setLens(entry.lensKey);
    setFocus((f) => (entry.focus && JSON.stringify(f) === JSON.stringify(entry.focus) ? null : entry.focus));
  };

  const index = current ? modules.indexOf(current) : -1;
  const statusPill = open ? <StatusPill alert={alert} /> : null;

  const conductor = (
    <Conductor
      view={view}
      compact={!desktop}
      room={room}
      pending={move.pending}
      onMove={(id) => void move.run(id)}
      error={move.error?.message ?? null}
    />
  );

  const side = room ? undefined : desktop ? (
    <div className="flex flex-col gap-5">
      <TodayPanel bare items={today} date={current ? `Module ${index + 1} of ${modules.length}` : undefined} activeId={activeToday} onSelect={pickToday} empty="The room is steady." />
      <ConsoleExtras view={view} onAdd={() => setAdding(true)} onClose={() => setClosing(true)} />
    </div>
  ) : (
    <TodayPanel bare items={today} activeId={activeToday} onSelect={pickToday} empty="The room is steady." />
  );

  const stageOverlay = (
    <div className="pointer-events-none absolute inset-y-0 left-0 w-[calc(100%-var(--side-w,0px))]">
      {open && !current && (
        <EmptyRoom title="Ready when you are" code={session.code}>
          Start the first module, then each check-in lights up here.
        </EmptyRoom>
      )}
      {open && current && gauge.active === 0 && (
        <EmptyRoom title="No one is active yet" code={session.code}>
          Lights appear as people join and check in.
        </EmptyRoom>
      )}
      {showMoment && (
        <PauseMoment
          lost={gauge.counts.lost}
          active={gauge.active}
          onShow={() => setFocus({ kind: 'lane', lane: 'lost' })}
          onDismiss={() => setDismissedAt(gauge.counts.lost)}
        />
      )}
      {focus?.kind === 'notes' && !room && <NotesMoment notes={notes} module={current?.name ?? ''} onClose={() => setFocus(null)} />}
      {room && open && <JoinBeacon code={session.code} />}
      {desktop && <div className="pointer-events-auto absolute bottom-[68px] left-1/2 w-max max-w-[calc(100%-32px)] -translate-x-1/2">{conductor}</div>}
    </div>
  );

  return (
    <>
      <StagePage
        label="Room heartbeat"
        view={stageView}
        breadcrumb={[{ label: 'Sessions', to: '/sessions' }, { label: open ? 'Live pulse' : 'Closed' }]}
        title={session.title}
        meta={
          <>
            {open ? (
              <span className="inline-flex items-center gap-1.5">
                <StatusDot tone="ok" pulse={!reduced} size={7} />
                Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <StatusDot tone="neutral" size={7} />
                Closed {formatDateTime(session.closedAt)}
              </span>
            )}
            <span className="font-mono text-fg num" title="Join code">
              {session.code}
            </span>
            <span data-testid="active-count" className="num">
              {gauge.active} active
            </span>
            {statusPill}
            {error && <span className="text-bad-text">Refresh failed, retrying</span>}
          </>
        }
        topRight={
          <>
            {!open && (
              <LinkButton to={`/report/${session.id}`} variant="primary" size="sm">
                Session report
              </LinkButton>
            )}
            {desktop && (
              <IconButton label="Keyboard shortcuts (?)" icon={<Keyboard />} className={cx(stageView === 'stage' && 'x-glass rounded-full!')} onClick={() => setShortcuts(true)} />
            )}
            <ViewToggle value={stageView} onChange={setStageView} glass={stageView === 'stage'} stageLabel="Pulse" stageIcon={<PulseGlyph />} />
          </>
        }
        lenses={<LensBar lenses={LENSES} value={lens} onChange={(l) => (setLens(l), setFocus(null))} />}
        legend={<Legend title="Key" items={legendFor(lens)} collapsible defaultOpen={desktop} />}
        bottomRight={
          <ViewAsSwitch
            value={viewAs}
            onChange={(v) => (setViewAs(v), setFocus(null))}
            options={[
              { value: 'facilitator', label: 'Facilitator', icon: <UserRound /> },
              { value: 'room', label: 'Room', icon: <Presentation /> },
            ]}
          />
        }
        side={side}
        sideTitle="Today"
        sideCount={today.length}
        stage={
          <>
            <Suspense fallback={<StageMessage icon={<Spinner small />} title="Finding the room's pulse" />}>
              <HeartbeatStage
                lens={lens}
                focus={focus}
                onFocus={setFocus}
                counts={gauge.counts}
                shares={gauge.shares}
                active={current ? gauge.active : 0}
                alertKind={!current ? 'none' : alert.kind}
                alertPercent={ALERT_LOST_PERCENT}
                currentId={current?.id ?? null}
                byModule={view.byModule}
                trend={view.trend}
                renderer={renderer}
                reduced={reduced}
                compact={!desktop}
              />
            </Suspense>
            {stageOverlay}
          </>
        }
        list={<PulseList view={view} />}
      >
        {!desktop && (
          <div className="flex flex-col gap-6">
            {conductor}
            {!room && <ConsoleExtras view={view} onAdd={() => setAdding(true)} onClose={() => setClosing(true)} />}
          </div>
        )}
      </StagePage>

      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
      <AddModuleDialog open={adding} onClose={() => setAdding(false)} sessionId={session.id} onAdded={reload} />
      <ConfirmDialog
        open={closing}
        onClose={() => setClosing(false)}
        title="Close this session?"
        danger
        confirmLabel="Close session"
        body={
          <p className="m-0">
            Check-ins stop{current ? ` and the final states of "${current.name}" are taken now` : ''}. The session report ranks modules by
            confusion. This cannot be undone.
          </p>
        }
        onConfirm={async () => {
          await closeSession(store, me, session.id);
          navigate(`/report/${session.id}`);
        }}
      />
    </>
  );
}

function PulseGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12h4l2.5-6 4 13 3-9 1.5 2H22" />
    </svg>
  );
}

/* ------------------------------------------------------------------ status, conductor */

function StatusPill({ alert }: { alert: HostConsoleView['alert'] }) {
  const tone: Tone = alert.kind === 'alert' ? 'bad' : alert.kind === 'waiting' ? 'info' : 'ok';
  const text =
    alert.kind === 'alert'
      ? alert.message
      : alert.kind === 'waiting'
        ? `Waiting for ${alert.needed} active`
        : `Steady: ${alert.lost} of ${alert.active} are lost`;
  return (
    <span
      data-testid="alert-banner"
      data-kind={alert.kind}
      role="status"
      title={alert.message}
      className={cx('inline-flex items-center gap-1.5', alert.kind === 'alert' ? 'font-medium text-bad-text' : 'text-muted')}
    >
      <StatusDot tone={tone} size={7} pulse={alert.kind === 'alert'} />
      {text}
    </span>
  );
}

function Pips({ modules, currentId }: { modules: HostConsoleView['modules']; currentId: string | null }) {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      {modules.map((m) => {
        const cur = m.id === currentId;
        const done = !!m.endedAt && !cur;
        return (
          <span
            key={m.id}
            className={cx(
              'h-1.5 rounded-full transition-all duration-300 ease-standard',
              cur ? 'w-5 bg-accent-9' : done ? 'w-1.5 bg-gray-9' : 'w-1.5 bg-gray-5',
            )}
          />
        );
      })}
    </span>
  );
}

function Conductor({
  view,
  compact,
  room,
  pending,
  onMove,
  error,
}: {
  view: HostConsoleView;
  compact: boolean;
  room: boolean;
  pending: boolean;
  onMove: (id: string) => void;
  error: string | null;
}) {
  const { session, modules, current, prev, next } = view;
  const open = session.status === 'open';
  const index = current ? modules.indexOf(current) : -1;
  const caption = !open ? 'Session closed' : current ? `Module ${index + 1} of ${modules.length}` : `${modules.length} modules`;
  const name = !open ? 'Final states shown' : current ? current.name : 'Not started';

  const jump = (
    <Menu
      label="Jump to module"
      placement={compact ? 'top-start' : 'top-end'}
      width={280}
      trigger={<IconButton label="Jump to module" icon={<ListOrdered />} variant="ghost" size={compact ? 'lg' : 'md'} disabled={pending} />}
      items={modules.map((m, i) => ({
        label: `${i + 1}. ${m.name}`,
        description: m.id === current?.id ? 'Running now' : m.endedAt ? 'Done; reopening starts it fresh' : 'Not run yet',
        checked: m.id === current?.id,
        role: 'menuitemradio' as const,
        onSelect: () => m.id !== current?.id && onMove(m.id),
      }))}
    />
  );

  const nextButton = next ? (
    <Button
      variant="primary"
      size={compact ? 'lg' : 'md'}
      busy={pending}
      iconRight={<ArrowRight aria-hidden="true" />}
      aria-label={current ? `Next module: ${next.name}` : `Start first module: ${next.name}`}
      onClick={() => onMove(next.id)}
      className={cx(compact && 'min-w-0 flex-1')}
    >
      <span className="truncate">{current ? (compact ? 'Next module' : `Next: ${next.name}`) : 'Start first module'}</span>
    </Button>
  ) : null;

  const body = (
    <>
      <div className={cx('min-w-0', !compact && 'flex-1')}>
        <div className="flex items-center gap-2">
          <Pips modules={modules} currentId={current?.id ?? null} />
          <span className="x-legend-label text-muted">{caption}</span>
        </div>
        <div className={cx('mt-1 truncate font-semibold text-fg', compact ? 'text-lg' : 'max-w-[300px] text-sm')} data-testid="console-module">
          {name}
        </div>
      </div>
      {open && !room && (
        <div className={cx('flex items-center gap-1.5', compact && 'mt-3 w-full')}>
          {jump}
          <IconButton
            label={prev ? `Previous module: ${prev.name}` : 'Previous module'}
            icon={<ChevronLeft />}
            variant={compact ? 'secondary' : 'ghost'}
            size={compact ? 'lg' : 'md'}
            disabled={!prev || pending}
            onClick={() => prev && onMove(prev.id)}
          />
          {nextButton}
          {!next && current && <span className="px-2 text-ui text-muted">Last module</span>}
        </div>
      )}
      {!open && (
        <LinkButton to={`/report/${session.id}`} variant="primary" size={compact ? 'lg' : 'md'} className={cx(compact && 'mt-3 w-full')}>
          Session report
        </LinkButton>
      )}
    </>
  );

  if (compact)
    return (
      <section aria-label="Module" className="border-b border-line pb-5">
        <div className="flex flex-col items-stretch">{body}</div>
        <InlineError error={error} className="mt-2" />
      </section>
    );
  return (
    <section aria-label="Module" className="x-glass flex items-center gap-4 rounded-2xl py-2 pr-2 pl-4 shadow-[var(--shadow-float)]">
      {body}
      {error && <InlineError error={error} className="max-w-[220px]" />}
    </section>
  );
}

/* ------------------------------------------------------------------ side: notes, join, manage */

function SideHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 px-1">
      <h2 className="x-legend-label m-0 text-muted">{children}</h2>
      {action}
    </div>
  );
}

function ConsoleExtras({ view, onAdd, onClose }: { view: HostConsoleView; onAdd: () => void; onClose: () => void }) {
  const { session, notes, current, modules } = view;
  const open = session.status === 'open';
  return (
    <>
      {open && (
        <section className="border-t border-line pt-4">
          <SideHeading>Notes · unattributed</SideHeading>
          {notes.length ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0 px-1" data-testid="notes-list">
              {notes.map((n, i) => (
                <li key={`${i}-${n}`} className="flex gap-2.5 text-sm leading-5 text-fg">
                  <MessageSquareText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-faint" strokeWidth={1.75} />
                  <span className="min-w-0 break-words">{n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 px-1 text-ui text-muted">{current ? 'No notes on this module yet.' : 'Notes arrive with check-ins.'}</p>
          )}
        </section>
      )}
      {open && <JoinPanel code={session.code} />}
      {open && (
        <section className="flex flex-wrap gap-2 border-t border-line px-1 pt-4">
          {modules.length < MAX_MODULES && (
            <Button size="sm" icon={<Plus aria-hidden="true" />} onClick={onAdd}>
              Add module
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-bad-text" onClick={onClose}>
            Close session
          </Button>
        </section>
      )}
    </>
  );
}

function JoinPanel({ code }: { code: string }) {
  const link = joinLink(code);
  return (
    <section className="border-t border-line pt-4">
      <SideHeading>Join code</SideHeading>
      <div className="px-1">
        <div className="font-mono text-[34px] font-semibold leading-none tracking-[0.18em] text-fg" data-testid="join-code">
          {code}
        </div>
        <p className="m-0 mt-2 truncate font-mono text-xs text-muted" title={link}>
          {link}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <CopyButton text={link} label="Copy join link" />
          <CopyButton text={code} label="Copy code" variant="ghost" />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ stage moments */

function PauseMoment({ lost, active, onShow, onDismiss }: { lost: number; active: number; onShow: () => void; onDismiss: () => void }) {
  return (
    <div className="pointer-events-none absolute right-8 top-[24%] flex justify-end max-md:inset-x-0 max-md:top-auto max-md:right-auto max-md:bottom-16 max-md:justify-center max-md:px-4">
      <div role="alert" data-testid="alert-moment" className="x-glass pointer-events-auto flex w-full max-w-[380px] animate-x-in items-start gap-4 p-5 shadow-[var(--shadow-float)]">
        <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-bad-soft text-bad-text">
          <span aria-hidden="true" className="absolute inset-0 rounded-full ring-2 ring-[color-mix(in_oklab,var(--bad-solid)_40%,transparent)] motion-safe:animate-[cp-breathe_3.2s_ease-in-out_infinite]" />
          <Pause aria-hidden="true" className="size-5" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <div className="x-legend-label text-bad-text">Consider pausing</div>
          <div className="mt-1 text-xl font-semibold leading-7 text-fg num">
            {lost} of {active} are lost
          </div>
          <p className="m-0 mt-1 text-ui text-muted">A recap, an example or a quick question round may help.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={onShow}>
              Show the lost band
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Keep going
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotesMoment({ notes, module, onClose }: { notes: string[]; module: string; onClose: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div data-testid="notes-moment" className="x-glass pointer-events-auto relative w-full max-w-[460px] animate-x-in p-5 shadow-[var(--shadow-float)]">
        <span className="absolute right-2 top-2">
          <IconButton size="sm" label="Close notes" icon={<X />} onClick={onClose} />
        </span>
        <div className="x-legend-label text-muted">Notes · {module}</div>
        {notes.length ? (
          <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
            {notes.map((n, i) => (
              <li key={`${i}-${n}`} className="border-l-2 border-accent-7 pl-3 text-base leading-6 text-fg">
                {n}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 mt-3 text-sm text-muted">No notes on this module yet.</p>
        )}
        <p className="m-0 mt-4 text-xs text-muted">Shown without names, newest first.</p>
      </div>
    </div>
  );
}

function EmptyRoom({ title, code, children }: { title: string; code: string; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[30%] flex justify-center px-4 max-md:top-[18%]">
      <div className="x-glass pointer-events-auto max-w-sm p-5 text-center">
        <div className="text-base font-semibold">{title}</div>
        <p className="m-0 mt-1 text-sm text-muted">{children}</p>
        <div className="mt-3 font-mono text-2xl font-semibold tracking-[0.2em] text-fg">{code}</div>
      </div>
    </div>
  );
}

function JoinBeacon({ code }: { code: string }) {
  return (
    <div className="pointer-events-auto absolute right-4 top-16 max-md:top-3 max-md:right-3">
      <div className="x-glass flex items-center gap-4 px-5 py-4 max-md:px-3 max-md:py-2">
        <MonitorUp aria-hidden="true" className="size-5 text-brand-text max-md:hidden" strokeWidth={1.75} />
        <div>
          <div className="x-legend-label text-muted">Check in with code</div>
          <div className="font-mono text-4xl font-semibold leading-tight tracking-[0.2em] text-fg max-md:text-xl">{code}</div>
          <div className="text-xs text-muted">Lost, Unsure or Got it. Totals only, never names.</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ dialogs */

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: [ReactNode, string][] = [
    [<><Kbd>1</Kbd> <Kbd>2</Kbd> <Kbd>3</Kbd></>, 'Lens: current module, all modules, trend'],
    [<Kbd>L</Kbd>, 'Pulse or list view'],
    [<Kbd>V</Kbd>, 'View as facilitator or room screen'],
    [<><Kbd>Shift</Kbd> <Kbd>→</Kbd></>, 'Next module'],
    [<><Kbd>Shift</Kbd> <Kbd>←</Kbd></>, 'Previous module'],
    [<Kbd>Esc</Kbd>, 'Clear focus'],
    [<Kbd>?</Kbd>, 'This list'],
  ];
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3">
        {rows.map(([k, label], i) => (
          <div key={i} className="contents">
            <dt className="flex items-center gap-1">{k}</dt>
            <dd className="m-0 text-sm text-fg">{label}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

function AddModuleDialog({ open, onClose, sessionId, onAdded }: { open: boolean; onClose: () => void; sessionId: string; onAdded: () => Promise<void> }) {
  const { store, me } = useApp<Schema>();
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  useEffect(() => {
    if (open) {
      setName('');
      setErr(null);
    }
  }, [open]);
  const add = useAction(async () => {
    try {
      await addModule(store, me, sessionId, name);
      await onAdded();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a module"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={add.pending} onClick={() => void add.run()}>
            Add module
          </Button>
        </>
      }
    >
      <form
        id={`${id}-form`}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void add.run();
        }}
      >
        <Field label="Module name" htmlFor={id} error={err} counter={{ value: name.length, max: limits.moduleName.max }} className="mb-0">
          <Input id={id} value={name} onChange={(e) => setName(e.target.value)} invalid={!!err} placeholder="Bonus: live Q and A" autoFocus />
        </Field>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ list view */

function PulseList({ view }: { view: HostConsoleView }) {
  const { current, gauge, alert, notes, byModule, trend, session } = view;
  const now = useNow(30_000);
  const samples = useMemo(() => {
    if (!trend) return [];
    const n = Math.min(10, trend.samples.length);
    const pick: typeof trend.samples = [];
    for (let i = 0; i < n; i++) pick.push(trend.samples[Math.round((i * (trend.samples.length - 1)) / Math.max(1, n - 1))]);
    return pick;
  }, [trend]);
  const nameOf = (id: string) => byModule.find((m) => m.moduleId === id)?.name ?? '';
  return (
    <div className="flex flex-col gap-10" data-testid="pulse-list">
      {session.status === 'open' && (
        <section aria-labelledby="pl-now">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="pl-now" className="m-0 text-base font-semibold">
              {current ? `Current module: ${current.name}` : 'No module running yet'}
            </h2>
            <span className="text-ui text-muted">
              {gauge.active} active in the last {ACTIVE_WINDOW_MINUTES} minutes · {alert.message}
            </span>
          </div>
          <TableWrap label="Current answers">
            <Table>
              <thead>
                <tr>
                  <Th>Answer</Th>
                  <Th numeric>People</Th>
                  <Th numeric>Share</Th>
                </tr>
              </thead>
              <tbody>
                {LANES.map((l) => (
                  <Tr key={l}>
                    <Td>
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden="true" className={cx('size-2.5 rounded-full', l === 'none' && 'border border-[var(--muted)]')} style={{ background: l === 'none' ? 'transparent' : LANE_COLOR[l] }} />
                        {LEVEL_LABEL[l]}
                      </span>
                    </Td>
                    <Td numeric data-testid={`list-${l}`}>
                      {gauge.counts[l]}
                    </Td>
                    <Td numeric>{gauge.shares[l]}%</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </section>
      )}

      <section aria-labelledby="pl-mod">
        <h2 id="pl-mod" className="m-0 mb-3 text-base font-semibold">
          All modules
        </h2>
        <ModulesTable rows={byModule} />
      </section>

      {samples.length > 0 && (
        <section aria-labelledby="pl-trend">
          <h2 id="pl-trend" className="m-0 mb-3 text-base font-semibold">
            Trend over the session
          </h2>
          <TableWrap label="Answers over time">
            <Table density="compact">
              <thead>
                <tr>
                  <Th>Time</Th>
                  <Th>Module</Th>
                  <Th numeric>Lost</Th>
                  <Th numeric>Unsure</Th>
                  <Th numeric>Got it</Th>
                </tr>
              </thead>
              <tbody>
                {samples.map((s, i) => (
                  <Tr key={i}>
                    <Td className="num">{new Date(s.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Td>
                    <Td muted>{nameOf(s.moduleId)}</Td>
                    <Td numeric>{s.counts.lost}</Td>
                    <Td numeric>{s.counts.unsure}</Td>
                    <Td numeric>{s.counts.got_it}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </section>
      )}

      {session.status === 'open' && (
        <section aria-labelledby="pl-notes">
          <h2 id="pl-notes" className="m-0 mb-3 text-base font-semibold">
            Notes on this module
          </h2>
          {notes.length ? (
            <ul className="m-0 list-disc space-y-1.5 pl-5 text-sm">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-sm text-muted">No notes yet.</p>
          )}
        </section>
      )}
      <p className="m-0 text-xs text-muted">Totals only. Updated {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>
    </div>
  );
}

export function ModulesTable({ rows }: { rows: ModuleTotals[] }) {
  return (
    <TableWrap label="Totals per module">
      <Table>
        <thead>
          <tr>
            <Th numeric>#</Th>
            <Th>Module</Th>
            <Th>State</Th>
            <Th numeric>Lost</Th>
            <Th numeric>Unsure</Th>
            <Th numeric>Got it</Th>
            <Th numeric>Answers</Th>
            <Th numeric>Confusion</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <Tr key={m.moduleId}>
              <Td numeric muted>
                {i + 1}
              </Td>
              <Td className="font-medium">{m.name}</Td>
              <Td>
                <span className="inline-flex items-center gap-1.5 text-ui">
                  <StatusDot tone={m.state === 'current' ? 'brand' : m.state === 'done' ? 'neutral' : 'neutral'} size={7} />
                  {m.state === 'current' ? 'Running' : m.state === 'done' ? 'Done' : 'Not run'}
                </span>
              </Td>
              <Td numeric>{m.counts.lost}</Td>
              <Td numeric>{m.counts.unsure}</Td>
              <Td numeric>{m.counts.got_it}</Td>
              <Td numeric>{m.responses}</Td>
              <Td numeric className={cx(m.confusionIndex !== null && m.confusionIndex >= ALERT_LOST_PERCENT / 100 && 'text-bad-text font-semibold')}>
                {formatIndex(m.confusionIndex)}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
