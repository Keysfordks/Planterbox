import { NextResponse } from 'next/server';
import { auth } from '../auth/[...nextauth]/route';
import { MongoClient, ObjectId } from 'mongodb';
import { processSensorData } from './backendLogic'; // keep your existing logic file

/* ---------- simple cached Mongo helper ---------- */
let _client = null;
async function connectToDB() {
  if (_client && _client.topology?.isConnected()) {
    return { db: _client.db(process.env.MONGODB_DB || 'planterbox') };
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGODB_URI');
  _client = new MongoClient(uri, { ignoreUndefined: true });
  await _client.connect();
  return { db: _client.db(process.env.MONGODB_DB || 'planterbox') };
}

/* ---------- helpers ---------- */
const STAGES = new Set(['seedling', 'vegetative', 'mature']);

async function getSelection(db, userOrDeviceId) {
  const state = await db.collection('app_state').findOne({ userId: userOrDeviceId });
  if (!state) return null;
  return {
    plant: state.selectedPlant,
    stage: state.selectedStage,
    start: state.selectionStart ? new Date(state.selectionStart) : null
  };
}

async function getIdealFor(db, userId, plant, stage) {
  if (!plant || !stage) return null;
  const p = await db.collection('plants').findOne({ userId, plant_name: plant });
  return p?.stages?.[stage] || null;
}

/* ========== GET ========== */
export async function GET(req) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { db } = await connectToDB();
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const growth = searchParams.get('growth') === 'true';
  const plantQ = searchParams.get('plant');
  const stageQ = searchParams.get('stage');

  // 1) return ideal conditions for specific (plant, stage)
  if (plantQ && stageQ) {
    const ideal = await getIdealFor(db, userId, plantQ.toLowerCase().trim(), stageQ);
    return NextResponse.json({ ideal_conditions: ideal }, { status: 200 });
  }

  // 2) growth history (6-hour windows)
  if (growth) {
    // read selection to anchor timeframe and stage band
    const sel = await getSelection(db, userId);
    const since = sel?.start || new Date(Date.now() - 6 * 60 * 60 * 1000); // 6h fallback
    const ideal = await getIdealFor(db, userId, sel?.plant, sel?.stage);

    // Only aggregate for the current device/user sink; we store with userId (deviceId supported the same way)
    const match = { userId };
    if (since) match.timestamp = { $gte: since };

    // 6-hour buckets over approx the last window (server keeps the windowing by date)
    const pipeline = [
      { $match: match },
      {
        $project: {
          timestamp: 1,
          temperature: 1,
          humidity: 1,
          ppm: 1,
          ph: 1
        }
      },
      {
        // group by 6-hour block
        $group: {
          _id: {
            y: { $year: '$timestamp' },
            m: { $month: '$timestamp' },
            d: { $dayOfMonth: '$timestamp' },
            h: { $subtract: [{ $hour: '$timestamp' }, { $mod: [{ $hour: '$timestamp' }, 6] }] }
          },
          firstTs: { $first: '$timestamp' },
          avgTemp: { $avg: '$temperature' },
          avgHum:  { $avg: '$humidity' },
          avgPPM:  { $avg: '$ppm' },
          avgPH:   { $avg: '$ph' }
        }
      },
      { $sort: { '_id.y': 1, '_id.m': 1, '_id.d': 1, '_id.h': 1 } },
      {
        $project: {
          _id: 0,
          timestamp: '$firstTs',
          temperature: { $round: ['$avgTemp', 2] },
          humidity:    { $round: ['$avgHum', 2] },
          ppm:         { $round: ['$avgPPM', 0] },
          ph:          { $round: ['$avgPH', 2] }
        }
      }
    ];

    const rows = await db.collection('sensordata').aggregate(pipeline).toArray();
    return NextResponse.json({ historicalData: rows, idealConditions: ideal }, { status: 200 });
  }

  // 3) default GET → latest sample + statuses + ideal ranges according to selection
  const sel = await getSelection(db, userId);
  const idealRanges = await getIdealFor(db, userId, sel?.plant, sel?.stage);

  const latest = await db.collection('sensordata')
    .find({ userId })
    .sort({ timestamp: -1 })
    .limit(1)
    .toArray();

  const sensorData = latest[0] || {};
  const sensorStatus = {};

  // Compute simple statuses against idealRanges (if present)
  if (idealRanges) {
    const inRange = (v, lo, hi) => (typeof v === 'number' && lo != null && hi != null) ? (v >= lo && v <= hi) : null;
    const mk = (key, v, lo, hi) => {
      const ok = inRange(v, lo, hi);
      if (ok == null) return 'UNKNOWN';
      if (key === 'ppm' && v > hi) return 'DILUTE_WATER';
      return ok ? 'IDEAL' : 'WARNING';
    };
    sensorStatus.temperature = mk('temperature', sensorData.temperature, idealRanges.temp_min, idealRanges.temp_max);
    sensorStatus.humidity    = mk('humidity',    sensorData.humidity,    idealRanges.humidity_min, idealRanges.humidity_max);
    sensorStatus.ph          = mk('ph',          sensorData.ph,          idealRanges.ph_min,       idealRanges.ph_max);
    sensorStatus.ppm         = mk('ppm',         sensorData.ppm,         idealRanges.ppm_min,      idealRanges.ppm_max);
    if (typeof sensorData.water_sufficient === 'boolean') {
      sensorStatus.water_sufficient = sensorData.water_sufficient ? 'IDEAL' : 'WARNING';
    }
  }

  // Commands (no-op here; POST handles actuation plan)
  const commands = {
    light: 0,
    ph_up_pump: false,
    ph_down_pump: false,
    ppm_a_pump: false,
    ppm_b_pump: false
  };

  return NextResponse.json({
    sensorData,
    sensorStatus,
    commands,
    idealRanges
  }, { status: 200 });
}

/* ========== POST ========== */
export async function POST(req) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { db } = await connectToDB();
  const userId = session.user.id;

  const body = await req.json();
  const action = body?.action;

  // 1) stage/plant selection update
  if (action === 'select_plant') {
    const selectedPlant = body.selectedPlant?.toLowerCase()?.trim();
    const selectedStage = STAGES.has(body.selectedStage) ? body.selectedStage : 'seedling';
    const now = new Date();

    await db.collection('app_state').updateOne(
      { userId },
      { $set: { selectedPlant, selectedStage, selectionStart: now } },
      { upsert: true }
    );
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // 2) abort plant → archive snapshots + clear data + clear selection
  if (action === 'abort_plant') {
    const snapshots = body?.snapshots || null;
    const sel = await getSelection(db, userId);

    const start = sel?.start || null;
    const end = new Date();

    // Compute simple stats from sensordata in this run (optional best-effort)
    const match = { userId };
    if (start) match.timestamp = { $gte: start, $lte: end };

    const agg = await db.collection('sensordata').aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          samples: { $sum: 1 },
          t_min: { $min: '$temperature' }, t_max: { $max: '$temperature' }, t_avg: { $avg: '$temperature' },
          h_min: { $min: '$humidity' },    h_max: { $max: '$humidity' },    h_avg: { $avg: '$humidity' },
          p_min: { $min: '$ph' },          p_max: { $max: '$ph' },          p_avg: { $avg: '$ph' },
          n_min: { $min: '$ppm' },         n_max: { $max: '$ppm' },         n_avg: { $avg: '$ppm' }
        }
      }
    ]).toArray();

    const stats = agg[0] ? {
      samples: agg[0].samples || 0,
      temperature: { min: agg[0].t_min, max: agg[0].t_max, avg: agg[0].t_avg },
      humidity:    { min: agg[0].h_min, max: agg[0].h_max, avg: agg[0].h_avg },
      ph:          { min: agg[0].p_min, max: agg[0].p_max, avg: agg[0].p_avg },
      ppm:         { min: agg[0].n_min, max: agg[0].n_max, avg: agg[0].n_avg }
    } : null;

    // Store archive
    if (sel?.plant) {
      await db.collection('archives').insertOne({
        userId,
        plantName: sel.plant,
        finalStage: sel.stage || 'seedling',
        startDate: start,
        endDate: end,
        stats,
        snapshots: snapshots || null,
        createdAt: end
      });
    }

    // Clear sensordata rows and selection
    await db.collection('sensordata').deleteMany({ userId });
    await db.collection('app_state').deleteOne({ userId });

    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // 3) treat as a live sensor reading from device
  const sel = await getSelection(db, userId);
  if (!sel?.plant || !sel?.stage) {
    // If no selection yet, do not store readings — return passive defaults
    return NextResponse.json({
      commands: { light: 0, ph_up_pump: false, ph_down_pump: false, ppm_a_pump: false, ppm_b_pump: false }
    }, { status: 200 });
  }

  const doc = {
    userId,
    timestamp: new Date(),
    temperature: numOrNull(body.temperature),
    humidity:    numOrNull(body.humidity),
    ph:          numOrNull(body.ph),
    ppm:         numOrNull(body.ppm),
    distance:    numOrNull(body.distance),
    water_sufficient: typeof body.water_sufficient === 'boolean' ? body.water_sufficient : null,
    raw: body // keep raw payload for troubleshooting if you like
  };
  await db.collection('sensordata').insertOne(doc);

  // Decide actuation using backend logic and current stage’s ideals
  const ideals = await getIdealFor(db, userId, sel.plant, sel.stage);
  const commands = processSensorData({
    latest: doc,
    ideal: ideals || {},
    selection: sel
  });

  return NextResponse.json(commands, { status: 200 });
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
