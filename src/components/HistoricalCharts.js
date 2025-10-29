'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
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

const HistoricalCharts = forwardRef(function HistoricalCharts({ show }, ref) {
  const [payload, setPayload] = useState(null);     // last seen payload (we'll preserve rows when needed)
  const [error, setError] = useState(null);
  const [isFetching, setIsFetching] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const abortRef = useRef(null);

  // keep a copy of the last **non-empty** rows to avoid visual "collapse" between ticks
  const lastGoodRowsRef = useRef([]);

  // refs to individual charts for snapshot
  const tempRef = useRef(null);
  const humRef  = useRef(null);
  const ppmRef  = useRef(null);
  const phRef   = useRef(null);

  async function loadGrowth() {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (!hasLoadedOnceRef.current) setError(null);
    setIsFetching(true);

    try {
      const res = await fetch('/api/sensordata?growth=true', { cache: 'no-store', signal: controller.signal });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Growth fetch failed (${res.status}): ${text.slice(0, 180)}`);
      }
      const json = await res.json();

      const nextRows = Array.isArray(json?.historicalData) ? json.historicalData : [];
      const nextPayload = {
        historicalData: nextRows,
        idealConditions: json?.idealConditions ?? null,
        selectionStartTime: json?.selectionStartTime ?? null,
      };

      // Preserve the last good (non-empty) dataset to prevent the chart from "closing"
      if (nextRows.length > 0) {
        lastGoodRowsRef.current = nextRows;
        setPayload(nextPayload);
      } else if (hasLoadedOnceRef.current && lastGoodRowsRef.current.length > 0) {
        // Keep previous rows; still update ideals & selection time
        setPayload(prev => ({
          historicalData: lastGoodRowsRef.current,
          idealConditions: nextPayload.idealConditions,
          selectionStartTime: nextPayload.selectionStartTime,
        }));
      } else {
        // First load and genuinely empty -> show empty once, but never "collapse" afterward
        setPayload(nextPayload);
      }

      setError(null);
      hasLoadedOnceRef.current = true;
    } catch (e) {
      if (e?.name === 'AbortError') return;
      console.error('HistoricalCharts load error:', e);
      setError(e.message || 'Failed to load historical data');
      if (!hasLoadedOnceRef.current) {
        setPayload({ historicalData: [], idealConditions: null, selectionStartTime: null });
      }
    } finally {
      setIsFetching(false);
    }
  }

  useEffect(() => {
    if (!show) return;
    loadGrowth();
    return () => { if (abortRef.current) abortRef.current.abort(); };
    // We purposely only refetch on open; polling (if needed) should happen outside,
    // but the component will not flash even if parent re-renders often.
  }, [show]);

  const rows = payload?.historicalData ?? [];
  const ideals = payload?.idealConditions ?? null;
  const hasDataEver = hasLoadedOnceRef.current || rows.length > 0;
  const hasDataNow = rows.length > 0;
  const isInitialLoading = !hasLoadedOnceRef.current && !error && !hasDataNow;

  // time unit selection
  const timeUnit = useMemo(() => {
    if (!hasDataNow) return 'hour';
    const first = new Date(rows[0].timestamp).getTime();
    const last  = new Date(rows[rows.length - 1].timestamp).getTime();
    const spanHours = Math.max(1, (last - first) / 36e5);
    if (spanHours <= 24) return 'hour';
    if (spanHours <= 24 * 14) return 'day';
    return 'week';
  }, [rows, hasDataNow]);

  // Expose snapshots to parent
  useImperativeHandle(ref, () => ({
    getSnapshots: () => {
      const snap = (r) => {
        const inst = r?.current;
        if (!inst) return null;
        const chart = inst?.canvas ? inst : inst?.chart || inst;
        try {
          return chart?.toBase64Image ? chart.toBase64Image('image/png', 1.0) : null;
        } catch {
          return null;
        }
      };
      return {
        temperature: snap(tempRef),
        humidity:    snap(humRef),
        ppm:         snap(ppmRef),
        ph:          snap(phRef),
      };
    }
  }), []);

  return (
    <div style={{ padding: 16, position: 'relative' }}>
      {/* Initial skeleton only on the very first load */}
      {isInitialLoading && (
        <div style={{ height: 208, borderRadius: 10, background: '#e5e7eb', animation: 'pulse 1.5s ease-in-out infinite' }} />
      )}

      {/* Error banner (non-blocking; charts remain mounted once shown) */}
      {error && !isInitialLoading && (
        <div style={{ color: 'crimson', marginBottom: 12 }}>{error}</div>
      )}

      {/* Keep charts mounted once they've been shown at least once.
          If there is truly never any data, we'll show the friendly empty
          message—but only before the first chart render. */}
      {hasDataEver ? (
        <div style={{ display: 'grid', gap: 24 }}>
          <MetricChart
            chartRef={tempRef}
            title="Temperature (°C)"
            unit="°C"
            field="temperature"
            rows={rows.length > 0 ? rows : lastGoodRowsRef.current}
            idealMin={ideals?.temp_min ?? null}
            idealMax={ideals?.temp_max ?? null}
            timeUnit={timeUnit}
          />
          <MetricChart
            chartRef={humRef}
            title="Humidity (%)"
            unit="%"
            field="humidity"
            rows={rows.length > 0 ? rows : lastGoodRowsRef.current}
            idealMin={ideals?.humidity_min ?? null}
            idealMax={ideals?.humidity_max ?? null}
            timeUnit={timeUnit}
          />
          <MetricChart
            chartRef={ppmRef}
            title="PPM (Nutrients)"
            unit=""
            field="ppm"
            rows={rows.length > 0 ? rows : lastGoodRowsRef.current}
            idealMin={ideals?.ppm_min ?? null}
            idealMax={ideals?.ppm_max ?? null}
            timeUnit={timeUnit}
          />
          <MetricChart
            chartRef={phRef}
            title="pH Level"
            unit=""
            field="ph"
            rows={rows.length > 0 ? rows : lastGoodRowsRef.current}
            idealMin={ideals?.ph_min ?? null}
            idealMax={ideals?.ph_max ?? null}
            timeUnit={timeUnit}
          />

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
      ) : (
        !isInitialLoading && (
          <div style={{ lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>No Historical Data Found</div>
            <div>
              No sensor data available since plant selection (
              {payload?.selectionStartTime ? new Date(payload.selectionStartTime).toLocaleString() : 'N/A'}
              ).
            </div>
          </div>
        )
      )}
    </div>
  );
});

export default HistoricalCharts;

/** One chart with an ideal-range green band (no flicker version) */
function MetricChart({ chartRef, title, unit, field, rows, idealMin, idealMax, timeUnit }) {
  // map to points (x: Date, y: number)
  const points = useMemo(() => (
    rows
      .map(r => {
        const y = r?.[field];
        if (y == null || Number.isNaN(y)) return null;
        return { x: new Date(r.timestamp), y: Number(y) };
      })
      .filter(Boolean)
  ), [rows, field]);

  // stable dataset shape; just swap .data
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
        spanGaps: true,
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
        backgroundColor: 'rgba(16, 185, 129, 0.18)',
        borderWidth: 0,
      }
    };
  }, [idealMin, idealMax]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    normalized: true,
    animation: { duration: 0 },               // zero-duration -> no flash
    transitions: { active: { animation: { duration: 0 } } },
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
    interaction: { mode: 'nearest', intersect: false },
    scales: {
      x: { type: 'time', time: { unit: timeUnit }, grid: { display: false }, ticks: { maxRotation: 0 } },
      y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.08)' }, ticks: { callback: v => `${v}${unit ? ` ${unit}` : ''}` } }
    },
    elements: { line: { borderJoinStyle: 'round' } }
  }), [annotations, idealMin, idealMax, timeUnit, title, unit]);

  return (
    <div style={{ height: 260, border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
      {/* Keeping a constant <Line> instance prevents "close/reopen" effects */}
      <Line ref={chartRef} data={data} options={options} updateMode="none" />
    </div>
  );
}

/* tiny css keyframes for skeleton (optional) */
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.innerHTML = `@keyframes pulse { 0%,100%{opacity:.6} 50%{opacity:1} }`;
  document.head.appendChild(style);
}
