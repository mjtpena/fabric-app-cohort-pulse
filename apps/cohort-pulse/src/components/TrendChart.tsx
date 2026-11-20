import { useLayoutEffect, useRef, useState } from 'react';

import type { SessionTrend } from '../domain/pulse';
import { trendGeometry, type StreamPoint } from '../heartbeat/geometry';
import { LEVEL_TONE } from './levels';

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * The session's heartbeat as a static streamgraph (the report's signature): thickness is the number of answers, the
 * layers are lost, unsure and got it, one stretch per module. Totals only.
 */
export function TrendChart({ trend, height = 200, label }: { trend: SessionTrend; height?: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => setW(el.getBoundingClientRect().width);
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const top = 28;
  const bottom = height - 22;
  const plot = { x0: 0, y0: top, x1: Math.max(10, w), y1: bottom };
  const geo = w ? trendGeometry(plot, trend, 0.94) : null;
  const layer = (pts: StreamPoint[], a: keyof StreamPoint, b: keyof StreamPoint) =>
    `M${pts.map((p) => `${p.x.toFixed(1)},${(p[a] as number).toFixed(1)}`).join('L')}L${[...pts]
      .reverse()
      .map((p) => `${p.x.toFixed(1)},${(p[b] as number).toFixed(1)}`)
      .join('L')}Z`;
  const mid = (top + bottom) / 2;
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {geo && (
        <svg width={w} height={height} role="img" aria-label={label} className="block overflow-visible">
          <line x1={0} x2={w} y1={mid} y2={mid} stroke="var(--line)" strokeDasharray="2 4" />
          {geo.segments.map((s, i) => (
            <g key={s.id}>
              {i > 0 && <line x1={s.x0} x2={s.x0} y1={top - 6} y2={bottom} stroke="var(--line-strong)" strokeDasharray="2 4" />}
              {s.points.length > 1 && (
                <>
                  <path d={layer(s.points, 'y0', 'y1')} fill={LEVEL_TONE.lost.solid} fillOpacity={0.62} />
                  <path d={layer(s.points, 'y1', 'y2')} fill={LEVEL_TONE.unsure.solid} fillOpacity={0.62} />
                  <path d={layer(s.points, 'y2', 'y3')} fill={LEVEL_TONE.got_it.solid} fillOpacity={0.62} />
                  <path d={`M${s.points.map((p) => `${p.x.toFixed(1)},${p.y0.toFixed(1)}`).join('L')}`} fill="none" stroke={LEVEL_TONE.lost.solid} strokeWidth={1.25} />
                </>
              )}
            </g>
          ))}
        </svg>
      )}
      {geo?.segments.map((s) => (
        <span key={s.id} className="absolute top-0 truncate pl-1.5 text-xs font-medium text-fg/80" style={{ left: s.x0, width: Math.max(0, s.x1 - s.x0 - 4) }} title={s.name}>
          {s.name}
        </span>
      ))}
      {geo && (
        <>
          <span className="absolute bottom-0 left-0 font-mono text-[11px] text-muted num">{hhmm(geo.start)}</span>
          <span className="absolute bottom-0 right-0 font-mono text-[11px] text-muted num">{hhmm(geo.stop)}</span>
        </>
      )}
    </div>
  );
}
