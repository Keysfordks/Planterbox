import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import clientPromise from '../../../lib/mongodb';
import { auth } from '../auth/[...nextauth]/route';

// GET - Fetch plant presets OR user's plants
export async function GET(request) {
  try {
    const session = await auth();
    const { searchParams } = new URL(request.url);
    const plantName = searchParams.get('plant');
    const stage = searchParams.get('stage');
    const presetsOnly = searchParams.get('presets');

    const client = await clientPromise;
    const db = client.db('planterbox');

    // If requesting presets (templates without userId)
    if (presetsOnly === 'true') {
      // If plant and stage specified, return specific preset
      if (plantName && stage) {
        const preset = await db.collection('plant_profiles')
          .findOne({ 
            plant_name: plantName, 
            stage: stage,
            userId: { $exists: false } 
          });

        if (!preset) {
          return NextResponse.json(
            { error: 'Preset not found' },
            { status: 404 }
          );
        }

        return NextResponse.json({ 
          ideal_conditions: preset.ideal_conditions 
        }, { status: 200 });
      }

      // Otherwise, return list of unique plant types
      const distinctPlantNames = await db.collection('plant_profiles')
        .distinct('plant_name', { userId: { $exists: false } });

      const presets = [];
      for (const plantName of distinctPlantNames) {
        const preset = await db.collection('plant_profiles')
          .findOne({ 
            plant_name: plantName, 
            stage: 'seedling',
            userId: { $exists: false } 
          });
        
        if (preset) {
          presets.push(preset);
        }
      }

      console.log(`Found ${presets.length} unique plant presets`);
      return NextResponse.json({ presets }, { status: 200 });
    }

    // Otherwise, fetch user's plants (requires authentication)
    if (!session || !session.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const plants = await db.collection('plant_profiles')
      .find({ userId: session.user.id })
      .toArray();

    console.log(`Found ${plants.length} plants for user ${session.user.id}`);
    return NextResponse.json({ plants }, { status: 200 });
    
  } catch (error) {
    console.error('Error in GET /api/plants:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data', details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { plant_name, stage, ideal_conditions } = body || {};
    if (!plant_name || !stage || !ideal_conditions) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    // Coerce to numbers and validate
    const ic = {
      temp_min: Number(ideal_conditions.temp_min),
      temp_max: Number(ideal_conditions.temp_max),
      humidity_min: Number(ideal_conditions.humidity_min),
      humidity_max: Number(ideal_conditions.humidity_max),
      ph_min: Number(ideal_conditions.ph_min),
      ph_max: Number(ideal_conditions.ph_max),
      ppm_min: Number(ideal_conditions.ppm_min),
      ppm_max: Number(ideal_conditions.ppm_max),
      // HOURS PER DAY — not duty cycle
      light_pwm_cycle: Number(ideal_conditions.light_pwm_cycle),
    };
    for (const [k,v] of Object.entries(ic)) {
      if (Number.isNaN(v)) return NextResponse.json({ error: `Field ${k} must be a number` }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db('planterbox');
    const col = db.collection('plant_profiles');

    const doc = {
      userId: session.user.id,
      plant_name: plant_name.trim(),
      stage: String(stage).trim(),                 // ← must match what you “select”
      ideal_conditions: ic,
      createdAt: new Date()
    };
    const { insertedId } = await col.insertOne(doc);
    return NextResponse.json({ ok: true, id: insertedId.toString() }, { status: 200 });
  } catch (err) {
    console.error('POST /api/plants error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}


// DELETE - Remove a plant profile
export async function DELETE(request) {
  try {
    const session = await auth();
    if (!session || !session.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const plantId = searchParams.get('id');

    if (!plantId) {
      return NextResponse.json(
        { error: 'Missing plant ID' },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db('planterbox');
    
    // Delete only if the plant belongs to this user
    const result = await db.collection('plant_profiles').deleteOne({
      _id: new ObjectId(plantId),
      userId: session.user.id
    });

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: 'Plant not found or unauthorized' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Plant deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error deleting plant:', error);
    return NextResponse.json(
      { error: 'Failed to delete plant' },
      { status: 500 }
    );
  }
}