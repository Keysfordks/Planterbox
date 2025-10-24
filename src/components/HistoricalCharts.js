'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Title,
  Tooltip,
  Legend,
  Filler,
  CategoryScale
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import annotationPlugin from 'chartjs-plugin-annotation';

ChartJS.register(
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Title,
  Tooltip,
  Legend,
  Filler,
  CategoryScale,
  annotationPlugin
);

export default function HistoricalCharts({ show }) {
  // We separate "initial skeleton" from "background updating"
  const [payload, setPayload] = useState(null);     // last good data
  const [error, setError] = useState(null);
  const [isFetching, setIsFetching] = useState(false); // background fetch state
  const hasLoadedOnceRef = useRef(false);
  const abortRef = useRef(null);

  async function loadGrowth() {
    // Cancel any in-flight request to avoid race conditions / flicker
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // For the very first load, show skeleton; thereafter, keep the graph visible
    if (!hasLoadedOnceRef.current) {
      setError(null);
    }
    setIsFetching(true);

    try {
      const res = await fetch('/api/sensordata?growth=true', {
        // keep no-store if you truly need the latest every time;
        // the "keep previous data" UX is handled in our state logic
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Growth fetch failed (${res.status}): ${text.slice(0, 180)}`);
      }
      const json = await res.json();

      const nextPayload = {
        historicalData: Array.isArray(json?.historicalData) ? json.historicalData : [],
        idealConditions: json?.idealConditions ?? null,
        selectionStartTime: json?.selectionStartTime ?? null,
      };

      setPayload(nextPayload);
      setError(null);
      hasLoadedOnceRef.current = true;
    } catch (e) {
      if (e?.name === 'AbortError') return; // ignore cancellations
      console.error('HistoricalCharts load error:', e);
      setError(e.message || 'Failed to load historical data');

      // Keep prior payload so chart remains visible; only seed an empty payload
      // if we've never had data before.
      if (!hasLoadedOnceRef.current) {
        setPayload({
          historicalData: [],
          idealConditions: null,
          selectionStartTime: null,
        });
      }
    } finally {
      setIsFetching(false);
    }
  }

  useEffect(() => {
    if (!show) return;
    loadGrowth();

    // Optional: clean up on unmount
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [show]); // only when dialog/panel becomes visible

  const rows = payload?.historicalData ?? [];
  const ideals = payload?.idealConditions ?? null;
  const hasData = rows.length > 0;
  const isInitialLoading = !hasLoadedOnceRef.current;

  const timeUnit = useMemo(() => {
    if (!hasData) return 'hour';
    const first = new Date(rows[0].timestamp).getTime();
    const last = new Date(rows[rows.length - 1].timestamp).getTime();
    const spanHours = Math.max(1, (last - first) / 36e5);
    if (spanHours <= 24) return 'hour';
    if (spanHours <= 24 * 14) return 'day';
    return 'week';
  }, [rows, hasData]);

  return (
    <div style={{ padding: 16, position: 'relative' }}>
      {/* Initial skeleton ONLY the first time */}
      {isInitialLoading && (
        <div className="h-48" style={{ height: 208, borderRadius: 10, background: '#e5e7eb', animation: 'pulse 1.5s ease-in-out infinite' }} />
      )}

      {/* Error banner (non-blocking; we keep the old chart if we have one) */}
      {error && !isInitialLoading && (
        <div style={{ color: 'crimson', marginBottom: 12 }}>{error}</div>
      )}

      {/* Empty state (only when we have no data after first load) */}
      {!isInitialLoading && !hasData && (
        <div style={{ lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No Historical Data Found</div>
          <div>
            No sensor data available since plant selection (
            {payload?.selectionStartTime ? new Date(payload.selectionStartTime).toLocaleString() : 'N/A'}
            ).
          </div>
        </div>
      )}

      {/* Charts (stay mounted during background fetches) */}
      {!isInitialLoading && hasData && (
        <div style={{ display: 'grid', gap: 24 }}>
          <MetricChart
            title="Temperature (°C)"
            unit="°C"
            field="temperature"
            rows={rows}
            idealMin={ideals?.temp_min ?? null}
            idealMax={ideals?.temp_max ?? null}
            timeUnit={timeUnit}
          />
          <MetricChart
            title="Humidity (%)"
            unit="%"
            field="humidity"
            rows={rows}
            idealMin={ideals?.humidity_min ?? null}
            idealMax={ideals?.humidity_max ?? null}
            timeUnit={timeUnit}
          />
          <MetricChart
            title="PPM (Nutrients)"
            unit=""
            field="ppm"
            rows={rows}
            idealMin={ideals?.ppm_min ?? null}
            idealMax={ideals?.ppm_max ?? null}
            timeUnit={timeUnit}
          />
          <MetricChart
            title="pH Level"
            unit=""
            field="ph"
            rows={rows}
            idealMin={ideals?.ph_min ?? null}
            idealMax={ideals?.ph_max ?? null}
            timeUnit={timeUnit}
          />

          {/* Tiny non-blocking badge during background updates */}
          {isFetching && (
            <div style={{
              position: 'absolute',
              top: 18,
              right: 24,
              fontSize: 12,
              padding: '2px 8px',
              borderRadius: 6,
              background: '#f3f4f6',
              border: '1px solid #e5e7eb'
            }}>
              updating…
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One chart with an ideal-range green band */
function MetricChart({ title, unit, field, rows, idealMin, idealMax, timeUnit }) {
  // Build (x,y) points; skip nulls
  const points = useMemo(() => (
    rows
      .map(r => {
        const y = r?.[field];
        if (y == null || Number.isNaN(y)) return null;
        return { x: new Date(r.timestamp), y: Number(y) };
      })
      .filter(Boolean)
  ), [rows, field]);

  // Memoize data/options to keep <Line> from remounting
  const data = useMemo(() => ({
    datasets: [
      {
        label: title,
        data: points,
        parsing: false,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.25,
        fill: false,
      }
    ]
  }), [points, title]);

  const annotations = useMemo(() => {
    if (idealMin == null || idealMax == null || idealMin > idealMax) return {};
    return {
      idealBand: {
        type: 'box',
        yMin: idealMin,
        yMax: idealMax,
        backgroundColor: 'rgba(16, 185, 129, 0.18)', // translucent green
        borderWidth: 0,
      }
    };
  }, [idealMin, idealMax]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: `${title}${unit ? `  (Ideal: ${idealMin ?? '—'}–${idealMax ?? '—'} ${unit})` : ''}`
      },
      tooltip: {
        callbacks: {
          label: ctx => {
            const v = ctx.parsed.y;
            const u = unit ? ` ${unit}` : '';
            return `${v}${u} @ ${new Date(ctx.parsed.x).toLocaleString()}`;
          }
        }
      },
      annotation: { annotations }
    },
    scales: {
      x: {
        type: 'time',
        time: { unit: timeUnit },
        grid: { display: false },
        ticks: { maxRotation: 0 },
      },
      y: {
        beginAtZero: false,
        grid: { color: 'rgba(0,0,0,0.08)' },
        ticks: { callback: v => `${v}${unit ? ` ${unit}` : ''}` },
      }
    },
    elements: {
      line: { borderJoinStyle: 'round' }
    }
  }), [annotations, idealMin, idealMax, timeUnit, title, unit]);

  // Give each chart its own height
  return (
    <div style={{ height: 260, border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
      {points.length ? (
        <Line data={data} options={options} />
      ) : (
        <div style={{ padding: 8, opacity: 0.7 }}>No {title} data yet.</div>
      )}
    </div>
  );
}

/* tiny css keyframes for skeleton (optional) */
const style = typeof document !== 'undefined' && document.createElement('style');
if (style) {
  style.innerHTML = `
  @keyframes pulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }`;
  document.head.appendChild(style);
}
