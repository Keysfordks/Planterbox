// app/api/plants/route.js
import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';

// Adjust these paths if your structure differs
import clientPromise from '../../../lib/mongodb';
import { auth } from '../auth/[...nextauth]/route';

import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("Missing MONGODB_URI in environment");

// Simple cached connection (doesn't change your other db code)
let cached = global._plantsDbCache;
if (!cached) cached = global._plantsDbCache = { conn: null, promise: null };

async function connect() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
    }).then((m) => m);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

// Inline model used only by this route (doesn't replace any existing model files)
const IdealSchema = new mongoose.Schema({
  ph_min: Number, ph_max: Number,
  ppm_min: Number, ppm_max: Number,
  temp_min: Number, temp_max: Number,
  humidity_min: Number, humidity_max: Number,
  light_pwm_cycle: Number,
}, { _id: false });

const PlantProfileSchema = new mongoose.Schema({
  plant_name: { type: String, required: true, lowercase: true, trim: true },
  stage: { type: String, required: true, lowercase: true, trim: true },
  ideal_conditions: { type: IdealSchema, required: true },
}, { collection: "plant_profiles", timestamps: true });

PlantProfileSchema.index({ plant_name: 1, stage: 1 }, { unique: true });

const PlantProfile =
  mongoose.models.PlantProfile || mongoose.model("PlantProfile", PlantProfileSchema);

// GET /api/plants?presets=true
// GET /api/plants?presets=true&plant=<pothos|mint|monstera>&stage=<seedling|vegetative|mature>
export async function GET(req) {
  try {
    await connect();

    const { searchParams } = new URL(req.url);
    const presets = searchParams.get("presets");
    const plant = searchParams.get("plant")?.toLowerCase().trim();
    const stage = searchParams.get("stage")?.toLowerCase().trim();

    if (presets === "true" && !plant && !stage) {
      // Return the three preset names you care about (safe even if extra docs exist)
      const allowed = ["pothos", "mint", "monstera"];
      const names = await PlantProfile.aggregate([
        { $match: { plant_name: { $in: allowed } } },
        { $group: { _id: "$plant_name" } },
        { $project: { _id: 0, plant_name: "$_id" } },
        { $sort: { plant_name: 1 } },
      ]);
      return new Response(JSON.stringify({ presets: names }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    if (presets === "true" && plant && stage) {
      const doc = await PlantProfile.findOne({ plant_name: plant, stage }).lean();
      if (!doc) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        plant_name: doc.plant_name,
        stage: doc.stage,
        ideal_conditions: doc.ideal_conditions,
      }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    return new Response(JSON.stringify({ error: "Bad request" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("/api/plants GET error:", err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}


/**
 * GET /api/plants
 * - ?presets=true&plant=<name>&stage=<stage> -> preset ideal_conditions (no userId)
 * - ?presets=true -> list one "seedling" preset per plant (no userId)
 * - (default, requires auth) -> authenticated user's plants
 */
export async function GET(request) {
  try {
    const session = await auth();
    const { searchParams } = new URL(request.url);

    const presetsOnly = searchParams.get('presets') === 'true';
    const plantName = searchParams.get('plant');
    const stage = searchParams.get('stage');

    const client = await clientPromise;
    const db = client.db('planterbox');

    if (presetsOnly) {
      if (plantName && stage) {
        const preset = await db.collection('plant_profiles').findOne({
          plant_name: plantName,
          stage,
          userId: { $exists: false },
        });
        if (!preset) {
          return NextResponse.json({ error: 'Preset not found' }, { status: 404 });
        }
        return NextResponse.json({ ideal_conditions: preset.ideal_conditions }, { status: 200 });
      }

      const distinctPlantNames = await db
        .collection('plant_profiles')
        .distinct('plant_name', { userId: { $exists: false } });

      const presets = [];
      for (const name of distinctPlantNames) {
        const seedling = await db.collection('plant_profiles').findOne({
          plant_name: name,
          stage: 'seedling',
          userId: { $exists: false },
        });
        if (seedling) presets.push(seedling);
      }
      return NextResponse.json({ presets }, { status: 200 });
    }

    if (!session || !session.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const plants = await db
      .collection('plant_profiles')
      .find({ userId: session.user.id })
      .toArray();

    return NextResponse.json({ plants }, { status: 200 });
  } catch (error) {
    console.error('Error in GET /api/plants:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/plants
 * Body:
 * {
 *   plant_name: string,
 *   stage: 'seedling'|'vegetative'|'flowering'|'mature'|'harvest',
 *   ideal_conditions: {
 *     ph_min, ph_max, ppm_min, ppm_max, temp_min, temp_max,
 *     humidity_min, humidity_max, light_pwm_cycle,
 *     ideal_light_distance_cm, light_distance_tolerance_cm
 *   },
 *   // optional
 *   deviceId?: string
 * }
 *
 * - Inserts the plant profile (scoped to the user)
 * - Updates app_state to set current selection for the user
 * - If deviceId provided, mirrors the selection under that deviceId
 */
export async function POST(request) {
  try {
    const session = await auth();
    if (!session || !session.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    if (!body.plant_name || !body.stage || !body.ideal_conditions) {
      return NextResponse.json(
        { error: 'Missing required fields: plant_name, stage, or ideal_conditions' },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db('planterbox');

    const normalizedName = String(body.plant_name).toLowerCase().trim();

    const plantData = {
      ...body,
      plant_name: normalizedName,
      userId: session.user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const insertResult = await db.collection('plant_profiles').insertOne(plantData);

    const appState = db.collection('app_state');
    const selectionValue = {
      plant: normalizedName,
      stage: body.stage,
      timestamp: new Date().toISOString(),
    };

    // selection for the user
    await appState.updateOne(
      { state_name: 'plantSelection', userId: session.user.id },
      { $set: { value: selectionValue } },
      { upsert: true }
    );

    // optional device mirror
    if (body.deviceId) {
      await appState.updateOne(
        { state_name: 'plantSelection', userId: body.deviceId },
        { $set: { value: selectionValue } },
        { upsert: true }
      );
    }

    return NextResponse.json(
      {
        message: 'Plant added and selection updated',
        id: insertResult.insertedId,
        plant: plantData,
        selection: selectionValue,
        mirroredToDevice: Boolean(body.deviceId),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error adding plant:', error);
    return NextResponse.json(
      { error: 'Failed to add plant', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/plants?id=<plantId>
 */
export async function DELETE(request) {
  try {
    const session = await auth();
    if (!session || !session.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const plantId = searchParams.get('id');
    if (!plantId) {
      return NextResponse.json({ error: 'Missing plant ID' }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db('planterbox');

    const result = await db.collection('plant_profiles').deleteOne({
      _id: new ObjectId(plantId),
      userId: session.user.id,
    });

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: 'Plant not found or unauthorized' },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: 'Plant deleted successfully' }, { status: 200 });
  } catch (error) {
    console.error('Error deleting plant:', error);
    return NextResponse.json(
      { error: 'Failed to delete plant', details: error.message },
      { status: 500 }
    );
  }
}
