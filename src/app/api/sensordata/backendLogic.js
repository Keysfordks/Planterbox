import clientPromise from '../../../lib/mongodb';

// Check range helper
const inRange = (v, min, max) => typeof v === 'number' && min != null && max != null && v >= min && v <= max;

/**
 * Decide device commands from latest sensor sample and the selected plant profile.
 * @param {Object} latestData - {temperature, humidity, ph, ppm, ...}
 * @param {string} selectedPlant
 * @param {string} selectedStage
 * @param {string|undefined} ownerId - userId that owns the plant profile (optional)
 * @returns {{deviceCommands: {light:number, ph_up_pump:boolean, ph_down_pump:boolean, ppm_a_pump:boolean, ppm_b_pump:boolean}, sensorStatus: Object}}
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
      ...(ownerId ? { $or: [{ userId: ownerId }, { userId: { $exists: false } }] } : { userId: { $exists: false } })
    },
    { sort: ownerId ? { userId: -1 } : undefined }
  );

  const ideal = profile?.ideal_conditions;
  // If we cannot find a profile, return safe defaults
  if (!ideal || !latestData) {
    return {
      deviceCommands: { light: 0, ph_up_pump: false, ph_down_pump: false, ppm_a_pump: false, ppm_b_pump: false },
      sensorStatus: { temperature: 'UNKNOWN', humidity: 'UNKNOWN', ph: 'UNKNOWN', ppm: 'UNKNOWN' }
    };
  }

  const { temperature, humidity, ph, ppm } = latestData;
  const {
    temp_min, temp_max,
    humidity_min, humidity_max,
    ph_min, ph_max,
    ppm_min, ppm_max,
    light_pwm_cycle = 0
  } = ideal;

  // Status strings for UI
  const sensorStatus = {
    temperature: inRange(temperature, temp_min, temp_max) ? 'IDEAL' : 'NOT IDEAL',
    humidity: inRange(humidity, humidity_min, humidity_max) ? 'IDEAL' : 'NOT IDEAL',
    ph: inRange(ph, ph_min, ph_max) ? 'IDEAL' : 'NOT IDEAL',
    ppm: ppm > ppm_max ? 'DILUTE_WATER' : (inRange(ppm, ppm_min, ppm_max) ? 'IDEAL' : 'NOT IDEAL')
  };

  // Naive control: obey profile PWM for light; toggle pumps based on thresholds
  const deviceCommands = {
    light: Number(light_pwm_cycle) || 0,
    ph_up_pump: typeof ph === 'number' && ph < ph_min,     // raise pH
    ph_down_pump: typeof ph === 'number' && ph > ph_max,   // lower pH
    ppm_a_pump: typeof ppm === 'number' && ppm < ppm_min,  // add nutrients A/B when ppm too low
    ppm_b_pump: typeof ppm === 'number' && ppm < ppm_min
  };

  return { deviceCommands, sensorStatus };
}
