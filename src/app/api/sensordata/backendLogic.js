import clientPromise from '../../../lib/mongodb';

// =================== CONFIG (tunable) ===================
// Hard settle delay after ANY pump activity:
const SETTLING_MS = 2 * 60 * 1000; // 2 minutes

// How long the whole PPM set (A then B) takes on the device, *before* the settle.
// If your ESP32 does A (X sec) → waits 120s → B (Y sec), set this to 120000 + X + Y.
// If unknown, a safe conservative default is 2 minutes (just the A→B gap).
const PPM_SET_EXEC_MS_DEFAULT = 120000; // adjust if your device runs longer

// Optionally override from DB (app_state.systemConfig.value.ppmSetExecMs)
async function fetchPpmExecMs(db) {
  const cfg = await db.collection('app_state').findOne({ state_name: 'systemConfig' });
  const v = cfg?.value?.ppmSetExecMs;
  return Number.isFinite(v) && v >= 0 ? v : PPM_SET_EXEC_MS_DEFAULT;
}
// =======================================================

const inRange = (v, min, max) =>
  typeof v === 'number' && min != null && max != null && v >= min && v <= max;

// ---------- LIGHT HELPERS ----------
function isLightOnNow(hoursPerDay, startHour = 6, now = new Date()) {
  const hrs = Math.max(0, Math.min(24, Number(hoursPerDay) || 0));
  if (hrs === 0) return false;
  if (hrs >= 24) return true;

  const start = ((Number(startHour) || 0) % 24 + 24) % 24;
  const end = (start + hrs) % 24;
  const current = now.getHours();
  return start < end ? (current >= start && current < end) : (current >= start || current < end);
}

function computeDaylightPWM(hoursPerDay, startHour = 6, now = new Date(), rampMinutes = 60) {
  const hrs = Math.max(0, Math.min(24, Number(hoursPerDay) || 0));
  if (hrs <= 0) return 0;
  if (hrs >= 24) return 255;

  const start = ((Number(startHour) || 0) % 24 + 24) % 24;
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const minutesStart = start * 60;
  const minutesEnd = (minutesStart + hrs * 60) % (24 * 60);
  const onNow = isLightOnNow(hrs, start, now);
  if (!onNow) return 0;

  const distForward = (from, to) => (to - from + 1440) % 1440;
  const sinceStart = distForward(minutesStart, minutesNow);
  const untilEnd = distForward(minutesNow, minutesEnd);

  const plateau = 255;
  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.max(0, Math.min(1, x)) * Math.PI);

  if (sinceStart < rampMinutes) return Math.round(plateau * ease(sinceStart / rampMinutes));
  if (untilEnd < rampMinutes) return Math.round(plateau * ease(1 - untilEnd / rampMinutes));
  return plateau;
}

// ---------- BUSY / COOLDOWN STATE ----------
// We now treat dosing as a single “busy” window regardless of PH or PPM.
// Schema: app_state: { state_name:'dosingBusy', userId: deviceId, value:{ untilISO } }

async function getBusy(db, deviceId) {
  const doc = await db.collection('app_state').findOne({ state_name: 'dosingBusy', userId: deviceId });
  const until = doc?.value?.untilISO ? new Date(doc.value.untilISO) : null;
  return until && until > new Date() ? until : null;
}

/**
 * Reserve a busy window ending at `Date.now() + durationMs`.
 * During busy window, *all* pump commands are blocked.
 */
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
 * Light: `light_pwm_cycle` = HOURS PER DAY (0–24). PWM is 0–255 with sunrise/sunset ramps.
 *
 * Dosing rules (updated):
 *  • After ANY pump turns on, there’s a mandatory 2-minute busy window that blocks all dosing.
 *  • Exception: the window should NOT interrupt PPM A→B (we assume the device sequences A then B itself).
 *    So when we request a PPM set, we reserve a busy window long enough to cover the whole A→B execution
 *    **plus** the post-B 2-minute settle. (Configurable via `ppmSetExecMs`.)
 */
export async function processSensorData(latestData, selectedPlant, selectedStage, ownerId, deviceId = 'default_device') {
  const client = await clientPromise;
  const db = client.db('planterbox');
  const plantProfiles = db.collection('plant_profiles');

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
    light_pwm_cycle // HOURS PER DAY (0–24)
  } = ideal;

  const sensorStatus = {
    temperature: inRange(temperature, temp_min, temp_max) ? 'IDEAL' : 'NOT IDEAL',
    humidity: inRange(humidity, humidity_min, humidity_max) ? 'IDEAL' : 'NOT IDEAL',
    ph: inRange(ph, ph_min, ph_max) ? 'IDEAL' : 'NOT IDEAL',
    ppm: (typeof ppm === 'number' && ppm_max != null && ppm > ppm_max)
      ? 'DILUTE_WATER'
      : (inRange(ppm, ppm_min, ppm_max) ? 'IDEAL' : 'NOT IDEAL')
  };

  // Light output
  const hoursPerDay = Math.max(0, Math.min(24, Number(light_pwm_cycle) || 0));
  const light = computeDaylightPWM(hoursPerDay, 6, new Date(), 60);

  // Need flags
  const needPhUp = typeof ph === 'number' && ph_min != null && ph < ph_min;
  const needPhDown = typeof ph === 'number' && ph_max != null && ph > ph_max;
  const needPPM = typeof ppm === 'number' && ppm_min != null && ppm < ppm_min;

  let ph_up_pump = false;
  let ph_down_pump = false;
  let ppm_a_pump = false;
  let ppm_b_pump = false;

  // Check global busy window
  const busyUntil = await getBusy(db, deviceId);
  const busy = !!busyUntil;

  if (!busy) {
    // Choose *one* thing to do this tick. Priority: pH corrections first (usually safer), then PPM.
    if (needPhUp || needPhDown) {
      ph_up_pump = needPhUp;
      ph_down_pump = needPhDown;
      // Any PH pump starts a 2-minute settle window
      await setBusy(db, deviceId, SETTLING_MS);
    } else if (needPPM) {
      // Ask device to run the full PPM set (A→B). We block everything else during that run,
      // and for 2 minutes afterwards.
      const ppmExecMs = await fetchPpmExecMs(db);
      await setBusy(db, deviceId, ppmExecMs + SETTLING_MS);
      ppm_a_pump = true;
      ppm_b_pump = true;
    }
  }
  // else: still busy → no dosing commands issued this tick.

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
