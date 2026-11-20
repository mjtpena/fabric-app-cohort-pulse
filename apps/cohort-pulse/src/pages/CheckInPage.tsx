import { useCallback, useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { useParams } from 'react-router-dom';
import { CircleSlash, DoorClosed, Hourglass, KeyRound, Presentation } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { useAction, useAsync, useNow, usePolling } from '@x10/shared/lib';
import { cx, EmptyState, Field, InlineError, LinkButton, Skeleton, StatusDot, TextArea, Toast, useReducedMotion } from '@x10/shared/ui';

import { LEVEL_HINT, LEVEL_TONE, LevelIcon, LevelTag, PrivacyLine } from '../components/levels';
import { POLL_MS } from '../config';
import { agoShort, LEVEL_LABEL, validateNote } from '../domain/pulse';
import { checkIn, loadParticipantView, type ParticipantView } from '../domain/sessions';
import { LEVELS, limits, type Level, type PulseModule, type PulseSession, type Schema } from '../model';

/** Check-in (attendee): the current module, three big tactile buttons, "you said", and an optional note. Polls. */
export function CheckInPage() {
  const { code = '' } = useParams();
  const { store, me } = useApp<Schema>();
  const joined = useRef(false);
  const view = useAsync(async () => {
    const v = await loadParticipantView(store, me, code, { join: !joined.current });
    joined.current = true;
    return v;
  }, [store, me.sub, code]);
  usePolling(view.reload, POLL_MS, view.data?.kind === 'ready');

  if (!view.data) {
    if (view.error)
      return (
        <EmptyState
          icon={<CircleSlash />}
          title="Could not reach the session"
          action={
            <button type="button" className="font-medium text-brand-text" onClick={() => void view.reload()}>
              Retry
            </button>
          }
        >
          {view.error.message}
        </EmptyState>
      );
    return <CheckInSkeleton />;
  }
  return <ParticipantBody view={view.data} reload={view.reload} />;
}

function CheckInSkeleton() {
  return (
    <div className="mx-auto max-w-3xl" role="status" aria-label="Loading">
      <Skeleton width={200} height={12} />
      <Skeleton width="70%" height={32} className="mt-4" />
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={120} className="rounded-[22px]" />
        ))}
      </div>
    </div>
  );
}

function ParticipantBody({ view, reload }: { view: ParticipantView; reload: () => Promise<void> }) {
  switch (view.kind) {
    case 'invalid':
      return (
        <EmptyState icon={<KeyRound />} title="That code does not look right" action={<LinkButton to="/checkin" variant="primary">Try another code</LinkButton>}>
          {view.message}
        </EmptyState>
      );
    case 'unknown':
      return (
        <EmptyState icon={<KeyRound />} title={`No session uses the code ${view.code}`} action={<LinkButton to="/checkin" variant="primary">Try another code</LinkButton>}>
          Check the code with your facilitator. Codes are not case-sensitive.
        </EmptyState>
      );
    case 'closed':
      return (
        <EmptyState icon={<DoorClosed />} title="This session has ended" action={<LinkButton to="/checkin">Back to check-in</LinkButton>}>
          {view.session.title} is closed, so check-ins are off. Thank you for taking part.
        </EmptyState>
      );
    case 'host':
      return (
        <EmptyState icon={<Presentation />} title="You are the facilitator of this session" action={<LinkButton to={`/host/${view.session.id}`} variant="primary">Open the pulse</LinkButton>}>
          Facilitators do not check in to their own session. Share the code {view.session.code}.
        </EmptyState>
      );
    case 'ready':
      return <ParticipantScreen session={view.session} module={view.module} mine={view.mine} reload={reload} />;
  }
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

function ParticipantScreen({
  session,
  module,
  mine,
  reload,
}: {
  session: PulseSession;
  module: PulseModule | null;
  mine: Extract<ParticipantView, { kind: 'ready' }>['mine'];
  reload: () => Promise<void>;
}) {
  const { store, me } = useApp<Schema>();
  const now = useNow(15_000);
  const reduced = useReducedMotion();
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Level | null>(null);
  const [risen, setRisen] = useState<{ id: number; level: Level } | null>(null);
  const [ripples, setRipples] = useState<Record<Level, Ripple[]>>({ lost: [], unsure: [], got_it: [] });
  const clearToast = useCallback(() => setToast(null), []);
  const noteId = useId();
  const seq = useRef(0);

  const send = useAction(async (level: Level) => {
    if (!module) return;
    const msg = validateNote(note);
    setNoteError(msg);
    if (msg) return;
    setOptimistic(level);
    try {
      await checkIn(store, me, { sessionId: session.id, moduleId: module.id, level, note });
      setNote('');
      setToast(`Thanks. You said ${LEVEL_LABEL[level]}.`);
      if (!reduced) setRisen({ id: ++seq.current, level });
    } finally {
      await reload();
      setOptimistic(null);
    }
  });

  const press = (level: Level, e: PointerEvent<HTMLButtonElement>) => {
    if (reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    const rp = { id: ++seq.current, x: e.clientX - r.left, y: e.clientY - r.top };
    setRipples((s) => ({ ...s, [level]: [...s[level], rp] }));
    setTimeout(() => setRipples((s) => ({ ...s, [level]: s[level].filter((x) => x.id !== rp.id) })), 700);
    navigator.vibrate?.(12);
  };

  const shown = optimistic ?? mine?.level ?? null;

  return (
    <div className="mx-auto max-w-3xl pb-4">
      <header className="mb-7 md:mb-9">
        <p className="x-legend-label m-0 truncate text-muted">{session.title}</p>
        {module ? (
          <>
            <p className="m-0 mt-4 flex items-center gap-2 text-ui text-muted">
              <StatusDot tone="ok" pulse={!reduced} size={7} />
              Now teaching
            </p>
            <h1 className="m-0 mt-1 text-[28px] font-semibold leading-9 tracking-[-0.02em] break-words md:text-4xl md:leading-[44px]" data-testid="current-module">
              {module.name}
            </h1>
            <p className="m-0 mt-1 text-ui text-muted">with {session.hostName}</p>
          </>
        ) : (
          <div className="mt-8 flex flex-col items-center text-center">
            <span aria-hidden="true" className="cp-wait grid size-20 place-items-center rounded-full text-brand-text">
              <Hourglass className="size-7" strokeWidth={1.5} />
            </span>
            <h1 className="m-0 mt-5 text-2xl font-semibold" data-testid="current-module">
              Waiting for the first module
            </h1>
            <p className="m-0 mt-1 text-sm text-muted">Your facilitator has not started yet. This screen updates by itself.</p>
          </div>
        )}
      </header>

      {module && (
        <>
          <h2 className="m-0 mb-3 text-base font-medium text-muted">How are you doing with this module?</h2>
          <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Your answer">
            {LEVELS.map((level) => {
              const pressed = shown === level;
              const t = LEVEL_TONE[level];
              return (
                <button
                  key={level}
                  type="button"
                  aria-pressed={pressed}
                  disabled={send.pending}
                  onPointerDown={(e) => press(level, e)}
                  onClick={() => void send.run(level)}
                  className={cx('cp-tap group', pressed && 'is-on')}
                  style={{ '--tone': t.solid, '--tone-soft': t.soft, '--tone-text': t.text } as CSSProperties}
                >
                  {ripples[level].map((r) => (
                    <span key={r.id} aria-hidden="true" className="cp-ripple" style={{ left: r.x, top: r.y }} />
                  ))}
                  <span aria-hidden="true" className={cx('cp-orb relative grid size-12 shrink-0 place-items-center rounded-full sm:size-16', pressed && 'is-lit')}>
                    <LevelIcon level={level} className="relative size-6 sm:size-8" />
                    {risen?.level === level && <span key={risen.id} className="cp-rise" />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col items-start sm:items-center">
                    <span className="text-xl font-semibold leading-7 text-fg sm:text-2xl">{LEVEL_LABEL[level]}</span>
                    <span className="text-ui text-muted">{LEVEL_HINT[level]}</span>
                  </span>
                  <span aria-hidden="true" className={cx('cp-check text-xs font-medium', !pressed && 'opacity-0')}>
                    Your answer
                  </span>
                </button>
              );
            })}
          </div>
          <p className="m-0 mt-4 min-h-6 text-base" data-testid="you-said" aria-live="polite">
            {mine ? (
              <>
                You said: <LevelTag level={mine.level} />, {agoShort(mine.createdAt, now)}. <span className="text-muted">Tap again whenever that changes.</span>
              </>
            ) : (
              <span className="text-muted">You have not answered for this module yet.</span>
            )}
          </p>
          <InlineError error={send.error} />
          <div className="mt-6 border-t border-line pt-5">
            <Field
              label="Optional note for your facilitator"
              htmlFor={noteId}
              error={noteError}
              hint="Sent with your next tap, without your name."
              counter={{ value: note.length, max: limits.note.max }}
            >
              <TextArea
                id={noteId}
                rows={2}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  if (noteError) setNoteError(null);
                }}
                invalid={!!noteError}
                placeholder="A question, an example that would help, a slower pace…"
              />
            </Field>
          </div>
        </>
      )}
      <PrivacyLine className="mt-4" />
      <Toast message={toast} onDone={clearToast} />
    </div>
  );
}
