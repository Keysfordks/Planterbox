import { NextResponse } from 'next/server';
import clientPromise from '../../../lib/mongodb';
import { auth } from '../auth/[...nextauth]/route';
import { ObjectId } from 'mongodb';

// ---------- GET ----------
// - ?presets=true&plant=&stage=  -> fetch preset ideal for specific plant+stage
// - ?presets=true                -> list preset plants (seedling stage)
// - (no presets)                 -> list user's custom plant profiles
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const presets = searchParams.get('presets') === 'true';
    const plant = searchParams.get('plant');
    const stage = searchParams.get('stage');

    const client = await clientPromise;
    const db = client.db('planterbox');
    const col = db.collection('plant_profiles');

    if (presets) {
      if (plant && stage) {
        const preset = await col.findOne({ plant_name: plant, stage, userId: { $exists: false } });
        return NextResponse.json({ ideal_conditions: preset?.ideal_conditions ?? null }, { status: 200 });
      }
      // list presets (seedling) for UI picker
      const list = await col
        .find({ stage: 'seedling', userId: { $exists: false } })
        .project({ plant_name: 1, stage: 1, ideal_conditions: 1 })
        .toArray();
      return NextResponse.json({ presets: list }, { status: 200 });
    }

    // user profiles (auth required)
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const list = await col
      .find({ userId: session.user.id })
      .project({ plant_name: 1, stage: 1, ideal_conditions: 1, createdAt: 1 })
      .toArray();

    return NextResponse.json({ profiles: list }, { status: 200 });
  } catch (err) {
    console.error('GET /api/plants error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// ---------- POST ----------
// Create a user-owned plant profile with strict validation
export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { plant_name, stage, ideal_conditions } = body || {};

    if (!plant_name || !String(plant_name).trim()) {
      return NextResponse.json({ error: 'plant_name is required' }, { status: 400 });
    }
    if (!stage || !String(stage).trim()) {
      return NextResponse.json({ error: 'stage is required' }, { status: 400 });
    }
    if (!ideal_conditions || typeof ideal_conditions !== 'object') {
      return NextResponse.json({ error: 'ideal_conditions is required' }, { status: 400 });
    }

    // Coerce and validate numbers
    const toNum = (v) => (typeof v === 'number' ? v : Number(v));
    const ic = {
      temp_min: toNum(ideal_conditions.temp_min),
      temp_max: toNum(ideal_conditions.temp_max),
      humidity_min: toNum(ideal_conditions.humidity_min),
      humidity_max: toNum(ideal_conditions.humidity_max),
      ph_min: toNum(ideal_conditions.ph_min),
      ph_max: toNum(ideal_conditions.ph_max),
      ppm_min: toNum(ideal_conditions.ppm_min),
      ppm_max: toNum(ideal_conditions.ppm_max),
      // HOURS PER DAY
      light_pwm_cycle: toNum(ideal_conditions.light_pwm_cycle),
    };

    // field-level checks
    for (const [k, v] of Object.entries(ic)) {
      if (typeof v !== 'number' || Number.isNaN(v)) {
        return NextResponse.json({ error: `Field ${k} must be a valid number` }, { status: 400 });
      }
    }
    // logical range checks
    if (ic.temp_min > ic.temp_max)   return NextResponse.json({ error: 'Temperature min must be ≤ max' }, { status: 400 });
    if (ic.humidity_min > ic.humidity_max) return NextResponse.json({ error: 'Humidity min must be ≤ max' }, { status: 400 });
    if (ic.ph_min > ic.ph_max)       return NextResponse.json({ error: 'pH min must be ≤ max' }, { status: 400 });
    if (ic.ppm_min > ic.ppm_max)     return NextResponse.json({ error: 'PPM min must be ≤ max' }, { status: 400 });
    if (ic.light_pwm_cycle < 0 || ic.light_pwm_cycle > 24) {
      return NextResponse.json({ error: 'Light hours per day must be between 0 and 24' }, { status: 400 });
    }

    const doc = {
      userId: session.user.id,
      plant_name: String(plant_name).trim(),
      stage: String(stage).trim(),
      ideal_conditions: ic,
      createdAt: new Date(),
    };

    const client = await clientPromise;
    const db = client.db('planterbox');
    const col = db.collection('plant_profiles');

    const { insertedId } = await col.insertOne(doc);

    return NextResponse.json({ ok: true, id: insertedId.toString() }, { status: 200 });
  } catch (err) {
    console.error('POST /api/plants error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// ---------- DELETE ----------
// /api/plants?id=<profileId>
export async function DELETE(request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const _id = new ObjectId(id);
    const client = await clientPromise;
    const db = client.db('planterbox');
    const col = db.collection('plant_profiles');

    const res = await col.deleteOne({ _id, userId: session.user.id });
    if (res.deletedCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('DELETE /api/plants error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
