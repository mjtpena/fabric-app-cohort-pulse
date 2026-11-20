import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { useAction } from '@x10/shared/lib';
import { Button, cx, Field, InlineError, Input, PageHeader, TextArea } from '@x10/shared/ui';

import { CODE_LENGTH, MAX_MODULES } from '../config';
import { parseModuleLines } from '../domain/pulse';
import { createSession, validateNewSession } from '../domain/sessions';
import { limits, type Schema } from '../model';

const EXAMPLE = ['Welcome and goals', 'Core concepts', 'Hands-on lab', 'Wrap-up and questions'].join('\n');

/** Plan a session: title and modules, with a live agenda preview. Creating it opens its pulse. */
export function NewSessionPage() {
  const { store, me } = useApp<Schema>();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [modulesText, setModulesText] = useState('');
  const [errors, setErrors] = useState<{ title?: string; modules?: string }>({});
  const titleId = useId();
  const modulesId = useId();
  const parsed = parseModuleLines(modulesText);

  const save = useAction(async () => {
    const e = validateNewSession({ title, modulesText });
    setErrors(e);
    if (e.title || e.modules) return;
    const session = await createSession(store, me, { title, modulesText });
    navigate(`/host/${session.id}`);
  });

  return (
    <div className="mx-auto max-w-[960px]">
      <PageHeader title="Plan a session" />
      <form
        noValidate
        className="grid gap-x-12 gap-y-8 md:grid-cols-[minmax(0,1fr)_300px]"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run();
        }}
      >
        <div className="min-w-0">
          <Field label="Session title" htmlFor={titleId} required error={errors.title} counter={{ value: title.length, max: limits.sessionTitle.max }}>
            <Input id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} invalid={!!errors.title} placeholder="Data modelling clinic: week 3" />
          </Field>
          <Field
            label="Modules, one per line"
            htmlFor={modulesId}
            required
            error={errors.modules}
            hint={`Up to ${MAX_MODULES}. You can add more from the pulse.`}
          >
            <TextArea
              id={modulesId}
              value={modulesText}
              onChange={(e) => setModulesText(e.target.value)}
              invalid={!!errors.modules}
              rows={7}
              placeholder={EXAMPLE}
              className="font-[inherit] leading-7"
            />
          </Field>
          <p className="m-0 text-ui text-muted" aria-live="polite">
            {parsed.names.length === 0
              ? 'No modules yet.'
              : `${parsed.names.length} module${parsed.names.length === 1 ? '' : 's'}: ${parsed.names.join(' → ')}`}
          </p>
          <InlineError error={save.error} className="mt-3" />

          <div className="sticky bottom-[var(--x-bottom-inset)] z-10 -mx-4 mt-6 flex gap-2 border-t border-line bg-[color-mix(in_oklab,var(--bg)_90%,transparent)] px-4 py-3 backdrop-blur-md md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
            <Button type="submit" variant="primary" busy={save.pending} iconRight={<ArrowRight aria-hidden="true" />} className="max-md:h-11 max-md:flex-1">
              Create session
            </Button>
            <Button onClick={() => navigate(-1)} className="max-md:h-11">
              Cancel
            </Button>
          </div>
        </div>

        <aside aria-label="Agenda preview" className="max-md:order-first max-md:hidden">
          <div className="x-legend-label text-muted">Agenda</div>
          <ol className="m-0 mt-3 list-none p-0">
            {(parsed.names.length ? parsed.names : EXAMPLE.split('\n')).slice(0, MAX_MODULES).map((n, i, all) => (
              <li key={`${i}-${n}`} className="relative flex gap-3 pb-4 last:pb-0">
                {i < all.length - 1 && <span aria-hidden="true" className="absolute left-[9px] top-5 bottom-0 w-px bg-line-strong" />}
                <span
                  className={cx(
                    'relative grid size-[19px] shrink-0 place-items-center rounded-full font-mono text-[10px] num',
                    parsed.names.length ? (i === 0 ? 'bg-accent-9 text-accent-contrast' : 'border border-line-strong bg-surface text-muted') : 'border border-dashed border-line-strong text-faint',
                  )}
                >
                  {i + 1}
                </span>
                <span className={cx('min-w-0 break-words text-sm leading-5', parsed.names.length ? 'text-fg' : 'text-faint')}>{n}</span>
              </li>
            ))}
          </ol>
          <p className="m-0 mt-6 border-t border-line pt-4 text-ui text-muted">
            A {CODE_LENGTH}-character join code is made when you create the session. The first module starts when you press Start.
          </p>
        </aside>
      </form>
    </div>
  );
}
