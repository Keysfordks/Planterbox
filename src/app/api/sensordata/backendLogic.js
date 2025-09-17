import clientPromise from './dbConnect';

// Helper function to check if a value is within a range
const isWithinRange = (value, min, max) => {
  if (value === null || min === undefined || max === undefined) return false;
  return value >= min && value <= max;
};

// This function processes the sensor data and plant selection
export async function processSensorData(latestData, selectedPlant) {
  const client = await clientPromise;
  const db = client.db('planterbox');
  const plantProfileCollection = db.collection('plant_profiles');

  const idealConditions = await plantProfileCollection.findOne({ plant_name: selectedPlant });

  let deviceCommands = {
    light: 0,
    ph_up_pump: false,
    ph_down_pump: false,
    ppm_a_pump: false,
    ppm_b_pump: false,
  };

  let sensorStatus = {
    temperature: "Loading...",
    humidity: "Loading...",
    ph: "Loading...",
    ppm: "Loading...",
  };

  if (latestData && idealConditions) {
    const { temperature, humidity, ph, ppm } = latestData;
    const { temp_min, temp_max, humidity_min, humidity_max, ph_min, ph_max, ppm_min, ppm_max, light_pwm_cycle } = idealConditions.ideal_conditions;

    // Check if values are within the ideal ranges and set status
    sensorStatus.temperature = isWithinRange(temperature, temp_min, temp_max) ? "IDEAL" : "NOT IDEAL";
    sensorStatus.humidity = isWithinRange(humidity, humidity_min, humidity_max) ? "IDEAL" : "NOT IDEAL";
    sensorStatus.ph = isWithinRange(ph, ph_min, ph_max) ? "IDEAL" : "NOT IDEAL";
    sensorStatus.ppm = isWithinRange(ppm, ppm_min, ppm_max) ? "IDEAL" : "NOT IDEAL";

    // Generate device commands based on ideal conditions
    deviceCommands.light = light_pwm_cycle;
    
    // pH Pump control logic
    if (ph < ph_min) {
        deviceCommands.ph_up_pump = true;
    } else if (ph > ph_max) {
        deviceCommands.ph_down_pump = true;
    }

    // PPM Pump control logic: Set both pumps to true if PPM is out of range.
    if (ppm < ppm_min || ppm > ppm_max) {
        deviceCommands.ppm_a_pump = true;
        deviceCommands.ppm_b_pump = true;
    }
  }

  return { deviceCommands, sensorStatus };
}