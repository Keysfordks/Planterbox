import clientPromise from './dbConnect';

// Helper function to check if a value is within a range
const isWithinRange = (value, min, max) => {
  if (value === null || min === undefined || max === undefined) return false;
  return value >= min && value <= max;
};

// DOSING_LOCKOUT_MS is reduced to 60 seconds (60000 ms)
const DOSING_LOCKOUT_MS = 60000; 

// This function processes the sensor data and plant selection
export async function processSensorData(latestData, selectedPlant, selectedStage) {
  const client = await clientPromise;
  const db = client.db('planterbox');
  const plantProfileCollection = db.collection('plant_profiles');
  // Reference the app state collection
  const appStateCollection = db.collection('app_state');

  // Query now filters by both plant_name and stage
  const idealConditions = await plantProfileCollection.findOne({ 
    plant_name: selectedPlant, 
    stage: selectedStage 
  });
  
  // Fetch the last dosing time and calculate if we are in lockout
  const lastDoseState = await appStateCollection.findOne({ state_name: "lastDoseTimestamp" });
  const lastDoseTime = lastDoseState?.value?.timestamp ? new Date(lastDoseState.value.timestamp).getTime() : 0;
  const isDosingLocked = (Date.now() - lastDoseTime) < DOSING_LOCKOUT_MS;

  let deviceCommands = {
    // Include all specific pump commands
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
    
  
    if (ppm > ppm_max) {
      sensorStatus.ppm = "DILUTE_WATER"; // Custom status for the frontend
    } else {
      sensorStatus.ppm = isWithinRange(ppm, ppm_min, ppm_max) ? "IDEAL" : "NOT IDEAL";
    }


    // Generate device commands based on ideal conditions
    deviceCommands.light = light_pwm_cycle;
    
    // Closed-Loop Dosing Check
    if (!isDosingLocked) {
        let doseIssued = false;

        // 1. pH Pump control logic (pH takes priority)
        if (ph < ph_min) {
            deviceCommands.ph_up_pump = true;
            doseIssued = true;
        } else if (ph > ph_max) {
            deviceCommands.ph_down_pump = true;
            doseIssued = true;
        }

        // 2. PPM Pump control logic (only check if no pH dose was issued)
        // *** CRITICAL Only dose if ppm is LOW. If ppm > ppm_max (DILUTE_WATER), keep pumps OFF. ***
        if (!doseIssued && ppm < ppm_min) {
            deviceCommands.ppm_a_pump = true;
            deviceCommands.ppm_b_pump = true;
            doseIssued = true;
        }
        
        // 3. Update the lastDoseTimestamp if a dose was issued
        if (doseIssued) {
             await appStateCollection.updateOne(
                { state_name: "lastDoseTimestamp" },
                { $set: { 
                    value: { timestamp: new Date() }, 
                    type: "system_state" 
                } },
                { upsert: true }
            );
             console.log("Dose Issued. System now in lockout for 30 seconds.");
        }

    } else {
        // Log that dosing is skipped because of the lockout
        console.log(`Dosing skipped: System locked until ${new Date(lastDoseTime + DOSING_LOCKOUT_MS).toLocaleTimeString()}`);
    }

  }

  return { deviceCommands, sensorStatus };
}