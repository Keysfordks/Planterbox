import clientPromise from './dbConnect';
import { NextRequest, NextResponse } from 'next/server';
import { processSensorData } from './backendLogic';

// Function to get the current selection (plant and stage) from the database
async function getCurrentSelection(appStateCollection) {
    const appState = await appStateCollection.findOne({ state_name: "plantSelection" });
    const currentPlant = appState?.value?.plant || 'pothos';
    // Default to 'seedling' if stage is not found (for fresh deployments)
    const currentStage = appState?.value?.stage || 'seedling'; 
    return { currentPlant, currentStage };
}

// Function to handle historical data fetching
async function handleHistoricalData(appStateCollection, sensorCollection) {
    // 1. Get plant selection date
    const appState = await appStateCollection.findOne({ state_name: "plantSelection" });
    // Use the timestamp saved during the 'select_plant' action
    // Default to 7 days ago if timestamp is missing
    const selectionTime = appState?.value?.timestamp ? new Date(appState.value.timestamp) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); 

    // 2. Determine 7-day cutoff (start time)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    // The query starts at the *later* of the two: 7 days ago OR when the plant was selected
    const startTime = selectionTime > sevenDaysAgo ? selectionTime : sevenDaysAgo;
    
    // 3. Query the sensordata collection
    const historicalData = await sensorCollection.find({
        // Assuming the ESP32 sends a timestamp that MongoDB can convert
        timestamp: { $gte: startTime.toISOString() } 
    }).sort({ timestamp: 1 }).toArray();

    // 4. Return the data
    return new Response(JSON.stringify({ 
      historicalData, 
      selectionStartTime: startTime.toISOString() 
    }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
    });
}

export async function POST(request) {
  const client = await clientPromise;
  const db = client.db('planterbox');
  const sensorCollection = db.collection('sensordata');
  const appStateCollection = db.collection('app_state');

  const data = await request.json();
  console.log("Received data (POST):", data);


  if (data.action === "select_plant" && data.selectedPlant && data.selectedStage) {
    try {

      await appStateCollection.updateOne(
        { state_name: "plantSelection" },
        { $set: { 
            value: { 
                plant: data.selectedPlant, 
                stage: data.selectedStage,
                timestamp: new Date(),
            }
        } },
        { upsert: true }
      );
      
      return new Response(JSON.stringify({ message: `Plant selected: ${data.selectedPlant} (${data.selectedStage})` }), {
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
  } else if (data.action === "abort_plant") {
     try {
        await appStateCollection.deleteOne({ state_name: "plantSelection" });
        return new Response(JSON.stringify({ message: "Plant aborted successfully." }), { status: 200 });
     } catch (error) {
         console.error("Failed to abort plant:", error);
         return new Response(JSON.stringify({ error: "Failed to abort plant" }), { status: 500 });
     }
  } else {
    // Sensor data upload logic
    try {
      // Add server-side timestamp for reliable sorting/querying
      const sensorDataWithTimestamp = { ...data, timestamp: new Date().toISOString() };
      await sensorCollection.insertOne(sensorDataWithTimestamp);
      
      const latestData = sensorDataWithTimestamp;
      const { currentPlant, currentStage } = await getCurrentSelection(appStateCollection);
      
      const { deviceCommands, sensorStatus } = await processSensorData(latestData, currentPlant, currentStage);

      if (latestData) {
        // Return commands back to the ESP32
        return new Response(JSON.stringify(deviceCommands), { // Send back only the deviceCommands
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      
    } catch (error) {
      console.error("Failed to insert or process data:", error);
      // Return a response even on error so ESP32 doesn't time out
      return new Response(JSON.stringify({ light: 0, ph_up_pump: false, ph_down_pump: false, ppm_a_pump: false, ppm_b_pump: false }), { 
          status: 500,
          headers: { "Content-Type": "application/json" }
      });
    }
  }
}

export async function GET(request) {
  const client = await clientPromise;
  const db = client.db('planterbox');
  const sensorCollection = db.collection('sensordata');
  const appStateCollection = db.collection('app_state');
  
  const { searchParams } = new URL(request.url);
  
  // Handle request for historical data
  if (searchParams.get('growth') === 'true') {
    return handleHistoricalData(appStateCollection, sensorCollection);
  }
  
  // Handle request for ideal conditions and latest data
  const plantName = searchParams.get('plant');
  const stageName = searchParams.get('stage');

  if (plantName && stageName) {
    // Request for ideal conditions only (used during initial load)
    const plantProfileCollection = db.collection('plant_profiles');
    const idealConditions = await plantProfileCollection.findOne({ 
      plant_name: plantName, 
      stage: stageName 
    });
    
    return new Response(JSON.stringify({ ideal_conditions: idealConditions?.ideal_conditions || {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Request for latest sensor data and commands (used for dashboard refresh)
  try {
    const latestData = await sensorCollection.find().sort({ timestamp: -1 }).limit(1).next();
    const { currentPlant, currentStage } = await getCurrentSelection(appStateCollection);

    // Call processSensorData to get status and commands
    const { deviceCommands, sensorStatus } = await processSensorData(latestData, currentPlant, currentStage);
    
    // Ensure sensorData is always populated with the expected keys
    let sensorDataToReturn;
    
    if (latestData) {
        // Destructure out the unused fields (tds, distance) and keep everything else
        const { tds, distance, ...dataWithoutUnusedSensors } = latestData;
        sensorDataToReturn = dataWithoutUnusedSensors;
    } else {
        // Return null/default values for the frontend to show "Loading..." or "N/A"
        sensorDataToReturn = {
            temperature: null,
            humidity: null,
            ph: null,
            ppm: null,
            water_sufficient: null,
        };
    }

    return new Response(JSON.stringify({ 
        sensorData: sensorDataToReturn, // Use the correctly populated object
        sensorStatus, 
        deviceCommands 
    }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Failed to fetch data:", error);
    return new Response(JSON.stringify({ error: "Failed to fetch data" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}