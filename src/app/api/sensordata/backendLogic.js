import clientPromise from '../../../lib/mongodb';

// =================== CONFIG (tunable) ===================
// Mandatory settle delay after ANY pump activity (PH or PPM).
const SETTLING_MS = 2 * 60 * 1000; // 2 minutes

// Duration the device needs to finish a full PPM set A→(gap)→B (BEFORE the post-B settle).
// If your ESP32 does: A for X ms → wait 120000 ms → B for Y ms,
// set this to: X + 120000 + Y. If unknown, use a conservative default.
const PPM_SET_EXEC_MS_DEFAULT = 120000;

// Optionally override via DB (app_state.systemConfig.value.ppmSetExecMs)
async function fetchPpmExecMs(db) {
  const cfg = await db.collection('app_state').findOne({ state_name: 'systemConfig' });
  const v = cfg?.value?.ppmSetExecMs;
  return Number.isFinite(v) && v >= 0 ? v : PPM_SET_EXEC_MS_DEFAULT;
}
// =======================================================

// ————— helpers —————
const inRange = (v, min, max) =>
  typeof v === 'number' && min != null && max != null && v >= min && v <= max;

/** Return true if "now" is inside the ON window of length `hoursPerDay` starting at `startHour`. */
function isLightOnNow(hoursPerDay, startHour = 6, now = new Date()) {
  const hrs = Math.max(0, Math.min(24, Number(hoursPerDay) || 0));
  if (hrs === 0) return false;
  if (hrs >= 24) return true;

  const start = ((Number(startHour) || 0) % 24 + 24) % 24;
  const end = (start + hrs) % 24;
  const h = now.getHours();

  if (start < end) return h >= start && h < end;
  return h >= start || h < end; // wraps midnight
}

/** Smooth daylight PWM (0–255) with dawn/dusk ramps. */
function computeDaylightPWM(hoursPerDay, startHour = 6, now = new Date(), rampMinutes = 60) {
  const hrs = Math.max(0, Math.min(24, Number(hoursPerDay) || 0));
  if (hrs <= 0) return 0;
  if (hrs >= 24) return 255;

  // minutes since midnight
  const start = ((Number(startHour) || 0) % 24 + 24) % 24;
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const minutesStart = start * 60;
  const minutesEnd = (minutesStart + hrs * 60) % (24 * 60);

  if (!isLightOnNow(hrs, start, now)) return 0;

  // forward distance around a 24h ring
  const distFwd = (from, to) => (to - from + 1440) % 1440;

  const sinceStart = distFwd(minutesStart, minutesNow);
  const untilEnd   = distFwd(minutesNow, minutesEnd);

  const plateau = 255;
  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.max(0, Math.min(1, x)) * Math.PI);

  // Dawn ramp
  if (sinceStart < rampMinutes) return Math.round(plateau * ease(sinceStart / rampMinutes));
  // Dusk ramp
  if (untilEnd < rampMinutes)   return Math.round(plateau * ease(1 - untilEnd / rampMinutes));
  // Midday steady
  return plateau;
}

// ---------- Global dosing busy window ----------
// We block ALL new dosing while busy. Carve-out: when we *start* a PPM set,
// we pre-reserve a busy window that already covers the entire A→B run + post-B 2-minute settle.

// app_state doc: { state_name:'dosingBusy', userId:<deviceId>, value:{ untilISO: <iso> } }

async function getBusy(db, deviceId) {
  const doc = await db.collection('app_state').findOne({ state_name: 'dosingBusy', userId: deviceId });
  const until = doc?.value?.untilISO ? new Date(doc.value.untilISO) : null;
  return until && until > new Date() ? until : null;
}

async function setBusy(db, deviceId, durationMs) {
  const until = new Date(Date.now() + Math.max(0, durationMs | 0));
  await db.collection('app_state').updateOne(
    { state_name: 'dosingBusy', userId: deviceId },
    { $set: { value: { untilISO: until.toISOString() } } },
    { upsert: true }
  );
  return until;
}

/**
 * Decide device commands from latest sensor sample and the selected plant profile.
 * Light: `light_pwm_cycle` = HOURS PER DAY (0–24). Uses sunrise/sunset ramps for PWM (0–255).
 *
 * Dosing rules:
 *  • After ANY pump starts, we set a GLOBAL busy window (2 minutes) that blocks all new dosing.
 *  • For nutrients (PPM set A→B), we reserve busy for (A→B exec time) + 2 minutes settle.
 *    That prevents pH from triggering between A and B and enforces a settle after B.
 *
 * @param {Object} latestData          Sensor sample ({temperature, humidity, ph, ppm, ...})
 * @param {string} selectedPlant
 * @param {string} selectedStage
 * @param {string|undefined} ownerId   Profile owner if applicable
 * @param {string} deviceId            Device scope for busy window
 */
export async function processSensorData(latestData, selectedPlant, selectedStage, ownerId, deviceId = 'default_device') {
  const client = await clientPromise;
  const db = client.db('planterbox');
  const plantProfiles = db.collection('plant_profiles');

  // Prefer user-owned profile, fall back to global
  const profile = await plantProfiles.findOne(
    {
      plant_name: selectedPlant,
      stage: selectedStage,
      ...(ownerId
        ? { $or: [{ userId: ownerId }, { userId: { $exists: false } }] }
        : { userId: { $exists: false } })
    },
    { sort: ownerId ? { userId: -1 } : undefined }
  );

  const ideal = profile?.ideal_conditions;
  if (!ideal || !latestData) {
    return {
      deviceCommands: {
        light: 0,
        light_hours_per_day: 0,
        ph_up_pump: false,
        ph_down_pump: false,
        ppm_a_pump: false,
        ppm_b_pump: false
      },
      sensorStatus: { temperature: 'UNKNOWN', humidity: 'UNKNOWN', ph: 'UNKNOWN', ppm: 'UNKNOWN' },
      ideal: null
    };
  }

  const { temperature, humidity, ph, ppm } = latestData;
  const {
    temp_min, temp_max,
    humidity_min, humidity_max,
    ph_min, ph_max,
    ppm_min, ppm_max,
    light_pwm_cycle // HOURS/DAY
  } = ideal;

  // Status for UI
  const sensorStatus = {
    temperature: inRange(temperature, temp_min, temp_max) ? 'IDEAL' : 'NOT IDEAL',
    humidity:    inRange(humidity,    humidity_min, humidity_max) ? 'IDEAL' : 'NOT IDEAL',
    ph:          inRange(ph,          ph_min,       ph_max)       ? 'IDEAL' : 'NOT IDEAL',
    ppm: (typeof ppm === 'number' && ppm_max != null && ppm > ppm_max)
         ? 'DILUTE_WATER'
         : (inRange(ppm, ppm_min, ppm_max) ? 'IDEAL' : 'NOT IDEAL')
  };

  // Smooth daylight PWM
  const hoursPerDay = Math.max(0, Math.min(24, Number(light_pwm_cycle) || 0));
  const light = computeDaylightPWM(hoursPerDay, /*startHour=*/6, new Date(), /*rampMinutes=*/60);

  // Dosing needs
  const needPhUp   = typeof ph  === 'number' && ph_min  != null && ph  < ph_min;
  const needPhDown = typeof ph  === 'number' && ph_max  != null && ph  > ph_max;
  const needPPM    = typeof ppm === 'number' && ppm_min != null && ppm < ppm_min;

  let ph_up_pump = false;
  let ph_down_pump = false;
  let ppm_a_pump = false;
  let ppm_b_pump = false;

  // Respect global busy window
  const busy = !!(await getBusy(db, deviceId));

  if (!busy) {
    // Choose ONE thing to do per tick. Priority: correct pH before nutrients.
    if (needPhUp || needPhDown) {
      ph_up_pump = needPhUp;
      ph_down_pump = needPhDown;
      // Any pH pump → start a 2-minute settle window
      await setBusy(db, deviceId, SETTLING_MS);
    } else if (needPPM) {
      // Start full PPM set (A and B). Reserve busy to cover the whole run + 2-min settle.
      const ppmExecMs = await fetchPpmExecMs(db); // X + gap + Y
      await setBusy(db, deviceId, ppmExecMs + SETTLING_MS);
      ppm_a_pump = true;
      ppm_b_pump = true;
    }
  }
  // else: still busy → no dosing commands this tick.

  return {
    deviceCommands: {
      light,
      light_hours_per_day: hoursPerDay,
      ph_up_pump,
      ph_down_pump,
      ppm_a_pump,
      ppm_b_pump
    },
    sensorStatus,
    ideal
  };
}
