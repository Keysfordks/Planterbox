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

// Historical data helper (6h bins), since selection time if available
async function getHistoricalData(db, deviceId, ownerId, plant, stage, selectionStartISO) {
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

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startDate = selectionStartISO ? new Date(selectionStartISO) : sevenDaysAgo;

  // Aggregate supports both ISO strings and Date stored timestamps by converting to Date
  const historicalData = await sens.aggregate([
    { $match: { userId: deviceId } },
    { $addFields: { tsDate: { $toDate: "$timestamp" } } },
    { $match: { tsDate: { $gte: startDate } } },
    // 6-hour buckets
    {
      $group: {
        _id: {
          y: { $year: "$tsDate" },
          d: { $dayOfYear: "$tsDate" },
          block: { $floor: { $divide: [{ $hour: "$tsDate" }, 6] } }
        },
        timestamp: { $max: "$tsDate" },
        temperature: { $avg: "$temperature" },
        humidity: { $avg: "$humidity" },
        ph: { $avg: "$ph" },
        ppm: { $avg: "$ppm" }
      }
    },
    { $sort: { timestamp: 1 } },
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

  return {
    historicalData,
    idealConditions: ideal,
    selectionStartTime: selectionStartISO ?? null
  };
}

/** Convenience: return the JSON your device expects when not recording */
function safeDeviceDefaults() {
  return {
    light: 0,
    light_hours_per_day: 0,
    ph_up_pump: false,
    ph_down_pump: false,
    ppm_a_pump: false,
    ppm_b_pump: false
  };
}

export async function POST(request) {
  try {
    const client = await clientPromise;
    const db = client.db("planterbox");
    const appState = db.collection("app_state");
    const archives = db.collection("archives");

    const session = await auth().catch(() => null);
    const authUserId = session?.user?.id;

    const body = await request.json();
    const action = body?.action;

    // ---------- SELECT PLANT ----------
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

    // ---------- ABORT PLANT ----------
    if (action === "abort_plant") {
      if (!authUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      // Optional snapshots passed from client (HistoricalCharts)
      const snapshots = body?.snapshots ?? null;

      // Current selection for this user (to archive)
      const selection = await appState.findOne({ state_name: "plantSelection", userId: authUserId });

      if (selection?.value?.plant && selection?.value?.stage) {
        // Compute simple stats from sensordata for the (default) device
        const deviceIdToClear = body?.deviceId || "default_device";
        const sens = db.collection("sensordata");

        // Stats computing helper
        async function summarizeMetric(field) {
          const pipe = [
            { $match: { userId: deviceIdToClear } },
            { $addFields: { ts: { $toDate: "$timestamp" } } },
            ...(selection?.value?.timestamp ? [{ $match: { ts: { $gte: new Date(selection.value.timestamp) } } }] : []),
            { $group: { _id: null, min: { $min: `$${field}` }, max: { $max: `$${field}` }, avg: { $avg: `$${field}` }, count: { $sum: 1 } } }
          ];
          const res = await sens.aggregate(pipe).toArray();
          const r = res?.[0];
          return r ? { min: r.min ?? null, max: r.max ?? null, avg: r.avg ?? null, samples: r.count ?? 0 } : null;
        }

        const [t, h, pH, ppm] = await Promise.all([
          summarizeMetric("temperature"),
          summarizeMetric("humidity"),
          summarizeMetric("ph"),
          summarizeMetric("ppm")
        ]);

        const samplesCount = Math.max(t?.samples || 0, h?.samples || 0, pH?.samples || 0, ppm?.samples || 0);

        await archives.insertOne({
          userId: authUserId,
          plantName: selection.value.plant,
          finalStage: selection.value.stage,
          startDate: selection.value.timestamp ?? null,
          endDate: new Date().toISOString(),
          stats: {
            temperature: t ? { min: t.min, max: t.max, avg: t.avg } : null,
            humidity:    h ? { min: h.min, max: h.max, avg: h.avg } : null,
            ph:          pH ? { min: pH.min, max: pH.max, avg: pH.avg } : null,
            ppm:         ppm ? { min: ppm.min, max: ppm.max, avg: ppm.avg } : null,
            samples: samplesCount
          },
          snapshots: snapshots || null
        });
      }

      // Remove selection
      await appState.deleteOne({ state_name: "plantSelection", userId: authUserId });

      // NEW: clear sensordata for the device so the next plant starts fresh
      const deviceIdToClear = body?.deviceId || "default_device";
      await db.collection("sensordata").deleteMany({ userId: deviceIdToClear });

      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // ---------- DEVICE UPLOAD ----------
    // Only save samples if there is a REAL active selection in app_state.
    // (Prevents populating sensordata when no plant is selected.)
    const deviceId = body?.deviceId || "default_device";
    const activeSelectionDoc = await appState.findOne({ state_name: "plantSelection" });

    if (!activeSelectionDoc?.value?.plant || !activeSelectionDoc?.value?.stage) {
      // No active selection anywhere -> do not store; return safe defaults
      return NextResponse.json(safeDeviceDefaults(), { status: 200 });
    }

    // If we do have a real selection, store the sample and compute commands.
    const sensorData = {
      ...body,
      userId: deviceId, // namespace by device ID
      timestamp: body.timestamp ? new Date(body.timestamp) : new Date() // store as Date
    };
    await saveSensor(db, sensorData);

    // Determine selection (prefer deviceId match, fallback to latest any)
    const { plant, stage, ownerId } = await getSelection(appState, deviceId);

    const { deviceCommands } = await processSensorData(sensorData, plant, stage, ownerId);

    return NextResponse.json(deviceCommands, { status: 200 });
  } catch (err) {
    console.error("POST /api/sensordata error:", err);
    // Safe defaults
    return NextResponse.json(safeDeviceDefaults(), { status: 200 });
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
        const selectionStartISO = sel.selectionDoc?.value?.timestamp ?? null;

        const { historicalData, idealConditions, selectionStartTime } =
          await getHistoricalData(db, deviceId, sel.ownerId, plant, stage, selectionStartISO);

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
      deviceCommands: safeDeviceDefaults(),
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

    // UI-friendly mapping so your cards can read min/max easily
    const idealForUI = computed.ideal ? {
      temperature: { min: computed.ideal.temp_min,      max: computed.ideal.temp_max },
      humidity:    { min: computed.ideal.humidity_min,  max: computed.ideal.humidity_max },
      ph:          { min: computed.ideal.ph_min,        max: computed.ideal.ph_max },
      ppm:         { min: computed.ideal.ppm_min,       max: computed.ideal.ppm_max }
    } : null;

    return NextResponse.json(
      {
        sensorData: latest || null,
        sensorStatus: computed.sensorStatus,
        deviceCommands: computed.deviceCommands,
        idealConditions: computed.ideal,
        idealForUI, // <— convenient for the dashboard UI
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
        deviceCommands: safeDeviceDefaults(),
        idealConditions: null,
        idealForUI: null,
        currentSelection: { plant: "default", stage: "seedling", deviceId: "default_device" }
      },
      { status: 200 }
    );
  }
}
