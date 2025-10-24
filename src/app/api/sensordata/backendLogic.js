import clientPromise from '../../../lib/mongodb';

// =================== LIGHT HELPERS (smooth sunrise/sunset) ===================
const inRange = (v, min, max) =>
  typeof v === 'number' && min != null && max != null && v >= min && v <= max;

function isLightOnNow(hoursPerDay, startHour = 6, now = new Date()) {
  const hrs = Math.max(0, Math.min(24, Number(hoursPerDay) || 0));
  if (hrs === 0) return false;
  if (hrs >= 24) return true;
  const start = ((Number(startHour) || 0) % 24 + 24) % 24;
  const end = (start + hrs) % 24;
  const h = now.getHours();
  return start < end ? (h >= start && h < end) : (h >= start || h < end);
}

function computeDaylightPWM(hoursPerDay, startHour = 6, now = new Date(), rampMinutes = 60) {
  const hrs = Math.max(0, Math.min(24, Number(hoursPerDay) || 0));
  if (hrs <= 0) return 0;
  if (hrs >= 24) return 255;

  const start = ((Number(startHour) || 0) % 24 + 24) % 24;
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const minutesStart = start * 60;
  const minutesEnd = (minutesStart + hrs * 60) % (24 * 60);
  if (!isLightOnNow(hrs, start, now)) return 0;

  const distFwd = (from, to) => (to - from + 1440) % 1440;
  const sinceStart = distFwd(minutesStart, minutesNow);
  const untilEnd   = distFwd(minutesNow, minutesEnd);

  const plateau = 255;
  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.max(0, Math.min(1, x)) * Math.PI);

  if (sinceStart < rampMinutes) return Math.round(plateau * ease(sinceStart / rampMinutes));
  if (untilEnd < rampMinutes)   return Math.round(plateau * ease(1 - untilEnd / rampMinutes));
  return plateau;
}

// =================== MAIN DECIDER ===================
/**
 * Returns pump commands and a lockout hint for the ESP32 to enforce locally.
 * Rules:
 *  • Choose ONE action per tick (priority: pH correction, then nutrients).
 *  • If pH is low → ph_up_pump = true; if high → ph_down_pump = true.
 *  • If ppm low → ppm_a_pump = true & ppm_b_pump = true (device handles A→B sequence).
 *  • Include lockout_ms when any pump command is issued (default 120000 = 2 min).
 *    The ESP32 will enforce:
 *       - pH start → 2 min lockout.
 *       - PPM A→B start → (A+B exec time on device) + 2 min post-B lockout.
 */
export async function processSensorData(latestData, selectedPlant, selectedStage, ownerId) {
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
    { sort: ownerId ? { userId: -1, updatedAt: -1, createdAt: -1 } : { updatedAt: -1, createdAt: -1 } }
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
        ppm_b_pump: false,
        lockout_ms: 0
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
    light_pwm_cycle // HOURS/DAY (0–24)
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

  // Choose ONE action per tick (pH first, else PPM)
  let ph_up_pump = false, ph_down_pump = false, ppm_a_pump = false, ppm_b_pump = false, lockout_ms = 0;

  if (needPhUp || needPhDown) {
    ph_up_pump = needPhUp;
    ph_down_pump = needPhDown;
    lockout_ms = 120000; // 2 minutes
  } else if (needPPM) {
    ppm_a_pump = true;
    ppm_b_pump = true;   // ESP32 runs A→delay→B internally
    lockout_ms = 120000; // ESP32 will extend this to (A→B exec) + 2min locally
  }

  return {
    deviceCommands: {
      light,
      light_hours_per_day: hoursPerDay,
      ph_up_pump,
      ph_down_pump,
      ppm_a_pump,
      ppm_b_pump,
      lockout_ms
    },
    sensorStatus,
    ideal
  };
}
