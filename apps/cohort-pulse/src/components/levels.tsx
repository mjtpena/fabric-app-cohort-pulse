import type { CSSProperties, ReactNode } from 'react';

import { cx } from '@x10/shared/ui';

import { LEVEL_LABEL } from '../domain/pulse';
import type { Level } from '../model';

type Key = Level | 'none';

/** Status colour tokens per level: solid (lights, bars), soft (fills), text (labels). */
export const LEVEL_TONE: Record<Key, { solid: string; soft: string; text: string }> = {
  lost: { solid: 'var(--bad-solid)', soft: 'var(--bad-soft)', text: 'var(--bad-text)' },
  unsure: { solid: 'var(--warn-solid)', soft: 'var(--warn-soft)', text: 'var(--warn-text)' },
  got_it: { solid: 'var(--ok-solid)', soft: 'var(--ok-soft)', text: 'var(--ok-text)' },
  none: { solid: 'var(--gray-8)', soft: 'var(--gray-3)', text: 'var(--muted)' },
};

/** One short line under each answer button. */
export const LEVEL_HINT: Record<Level, string> = {
  lost: 'I need a recap',
  unsure: 'Partly there',
  got_it: 'Ready to move on',
};

const iconProps = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Line glyphs: a question mark (lost), a level line (unsure), a tick (got it), a dash (no answer). */
export function LevelIcon({ level, className }: { level: Key; className?: string }) {
  const body: Record<Key, ReactNode> = {
    lost: (
      <>
        <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </>
    ),
    unsure: (
      <>
        <path d="M7 12c1.5-1.5 3.5-1.5 5 0s3.5 1.5 5 0" />
      </>
    ),
    got_it: <path d="m7 12.5 3.2 3.2L17 9" />,
    none: <path d="M8 12h8" />,
  };
  return (
    <svg {...iconProps} className={className}>
      {body[level]}
    </svg>
  );
}

export function LockIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/** A glowing orb in the level's colour, with its glyph: the light that stands for one answer. */
export function LevelOrb({ level, size = 40, lit = true, className }: { level: Key; size?: number; lit?: boolean; className?: string }) {
  const t = LEVEL_TONE[level];
  return (
    <span
      aria-hidden="true"
      className={cx('cp-orb relative inline-grid shrink-0 place-items-center rounded-full', lit && 'is-lit', className)}
      style={{ width: size, height: size, '--tone': t.solid, '--tone-soft': t.soft, '--tone-text': t.text } as CSSProperties}
    >
      <LevelIcon level={level} className="relative size-[55%]" />
    </span>
  );
}

/** Small "Lost" / "Unsure" / "Got it" label with a dot, for inline text. */
export function LevelTag({ level }: { level: Level }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: LEVEL_TONE[level].text }}>
      <span aria-hidden="true" className="inline-block size-2 rounded-full" style={{ background: LEVEL_TONE[level].solid }} />
      {LEVEL_LABEL[level]}
    </span>
  );
}

/** Lost / Unsure / Got it shares as one hairline-separated bar, with a text equivalent for screen readers. */
export function MixBar({
  counts,
  label,
  className,
  height = 8,
}: {
  counts: { lost: number; unsure: number; got_it: number };
  label: string;
  className?: string;
  height?: number;
}) {
  const total = counts.lost + counts.unsure + counts.got_it;
  const parts: Level[] = ['lost', 'unsure', 'got_it'];
  return (
    <span
      role="img"
      aria-label={total ? `${label}: ${parts.map((p) => `${LEVEL_LABEL[p]} ${counts[p]}`).join(', ')}` : `${label}: no answers`}
      className={cx('flex w-full gap-[2px] overflow-hidden rounded-full bg-gray-3', className)}
      style={{ height }}
    >
      {total > 0 &&
        parts.map((p) =>
          counts[p] ? <span key={p} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(counts[p] / total) * 100}%`, background: LEVEL_TONE[p].solid }} /> : null,
        )}
    </span>
  );
}

/** The privacy promise, shown on the check-in screens. */
export function PrivacyLine({ className }: { className?: string }) {
  return (
    <p className={cx('m-0 flex items-center gap-2 text-ui text-muted', className)} data-testid="privacy-line">
      <LockIcon className="size-4 shrink-0 text-brand-text" />
      This app shows your facilitator totals, not names.
    </p>
  );
}
