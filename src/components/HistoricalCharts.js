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
        throw new Error(`Growth fetch failed (${res.status}): ${text.slice(0, 180)}`);
      }
      const json = await res.json();
      setPayload({
        historicalData: Array.isArray(json?.historicalData) ? json.historicalData : [],
        idealConditions: json?.idealConditions ?? null,
        selectionStartTime: json?.selectionStartTime ?? null,
      });
    } catch (e) {
      console.error('HistoricalCharts load error:', e);
      setError(e.message || 'Failed to load historical data');
      setPayload({
        historicalData: [],
        idealConditions: null,
        selectionStartTime: null,
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
  const hasData = rows.length > 0;

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
    <div style={{ padding: 16 }}>
      {loading && <div>Loading historical data…</div>}
      {!loading && error && <div style={{ color: 'crimson', marginBottom: 12 }}>{error}</div>}

      {!loading && !hasData && (
        <div style={{ lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No Historical Data Found</div>
          <div>
            No sensor data available since plant selection (
            {payload?.selectionStartTime ? new Date(payload.selectionStartTime).toLocaleString() : 'N/A'}
            ).
          </div>
        </div>
      )}

      {!loading && hasData && (
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

/** One chart with an ideal-range green band */
function MetricChart({ title, unit, field, rows, idealMin, idealMax, timeUnit }) {
  // Build (x,y) points; skip nulls
  const points = rows
    .map(r => {
      const y = r?.[field];
      if (y == null || Number.isNaN(y)) return null;
      return { x: new Date(r.timestamp), y: Number(y) };
    })
    .filter(Boolean);

  const data = {
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
  };

  const annotations = {};
  if (idealMin != null && idealMax != null && idealMin <= idealMax) {
    annotations.idealBand = {
      type: 'box',
      yMin: idealMin,
      yMax: idealMax,
      backgroundColor: 'rgba(16, 185, 129, 0.18)', // translucent green
      borderWidth: 0,
    };
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: { display: true, text: `${title}${unit ? `  (Ideal: ${idealMin ?? '—'}–${idealMax ?? '—'} ${unit})` : ''}` },
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
  };

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
