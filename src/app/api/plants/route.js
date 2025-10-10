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

// POST - Add a new plant profile for the authenticated user
export async function POST(request) {
  try {
    const session = await auth();
    
    console.log('Session in POST:', session);
    
    if (!session || !session.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    
    // Validate required fields
    if (!body.plant_name || !body.stage || !body.ideal_conditions) {
      return NextResponse.json(
        { error: 'Missing required fields: plant_name, stage, or ideal_conditions' },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db('planterbox');
    
    // Add userId and timestamps to the plant profile
    const plantData = {
      ...body,
      userId: session.user.id,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    console.log('Creating plant for user:', session.user.id);
    
    const result = await db.collection('plant_profiles').insertOne(plantData);

    return NextResponse.json(
      { 
        message: 'Plant added successfully', 
        id: result.insertedId,
        plant: plantData
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