// app/api/plants/route.js
import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import clientPromise from '../../../lib/mongodb';

const DEFAULT_USER_ID = "local_user";

/**
 * GET /api/plants
 * - ?presets=true&plant=<n>&stage=<stage> -> preset ideal_conditions (no userId)
 * - ?presets=true -> list one "seedling" preset per plant (no userId)
 * - (default) -> local user's plants
 */
export async function GET(request) {
  try {
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

    const plants = await db
      .collection('plant_profiles')
      .find({ userId: DEFAULT_USER_ID })
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
 */
export async function POST(request) {
  try {
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
      userId: DEFAULT_USER_ID,
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
      { state_name: 'plantSelection', userId: DEFAULT_USER_ID },
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
    const { searchParams } = new URL(request.url);
    const plantId = searchParams.get('id');
    if (!plantId) {
      return NextResponse.json({ error: 'Missing plant ID' }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db('planterbox');

    const result = await db.collection('plant_profiles').deleteOne({
      _id: new ObjectId(plantId),
      userId: DEFAULT_USER_ID,
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