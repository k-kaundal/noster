import { useId, useState } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { formatSats } from '@/lib/zap';
import type { DayEarning } from '@/lib/studio';
import { cn } from '@/lib/utils';

/**
 * Sats per day across the window.
 *
 * One series, so no legend and no palette: the heading names it and the colour
 * is the app's own zap gold, which already means sats everywhere else. A
 * categorical scale would be inventing a distinction that does not exist.
 *
 * Drawn as an area under a 2px line. The area carries the magnitude at a
 * glance and the line keeps the day-to-day shape readable, which a bar chart
 * at ninety columns does not.
 */
export function EarningsTrend({
  days,
  className,
}: {
  days: DayEarning[];
  className?: string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (days.length < 2) return null;

  const peak = Math.max(...days.map((day) => day.sats));

  /*
   * A flat run of zeroes still draws a baseline rather than dividing by zero,
   * and a month with nothing in it should look like a month with nothing in
   * it — not like an empty component that failed to load.
   */
  const height = 64;
  const width = 100;
  const step = width / (days.length - 1);

  const y = (sats: number) =>
    peak > 0 ? height - (sats / peak) * (height - 6) - 3 : height - 3;

  const points = days.map((day, index) => `${index * step},${y(day.sats)}`);
  const line = `M${points.join(' L')}`;
  const area = `${line} L${width},${height} L0,${height} Z`;

  const active = hover === null ? null : days[hover];

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Sats per day
          </p>

          {/*
            The hovered day, in the heading rather than in a floating box.
            A tooltip that covers the line it is describing is worse than no
            tooltip, and at this size anything floating covers most of it.
          */}
          <p className="text-xs tabular-nums text-muted-foreground">
            {active ? (
              <>
                <span className="text-foreground">
                  {formatSats(active.sats)} sats
                </span>{' '}
                · {new Date(active.day * 1000).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                })}
              </>
            ) : (
              <>peak {formatSats(peak)}</>
            )}
          </p>
        </div>

        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="mt-2 h-16 w-full"
          role="img"
          aria-label={`Sats received per day over the last ${days.length} days. Highest day ${peak} sats.`}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--zap))" stopOpacity="0.35" />
              <stop offset="100%" stopColor="hsl(var(--zap))" stopOpacity="0" />
            </linearGradient>
          </defs>

          <path d={area} fill={`url(#${gradientId})`} />
          <path
            d={line}
            fill="none"
            stroke="hsl(var(--zap))"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {active && (
            <circle
              cx={hover! * step}
              cy={y(active.sats)}
              r="3"
              fill="hsl(var(--zap))"
              stroke="hsl(var(--card))"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/*
            One transparent column per day, so the hit target is the whole
            height of the chart rather than a two-pixel line somebody has to
            hunt for.
          */}
          {days.map((day, index) => (
            <rect
              key={day.day}
              x={index * step - step / 2}
              y={0}
              width={step}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          ))}
        </svg>
      </CardContent>
    </Card>
  );
}
