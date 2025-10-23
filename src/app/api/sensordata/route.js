import { NextResponse } from "next/server";
import clientPromise from "../../../lib/mongodb";
import { processSensorData } from "./backendLogic";
import { auth } from "../auth/[...nextauth]/route";

/**
 * Fetch the current plant selection.
 * Strategy:
 * 1) Try the selection for the provided key (userId or deviceId).
 * 2) Otherwise, use the most recent selection from anyone (single-user friendly fallback).
 * Returns { plant, stage, ownerId, selectionDoc }
 */
async function getSelection(appState, key) {
  // 1) strict match
  let doc = await appState.findOne({ state_name: "plantSelection", userId: key });
  if (doc?.value?.plant && doc?.value?.stage) {
    return { plant: doc.value.plant, stage: doc.value.stage, ownerId: doc.userId, selectionDoc: doc };
  }
  // 2) latest any
  doc = await appState.findOne({ state_name: "plantSelection" }, { sort: { "value.timestamp": -1 } });
  return {
    plant: doc?.value?.plant || "pothos",
    stage: doc?.value?.stage || "seedling",
    ownerId: doc?.userId,
    selectionDoc: doc || null
  };
}

// Record one sensor sample
async function saveSensor(db, sample) {
  const sens = db.collection("sensordata");
  await sens.insertOne(sample);
}

export async function POST(request) {
  try {
    const client = await clientPromise;
    const db = client.db("planterbox");
    const appState = db.collection("app_state");

    const body = await request.json();
    const deviceId = body.deviceId || "default_device";

    // Store raw sample under deviceId namespace
    const sensorData = {
      ...body,
      userId: deviceId,                   // keep historical data per-device
      timestamp: new Date().toISOString()
    };
    await saveSensor(db, sensorData);

    // Determine which selection to use
    const { plant, stage, ownerId } = await getSelection(appState, deviceId);

    // Compute commands using ownerId so we can read user-specific plant profiles
    const { deviceCommands } = await processSensorData(sensorData, plant, stage, ownerId);

    // Return commands for the ESP32
    return NextResponse.json(deviceCommands, { status: 200 });
  } catch (err) {
    console.error("POST /api/sensordata error:", err);
    // Fail-safe defaults
    return NextResponse.json(
      { light: 0, ph_up_pump: false, ph_down_pump: false, ppm_a_pump: false, ppm_b_pump: false },
      { status: 200 }
    );
  }
}

export async function GET(request) {
  try {
    const client = await clientPromise;
    const db = client.db("planterbox");
    const sens = db.collection("sensordata");
    const appState = db.collection("app_state");

    // Auth is optional for dashboard polling; guard it
    let session = null;
    try { session = await auth(); } catch {}
    const authUserId = session?.user?.id ?? null;

    const { searchParams } = new URL(request.url);
    const growth = searchParams.get("growth") === "true";
    const queryPlant = searchParams.get("plant");
    const queryStage = searchParams.get("stage");
    const deviceId = searchParams.get("deviceId") || "default_device";

    // 1) Historical charts branch
    if (growth) {
      try {
        const sel = await getSelection(appState, authUserId ?? deviceId);
        const plant = queryPlant || sel.plant;
        const stage = queryStage || sel.stage;

        const { historicalData, idealConditions, selectionStartTime } =
          await getHistoricalData(db, deviceId, sel.ownerId, plant, stage);

        return NextResponse.json(
          { historicalData, idealConditions, selectionStartTime },
          { status: 200 }
        );
      } catch (e) {
        console.error("GET /api/sensordata growth error:", e);
        // Still return a valid shape so the client never crashes
        return NextResponse.json(
          { historicalData: [], idealConditions: null, selectionStartTime: null },
          { status: 200 }
        );
      }
    }

    // 2) Ideal lookup branch
    if (queryPlant && queryStage) {
      try {
        const { ownerId } = await getSelection(appState, authUserId ?? deviceId);
        const profiles = db.collection("plant_profiles");
        const profile = await profiles.findOne(
          {
            plant_name: queryPlant,
            stage: queryStage,
            ...(ownerId
              ? { $or: [{ userId: ownerId }, { userId: { $exists: false } }] }
              : { userId: { $exists: false } })
          },
          { sort: ownerId ? { userId: -1 } : undefined }
        );
        return NextResponse.json(
          { ideal_conditions: profile?.ideal_conditions ?? null },
          { status: 200 }
        );
      } catch (e) {
        console.error("GET /api/sensordata ideal lookup error:", e);
        return NextResponse.json({ ideal_conditions: null }, { status: 200 });
      }
    }

    // 3) Default dashboard tiles branch (latest sample + computed statuses)
    let latest = null;
    try {
      latest = await sens
        .find({ userId: deviceId })
        .sort({ timestamp: -1 })
        .limit(1)
        .next();
    } catch (e) {
      console.error("GET /api/sensordata find latest error:", e);
    }

    let selection = { plant: "default", stage: "seedling", ownerId: null };
    try {
      selection = await getSelection(appState, authUserId ?? deviceId);
    } catch (e) {
      console.error("GET /api/sensordata getSelection error:", e);
    }

    let computed = {
      deviceCommands: {
        light: 0,
        light_hours_per_day: 0,
        ph_up_pump: false,
        ph_down_pump: false,
        ppm_a_pump: false,
        ppm_b_pump: false
      },
      sensorStatus: {
        temperature: "UNKNOWN",
        humidity: "UNKNOWN",
        ph: "UNKNOWN",
        ppm: "UNKNOWN"
      },
      ideal: null
    };

    try {
      computed = await processSensorData(
        latest || {},
        selection.plant,
        selection.stage,
        selection.ownerId
      );
    } catch (e) {
      console.error("GET /api/sensordata processSensorData error:", e);
    }

    return NextResponse.json(
      {
        sensorData: latest || null,
        sensorStatus: computed.sensorStatus,
        deviceCommands: computed.deviceCommands,
        idealConditions: computed.ideal,
        currentSelection: { plant: selection.plant, stage: selection.stage, deviceId }
      },
      { status: 200 }
    );
  } catch (err) {
    // LAST RESORT: never 500 to the client; always return a safe JSON shape
    console.error("GET /api/sensordata fatal:", err);
    return NextResponse.json(
      {
        sensorData: null,
        sensorStatus: {
          temperature: "UNKNOWN",
          humidity: "UNKNOWN",
          ph: "UNKNOWN",
          ppm: "UNKNOWN"
        },
        deviceCommands: {
          light: 0,
          light_hours_per_day: 0,
          ph_up_pump: false,
          ph_down_pump: false,
          ppm_a_pump: false,
          ppm_b_pump: false
        },
        idealConditions: null,
        currentSelection: { plant: "default", stage: "seedling", deviceId: "default_device" }
      },
      { status: 200 }
    );
  }
}
