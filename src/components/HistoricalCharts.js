'use client';

import React, {
  forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState
} from 'react';
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
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [isFetching, setIsFetching] = useState(false);

  const hasLoadedOnceRef = useRef(false);
  const abortRef = useRef(null);
  const lastGoodRowsRef = useRef([]); // keep last non-empty dataset

  // refs to ChartJS instances
  const tempRef = useRef(null);
  const humRef  = useRef(null);
  const ppmRef  = useRef(null);
  const phRef   = useRef(null);

  // ---- DEBUG: mount/unmount tracing ----
  useEffect(() => {
    console.log('[HC] mounted at', new Date().toLocaleTimeString());
    return () => console.log('[HC] unmounted at', new Date().toLocaleTimeString());
  }, []);

  // ---- DEBUG: show prop changes (should flip only when you open/close modal) ----
  useEffect(() => {
    console.log('[HC] show prop ->', show, 'at', new Date().toLocaleTimeString());
  }, [show]);

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

      const rows = Array.isArray(json?.historicalData) ? json.historicalData : [];
      const nextPayload = {
        historicalData: rows,
        idealConditions: json?.idealConditions ?? null,
        selectionStartTime: json?.selectionStartTime ?? null,
      };

      // ---- DEBUG: incoming row count per poll ----
      console.log('[HC] fetched rows =', rows.length, 'at', new Date().toLocaleTimeString());

      if (rows.length > 0) {
        lastGoodRowsRef.current = rows;
        setPayload(nextPayload);
      } else if (hasLoadedOnceRef.current && lastGoodRowsRef.current.length > 0) {
        setPayload(prev => ({
          historicalData: lastGoodRowsRef.current,
          idealConditions: nextPayload.idealConditions,
          selectionStartTime: nextPayload.selectionStartTime,
        }));
      } else {
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

  // Poll every 5s while visible
  useEffect(() => {
    if (!show) return;
    let timer;
    (async () => {
      await loadGrowth();
      timer = setInterval(loadGrowth, 5000);
    })();
    return () => { clearInterval(timer); if (abortRef.current) abortRef.current.abort(); };
  }, [show]);

  const rows = payload?.historicalData ?? [];
  const ideals = payload?.idealConditions ?? null;
  const hasDataNow = rows.length > 0;
  const hasDataEver = hasLoadedOnceRef.current || hasDataNow;
  const isInitialLoading = !hasLoadedOnceRef.current && !error && !hasDataNow;

  const timeUnit = useMemo(() => {
    const src = hasDataNow ? rows : lastGoodRowsRef.current;
    if (!src || src.length < 2) return 'hour';
    const first = new Date(src[0].timestamp).getTime();
    const last  = new Date(src[src.length - 1].timestamp).getTime();
    const spanHours = Math.max(1, (last - first) / 36e5);
    if (spanHours <= 24) return 'hour';
    if (spanHours <= 24 * 14) return 'day';
    return 'week';
  }, [rows, hasDataNow]);

  // Snapshots for parent
  useImperativeHandle(ref, () => ({
    getSnapshots: () => {
      const grab = (r) => {
        const chart = r?.current;
        try { return chart?.toBase64Image?.('image/png', 1.0) ?? null; } catch { return null; }
      };
      return {
        temperature: grab(tempRef),
        humidity:    grab(humRef),
        ppm:         grab(ppmRef),
        ph:          grab(phRef),
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

      {hasDataEver ? (
        <div style={{ display: 'grid', gap: 24 }}>
          <MetricChart
            instRef={tempRef}
            title="Temperature (°C)"
            unit="°C"
            field="temperature"
            rows={hasDataNow ? rows : lastGoodRowsRef.current}
            idealMin={ideals?.temp_min ?? null}
            idealMax={ideals?.temp_max ?? null}
            timeUnit={timeUnit}
          />
          <MetricChart
            instRef={humRef}
            title="Humidity (%)"
            unit="%"
            field="humidity"
            rows={hasDataNow ? rows : lastGoodRowsRef.current}
            idealMin={ideals?.humidity_min ?? null}
            idealMax={ideals?.humidity_max ?? null}
            timeUnit={timeUnit}
          />
          <MetricChart
            instRef={ppmRef}
            title="PPM (Nutrients)"
            unit=""
            field="ppm"
            rows={hasDataNow ? rows : lastGoodRowsRef.current}
            idealMin={ideals?.ppm_min ?? null}
            idealMax={ideals?.ppm_max ?? null}
            timeUnit={timeUnit}
          />
          <MetricChart
            instRef={phRef}
            title="pH Level"
            unit=""
            field="ph"
            rows={hasDataNow ? rows : lastGoodRowsRef.current}
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

/**
 * MetricChart
 * - Renders a single <Line> and mutates the ChartJS instance in place.
 * - Prevents re-init flicker by never replacing data/options objects during updates.
 */
function MetricChart({ instRef, title, unit, field, rows, idealMin, idealMax, timeUnit }) {
  // map to points
  const points = useMemo(() => (
    rows
      .map(r => {
        const y = r?.[field];
        if (y == null || Number.isNaN(y)) return null;
        return { x: new Date(r.timestamp), y: Number(y) };
      })
      .filter(Boolean)
  ), [rows, field]);

  // stable data/options ONCE
  const baseData = useMemo(() => ({
    datasets: [
      {
        datasetIdKey: 'main',
        label: title,
        data: [],
        parsing: false,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.25,
        fill: false,
        spanGaps: true,
      }
    ]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const baseOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    normalized: true,
    animation: { duration: 0 },
    transitions: { active: { animation: { duration: 0 } } },
    plugins: {
      legend: { display: false },
      title: { display: true, text: '' },
      tooltip: {
        callbacks: {
          label: ctx => {
            const v = ctx.parsed.y;
            const u = unit ? ` ${unit}` : '';
            return `${v}${u} @ ${new Date(ctx.parsed.x).toLocaleString()}`;
          }
        }
      },
      annotation: { annotations: {} }
    },
    interaction: { mode: 'nearest', intersect: false },
    scales: {
      x: { type: 'time', time: { unit: timeUnit }, grid: { display: false }, ticks: { maxRotation: 0 } },
      y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.08)' }, ticks: { callback: v => `${v}${unit ? ` ${unit}` : ''}` } }
    },
    elements: { line: { borderJoinStyle: 'round' } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // update instance imperatively when inputs change
  useEffect(() => {
    const chart = instRef.current;
    if (!chart) return;

    // ---- DEBUG: confirm we are not recreating the canvas ----
    console.log('[HC] updating chart', title, 'points=', points.length, 'unit=', timeUnit);

    chart.data.datasets[0].data = points;

    const annotations =
      (idealMin == null || idealMax == null || idealMin > idealMax)
        ? {}
        : {
            idealBand: {
              type: 'box',
              yMin: idealMin,
              yMax: idealMax,
              backgroundColor: 'rgba(16, 185, 129, 0.18)',
              borderWidth: 0,
            }
          };

    chart.options.plugins.annotation.annotations = annotations;
    chart.options.plugins.title.text =
      `${title}${unit ? `  (Ideal: ${idealMin ?? '—'}–${idealMax ?? '—'} ${unit})` : ''}`;

    if (chart.options.scales?.x?.time?.unit !== timeUnit) {
      chart.options.scales.x.time.unit = timeUnit;
    }

    chart.update('none');
  }, [points, idealMin, idealMax, timeUnit, title, unit, instRef]);

  return (
    <div style={{ height: 260, border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
      <Line
        ref={(node) => {
          if (node && node !== instRef.current) {
            instRef.current = node;
            // ---- DEBUG: when ChartJS instance is first attached ----
            console.log('[HC] chart instance ready for', title, 'at', new Date().toLocaleTimeString());
          }
        }}
        data={baseData}
        options={baseOptions}
      />
    </div>
  );
}

/* tiny css keyframes for skeleton (optional) */
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.innerHTML = `@keyframes pulse { 0%,100%{opacity:.6} 50%{opacity:1} }`;
  document.head.appendChild(style);
}
