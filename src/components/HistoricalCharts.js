'use client';

import React, { useEffect, useMemo, useState } from 'react';
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

// ---------- utilities ----------
function coerceRows(raw) {
  // Ensure it's an array of plain objects with a timestamp
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .filter((r) => r && typeof r === 'object' && r.timestamp)
    .map((r) => {
      // Normalize fields; undefined values are kept as undefined (charts will skip)
      return {
        timestamp: r.timestamp,
        temperature: typeof r.temperature === 'number' ? r.temperature : undefined,
        humidity: typeof r.humidity === 'number' ? r.humidity : undefined,
        ph: typeof r.ph === 'number' ? r.ph : undefined,
        ppm: typeof r.ppm === 'number' ? r.ppm : undefined,
      };
    });
}

function buildPoints(rows, field) {
  // Build points only for rows that have a numeric value for the field
  return rows
    .filter((r) => typeof r?.[field] === 'number' && r.timestamp)
    .map((r) => ({ x: new Date(r.timestamp), y: r[field] }));
}

export default function HistoricalCharts({ show }) {
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);

  async function loadGrowth() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/sensordata?growth=true', { cache: 'no-store' });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Growth fetch failed (${res.status}): ${text.slice(0, 200)}`);
      }
      const json = await res.json();

      setPayload({
        historicalData: coerceRows(json?.historicalData),
        idealConditions: json?.idealConditions ?? null,
        selectionStartTime: json?.selectionStartTime ?? null,
        selection: json?.selection ?? null,
      });
    } catch (e) {
      console.error('HistoricalCharts load error:', e);
      setError(e.message || 'Failed to load historical data');
      setPayload({
        historicalData: [],
        idealConditions: null,
        selectionStartTime: null,
        selection: null,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (show) loadGrowth();
  }, [show]);

  const rows = payload?.historicalData ?? [];
  const ideals = payload?.idealConditions ?? null;
  const hasAnyData = rows.length > 0;

  const timeUnit = useMemo(() => {
    if (!hasAnyData) return 'hour';
    const first = new Date(rows[0].timestamp).getTime();
    const last = new Date(rows[rows.length - 1].timestamp).getTime();
    const spanHours = Math.max(1, (last - first) / 36e5);
    if (spanHours <= 24) return 'hour';
    if (spanHours <= 24 * 14) return 'day';
    return 'week';
  }, [rows, hasAnyData]);

  return (
    <div style={{ padding: 16 }}>
      {loading && <div>Loading historical data…</div>}
      {!loading && error && (
        <div style={{ color: 'crimson', marginBottom: 12 }}>{error}</div>
      )}

      {!loading && !hasAnyData && (
        <div style={{ lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No Historical Data Found</div>
          <div>
            No sensor data available since plant selection (
            {payload?.selectionStartTime ? new Date(payload.selectionStartTime).toLocaleString() : 'N/A'}
            ).
          </div>
        </div>
      )}

      {!loading && hasAnyData && (
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
        </div>
      )}
    </div>
  );
}

/** One chart with an ideal-range green band and strong guards */
function MetricChart({ title, unit, field, rows, idealMin, idealMax, timeUnit }) {
  const points = useMemo(() => buildPoints(rows, field), [rows, field]);

  const data = {
    datasets: [
      {
        label: title,
        data: points,
        parsing: false,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.25,
        fill: false
      }
    ]
  };

  const annotations = {};
  if (
    typeof idealMin === 'number' &&
    typeof idealMax === 'number' &&
    idealMin <= idealMax
  ) {
    annotations.idealBand = {
      type: 'box',
      yMin: idealMin,
      yMax: idealMax,
      backgroundColor: 'rgba(16, 185, 129, 0.18)', // translucent green
      borderWidth: 0
    };
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text:
          unit
            ? `${title}  (Ideal: ${idealMin ?? '—'}–${idealMax ?? '—'} ${unit})`
            : `${title}  (Ideal: ${idealMin ?? '—'}–${idealMax ?? '—'})`
      },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const v = ctx.parsed.y;
            const x = ctx.parsed.x ? new Date(ctx.parsed.x).toLocaleString() : '';
            const u = unit ? ` ${unit}` : '';
            return `${v}${u} @ ${x}`;
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
        ticks: { maxRotation: 0 }
      },
      y: {
        beginAtZero: false,
        grid: { color: 'rgba(0,0,0,0.08)' },
        ticks: { callback: (v) => `${v}${unit ? ` ${unit}` : ''}` }
      }
    },
    elements: {
      line: { borderJoinStyle: 'round' }
    }
  };

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
