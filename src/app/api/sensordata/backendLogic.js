import { NextResponse } from "next/server";
import clientPromise from "../../../lib/mongodb";
import { processSensorData } from "./backendLogic";
import { auth } from "../auth/[...nextauth]/route";

/** Get the current plant selection.
 * Tries an exact key first (deviceId or userId), then falls back to latest any.
 * Returns { plant, stage, ownerId, selectionDoc }
 */
async function getSelection(appState, exactKey) {
  // try an exact match first
  let doc = await appState.findOne({ state_name: "plantSelection", userId: exactKey });
  if (doc?.value?.plant && doc?.value?.stage) {
    return { plant: doc.value.plant, stage: doc.value.stage, ownerId: doc.userId, selectionDoc: doc };
  }
  // latest any
  doc = await appState.findOne({ state_name: "plantSelection" }, { sort: { "value.timestamp": -1 } });
  return {
    plant: doc?.value?.plant || "default",
    stage: doc?.value?.stage || "seedling",
    ownerId: doc?.userId,
    selectionDoc: doc || null
  };
}

// Save one sensor sample
async function saveSensor(db, sample) {
  const sens = db.collection("sensordata");
  await sens.insertOne(sample);
}

// Historical data helper (6h bins)
async function getHistoricalData(db, deviceId, ownerId, plant, stage) {
  const sens = db.collection("sensordata");
  const profiles = db.collection("plant_profiles");

  // Ideal conditions (prefer owner-specific)
  const profile = await profiles.findOne(
    {
      plant_name: plant,
      stage,
      ...(ownerId ? { $or: [{ userId: ownerId }, { userId: { $exists: false } }] } : { userId: { $exists: false } })
    },
    { sort: ownerId ? { userId: -1 } : undefined }
  );
  const ideal = profile?.ideal_conditions || null;

  // Pull last 7 days of data for that device
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

  // If your timestamps are stored as ISO strings, match on range using strings; better is to store real Dates.
  const historicalData = await sens.aggregate([
    { $match: { userId: deviceId, timestamp: { $gte: start.toISOString() } } },
    // round into 6-hour buckets
    {
      $addFields: {
        tsDate: { $toDate: "$timestamp" }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: "$tsDate" },
          dayOfYear: { $dayOfYear: "$tsDate" },
          sixHourBlock: { $floor: { $divide: [{ $hour: "$tsDate" }, 6] } }
        },
        timestamp: { $max: "$tsDate" },
        temperature: { $avg: "$temperature" },
        humidity: { $avg: "$humidity" },
        ph: { $avg: "$ph" },
        ppm: { $avg: "$ppm" }
      }
    },
    { $sort: { "timestamp": 1 } },
    {
      $project: {
        _id: 0,
        timestamp: 1,
        temperature: { $round: ["$temperature", 2] },
        humidity: { $round: ["$humidity", 2] },
        ph: { $round: ["$ph", 2] },
        ppm: { $round: ["$ppm", 0] }
      }
    }
  ]).toArray();

  const selectionStartTime = null; // (optional) if you store this in app_state.value.timestamp when selecting

  return { historicalData, idealConditions: ideal, selectionStartTime };
}

export async function POST(request) {
  try {
    const client = await clientPromise;
    const db = client.db("planterbox");
    const appState = db.collection("app_state");
    const archives = db.collection("archives");
    const plantProfileCollection = db.collection("plant_profiles"); // FIX for abort_plant path

    const session = await auth().catch(() => null);
    const authUserId = session?.user?.id;

    const body = await request.json();
    const action = body?.action;

    if (action === "select_plant") {
      if (!authUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const { selectedPlant, selectedStage } = body || {};
      if (!selectedPlant || !selectedStage) {
        return NextResponse.json({ error: "Missing plant or stage" }, { status: 400 });
      }
      await appState.updateOne(
        { state_name: "plantSelection", userId: authUserId },
        { $set: { value: { plant: selectedPlant, stage: selectedStage, timestamp: new Date().toISOString() } } },
        { upsert: true }
      );
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    if (action === "abort_plant") {
      if (!authUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const selection = await appState.findOne({ state_name: "plantSelection", userId: authUserId });
      if (selection?.value?.plant && selection?.value?.stage) {
        // Optional: write an archive entry
        await archives.insertOne({
          userId: authUserId,
          plantName: selection.value.plant,
          finalStage: selection.value.stage,
          startDate: selection.value.timestamp ?? null,
          endDate: new Date().toISOString()
        });
      }

      await appState.deleteOne({ state_name: "plantSelection", userId: authUserId });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // Device upload: store sample + compute commands
    const deviceId = body.deviceId || "default_device";
    const sensorData = {
      ...body,
      userId: deviceId, // namespace by device ID
      timestamp: body.timestamp || new Date().toISOString()
    };
    await saveSensor(db, sensorData);

    // Determine selection (prefer deviceId match, fallback to latest any)
    const { plant, stage, ownerId } = await getSelection(appState, deviceId);

    const { deviceCommands } = await processSensorData(sensorData, plant, stage, ownerId);

    return NextResponse.json(deviceCommands, { status: 200 });
  } catch (err) {
    console.error("POST /api/sensordata error:", err);
    // Safe defaults
    return NextResponse.json(
      { light: 0, light_hours_per_day: 0, ph_up_pump: false, ph_down_pump: false, ppm_a_pump: false, ppm_b_pump: false },
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

    const session = await auth().catch(() => null);
    const authUserId = session?.user?.id || null;

    const { searchParams } = new URL(request.url);
    const growth = searchParams.get("growth") === "true";
    const queryPlant = searchParams.get("plant");
    const queryStage = searchParams.get("stage");
    const deviceId = searchParams.get("deviceId") || "default_device";

    // 1) Growth endpoint for HistoricalCharts
    if (growth) {
      const sel = await getSelection(appState, authUserId ?? deviceId);
      const plant = queryPlant || sel.plant;
      const stage = queryStage || sel.stage;

      const { historicalData, idealConditions, selectionStartTime } =
        await getHistoricalData(db, deviceId, sel.ownerId, plant, stage);

      return NextResponse.json({ historicalData, idealConditions, selectionStartTime }, { status: 200 });
    }

    // 2) Ideal lookup for dashboard (plant & stage provided)
    if (queryPlant && queryStage) {
      const { ownerId } = await getSelection(appState, authUserId ?? deviceId);
      const profiles = db.collection("plant_profiles");
      const profile = await profiles.findOne(
        {
          plant_name: queryPlant,
          stage: queryStage,
          ...(ownerId ? { $or: [{ userId: ownerId }, { userId: { $exists: false } }] } : { userId: { $exists: false } })
        },
        { sort: ownerId ? { userId: -1 } : undefined }
      );
      return NextResponse.json({ ideal_conditions: profile?.ideal_conditions ?? null }, { status: 200 });
    }

    // 3) Default: latest sample + computed statuses for dashboard tiles
    const latest = await sens
      .find({ userId: deviceId })
      .sort({ timestamp: -1 })
      .limit(1)
      .next();

    const { plant, stage, ownerId } = await getSelection(appState, authUserId ?? deviceId);
    const { deviceCommands, sensorStatus, ideal } = await processSensorData(latest || {}, plant, stage, ownerId);

    return NextResponse.json(
      {
        sensorData: latest || null,
        sensorStatus,
        deviceCommands,
        idealConditions: ideal,
        currentSelection: { plant, stage, deviceId }
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/sensordata error:", err);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
