import clientPromise from './dbConnect';
import { NextRequest, NextResponse } from 'next/server';
import { processSensorData } from './backendLogic';

export async function POST(request) {
  const client = await clientPromise;
  const db = client.db('planterbox');
  const sensorCollection = db.collection('sensordata');
  const appStateCollection = db.collection('app_state');

  const data = await request.json();
  console.log("Received data:", data);

  // New logic to handle 'select_plant' action from frontend
  if (data.action === "select_plant" && data.selectedPlant) {
    try {
      await appStateCollection.updateOne(
        { state_name: "selectedPlant" },
        { $set: { value: data.selectedPlant, timestamp: new Date() } },
        { upsert: true }
      );
      return new Response(JSON.stringify({ status: "ok", message: "Plant selection updated." }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      console.error("Failed to save plant selection:", error);
      return new Response(JSON.stringify({ error: "Failed to save plant selection" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  // Check for the 'abort_plant' action
  if (data.action === "abort_plant") {
    try {
      await sensorCollection.deleteMany({});
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      console.error("Failed to delete sensor data:", error);
      return new Response(JSON.stringify({ error: "Failed to delete sensor data" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  // Handle incoming sensor data from ESP32
  if (data.temperature !== undefined || data.humidity !== undefined) {
    try {
      const result = await sensorCollection.insertOne({ ...data, timestamp: new Date() });
      console.log(`A document was inserted with the _id: ${result.insertedId}`);

      const latestData = await sensorCollection.findOne({}, { sort: { timestamp: -1 } });
      
      const appState = await appStateCollection.findOne({ state_name: "selectedPlant" });
      const currentPlant = appState?.value || 'pothos';

      const { deviceCommands } = await processSensorData(latestData, currentPlant);
      
      return new Response(JSON.stringify(deviceCommands), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    } catch (error) {
      console.error("Failed to save sensor data:", error);
      return new Response(JSON.stringify({ error: "Failed to save sensor data" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  // Handle other types of POST requests (manual controls from frontend)
  if (data.pump !== undefined || data.light !== undefined) {
    try {
      const updateDoc = { $set: { ...data } };
      const options = { sort: { timestamp: -1 }, returnDocument: 'after', upsert: true };
      const result = await sensorCollection.findOneAndUpdate({}, updateDoc, options);
      const deviceCommands = {
        pump: result.value?.pump || false,
        light: result.value?.light || false,
      };

      return new Response(JSON.stringify({ status: "ok", deviceCommands }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    } catch (error) {
      console.error("Failed to update device commands:", error);
      return new Response(JSON.stringify({ error: "Failed to update device commands" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function GET(request) {
  const client = await clientPromise;
  const db = client.db('planterbox');
  const sensorCollection = db.collection('sensordata');
  const plantProfileCollection = db.collection('plant_profiles');
  const appStateCollection = db.collection('app_state');

  try {
    const { searchParams } = new URL(request.url);
    const plantName = searchParams.get('plant');

    if (plantName) {
      const profile = await plantProfileCollection.findOne({ plant_name: plantName });
      if (profile) {
        return new Response(JSON.stringify(profile), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      } else {
        return new Response(JSON.stringify({ error: "Plant profile not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }
    } else {
      const latestData = await sensorCollection.findOne(
        { temperature: { $exists: true } },
        { sort: { timestamp: -1 } }
      );
      
      const appState = await appStateCollection.findOne({ state_name: "selectedPlant" });
      const currentPlant = appState?.value || 'pothos';

      const { deviceCommands, sensorStatus } = await processSensorData(latestData, currentPlant);

      if (latestData) {
        const { tds, distance, ...dataWithoutUnusedSensors } = latestData;
        return new Response(JSON.stringify({ sensorData: dataWithoutUnusedSensors, sensorStatus, deviceCommands }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      } else {
        return new Response(JSON.stringify({
          sensorData: {
            temperature: null,
            humidity: null,
            ph: null,
            ppm: null,
          },
          sensorStatus: {
            temperature: "Loading...",
            humidity: "Loading...",
            ph: "Loading...",
            ppm: "Loading...",
          },
          deviceCommands: {
            pump: false,
            light: 0,
          }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
  } catch (error) {
    console.error("Failed to fetch data:", error);
    return new Response(JSON.stringify({ error: "Failed to fetch data" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}