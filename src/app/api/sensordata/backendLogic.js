import clientPromise from "../../../lib/mongodb";

// Constants
const DOSING_LOCKOUT_MS = 60000; // 60 seconds
const RAMP_PERIOD_MINUTES = 60; // 1 hour ramp up/down
const MAX_BRIGHTNESS = 255;
const DEFAULT_LIGHT_CYCLE_HOURS = 12;
const DEFAULT_START_HOUR = 7; // 7 AM
const DEFAULT_LIGHT_TOLERANCE_CM = 2;

// Helper function to check if a value is within a range
const isWithinRange = (value, min, max) => {
  if (
    value === null ||
    value === undefined ||
    min === undefined ||
    max === undefined
  ) {
    return false;
  }
  return value >= min && value <= max;
};

// Helper to check if time is within a span that might cross midnight
const isTimeInSpan = (currentMinute, startMinute, endMinute) => {
  if (startMinute < endMinute) {
    return currentMinute >= startMinute && currentMinute < endMinute;
  } else {
    return currentMinute >= startMinute || currentMinute < endMinute;
  }
};

// Calculate dynamic PWM brightness based on time and cycle hours
function calculateLightBrightness(cycleHours) {
  const now = new Date();
  const currentMinuteOfDay = now.getHours() * 60 + now.getMinutes();

  const START_MINUTE = DEFAULT_START_HOUR * 60;
  const totalOnMinutes = cycleHours * 60;

  const SUNRISE_END_MINUTE = (START_MINUTE + RAMP_PERIOD_MINUTES) % (24 * 60);
  const DAYTIME_END_MINUTE =
    (START_MINUTE + totalOnMinutes - RAMP_PERIOD_MINUTES) % (24 * 60);
  const SUNSET_END_MINUTE = (START_MINUTE + totalOnMinutes) % (24 * 60);

  let brightness = 0;
  let cycleState = "NIGHT";

  if (cycleHours < 2) {
    if (
      currentMinuteOfDay >= START_MINUTE &&
      currentMinuteOfDay < SUNSET_END_MINUTE
    ) {
      brightness = MAX_BRIGHTNESS;
      cycleState = "DAY";
    }
  } else {
    if (isTimeInSpan(currentMinuteOfDay, START_MINUTE, SUNRISE_END_MINUTE)) {
      const minutesIntoRamp =
        (currentMinuteOfDay + 24 * 60 - START_MINUTE) % (24 * 60);
      brightness = Math.round(
        (minutesIntoRamp / RAMP_PERIOD_MINUTES) * MAX_BRIGHTNESS
      );
      cycleState = "SUNRISE";
    } else if (
      isTimeInSpan(currentMinuteOfDay, SUNRISE_END_MINUTE, DAYTIME_END_MINUTE)
    ) {
      brightness = MAX_BRIGHTNESS;
      cycleState = "DAY";
    } else if (
      isTimeInSpan(currentMinuteOfDay, DAYTIME_END_MINUTE, SUNSET_END_MINUTE)
    ) {
      let minutesUntilOff =
        (SUNSET_END_MINUTE + 24 * 60 - currentMinuteOfDay) % (24 * 60);
      if (minutesUntilOff === 0) minutesUntilOff = 24 * 60;
      brightness = Math.round(
        (minutesUntilOff / RAMP_PERIOD_MINUTES) * MAX_BRIGHTNESS
      );
      cycleState = "SUNSET";
    } else {
      brightness = 0;
      cycleState = "NIGHT";
    }
  }

  brightness = Math.min(MAX_BRIGHTNESS, Math.max(0, brightness));

  return {
    brightness,
    cycleState,
    startHour: DEFAULT_START_HOUR,
    cycleHours,
  };
}

// Calculate light motor commands based on distance
function calculateLightMotorCommand(distance, targetDistance, tolerance) {
  if (
    distance === null ||
    distance === undefined ||
    targetDistance === null ||
    targetDistance === undefined
  ) {
    return {
      command: "STOP",
      status: "N/A",
      message: "Missing distance data or target profile.",
      value: distance,
    };
  }

  const minDistance = targetDistance - tolerance;
  const maxDistance = targetDistance + tolerance;

  if (distance > maxDistance) {
    return {
      command: "DOWN",
      status: "ADJUSTING",
      message: `Distance (${distance}cm) is too high. Moving light down. Target: ${targetDistance}±${tolerance}cm.`,
      value: distance,
    };
  } else if (distance < minDistance) {
    return {
      command: "UP",
      status: "ADJUSTING",
      message: `Distance (${distance}cm) is too low. Moving light up. Target: ${targetDistance}±${tolerance}cm.`,
      value: distance,
    };
  } else {
    return {
      command: "STOP",
      status: "OK",
      message: `Distance (${distance}cm) is within target range. Target: ${targetDistance}±${tolerance}cm.`,
      value: distance,
    };
  }
}

// Handle dosing logic with lockout (per user)
async function handleDosing(
  ph,
  ppm,
  phMin,
  phMax,
  ppmMin,
  ppmMax,
  appStateCollection,
  userId
) {
  const dosingCommands = {
    ph_up_pump: false,
    ph_down_pump: false,
    ppm_a_pump: false,
    ppm_b_pump: false,
  };

  // Check dosing lockout for this specific user
  const lastDoseState = await appStateCollection.findOne({
    state_name: "lastDoseTimestamp",
    userId: userId,
  });
  const lastDoseTime = lastDoseState?.value?.timestamp
    ? new Date(lastDoseState.value.timestamp).getTime()
    : 0;
  const isDosingLocked = Date.now() - lastDoseTime < DOSING_LOCKOUT_MS;

  if (isDosingLocked) {
    console.log(
      `[User: ${userId}] Dosing skipped: System locked until ${new Date(
        lastDoseTime + DOSING_LOCKOUT_MS
      ).toLocaleTimeString()}`
    );
    return dosingCommands;
  }

  let doseIssued = false;

  // pH correction takes priority
  if (ph < phMin) {
    dosingCommands.ph_up_pump = true;
    doseIssued = true;
  } else if (ph > phMax) {
    dosingCommands.ph_down_pump = true;
    doseIssued = true;
  }

  // PPM correction only if pH is not being corrected
  if (!doseIssued && ppm < ppmMin) {
    dosingCommands.ppm_a_pump = true;
    dosingCommands.ppm_b_pump = true;
    doseIssued = true;
  }

  // Update lockout timestamp if dose was issued
  if (doseIssued) {
    await appStateCollection.updateOne(
      {
        state_name: "lastDoseTimestamp",
        userId: userId,
      },
      {
        $set: {
          value: { timestamp: new Date() },
          type: "system_state",
        },
      },
      { upsert: true }
    );
    console.log(
      `[User: ${userId}] Dose issued. System now in lockout for 60 seconds.`
    );
  }

  return dosingCommands;
}

// Main function to process sensor data and plant selection
export async function processSensorData(
  latestData,
  selectedPlant,
  selectedStage,
  userId
) {
  const client = await clientPromise;
  const db = client.db("planterbox");
  const plantProfileCollection = db.collection("plant_profiles");
  const appStateCollection = db.collection("app_state");

  // Fetch ideal conditions for the selected plant, stage, and user
  const idealConditions = await plantProfileCollection.findOne({
    plant_name: selectedPlant,
    stage: selectedStage,
    userId: userId,
  });

  // Initialize device commands with defaults
  const deviceCommands = {
    light: 0,
    ph_up_pump: false,
    ph_down_pump: false,
    ppm_a_pump: false,
    ppm_b_pump: false,
    light_motor_cmd: "STOP",
  };

  // Initialize sensor status
  const sensorStatus = {
    temperature: "Loading...",
    humidity: "Loading...",
    ph: "Loading...",
    ppm: "Loading...",
    light_distance: "Loading...",
  };

  // If no data or no ideal conditions, return defaults
  if (!latestData || !idealConditions) {
    return { deviceCommands, sensorStatus };
  }

  const { temperature, humidity, ph, ppm, distance } = latestData;
  const {
    temp_min,
    temp_max,
    humidity_min,
    humidity_max,
    ph_min,
    ph_max,
    ppm_min,
    ppm_max,
    ideal_light_distance_cm,
    light_distance_tolerance_cm,
    light_pwm_cycle,
  } = idealConditions.ideal_conditions;

  // --- Light Cycle Control ---
  const lightCycleHours = light_pwm_cycle || DEFAULT_LIGHT_CYCLE_HOURS;
  const lightControl = calculateLightBrightness(lightCycleHours);
  deviceCommands.light = lightControl.brightness;
  sensorStatus.light_cycle_status = {
    status: lightControl.cycleState,
    message: `${lightControl.brightness}/255 PWM. Target: ${lightControl.cycleHours} hrs/day, starting at ${lightControl.startHour}:00.`,
    value: lightControl.brightness,
  };

  // --- Sensor Status Evaluation ---
  sensorStatus.temperature = isWithinRange(temperature, temp_min, temp_max)
    ? "IDEAL"
    : "NOT IDEAL";
  sensorStatus.humidity = isWithinRange(humidity, humidity_min, humidity_max)
    ? "IDEAL"
    : "NOT IDEAL";
  sensorStatus.ph = isWithinRange(ph, ph_min, ph_max) ? "IDEAL" : "NOT IDEAL";

  // Special handling for PPM
  if (ppm > ppm_max) {
    sensorStatus.ppm = "DILUTE_WATER";
  } else {
    sensorStatus.ppm = isWithinRange(ppm, ppm_min, ppm_max)
      ? "IDEAL"
      : "NOT IDEAL";
  }

  // --- Light Motor Control ---
  const lightTolerance =
    light_distance_tolerance_cm || DEFAULT_LIGHT_TOLERANCE_CM;
  const motorControl = calculateLightMotorCommand(
    distance,
    ideal_light_distance_cm,
    lightTolerance
  );
  deviceCommands.light_motor_cmd = motorControl.command;
  sensorStatus.light_distance = {
    status: motorControl.status,
    message: motorControl.message,
    value: motorControl.value,
  };

  // --- Dosing Control ---
  const dosingCommands = await handleDosing(
    ph,
    ppm,
    ph_min,
    ph_max,
    ppm_min,
    ppm_max,
    appStateCollection,
    userId
  );

  Object.assign(deviceCommands, dosingCommands);

  return { deviceCommands, sensorStatus };
}
