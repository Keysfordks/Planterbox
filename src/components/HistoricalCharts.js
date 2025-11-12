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

const WINDOW_MS = 6 * 60 * 60 * 1000; // last 6 hours

const HistoricalCharts = forwardRef(function HistoricalCharts({ show }, ref) {
  const [error, setError] = useState(null);
  const [isFetching, setIsFetching] = useState(false);

  const abortRef = useRef(null);
  const hasLoadedOnceRef = useRef(false);

  // Accumulated rows live here (we build the time-series client-side)
  const accumRowsRef = useRef([]);           // array of { timestamp, temperature, humidity, ppm, ph, ... }
  const latestTsRef   = useRef(0);           // last timestamp we saw (ms)
  const allowBackfillRef = useRef(true);     // allow first response to seed with >1 rows if server provides

  // Chart refs
  const tempRef = useRef(null);
  const humRef  = useRef(null);
  const ppmRef  = useRef(null);
  const phRef   = useRef(null);

  // ---- DEBUG: mount tracing ----
  useEffect(() => {
    console.log('[HC] mounted at', new Date().toLocaleTimeString());
    return () => console.log('[HC] unmounted at', new Date().toLocaleTimeString());
  }, []);
  useEffect(() => {
    console.log('[HC] show prop ->', show, 'at', new Date().toLocaleTimeString());
  }, [show]);

  async function loadGrowth() {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsFetching(true);

    try {
      const res = await fetch('/api/sensordata?growth=true', { cache: 'no-store', signal: controller.signal });
      if (!res.ok) throw new Error(`Growth fetch failed (${res.status})`);
      const json = await res.json();

      const rows = Array.isArray(json?.historicalData) ? json.historicalData : [];
      console.log('[HC] fetched rows =', rows.length, 'at', new Date().toLocaleTimeString());

      // Normalize → ms timestamp + numeric fields
      const norm = rows.map(r => ({
        ...r,
        timestamp: Number(new Date(r.timestamp).getTime()),
        temperature: toNum(r.temperature),
        humidity:    toNum(r.humidity),
        ppm:         toNum(r.ppm),
        ph:          toNum(r.ph),
      })).filter(r => Number.isFinite(r.timestamp));

      // Seed with server history if we get it once (nice to have)
      if (allowBackfillRef.current && norm.length > 1) {
        accumRowsRef.current = mergeDedup(accumRowsRef.current, norm);
        latestTsRef.current = Math.max(latestTsRef.current, ...norm.map(r => r.timestamp));
        allowBackfillRef.current = false;
      } else if (norm.length > 0) {
        // Most APIs return the latest reading only → append if newer/unique
        const last = norm[norm.length - 1];
        if (last.timestamp > latestTsRef.current || !hasRow(accumRowsRef.current, last.timestamp)) {
          accumRowsRef.current.push(last);
          latestTsRef.current = Math.max(latestTsRef.current, last.timestamp);
        }
      }

      // Trim to sliding window
      const cutoff = Date.now() - WINDOW_MS;
      if (accumRowsRef.current.length) {
        accumRowsRef.current = accumRowsRef.current
          .filter(r => r.timestamp >= cutoff)
          .sort((a, b) => a.timestamp - b.timestamp);
      }

      setError(null);
      hasLoadedOnceRef.current = true;
      // Push data into charts
      updateAllCharts({ tempRef, humRef, ppmRef, phRef }, accumRowsRef.current, json?.idealConditions ?? null);
    } catch (e) {
      if (e?.name !== 'AbortError') {
        console.error('HistoricalCharts load error:', e);
        setError(e.message || 'Failed to load historical data');
      }
    } finally {
      setIsFetching(false);
    }
  }

  // Poll while visible
  useEffect(() => {
    if (!show) return;
    let timer;
    (async () => {
      await loadGrowth();
      timer = setInterval(loadGrowth, 5000);
    })();
    return () => { clearInterval(timer); if (abortRef.current) abortRef.current.abort(); };
  }, [show]);

  // Expose snapshots
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

  // Base chart configs (shared)
  const baseOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    normalized: true,
    animation: { duration: 150 },           // small animation so line "moves"
    transitions: { active: { animation: { duration: 0 } } },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: ctx => {
            const v = ctx.parsed.y;
            return `${v}${ctx.dataset._unit ? ` ${ctx.dataset._unit}` : ''} @ ${new Date(ctx.parsed.x).toLocaleString()}`;
          }
        }
      },
      annotation: { annotations: {} }
    },
    interaction: { mode: 'nearest', intersect: false },
    scales: {
      x: {
        type: 'time',
        time: { unit: 'minute' },
        grid: { display: false },
        ticks: { maxRotation: 0 }
      },
      y: {
        beginAtZero: false,
        grid: { color: 'rgba(0,0,0,0.08)' }
      }
    },
    elements: {
      line:   { borderWidth: 2, tension: 0.25, borderJoinStyle: 'round' },
      point:  { radius: 0 }
    }
  }), []);

  // Render 4 charts (each with stable data/options). We create empty datasets once and then mutate.
  return (
    <div style={{ padding: 16, position: 'relative' }}>
      {error && (
        <div style={{ color: 'crimson', marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ display: 'grid', gap: 24 }}>
        <MetricChart title="Temperature (°C)" unit="°C" field="temperature" instRef={tempRef} baseOptions={baseOptions} />
        <MetricChart title="Humidity (%)"     unit="%"  field="humidity"    instRef={humRef}  baseOptions={baseOptions} />
        <MetricChart title="PPM (Nutrients)"  unit=""   field="ppm"         instRef={ppmRef}  baseOptions={baseOptions} />
        <MetricChart title="pH Level"         unit=""   field="ph"          instRef={phRef}   baseOptions={baseOptions} />
      </div>

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
  );
});

export default HistoricalCharts;

// ---------- helpers ----------

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hasRow(arr, ts) {
  return arr.some(r => r.timestamp === ts);
}

function mergeDedup(a, b) {
  const map = new Map();
  [...a, ...b].forEach(r => map.set(r.timestamp, r));
  return Array.from(map.values()).sort((x, y) => x.timestamp - y.timestamp);
}

function updateAllCharts(refs, rows, ideals) {
  const { tempRef, humRef, ppmRef, phRef } = refs;
  const sharedIdeal = ideals || {};

  pushSeries(tempRef, rows, 'temperature', '°C', sharedIdeal.temp_min,    sharedIdeal.temp_max);
  pushSeries(humRef,  rows, 'humidity',    '%',  sharedIdeal.humidity_min,sharedIdeal.humidity_max);
  pushSeries(ppmRef,  rows, 'ppm',         '',   sharedIdeal.ppm_min,     sharedIdeal.ppm_max);
  pushSeries(phRef,   rows, 'ph',          '',   sharedIdeal.ph_min,      sharedIdeal.ph_max);
}

function pushSeries(ref, rows, field, unit, idealMin, idealMax) {
  const chart = ref.current;
  if (!chart) return;

  // Map to {x, y}
  const points = rows
    .map(r => {
      const y = r?.[field];
      return (y == null || Number.isNaN(y)) ? null : { x: r.timestamp, y: Number(y) };
    })
    .filter(Boolean);

  // Initialize dataset if needed
  if (!chart.data.datasets?.length) {
    chart.data.datasets = [{
      datasetIdKey: 'main',
      label: field,
      data: [],
      parsing: false,
      spanGaps: true,
      _unit: unit,
      fill: false,
      borderColor: '#111',         // dark black line
      backgroundColor: '#111',     // used for points if ever shown
      borderWidth: 3,
      tension: 0.25,
      shadowBlur: 6,
      shadowColor: 'rgba(0,0,0,0.4)'
}];


  }

  // Update data in place
  chart.data.datasets[0]._unit = unit;
  chart.data.datasets[0].data = points;

  // Ideal band
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

  // Title
  const titleText =
    unit
      ? `${titleize(field)} (${unit})  (Ideal: ${idealMin ?? '—'}–${idealMax ?? '—'} ${unit})`
      : `${titleize(field)}  (Ideal: ${idealMin ?? '—'}–${idealMax ?? '—'})`;

  if (!chart.options.plugins.title) chart.options.plugins.title = {};
  chart.options.plugins.title.display = true;
  chart.options.plugins.title.text = titleText;

  // X-axis unit auto (minute by default); keep it simple

  chart.update('none');
}

function titleize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * MetricChart: creates a stable ChartJS instance once, then we mutate via pushSeries().
 */
function MetricChart({ instRef, title, unit, field, baseOptions }) {
  const baseData = useMemo(() => ({ datasets: [] }), []);
  return (
    <div style={{ height: 260, border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
      <Line
        ref={(node) => {
          if (node && node !== instRef.current) {
            instRef.current = node;
            console.log('[HC] chart instance ready for', title, 'at', new Date().toLocaleTimeString());
          }
        }}
        data={baseData}
        options={baseOptions}
      />
    </div>
  );
}
