'use client';

import React, { useEffect, useMemo, useState } from 'react';

// If you already use react-chartjs-2 & Chart.js, keep your imports.
// This version renders a simple fallback if no data; you can wire charts back in where indicated.

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
      // Ensure structure is present to avoid null access
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

  // Safely normalize the ideals for UI (may be null)
  const ideals = useMemo(() => {
    const ic = payload?.idealConditions;
    if (!ic) return null;
    return {
      temperature: { min: ic?.temp_min ?? null,     max: ic?.temp_max ?? null },
      humidity:    { min: ic?.humidity_min ?? null, max: ic?.humidity_max ?? null },
      ph:          { min: ic?.ph_min ?? null,       max: ic?.ph_max ?? null },
      ppm:         { min: ic?.ppm_min ?? null,      max: ic?.ppm_max ?? null },
    };
  }, [payload]);

  const rows = payload?.historicalData ?? [];
  const hasData = rows.length > 0;

  return (
    <div style={{ padding: 16, minHeight: 200 }}>
      {loading && <div>Loading historical data…</div>}
      {!loading && error && (
        <div style={{ color: 'crimson', marginBottom: 12 }}>
          {error}
        </div>
      )}

      {!loading && !hasData && (
        <div style={{ lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No Historical Data Found</div>
          <div>
            No sensor data available since plant selection (
            {payload?.selectionStartTime ? new Date(payload.selectionStartTime).toLocaleString() : 'N/A'}
            ).
          </div>
          {/* Optional: show current ideals if available */}
          {ideals ? (
            <div style={{ marginTop: 12, opacity: 0.85 }}>
              <div><b>Ideal Ranges</b></div>
              <div>Temp: {ideals.temperature.min ?? '—'} – {ideals.temperature.max ?? '—'} °C</div>
              <div>Humidity: {ideals.humidity.min ?? '—'} – {ideals.humidity.max ?? '—'} %</div>
              <div>pH: {ideals.ph.min ?? '—'} – {ideals.ph.max ?? '—'}</div>
              <div>PPM: {ideals.ppm.min ?? '—'} – {ideals.ppm.max ?? '—'}</div>
            </div>
          ) : (
            <div style={{ marginTop: 12, opacity: 0.7 }}>
              Ideal ranges unavailable.
            </div>
          )}
        </div>
      )}

      {!loading && hasData && (
        <div>
          {/* ====== PLACE YOUR CHARTS HERE ======
              This guard ensures we only render charts when data exists.
              Use rows[] for datasets; use "ideals" for shaded bands or annotations.
              Example:
              - x: new Date(row.timestamp)
              - y: row.temperature / humidity / ph / ppm
          */}
          <div style={{ marginBottom: 8 }}>
            <b>Data points:</b> {rows.length}
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            {/* Temperature preview table (simple, safe) */}
            <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                Temperature (°C) 
                <span style={{ fontWeight: 400, marginLeft: 8, opacity: 0.8 }}>
                  Ideal: {ideals?.temperature?.min ?? '—'}–{ideals?.temperature?.max ?? '—'}
                </span>
              </div>
              <MiniTable rows={rows} field="temperature" />
            </div>

            {/* Humidity */}
            <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                Humidity (%) 
                <span style={{ fontWeight: 400, marginLeft: 8, opacity: 0.8 }}>
                  Ideal: {ideals?.humidity?.min ?? '—'}–{ideals?.humidity?.max ?? '—'}
                </span>
              </div>
              <MiniTable rows={rows} field="humidity" />
            </div>

            {/* PPM */}
            <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                PPM (Nutrients) 
                <span style={{ fontWeight: 400, marginLeft: 8, opacity: 0.8 }}>
                  Ideal: {ideals?.ppm?.min ?? '—'}–{ideals?.ppm?.max ?? '—'}
                </span>
              </div>
              <MiniTable rows={rows} field="ppm" />
            </div>

            {/* pH */}
            <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                pH Level 
                <span style={{ fontWeight: 400, marginLeft: 8, opacity: 0.8 }}>
                  Ideal: {ideals?.ph?.min ?? '—'}–{ideals?.ph?.max ?? '—'}
                </span>
              </div>
              <MiniTable rows={rows} field="ph" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Tiny safe preview table; you can replace with actual charts.
function MiniTable({ rows, field }) {
  if (!rows?.length) return <div style={{ opacity: 0.7 }}>No data</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', rowGap: 6 }}>
      {rows.slice(-10).map((r, idx) => (
        <React.Fragment key={idx}>
          <div style={{ opacity: 0.8 }}>{new Date(r.timestamp).toLocaleString()}</div>
          <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {r?.[field] ?? '—'}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
