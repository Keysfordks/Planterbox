import clientPromise from './dbConnect';

// Helper function to check if a value is within a range
const isWithinRange = (value, min, max) => {
  if (value === null || min === undefined || max === undefined) return false;
  return value >= min && value <= max;
};

// DOSING_LOCKOUT_MS is reduced to 60 seconds (60000 ms)
const DOSING_LOCKOUT_MS = 60000; 

// --- UPDATED: Function to calculate dynamic PWM brightness based on time and cycle hours ---
function calculateLightBrightness(cycleHours) {
    // Ramp up/down period is set to 1 hour (60 minutes)
    const RAMP_PERIOD_MINUTES = 60; 
    const MAX_BRIGHTNESS = 255;
    
    // Get current time. For consistency, we'll use a standard local clock (Node.js clock).
    const now = new Date();
    // Use the current hour and minute for precise calculation
    const currentMinuteOfDay = now.getHours() * 60 + now.getMinutes();

    // We assume the light cycle starts at a natural "sunrise" time, e.g., 7 AM.
    const START_HOUR = 7; 
    const START_MINUTE = START_HOUR * 60; 

    const totalOnMinutes = cycleHours * 60;
    
    // Calculate the minute markers for the entire cycle
    const SUNRISE_END_MINUTE = (START_MINUTE + RAMP_PERIOD_MINUTES) % (24 * 60);
    const DAYTIME_END_MINUTE = (START_MINUTE + totalOnMinutes - RAMP_PERIOD_MINUTES) % (24 * 60);
    const SUNSET_END_MINUTE = (START_MINUTE + totalOnMinutes) % (24 * 60);
    
    // The core full-brightness period starts after ramp-up and ends before ramp-down
    const fullPowerMinutes = totalOnMinutes - (2 * RAMP_PERIOD_MINUTES);


    let brightness = 0;
    let cycleState = "NIGHT";

    if (cycleHours < 2) {
        // Simple ON/OFF for cycles < 2 hours (no meaningful ramp period)
        if (currentMinuteOfDay >= START_MINUTE && currentMinuteOfDay < SUNSET_END_MINUTE) {
            brightness = MAX_BRIGHTNESS;
            cycleState = "DAY";
        }
    } else {
        // --- Day Cycle Logic (Centered on START_HOUR) ---

        // Helper to check if time is within a span that might cross midnight
        const isTimeInSpan = (start, end) => {
            if (start < end) {
                return currentMinuteOfDay >= start && currentMinuteOfDay < end;
            } else {
                // Span crosses midnight (e.g., 23:00 to 01:00)
                return currentMinuteOfDay >= start || currentMinuteOfDay < end;
            }
        };

        // 1. Sunrise Ramp Up (START_MINUTE to SUNRISE_END_MINUTE)
        if (isTimeInSpan(START_MINUTE, SUNRISE_END_MINUTE)) {
            let minutesIntoRamp = (currentMinuteOfDay + (24 * 60) - START_MINUTE) % (24 * 60);
            brightness = Math.round((minutesIntoRamp / RAMP_PERIOD_MINUTES) * MAX_BRIGHTNESS);
            cycleState = "SUNRISE";

        // 2. Full Power (SUNRISE_END_MINUTE to DAYTIME_END_MINUTE)
        } else if (isTimeInSpan(SUNRISE_END_MINUTE, DAYTIME_END_MINUTE)) {
            brightness = MAX_BRIGHTNESS;
            cycleState = "DAY";
            
        // 3. Sunset Ramp Down (DAYTIME_END_MINUTE to SUNSET_END_MINUTE)
        } else if (isTimeInSpan(DAYTIME_END_MINUTE, SUNSET_END_MINUTE)) {
            let minutesUntilOff = (SUNSET_END_MINUTE + (24 * 60) - currentMinuteOfDay) % (24 * 60);
            if (minutesUntilOff === 0) minutesUntilOff = 24 * 60; // Handle minute 0
            
            brightness = Math.round((minutesUntilOff / RAMP_PERIOD_MINUTES) * MAX_BRIGHTNESS);
            cycleState = "SUNSET";

        // 4. Nighttime (All other times)
        } else {
            brightness = 0;
            cycleState = "NIGHT";
        }
    }
    
    // Ensure brightness is clamped between 0 and 255
    brightness = Math.min(MAX_BRIGHTNESS, Math.max(0, brightness));

    return { brightness, cycleState, startHour: START_HOUR, cycleHours };
}
// -----------------------------------------------------------------------


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
    light_motor_cmd: "STOP",
  };

  let sensorStatus = {
    temperature: "Loading...",
    humidity: "Loading...",
    ph: "Loading...",
    ppm: "Loading...",
    light_distance: "Loading..."
  };

  // --- Light Cycle Logic ---
  // light_pwm_cycle is now treated as HOURS of light required.
  const lightCycleHours = idealConditions?.ideal_conditions?.light_pwm_cycle || 12; // Default to 12 hours
  const lightControl = calculateLightBrightness(lightCycleHours);
  deviceCommands.light = lightControl.brightness;
  sensorStatus.light_cycle_status = {
    status: lightControl.cycleState,
    message: `${lightControl.brightness}/255 PWM. Target: ${lightControl.cycleHours} hrs/day, starting at ${lightControl.startHour}:00.`,
    value: lightControl.brightness
  };
  // -------------------------

  if (latestData && idealConditions) {
    const { temperature, humidity, ph, ppm, distance } = latestData; // Destructure distance
    const { temp_min, temp_max, humidity_min, humidity_max, ph_min, ph_max, ppm_min, ppm_max, ideal_light_distance_cm, light_distance_tolerance_cm } = idealConditions.ideal_conditions;

    // Check if values are within the ideal ranges and set status
    sensorStatus.temperature = isWithinRange(temperature, temp_min, temp_max) ? "IDEAL" : "NOT IDEAL";
    sensorStatus.humidity = isWithinRange(humidity, humidity_min, humidity_max) ? "IDEAL" : "NOT IDEAL";
    sensorStatus.ph = isWithinRange(ph, ph_min, ph_max) ? "IDEAL" : "NOT IDEAL";
    
  
    if (ppm > ppm_max) {
      sensorStatus.ppm = "DILUTE_WATER"; // Custom status for the frontend
    } else {
      sensorStatus.ppm = isWithinRange(ppm, ppm_min, ppm_max) ? "IDEAL" : "NOT IDEAL";
    }


    // --- Light Motor Control Logic ---
    const light_target_distance = ideal_light_distance_cm;
    const light_tolerance = light_distance_tolerance_cm || 2; // Default to 2cm tolerance

    if (distance !== null && distance !== undefined && light_target_distance !== null && light_target_distance !== undefined) {
        
        const min_distance = light_target_distance - light_tolerance;
        const max_distance = light_target_distance + light_tolerance;

        if (distance > max_distance) {
            deviceCommands.light_motor_cmd = "DOWN"; 
            sensorStatus.light_distance = { 
                status: "ADJUSTING",
                message: `Distance (${distance}cm) is too high. Moving light down. Target: ${light_target_distance}±${light_tolerance}cm.`,
                value: distance 
            };

        } else if (distance < min_distance) {
            deviceCommands.light_motor_cmd = "UP"; 
            sensorStatus.light_distance = { 
                status: "ADJUSTING",
                message: `Distance (${distance}cm) is too low. Moving light up. Target: ${light_target_distance}±${light_tolerance}cm.`,
                value: distance 
            };

        } else {
            deviceCommands.light_motor_cmd = "STOP";
            sensorStatus.light_distance = { 
                status: "OK",
                message: `Distance (${distance}cm) is within target range. Target: ${light_target_distance}±${light_tolerance}cm.`,
                value: distance
            };
        }
    } else {
        sensorStatus.light_distance = { 
            status: "N/A", 
            message: "Missing distance data or target profile.",
            value: distance 
        };
    }
    
    // Closed-Loop Dosing Check 
    if (!isDosingLocked) {
        let doseIssued = false;

        if (ph < ph_min) {
            deviceCommands.ph_up_pump = true;
            doseIssued = true;
        } else if (ph > ph_max) {
            deviceCommands.ph_down_pump = true;
            doseIssued = true;
        }

        if (!doseIssued && ppm < ppm_min) {
            deviceCommands.ppm_a_pump = true;
            deviceCommands.ppm_b_pump = true;
            doseIssued = true;
        }
        
        if (doseIssued) {
             await appStateCollection.updateOne(
                { state_name: "lastDoseTimestamp" },
                { $set: { 
                    value: { timestamp: new Date() }, 
                    type: "system_state" 
                } },
                { upsert: true }
            );
             console.log("Dose Issued. System now in lockout for 60 seconds.");
        }

    } else {
        console.log(`Dosing skipped: System locked until ${new Date(lastDoseTime + DOSING_LOCKOUT_MS).toLocaleTimeString()}`);
    }

  }

  return { deviceCommands, sensorStatus };
}