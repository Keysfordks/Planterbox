// app/api/plants/route.js
import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';

// ✅ Adjust these two import paths to match your project structure
import clientPromise from '../../../lib/mongodb';
import { auth } from '../auth/[...nextauth]/route';

/**
 * GET /api/plants
 * - ?presets=true&plant=<name>&stage=<stage> -> returns preset ideal_conditions (no userId)
 * - ?presets=true -> returns a list of seedling presets (no userId)
 * - (default, requires auth) -> returns the authenticated user's plants
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
      // 1) Exact preset lookup
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

      // 2) Otherwise list one "seedling" preset per plant_name (no userId)
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

    // Otherwise, return the authenticated user's plants
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
 *   // optional:
 *   deviceId?: string
 * }
 *
 * - Inserts the plant profile (scoped to the user)
 * - Also updates app_state to set current selection for the user
 * - If deviceId provided, mirrors the same selection under that deviceId
 */
export async function POST(request) {
  try {
    const session = await auth();
    if (!session || !session.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Validate
    if (!body.plant_name || !body.stage || !body.ideal_conditions) {
      return NextResponse.json(
        { error: 'Missing required fields: plant_name, stage, or ideal_conditions' },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db('planterbox');

    // Normalize name (optional but recommended for consistent lookups)
    const normalizedName = String(body.plant_name).toLowerCase().trim();

    // Build document for plant_profiles
    const plantData = {
      ...body,
      plant_name: normalizedName,
      userId: session.user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Insert into plant_profiles
    const insertResult = await db.collection('plant_profiles').insertOne(plantData);

    // --- Also update app_state: set current selection for this user ---
    const appState = db.collection('app_state');
    const selectionValue = {
      plant: normalizedName,
      stage: body.stage,
      timestamp: new Date().toISOString(),
    };

    // Current selection under the userId (used by dashboard, GET /api/sensordata, etc.)
    await appState.updateOne(
      { state_name: 'plantSelection', userId: session.user.id },
      { $set: { value: selectionValue } },
      { upsert: true }
    );

    // OPTIONAL: Mirror selection under a device key so device POSTs can find an exact match
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
 * - Deletes the plant document if it belongs to the authenticated user
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
