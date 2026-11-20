/**
 * The room's heartbeat (lazy chunk): the WebGL room light, the canvas of lights and the pulse line, and crisp DOM
 * labels laid over them. Every number drawn is a total; nothing here knows who answered.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { cssVar, cx, useThemeColors } from '@x10/shared/ui';

import { LEVEL_LABEL, type LevelCounts, type ModuleTotals, type SessionTrend } from '../domain/pulse';
import { HeartbeatEngine, type EnginePalette, type StageFocus } from './engine';
import {
  bandSpan,
  LANES,
  moduleLights,
  nowLights,
  rhythmFor,
  rhythmWords,
  shareX,
  stageLayout,
  trendGeometry,
  trendLights,
  type Lane,
  type LensKey,
  type StageLayout,
} from './geometry';
import { parseColor, toCss, type RGB } from './roomLight';

export interface HeartbeatStageProps {
  lens: LensKey;
  focus: StageFocus | null;
  onFocus: (f: StageFocus | null) => void;
  /** Current module totals among active participants (zeros before the first module). */
  counts: LevelCounts;
  shares: LevelCounts;
  active: number;
  alertKind: 'alert' | 'calm' | 'waiting' | 'none';
  alertPercent: number;
  currentId: string | null;
  byModule: ModuleTotals[];
  trend: SessionTrend | null;
  /** 'webgl' draws the room light with a shader; 'css' uses gradients (no WebGL, or `?nowebgl`). */
  renderer: 'webgl' | 'css';
  reduced: boolean;
  compact: boolean;
}

const LANE_SHORT: Record<Lane, string> = { lost: 'Lost', unsure: 'Unsure', got_it: 'Got it', none: 'No answer yet' };
const LANE_TEXT: Record<Lane, string> = { lost: 'text-bad-text', unsure: 'text-warn-text', got_it: 'text-ok-text', none: 'text-muted' };

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function usePalette(): EnginePalette {
  const c = useThemeColors();
  return useMemo(() => {
    const v = (n: string, fb: RGB) => parseColor(cssVar(n), fb);
    const dark = c.dark;
    const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const sky = parseColor(c.world.sky, dark ? [0.07, 0.08, 0.1] : [0.93, 0.95, 0.96]);
    const sky2 = parseColor(c.world['sky-2'], dark ? [0.09, 0.1, 0.12] : [0.97, 0.96, 0.93]);
    const coral2 = v('--coral-2', [0.99, 0.97, 0.97]);
    return {
      dark,
      lane: {
        lost: parseColor(c.bad, [0.9, 0.28, 0.3]),
        unsure: parseColor(c.warn, [1, 0.77, 0.24]),
        got_it: parseColor(c.ok, [0.19, 0.64, 0.42]),
        none: parseColor(c.muted, [0.5, 0.5, 0.5]),
      },
      laneInk: {
        lost: v('--bad-text', [0.7, 0.15, 0.2]),
        unsure: v('--warn-text', [0.55, 0.38, 0]),
        got_it: v('--ok-text', [0.1, 0.45, 0.25]),
        none: parseColor(c.muted, [0.5, 0.5, 0.5]),
      },
      accent: parseColor(c.accent[9] ?? '', [0.93, 0.43, 0.41]),
      bad: parseColor(c.bad, [0.9, 0.28, 0.3]),
      muted: parseColor(c.muted, [0.5, 0.5, 0.5]),
      grid: dark ? [1, 1, 1] : [0.24, 0.2, 0.14],
      gridAlpha: dark ? 0.05 : 0.06,
      light: dark
        ? {
            top: lerp(sky2, v('--coral-2', [0.1, 0.09, 0.09]), 0.6),
            bottom: lerp(sky, [0.04, 0.05, 0.07], 0.4),
            calm: v('--coral-5', [0.28, 0.16, 0.16]),
            alert: lerp(v('--red-5', [0.33, 0.12, 0.13]), v('--coral-6', [0.34, 0.2, 0.19]), 0.3),
            cool: v('--indigo-4', [0.1, 0.12, 0.25]),
          }
        : {
            top: lerp(sky2, coral2, 0.55),
            bottom: lerp(sky, [1, 1, 1], 0.15),
            calm: v('--coral-6', [0.94, 0.8, 0.79]),
            alert: lerp(v('--red-6', [0.96, 0.75, 0.74]), v('--coral-7', [0.91, 0.72, 0.71]), 0.4),
            cool: v('--indigo-3', [0.91, 0.93, 0.99]),
          },
    };
  }, [c]);
}

export default function HeartbeatStage(props: HeartbeatStageProps) {
  const { lens, focus, onFocus, counts, shares, active, alertKind, currentId, byModule, trend, reduced, compact } = props;
  const outerRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lightRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<HeartbeatEngine | null>(null);
  const [renderer, setRenderer] = useState(props.renderer);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const palette = usePalette();

  useEffect(() => setRenderer(props.renderer), [props.renderer]);

  // Engine lifetime.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new HeartbeatEngine(canvas, renderer === 'webgl' ? lightRef.current : null, () => setRenderer('css'));
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [renderer]);

  // Size.
  useLayoutEffect(() => {
    const area = areaRef.current;
    const outer = outerRef.current;
    if (!area || !outer) return;
    const measure = () => {
      const r = area.getBoundingClientRect();
      const o = outer.getBoundingClientRect();
      setSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
      engineRef.current?.resize(r.width, r.height, o.width, o.height);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(area);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [renderer]);

  const layout = useMemo(() => stageLayout(size.w, size.h, compact), [size.w, size.h, compact]);
  const trendLayout = useMemo<StageLayout>(
    () =>
      compact
        ? { ...layout, plot: { ...layout.plot, x0: layout.labelX + 4, x1: layout.plot.x1 - 22 }, header: { ...layout.header, x0: layout.labelX + 4 } }
        : { ...layout, plot: { ...layout.plot, x1: layout.plot.x1 - 92 } },
    [layout, compact],
  );
  const stream = useMemo(() => trendGeometry(trendLayout.plot, trend), [trendLayout, trend]);
  const modules = useMemo(() => moduleLights(layout, byModule), [layout, byModule]);
  const rhythm = useMemo(() => rhythmFor(counts, active, alertKind), [counts, active, alertKind]);

  const lights = useMemo(() => {
    if (lens === 'modules') return modules.lights;
    if (lens === 'trend') return trendLights(trendLayout, stream, counts, currentId);
    return nowLights(layout, counts, currentId);
  }, [lens, modules, trendLayout, stream, layout, counts, currentId]);

  const spans = useMemo(
    () => Object.fromEntries(LANES.map((l) => [l, bandSpan(layout, l, counts)])) as Record<Lane, { x0: number; x1: number }>,
    [layout, counts],
  );
  const pauseX = active > 0 && alertKind !== 'waiting' && alertKind !== 'none' ? shareX(layout, props.alertPercent) : null;

  useEffect(() => {
    engineRef.current?.setPalette(palette);
  }, [palette, renderer]);
  useEffect(() => {
    engineRef.current?.setReduced(reduced);
  }, [reduced, renderer]);
  useEffect(() => {
    if (!size.w) return;
    engineRef.current?.setScene({ lens, layout, lights, columns: modules.columns, stream, focus, currentId, rhythm, spans, pauseX });
  }, [lens, layout, lights, modules.columns, stream, focus, currentId, rhythm, spans, pauseX, size.w, renderer]);

  const alertMix = rhythm.mode === 'alert' ? 1 : rhythm.intensity * 0.45;
  const lostPct = shares.lost;
  const summary =
    active > 0
      ? `${active} active. ${LANES.map((l) => `${LANE_SHORT[l]} ${counts[l]}`).join(', ')}.`
      : 'No one is active yet.';

  return (
    <div
      ref={outerRef}
      className="absolute inset-0 overflow-hidden"
      data-testid="heartbeat"
      data-lens={lens}
      data-renderer={renderer}
      data-focus={focus ? (focus.kind === 'lane' ? `lane:${focus.lane}` : focus.kind === 'module' ? `module:${focus.id}` : 'notes') : ''}
      data-rhythm={rhythm.mode}
    >
      {/* The room's light */}
      {/* The CSS light is always underneath: the fallback, and what shows until the shader's first frame. */}
      <CssLight palette={palette} mix={alertMix} />
      {renderer === 'webgl' && (
        <canvas ref={lightRef} aria-hidden="true" className="absolute inset-0 size-full opacity-0 transition-opacity duration-700 ease-standard" />
      )}

      <div ref={areaRef} className="absolute inset-y-0 left-0 w-[calc(100%-var(--side-w,0px))]">
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 size-full" />
        <p className="sr-only">{summary}</p>
        {size.w > 0 && (
          <>
            <Fade on={lens === 'now'}>
              <LaneLabels layout={layout} counts={counts} shares={shares} active={active} focus={focus} onFocus={onFocus} withCounts />
              {pauseX !== null && (
                <span
                  className={cx('pointer-events-none absolute -translate-x-1/2 whitespace-nowrap font-mono num', layout.compact ? 'text-[9px]' : 'text-[10px]', rhythm.mode === 'alert' ? 'text-bad-text' : 'text-muted')}
                  style={{ left: pauseX, top: layout.lanes.lost.y0 - (layout.compact ? 10 : 14) }}
                  data-testid="pause-line"
                >
                  PAUSE {props.alertPercent}%
                </span>
              )}
            </Fade>
            <Fade on={lens === 'modules'}>
              <LaneLabels layout={layout} counts={counts} shares={shares} active={active} focus={focus} onFocus={onFocus} />
              <ModuleHeaders columns={modules.columns} layout={layout} focus={focus} onFocus={onFocus} />
            </Fade>
            <Fade on={lens === 'trend'}>
              <TrendLabels layout={trendLayout} stream={stream} />
            </Fade>
            <PulseCaption layout={layout} words={rhythmWords(rhythm)} lostPct={lostPct} alertPercent={props.alertPercent} mode={rhythm.mode} active={active} />
          </>
        )}
      </div>
    </div>
  );
}

function Fade({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <div
      className={cx('absolute inset-0 transition-opacity duration-500 ease-standard', on ? 'opacity-100' : 'pointer-events-none opacity-0')}
      aria-hidden={!on || undefined}
      inert={!on || undefined}
    >
      {children}
    </div>
  );
}

function CssLight({ palette, mix }: { palette: EnginePalette; mix: number }) {
  const { top, bottom, calm, alert, cool } = palette.light;
  const plumes = (c: RGB, a: number) =>
    `radial-gradient(42% 38% at 28% 26%, ${toCss(c, a)} 0%, transparent 70%), radial-gradient(38% 34% at 72% 30%, ${toCss(c, a * 0.8)} 0%, transparent 72%), radial-gradient(50% 30% at 50% 78%, ${toCss(c, a * 0.5)} 0%, transparent 70%)`;
  return (
    <div aria-hidden="true" className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${toCss(top)} 0%, ${toCss(bottom)} 100%)` }}>
      <div className="absolute inset-0" style={{ background: `${plumes(calm, 0.9)}, radial-gradient(40% 40% at 12% 90%, ${toCss(cool, 0.6)} 0%, transparent 70%)` }} />
      <div
        className="absolute inset-0 transition-opacity duration-[1600ms] ease-standard"
        style={{ background: plumes(alert, 1), opacity: Math.max(0, Math.min(1, mix)) } as CSSProperties}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ labels */

function LaneLabels({
  layout,
  counts,
  shares,
  active,
  focus,
  onFocus,
  withCounts,
}: {
  layout: StageLayout;
  counts: LevelCounts;
  shares: LevelCounts;
  active: number;
  focus: StageFocus | null;
  onFocus: (f: StageFocus | null) => void;
  withCounts?: boolean;
}) {
  const { compact } = layout;
  return (
    <>
      {LANES.map((lane) => {
        const r = layout.lanes[lane];
        const on = focus?.kind === 'lane' && focus.lane === lane;
        const style: CSSProperties = {
          left: layout.labelX,
          top: (r.y0 + r.y1) / 2,
          width: layout.plot.x0 - layout.labelX - (compact ? 6 : 18),
        };
        const label = `${LEVEL_LABEL[lane]}: ${counts[lane]} of ${active} (${shares[lane]}%)`;
        return withCounts ? (
          <button
            key={lane}
            type="button"
            style={style}
            data-testid={`gauge-${lane}`}
            data-count={counts[lane]}
            data-share={shares[lane]}
            aria-pressed={on}
            aria-label={`${label}. ${on ? 'Clear focus' : 'Focus this band'}`}
            title={label}
            onClick={() => onFocus(on ? null : { kind: 'lane', lane })}
            className={cx(
              'group absolute -translate-y-1/2 cursor-pointer rounded-xl text-left transition-[background-color,box-shadow] duration-150 ease-standard',
              compact ? 'px-1.5 py-1' : 'px-3 py-2',
              on ? 'x-glass ring-1 ring-[color-mix(in_oklab,var(--accent-9)_45%,transparent)]' : 'hover:bg-[color-mix(in_oklab,var(--gray-12)_6%,transparent)]',
            )}
          >
            <span className={cx('x-legend-label block truncate', LANE_TEXT[lane], compact && 'text-[9px]')}>{compact && lane === 'none' ? 'No answer' : LANE_SHORT[lane]}</span>
            <span className="mt-0.5 flex items-baseline gap-2">
              <span className={cx('font-semibold leading-none tracking-[-0.03em] text-fg num', compact ? 'text-xl' : lane === 'none' ? 'text-2xl' : 'text-[34px]')}>
                {counts[lane]}
              </span>
              <span className={cx('font-mono text-muted num', compact ? 'text-[10px]' : 'text-ui')}>{shares[lane]}%</span>
            </span>
          </button>
        ) : (
          <span
            key={lane}
            style={style}
            className={cx('x-legend-label absolute -translate-y-1/2 truncate', LANE_TEXT[lane], compact ? 'px-1.5 text-[9px]' : 'px-3')}
          >
            {compact && lane === 'none' ? 'No answer' : LANE_SHORT[lane]}
          </span>
        );
      })}
    </>
  );
}

function ModuleHeaders({
  columns,
  layout,
  focus,
  onFocus,
}: {
  columns: ReturnType<typeof moduleLights>['columns'];
  layout: StageLayout;
  focus: StageFocus | null;
  onFocus: (f: StageFocus | null) => void;
}) {
  const { compact, header } = layout;
  return (
    <>
      {columns.map((c) => {
        const on = focus?.kind === 'module' && focus.id === c.id;
        const pct = c.confusionIndex === null ? null : Math.round(c.confusionIndex * 100);
        const state = c.state === 'current' ? 'now' : c.state === 'upcoming' ? 'not run' : 'done';
        return (
          <button
            key={c.id}
            type="button"
            data-testid="module-col"
            data-state={c.state}
            aria-pressed={on}
            aria-label={`Module ${c.index + 1}, ${c.name}: ${state}${pct === null ? '' : `, ${pct}% lost of ${c.responses} answers`}. ${on ? 'Clear focus' : 'Focus this module'}`}
            onClick={() => onFocus(on ? null : { kind: 'module', id: c.id })}
            className="group absolute flex cursor-pointer flex-col justify-start rounded-[14px] text-left focus-visible:outline-2 focus-visible:outline-accent-9"
            style={{ left: c.rect.x0, top: header.y0, width: c.rect.x1 - c.rect.x0, height: c.rect.y1 - header.y0 }}
          >
            <span className={cx('flex w-full items-baseline gap-1.5 px-2', compact ? 'h-5' : 'h-7')}>
              <span className={cx('font-mono text-faint num', compact ? 'text-[9px]' : 'text-[11px]')}>{c.index + 1}</span>
              <span
                className={cx(
                  'min-w-0 flex-1 truncate font-medium transition-colors',
                  compact ? 'text-[10px]' : 'text-ui',
                  c.state === 'upcoming' ? 'text-muted' : 'text-fg',
                  'group-hover:text-brand-text',
                  on && 'text-brand-text',
                )}
              >
                {c.name}
              </span>
              {!compact && (
                <span className={cx('shrink-0 font-mono text-[11px] num', c.state === 'current' ? 'text-brand-text' : pct !== null && pct >= 30 ? 'text-bad-text' : 'text-muted')}>
                  {c.state === 'current' ? 'NOW' : c.state === 'upcoming' ? '—' : `${pct}%`}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </>
  );
}

function TrendLabels({ layout, stream }: { layout: StageLayout; stream: ReturnType<typeof trendGeometry> }) {
  const { compact, header, plot } = layout;
  if (!stream) {
    return (
      <div className="absolute flex items-center justify-center text-ui text-muted" style={{ left: plot.x0, right: 0, top: plot.y0, height: plot.y1 - plot.y0 }}>
        The trend starts with the first module.
      </div>
    );
  }
  const end = stream.end;
  const ec = stream.endCounts;
  const labels: { lane: Lane; y: number; n: number }[] =
    end && ec
      ? [
          { lane: 'lost', y: (end.y0 + end.y1) / 2, n: ec.lost },
          { lane: 'unsure', y: (end.y1 + end.y2) / 2, n: ec.unsure },
          { lane: 'got_it', y: (end.y2 + end.y3) / 2, n: ec.got_it },
        ]
      : [];
  // Spread direct labels so they never overlap.
  const minGap = 18;
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < minGap) labels[i].y = labels[i - 1].y + minGap;
  return (
    <>
      {!compact && (
        <div className="absolute" style={{ left: layout.labelX, top: (plot.y0 + plot.y1) / 2, width: plot.x0 - layout.labelX - 18 }}>
          <div className="-translate-y-1/2 px-3">
            <div className="x-legend-label text-muted">Session trend</div>
            <div className="mt-1 text-xs leading-4 text-muted">Thickness is answers. Colours are the mix.</div>
          </div>
        </div>
      )}
      {stream.segments.map((s) => (
        <span
          key={s.id}
          className={cx('absolute truncate font-medium text-fg/85', compact ? 'text-[10px]' : 'text-ui')}
          style={{ left: s.x0 + 6, top: header.y0 + (compact ? 2 : 6), width: Math.max(0, s.x1 - s.x0 - 10) }}
        >
          {s.name}
        </span>
      ))}
      <span className="absolute whitespace-nowrap font-mono text-[11px] text-muted num" style={{ left: plot.x0, top: plot.y1 - 16 }}>
        {hhmm(stream.start)}
      </span>
      {end && (
        <span className="absolute -translate-x-full whitespace-nowrap font-mono text-[11px] text-muted num" style={{ left: end.x, top: plot.y1 - 16 }}>
          {hhmm(stream.stop)}
        </span>
      )}
      {!compact &&
        end &&
        labels.map((l) => (
          <span
            key={l.lane}
            className={cx('absolute flex -translate-y-1/2 items-baseline gap-1.5 whitespace-nowrap')}
            style={{ left: end.x + 12, top: l.y }}
          >
            <span className="text-base font-semibold leading-none text-fg num">{l.n}</span>
            <span className={cx('x-legend-label', LANE_TEXT[l.lane])}>{LANE_SHORT[l.lane]}</span>
          </span>
        ))}
    </>
  );
}

function PulseCaption({
  layout,
  words,
  lostPct,
  alertPercent,
  mode,
  active,
}: {
  layout: StageLayout;
  words: string;
  lostPct: number;
  alertPercent: number;
  mode: string;
  active: number;
}) {
  const { ecg, compact, labelX } = layout;
  return (
    <>
      <div
        className={cx('pointer-events-none absolute -translate-y-1/2', compact ? 'px-1.5' : 'px-3')}
        style={{ left: labelX, top: (ecg.y0 + ecg.y1) / 2, width: ecg.x0 - labelX - (compact ? 6 : 18) }}
        data-testid="pulse-caption"
      >
        <div className={cx('x-legend-label', mode === 'alert' ? 'text-bad-text' : 'text-brand-text', compact && 'text-[9px]')}>{compact ? 'Pulse' : 'Room pulse'}</div>
        <div className={cx('mt-0.5 font-medium text-fg', compact ? 'text-xs' : 'text-sm')}>{words}</div>
      </div>
      {active > 0 && !compact && (
        <span className="pointer-events-none absolute font-mono text-[11px] text-muted num" style={{ right: layout.w - ecg.x1, top: ecg.y0 - 18 }}>
          {lostPct}% lost · pause at {alertPercent}%
        </span>
      )}
    </>
  );
}
