import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronRight } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { useAsync } from '@x10/shared/lib';
import { Button, cx, Skeleton } from '@x10/shared/ui';

import { LEVEL_TONE, PrivacyLine } from '../components/levels';
import { CODE_LENGTH } from '../config';
import { normalizeCode, validateCode } from '../domain/pulse';
import { listJoinedSessions } from '../domain/sessions';
import type { Schema } from '../model';

/** Check-in: join a session with its code. The home screen for anyone who does not facilitate. */
export function CheckInEntry() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const clean = normalizeCode(code);
  return (
    <div className="mx-auto flex max-w-[480px] flex-col pt-2 md:pt-12">
      <div className="mb-6 flex items-center gap-2.5" aria-hidden="true">
        {(['lost', 'unsure', 'got_it'] as const).map((l) => (
          <span
            key={l}
            className="size-2.5 rounded-full"
            style={{ background: LEVEL_TONE[l].solid, boxShadow: `0 0 10px 1px color-mix(in oklab, ${LEVEL_TONE[l].solid} 55%, transparent)` }}
          />
        ))}
      </div>
      <p className="x-legend-label m-0 text-brand-text">Check-in</p>
      <h1 className="m-0 mt-1 text-2xl font-semibold md:text-[32px] md:leading-10">Join your session</h1>

      <form
        noValidate
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          const msg = validateCode(code);
          setError(msg);
          if (!msg) navigate(`/join/${normalizeCode(code)}`);
        }}
      >
        <label htmlFor={id} className="mb-2 block text-ui font-medium text-muted">
          Join code
        </label>
        <div className="relative">
          <input
            id={id}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              if (error) setError(null);
            }}
            aria-invalid={!!error || undefined}
            aria-describedby={`${id}-msg`}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={9}
            inputMode="text"
            placeholder={'·'.repeat(CODE_LENGTH)}
            className={cx(
              'h-16 w-full rounded-2xl border bg-surface px-5 text-center font-mono text-[28px] font-semibold uppercase tracking-[0.42em] text-fg shadow-xs outline-none transition-[border-color,box-shadow] duration-150 ease-standard placeholder:text-gray-7',
              'focus:border-accent-8 focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent-9)_18%,transparent)]',
              error ? 'border-bad-solid' : 'border-line-strong',
            )}
          />
          <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-[11px] text-faint num">
            {Math.min(clean.length, CODE_LENGTH)}/{CODE_LENGTH}
          </span>
        </div>
        <p id={`${id}-msg`} className={cx('m-0 mt-2 min-h-5 text-ui', error ? 'text-bad-text' : 'text-muted')} role={error ? 'alert' : undefined}>
          {error ?? 'Six letters and digits, from your facilitator.'}
        </p>
        <Button type="submit" variant="primary" size="lg" className="mt-4 w-full" iconRight={<ArrowRight aria-hidden="true" />}>
          Join
        </Button>
      </form>

      <PrivacyLine className="mt-5" />
      <Rejoin />

      <p className="m-0 mt-10 border-t border-line pt-4 text-ui text-muted">
        Facilitating?{' '}
        <Link to="/new" className="font-medium text-brand-text">
          Plan a session
        </Link>
      </p>
    </div>
  );
}

function Rejoin() {
  const { store, me } = useApp<Schema>();
  const joined = useAsync(() => listJoinedSessions(store, me), [store, me.sub]);
  if (joined.loading)
    return (
      <div className="mt-10" aria-hidden="true">
        <Skeleton width={140} height={12} />
        <Skeleton height={44} className="mt-3" />
      </div>
    );
  if (!joined.data?.length) return null;
  return (
    <section className="mt-10" aria-labelledby="rejoin-h">
      <h2 id="rejoin-h" className="x-legend-label m-0 text-muted">
        Sessions you joined
      </h2>
      <ul className="m-0 mt-2 list-none divide-y divide-[var(--line)] p-0">
        {joined.data.map((s) => (
          <li key={s.id}>
            <Link
              to={`/join/${s.code}`}
              aria-label={`Rejoin ${s.title}`}
              className="group -mx-2 flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 text-fg no-underline transition-colors hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{s.title}</span>
                <span className="block font-mono text-xs text-muted">{s.code}</span>
              </span>
              <span className="text-ui font-medium text-brand-text">Rejoin</span>
              <ChevronRight aria-hidden="true" className="size-4 text-faint transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
