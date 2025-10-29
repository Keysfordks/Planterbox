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

/**
 * Drop-in replacement for your existing HistoricalCharts component with:
 * 1) A horizontal dashed line showing the CURRENT reading against the ideal band
 * 2) Flicker-free updates by:
 *    - Preserving previous payload while fetching
 *    - Avoiding state updates if incoming data hasn't changed (signature compare)
 *    - Keeping Chart.js datasets stable and updating without animations
 */
const HistoricalCharts = forwardRef(function HistoricalCharts({ show, live = true, pollMs = 3000, showSkeletonOnFirstLoad = false }, ref) {
  const [payload, setPayload] = useState(null);     // last good data
  const [error, setError] = useState(null);
  const [isFetching, setIsFetching] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const abortRef = useRef(null);
  const signatureRef = useRef(''); // tracks last data signature to skip redundant state updates

  // refs to individual charts for snapshot
  const tempRef = useRef(null);
  const humRef  = useRef(null);
  const ppmRef  = useRef(null);
  const phRef   = useRef(null);

  function makeSignature(json) {
    // Build a lightweight signature of the historical rows and ideals to avoid unnecessary re-renders
    const rows = Array.isArray(json?.historicalData) ? json.historicalData : [];
    const ideals = json?.idealConditions ?? {};
    const last = rows.length ? rows[rows.length - 1] : null;
    const parts = [
      rows.length,
      last?.timestamp || 'none',
      last?.temperature ?? 'x',
      last?.humidity ?? 'x',
      last?.ppm ?? 'x',
      last?.ph ?? 'x',
      ideals?.temp_min ?? 'x', ideals?.temp_max ?? 'x',
      ideals?.humidity_min ?? 'x', ideals?.humidity_max ?? 'x',
      ideals?.ppm_min ?? 'x', ideals?.ppm_max ?? 'x',
      ideals?.ph_min ?? 'x', ideals?.ph_max ?? 'x',
    ];
    return parts.join('|');
  }

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
      const nextPayload = {
        historicalData: Array.isArray(json?.historicalData) ? json.historicalData : [],
        idealConditions: json?.idealConditions ?? null,
        selectionStartTime: json?.selectionStartTime ?? null,
      };

      // Avoid updating state if nothing material changed
      const sig = makeSignature(nextPayload);
      if (sig !== signatureRef.current) {
        signatureRef.current = sig;
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
    if (!live) return () => { if (abortRef.current) abortRef.current.abort(); };
    const id = setInterval(() => { loadGrowth(); }, Math.max(1000, pollMs));
    return () => { clearInterval(id); if (abortRef.current) abortRef.current.abort(); };
  }, [show, live, pollMs]);

  const rows = payload?.historicalData ?? [];
  const ideals = payload?.idealConditions ?? null;
  const hasData = rows.length > 0;
  const isInitialLoading = showSkeletonOnFirstLoad && !hasLoadedOnceRef.current;

  const timeUnit = useMemo(() => {
    if (!hasData) return 'hour';
    const first = new Date(rows[0].timestamp).getTime();
    const last  = new Date(rows[rows.length - 1].timestamp).getTime();
    const spanHours = Math.max(1, (last - first) / 36e5);
    if (spanHours <= 24) return 'hour';
    if (spanHours <= 24 * 14) return 'day';
    return 'week';
  }, [rows, hasData]);

  // Expose snapshots to parent
  useImperativeHandle(ref, () => ({
    getSnapshots: () => {
      const snap = (r) => {
        const inst = r?.current;
        if (!inst) return null;
        const chart = inst?.canvas ? inst : inst?.chart || inst;
        try {
          const url = chart?.toBase64Image ? chart.toBase64Image('image/png', 1.0) : null;
          return url || null;
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
      {isInitialLoading && (
        <div style={{ height: 208, borderRadius: 10, background: '#e5e7eb', animation: 'pulse 1.5s ease-in-out infinite' }} />
      )}

      {error && !isInitialLoading && (
        <div style={{ color: 'crimson', marginBottom: 12 }}>{error}</div>
      )}

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

      {!isInitialLoading && hasData && (
        <div style={{ display: 'grid', gap: 24 }}>
          <MetricChart
            chartRef={tempRef}
            title="Temperature (°C)"
            unit="°C"
            field="temperature"
            rows={rows}
            idealMin={ideals?.temp_min ?? null}
            idealMax={ideals?.temp_max ?? null}
            timeUnit={timeUnit}
          />
          <MetricChart
            chartRef={humRef}
            title="Humidity (%)"
            unit="%"
            field="humidity"
            rows={rows}
            idealMin={ideals?.humidity_min ?? null}
            idealMax={ideals?.humidity_max ?? null}
            timeUnit={timeUnit}
          />
          <MetricChart
            chartRef={ppmRef}
            title="PPM (Nutrients)"
            unit=""
            field="ppm"
            rows={rows}
            idealMin={ideals?.ppm_min ?? null}
            idealMax={ideals?.ppm_max ?? null}
            timeUnit={timeUnit}
          />
          <MetricChart
            chartRef={phRef}
            title="pH Level"
            unit=""
            field="ph"
            rows={rows}
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
      )}
    </div>
  );
});

export default React.memo(HistoricalCharts);

/** One chart with an ideal-range green band + CURRENT value line (dashed) */
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

  // latest value for horizontal line
  const latestValue = useMemo(() => (
    points.length ? points[points.length - 1].y : null
  ), [points]);

  // Keep a stable dataset shape; just swap .data
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
      },
      // optional single-point highlight of latest (tiny marker, no line)
      latestValue != null ? {
        label: 'current',
        data: points.length ? [points[points.length - 1]] : [],
        parsing: false,
        borderWidth: 0,
        pointRadius: 3,
        showLine: false,
      } : undefined,
    ].filter(Boolean)
  }), [points, title, latestValue]);

  const annotations = useMemo(() => {
    const anns = {};
    if (idealMin != null && idealMax != null && idealMin <= idealMax) {
      anns.idealBand = {
        type: 'box',
        yMin: idealMin,
        yMax: idealMax,
        backgroundColor: 'rgba(16, 185, 129, 0.18)',
        borderWidth: 0,
      };
    }
    if (latestValue != null) {
      anns.currentLine = {
        type: 'line',
        yMin: latestValue,
        yMax: latestValue,
        borderColor: 'rgba(59,130,246,0.9)',
        borderWidth: 2,
        borderDash: [6, 6],
        label: {
          enabled: true,
          content: `Current: ${latestValue}${unit ? ` ${unit}` : ''}`,
          position: 'start',
          backgroundColor: 'rgba(255,255,255,0.7)',
          color: '#1f2937',
          padding: 4,
          borderRadius: 6,
        }
      };
    }
    return anns;
  }, [idealMin, idealMax, latestValue, unit]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    normalized: true,               // improve perf on large/irregular data
    animation: { duration: 0 },     // disable animations to prevent flicker
    transitions: { active: { animation: { duration: 0 } } },
    plugins: {
      legend: { display: false },
      title: { display: true, text: `${title}${unit ? `  (Ideal: ${idealMin ?? '—'}–${idealMax ?? '—'} ${unit})` : ''}` },
      tooltip: {
        mode: 'nearest',
        intersect: false,
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

  // Always render the Line (no conditional), even if points are empty, to avoid mount/unmount flicker
  return (
    <div style={{ height: 260, border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
      <Line ref={chartRef} data={data} options={options} updateMode="none" />
    </div>
  );
}

/* tiny css keyframes for skeleton (optional) */
const style = typeof document !== 'undefined' && document.createElement('style');
if (style) {
  style.innerHTML = `
  @keyframes pulse { 0%,100%{opacity:.6} 50%{opacity:1} }`;
  document.head.appendChild(style);
}
