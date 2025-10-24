// src/app/api/sensordata/route.js

import { NextResponse } from "next/server";
import clientPromise from "../../../lib/mongodb";
import { auth } from "../auth/[...nextauth]/route";
import { processSensorData } from "./backendLogic"; // keep this import if you have backendLogic.js

/**
 * Read the current plant selection:
 * - Tries an exact key (userId or deviceId) first
 * - Falls back to the latest saved selection document
 * Returns { plant, stage, ownerId, selectionDoc }
 */
async function getSelection(appState, ownerKey) {
  // exact match (by userId or deviceId saved as userId)
  let doc = await appState.findOne({ state_name: "plantSelection", userId: ownerKey });
  if (doc?.value?.plant && doc?.value?.stage) {
    return {
      plant: doc.value.plant,
      stage: doc.value.stage,
      ownerId: doc.userId,
      selectionDoc: doc,
    };
  }
  // latest any
  doc = await appState.findOne(
    { state_name: "plantSelection" },
    { sort: { "value.timestamp": -1 } }
  );
  return {
    plant: doc?.value?.plant || null,
    stage: doc?.value?.stage || null,
    ownerId: doc?.userId || null,
    selectionDoc: doc || null,
  };
}

/**
 * Fetch ideal_conditions for a plant+stage.
 * Prefers a user-owned custom profile (ownerId), otherwise falls back to a global preset (no userId).
 */
async function getIdealConditions(db, plant, stage, ownerId) {
  if (!plant || !stage) return null;
  const profiles = db.collection("plant_profiles");

  const query = ownerId
    ? {
        plant_name: plant,
        stage,
        $or: [{ userId: ownerId }, { userId: { $exists: false } }],
      }
    : { plant_name: plant, stage, userId: { $exists: false } };

  const options = ownerId ? { sort: { userId: -1 } } : undefined;
  const profile = await profiles.findOne(query, options);
  return profile?.ideal_conditions ?? null;
}

/**
 * Historical aggregation (last 7 days by default, 6-hour buckets).
 * Returns { historicalData, idealConditions, selectionStartTime }
 */
async function getHistoricalData(db, deviceId, plant, stage, ownerId, selectionStartISO) {
  const sens = db.collection("sensordata");
  const idealConditions = await getIdealConditions(db, plant, stage, ownerId);

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startDate = selectionStartISO ? new Date(selectionStartISO) : sevenDaysAgo;

  const historicalData = await sens
    .aggregate([
      { $match: { userId: deviceId } },
      { $addFields: { tsDate: { $toDate: "$timestamp" } } },
      { $match: { tsDate: { $gte: startDate } } },
      // 6-hour buckets with averages
      {
        $group: {
          _id: {
            y: { $year: "$tsDate" },
            d: { $dayOfYear: "$tsDate" },
            block: { $floor: { $divide: [{ $hour: "$tsDate" }, 6] } },
          },
          timestamp: { $max: "$tsDate" },
          temperature: { $avg: "$temperature" },
          humidity: { $avg: "$humidity" },
          ph: { $avg: "$ph" },
          ppm: { $avg: "$ppm" },
        },
      },
      { $sort: { timestamp: 1 } },
      {
        $project: {
          _id: 0,
          timestamp: 1,
          temperature: { $round: ["$temperature", 2] },
          humidity: { $round: ["$humidity", 2] },
          ph: { $round: ["$ph", 2] }, // bump to 3 if you want finer precision
          ppm: { $round: ["$ppm", 0] },
        },
      },
    ])
    .toArray();

  return {
    historicalData,
    idealConditions,
    selectionStartTime: selectionStartISO ?? null,
  };
}

/**
 * POST
 * - { action: "select_plant", selectedPlant, selectedStage }   -> save selection to app_state
 * - { action: "abort_plant" }                                  -> clear selection, (optionally) archive
 * - (default) a device sensor payload from ESP32               -> save sample, compute device commands
 */
export async function POST(request) {
  try {
    const client = await clientPromise;
    const db = client.db("planterbox");
    const appState = db.collection("app_state");
    const archives = db.collection("archives");

    const session = await auth().catch(() => null);
    const authUserId = session?.user?.id ?? null;

    const body = await request.json().catch(() => ({}));
    const action = body?.action;

    // Save or update the plant selection for the logged-in user
    if (action === "select_plant") {
      if (!authUserId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const { selectedPlant, selectedStage } = body || {};
      if (!selectedPlant || !selectedStage) {
        return NextResponse.json({ error: "Missing selectedPlant or selectedStage" }, { status: 400 });
      }
      await appState.updateOne(
        { state_name: "plantSelection", userId: authUserId },
        {
          $set: {
            value: {
              plant: String(selectedPlant),
              stage: String(selectedStage),
              timestamp: new Date().toISOString(),
            },
          },
        },
        { upsert: true }
      );
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // Abort the current plant and clear selection (optionally archive)
    if (action === "abort_plant") {
      if (!authUserId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const current = await appState.findOne({ state_name: "plantSelection", userId: authUserId });
      if (current?.value?.plant && current?.value?.stage) {
        await archives.insertOne({
          userId: authUserId,
          plantName: current.value.plant,
          finalStage: current.value.stage,
          startDate: current.value.timestamp ?? null,
          endDate: new Date().toISOString(),
        });
      }
      await appState.deleteOne({ state_name: "plantSelection", userId: authUserId });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // DEFAULT: Treat as a sensor sample from device/ESP32 and compute device commands
    const deviceId = body?.deviceId || "default_device";
    const sens = db.collection("sensordata");

    const sensorData = {
      ...body,
      userId: deviceId, // namespace samples by device
      timestamp: body?.timestamp ? new Date(body.timestamp) : new Date(), // store as Date
    };

    await sens.insertOne(sensorData);

    // Determine the active selection (prefer exact device key, else latest)
    const selection = await getSelection(appState, deviceId);
    const plant = selection.plant || "default";
    const stage = selection.stage || "seedling";
    const ownerId = selection.ownerId || authUserId || null;

    // Compute device commands given the latest sample and the ideal conditions
    let deviceCommands = {
      light: 0,
      light_hours_per_day: 0,
      ph_up_pump: false,
      ph_down_pump: false,
      ppm_a_pump: false,
      ppm_b_pump: false,
    };

    try {
      const result = await processSensorData(sensorData, plant, stage, ownerId);
      deviceCommands = result?.deviceCommands || deviceCommands;
    } catch (e) {
      console.error("processSensorData error:", e);
    }

    return NextResponse.json(deviceCommands, { status: 200 });
  } catch (err) {
    console.error("POST /api/sensordata error:", err);
    // Return safe defaults so the device never stalls on errors
    return NextResponse.json(
      {
        light: 0,
        light_hours_per_day: 0,
        ph_up_pump: false,
        ph_down_pump: false,
        ppm_a_pump: false,
        ppm_b_pump: false,
      },
      { status: 200 }
    );
  }
}

/**
 * GET
 * - ?growth=true [&plant=&stage=&deviceId=] -> historical aggregates + ideal_conditions
 * - default (no growth)                     -> latest sensor sample + ideal_conditions for tiles
 * Always returns idealConditions for the resolved selection (user custom profile preferred).
 */
export async function GET(request) {
  try {
    const client = await clientPromise;
    const db = client.db("planterbox");
    const sens = db.collection("sensordata");
    const appState = db.collection("app_state");

    // auth is optional for read; helps match a user's custom profiles
    let session = null;
    try {
      session = await auth();
    } catch {}
    const authUserId = session?.user?.id ?? null;

    const { searchParams } = new URL(request.url);
    const growth = searchParams.get("growth") === "true";
    const qPlant = searchParams.get("plant");
    const qStage = searchParams.get("stage");
    const deviceId = searchParams.get("deviceId") || "default_device";

    // Resolve active selection then fetch ideals
    const sel = await getSelection(appState, authUserId ?? deviceId);
    const plant = qPlant || sel.plant;
    const stage = qStage || sel.stage;
    const ownerId = sel.ownerId ?? authUserId;

    const idealConditions = await getIdealConditions(db, plant, stage, ownerId);

    if (growth) {
      // Historical branch
      const selectionStartISO = sel.selectionDoc?.value?.timestamp ?? null;
      const { historicalData, selectionStartTime } = await getHistoricalData(
        db,
        deviceId,
        plant,
        stage,
        ownerId,
        selectionStartISO
      );

      return NextResponse.json(
        {
          historicalData,
          idealConditions, // <-- charts read min/max from here
          selectionStartTime,
          selection: { plant, stage },
        },
        { status: 200 }
      );
    }

    // Dashboard tiles: return latest sample and ideals
    const latest = await sens
      .find({ userId: deviceId })
      .sort({ timestamp: -1 })
      .limit(1)
      .next();

    return NextResponse.json(
      {
        sensorData: latest || null,
        idealConditions, // <-- tiles read min/max from here
        currentSelection: { plant, stage, deviceId },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/sensordata error:", err);
    // Soft-fail with a valid shape so UI never crashes
    return NextResponse.json(
      {
        sensorData: null,
        idealConditions: null,
        currentSelection: null,
        historicalData: [],
      },
      { status: 200 }
    );
  }
}
