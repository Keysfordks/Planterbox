import clientPromise from '../../../lib/mongodb';

// Helpers
const inRange = (v, min, max) =>
  typeof v === 'number' && min != null && max != null && v >= min && v <= max;

/**
 * Simple time-window scheduler: lights ON between [startHour, startHour + hoursPerDay) local server time
 * Returns boolean.
 */
function isLightOnNow(hoursPerDay, startHour = 6, now = new Date()) {
  const hrs = Math.max(0, Math.min(24, Number(hoursPerDay) || 0));
  if (hrs === 0) return false;
  if (hrs >= 24) return true;

  const start = ((Number(startHour) || 0) % 24 + 24) % 24;
  const end = (start + hrs) % 24;
  const current = now.getHours();

  if (start < end) {
    // e.g., start 6 → end 22
    return current >= start && current < end;
  } else {
    // wraps past midnight, e.g., start 18 → end 02
    return current >= start || current < end;
  }
}

/**
 * Decide device commands from latest sensor sample and the selected plant profile.
 * `light_pwm_cycle` in DB is interpreted as **hours per day** (0–24).
 *
 * @param {Object} latestData - {temperature, humidity, ph, ppm, ...}
 * @param {string} selectedPlant
 * @param {string} selectedStage
 * @param {string|undefined} ownerId - userId that owns the plant profile (optional)
 * @returns {{
 *   deviceCommands: {
 *     light:number,
 *     light_hours_per_day:number,
 *     ph_up_pump:boolean,
 *     ph_down_pump:boolean,
 *     ppm_a_pump:boolean,
 *     ppm_b_pump:boolean
 *   },
 *   sensorStatus: Object,
 *   ideal: Object
 * }}
 */
export async function processSensorData(latestData, selectedPlant, selectedStage, ownerId) {
  const client = await clientPromise;
  const db = client.db('planterbox');
  const plantProfiles = db.collection('plant_profiles');

  // Prefer a user-specific profile; otherwise fall back to global preset
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

  // Interpret light as HOURS/DAY → current ON/OFF
  const hoursPerDay = Math.max(0, Math.min(24, Number(light_pwm_cycle) || 0));
  const lightsOn = isLightOnNow(hoursPerDay, /*startHour=*/6);
  const deviceCommands = {
    light: lightsOn ? 255 : 0, // return immediate ON/OFF decision for now
    light_hours_per_day: hoursPerDay,
    ph_up_pump: typeof ph === 'number' && ph < ph_min,     // raise pH
    ph_down_pump: typeof ph === 'number' && ph > ph_max,   // lower pH
    ppm_a_pump: typeof ppm === 'number' && ppm < ppm_min,  // add nutrients when low
    ppm_b_pump: typeof ppm === 'number' && ppm < ppm_min
  };

  return { deviceCommands, sensorStatus, ideal };
}
