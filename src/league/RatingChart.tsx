"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  formatChange,
  formatDateTime,
  formatDay,
  formatRating,
  formatTime,
  niceTicks,
  type RatingPoint,
  type RatingSeries,
} from "./league-view";

type ShownSeries = RatingSeries & { slot: number };

interface RatingChartProps {
  series: ShownSeries[];
  names: Map<string, string>;
  initialRating: number;
}

const HEIGHT = 300;
const MARGIN = { top: 18, right: 104, bottom: 30, left: 46 };
const LABEL_GAP = 15;
const HOUR = 3_600_000;
const TWO_DAYS = 48 * HOUR;

function useMeasuredWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.max(240, Math.round(element.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** The last point at or before `time`, if the series has started by then. */
function valueAt(points: readonly RatingPoint[], time: number): RatingPoint | null {
  let found: RatingPoint | null = null;
  for (const point of points) {
    if (point.time > time) break;
    found = point;
  }
  return found;
}

export function RatingChart({ series, names, initialRating }: RatingChartProps) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>(640);
  const [hover, setHover] = useState<{ time: number; x: number } | null>(null);

  const innerWidth = Math.max(80, width - MARGIN.left - MARGIN.right);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const allPoints = series.flatMap((item) => item.points);
  if (allPoints.length === 0) {
    return (
      <div ref={ref} className="chart-frame">
        <p className="panel-placeholder">Choose at least one player to draw the chart.</p>
      </div>
    );
  }

  let timeStart = Math.min(...allPoints.map((point) => point.time));
  let timeEnd = Math.max(...allPoints.map((point) => point.time));
  if (timeEnd - timeStart < HOUR) {
    timeStart -= HOUR;
    timeEnd += HOUR;
  }
  const ratingValues = allPoints.map((point) => point.rating).concat(initialRating);
  const ticks = niceTicks(Math.min(...ratingValues), Math.max(...ratingValues), 5);
  const ratingLow = ticks[0];
  const ratingHigh = ticks[ticks.length - 1];

  const x = (time: number) => MARGIN.left + ((time - timeStart) / (timeEnd - timeStart)) * innerWidth;
  const y = (rating: number) => MARGIN.top + (1 - (rating - ratingLow) / (ratingHigh - ratingLow)) * innerHeight;

  const xTickCount = Math.max(2, Math.min(6, Math.floor(innerWidth / 110)));
  const shortRange = timeEnd - timeStart < TWO_DAYS;
  const xTicks: { time: number; label: string }[] = [];
  for (let index = 0; index < xTickCount; index += 1) {
    const time = timeStart + ((timeEnd - timeStart) * index) / (xTickCount - 1);
    const label = shortRange ? `${formatDay(time)} ${formatTime(time)}` : formatDay(time);
    if (xTicks[xTicks.length - 1]?.label !== label) xTicks.push({ time, label });
  }

  // Direct labels at each line's end, nudged apart so they never overlap.
  const labels = series
    .map((item) => {
      const last = item.points[item.points.length - 1];
      return { item, y: y(last.rating), rating: last.rating };
    })
    .sort((left, right) => left.y - right.y);
  for (let index = 1; index < labels.length; index += 1) {
    if (labels[index].y < labels[index - 1].y + LABEL_GAP) labels[index].y = labels[index - 1].y + LABEL_GAP;
  }
  const overflow = labels.length ? labels[labels.length - 1].y - (HEIGHT - MARGIN.bottom) : 0;
  if (overflow > 0) for (const label of labels) label.y -= overflow;

  const uniqueTimes = [...new Set(allPoints.map((point) => point.time))].sort((left, right) => left - right);

  function handlePointer(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const time = timeStart + ((pointerX - MARGIN.left) / innerWidth) * (timeEnd - timeStart);
    let nearest = uniqueTimes[0];
    for (const candidate of uniqueTimes) {
      if (Math.abs(candidate - time) < Math.abs(nearest - time)) nearest = candidate;
    }
    setHover({ time: nearest, x: x(nearest) });
  }

  const hoverRows = hover
    ? series
      .map((item) => ({ item, point: valueAt(item.points, hover.time) }))
      .filter((row): row is { item: ShownSeries; point: RatingPoint } => row.point !== null)
      .sort((left, right) => right.point.rating - left.point.rating)
    : [];
  const tooltipOnLeft = hover ? hover.x > width / 2 : false;

  return (
    <div ref={ref} className="chart-frame">
      <svg
        className="rating-chart"
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={`Rating history for ${series.map((item) => names.get(item.playerId) ?? item.playerId).join(", ")}`}
        onPointerMove={handlePointer}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} className="chart-grid" />
            <text x={MARGIN.left - 8} y={y(tick)} dy="0.35em" textAnchor="end" className="chart-tick">{tick}</text>
          </g>
        ))}
        {initialRating > ratingLow && initialRating < ratingHigh && (
          <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(initialRating)} y2={y(initialRating)} className="chart-start" />
        )}
        <line x1={MARGIN.left} x2={width - MARGIN.right} y1={HEIGHT - MARGIN.bottom} y2={HEIGHT - MARGIN.bottom} className="chart-axis" />
        {xTicks.map((tick) => (
          <text key={tick.time} x={x(tick.time)} y={HEIGHT - MARGIN.bottom + 18} textAnchor="middle" className="chart-tick">{tick.label}</text>
        ))}
        {series.map((item) => {
          const path = item.points
            .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.time).toFixed(1)} ${y(point.rating).toFixed(1)}`)
            .join(" ");
          return (
            <path key={item.playerId} d={path} className="chart-line" style={{ stroke: `var(--series-${item.slot})` }} />
          );
        })}
        {hover && <line x1={hover.x} x2={hover.x} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} className="chart-crosshair" />}
        {hoverRows.map(({ item, point }) => (
          <circle key={item.playerId} cx={hover!.x} cy={y(point.rating)} r="4" className="chart-dot" style={{ fill: `var(--series-${item.slot})` }} />
        ))}
        {labels.map(({ item, y: labelY, rating }) => {
          const last = item.points[item.points.length - 1];
          return (
            <g key={item.playerId}>
              <circle cx={x(last.time)} cy={y(rating)} r="4" className="chart-dot" style={{ fill: `var(--series-${item.slot})` }} />
              <text x={width - MARGIN.right + 10} y={labelY} dy="0.35em" className="chart-label">
                {names.get(item.playerId) ?? item.playerId}
                <tspan className="chart-label-value"> {formatRating(rating)}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
      {hover && hoverRows.length > 0 && (
        <div
          className="chart-tooltip"
          style={tooltipOnLeft ? { right: width - hover.x + 12 } : { left: hover.x + 12 }}
        >
          <p className="tooltip-time">{formatDateTime(hover.time)}</p>
          <ul>
            {hoverRows.map(({ item, point }) => (
              <li key={item.playerId}>
                <span className="legend-swatch" style={{ background: `var(--series-${item.slot})` }} aria-hidden="true" />
                <span className="tooltip-name">{names.get(item.playerId) ?? item.playerId}</span>
                <span className="tooltip-value">
                  {formatRating(point.rating)}
                  {point.time === hover.time && point.change !== undefined && (
                    <span className={point.change >= 0 ? "delta-up" : "delta-down"}> {formatChange(point.change)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
