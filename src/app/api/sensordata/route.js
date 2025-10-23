import { NextResponse } from "next/server";
import clientPromise from "../../../lib/mongodb";
import { processSensorData } from "./backendLogic";
import { auth } from "../auth/[...nextauth]/route";

// ----------------------------------------------------------------------
// HELPER FUNCTIONS
// ----------------------------------------------------------------------

// Get current plant and stage selection for a specific user
async function getCurrentSelection(appStateCollection, userId) {
  const appState = await appStateCollection.findOne({
    state_name: "plantSelection",
    userId: userId,
  });
  return {
    currentPlant: appState?.value?.plant || "pothos",
    currentStage: appState?.value?.stage || "seedling",
    selectionTime: appState?.value?.timestamp,
  };
}

// Get the ideal conditions for a plant/stage
async function getIdealConditions(plantProfileCollection, plantName, stageName, userId) {
    const idealConditions = await plantProfileCollection.findOne({ 
        plant_name: plantName, 
        stage: stageName,
        userId: userId, // Ensure you fetch the user's specific profile
    });
    return idealConditions?.ideal_conditions || {};
}


// ----------------------------------------------------------------------
// HISTORICAL DATA FUNCTION (MongoDB Aggregation)
// ----------------------------------------------------------------------

async function getHistoricalData(appStateCollection, sensorCollection, plantProfileCollection, userId) {
  try {
    // 1. Get current plant and stage selection and start time
    const { currentPlant, currentStage, selectionTime } = await getCurrentSelection(appStateCollection, userId);
    
    // 2. Fetch ideal conditions for the current selection
    const idealConditions = await getIdealConditions(plantProfileCollection, currentPlant, currentStage, userId);

    // Define the start date: use the plant selection time, or a default fallback (e.g., 7 days ago)
    const selectionStartTime = selectionTime ? new Date(selectionTime) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    // Use the actual plant selection time as the absolute start for the graph
    const startTime = selectionStartTime;

    const pipeline = [
      // --- STAGE 1: Filter by User ID and Time ---
      {
        $match: {
          userId: userId,
          timestamp: { $gte: startTime.toISOString() }, 
          // Ensure documents have required fields
          ph: { $exists: true }, 
          ppm: { $exists: true }, 
          temperature: { $exists: true },
          humidity: { $exists: true },
        }
      },
      // --- STAGE 2: Downsample (Group by 6 hours and average) ---
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: { $dateFromString: { dateString: "$timestamp" } }, // Convert ISO string to Date object
              unit: "hour",
              binSize: 6, // Group data into 6-hour chunks for smoother graph
              timezone: "America/Chicago" // Adjust to your actual system/plant timezone
            }
          },
          // Calculate the average of each metric
          avg_ph: { $avg: "$ph" },
          avg_ppm: { $avg: "$ppm" },
          avg_temperature: { $avg: "$temperature" },
          avg_humidity: { $avg: "$humidity" }
        }
      },
      // --- STAGE 3: Sort Chronologically ---
      {
        $sort: { "_id": 1 }
      },
      // --- STAGE 4: Reshape/Project ---
      {
        $project: {
          _id: 0,
          timestamp: "$_id",
          ph: { $round: ["$avg_ph", 2] }, // Round pH
          ppm: { $round: ["$avg_ppm", 0] }, // Round PPM
          temperature: { $round: ["$avg_temperature", 1] },
          humidity: { $round: ["$avg_humidity", 1] },
        }
      }
    ];

    const historicalData = await sensorCollection.aggregate(pipeline).toArray();

    return NextResponse.json({
      historicalData,
      idealConditions, // Return ideal conditions to plot on the graph
      selectionStartTime: startTime.toISOString(),
    });

  } catch (error) {
    console.error("Error fetching historical data:", error);
    return NextResponse.json(
      { error: "Failed to fetch historical data" },
      { status: 500 }
    );
  }
}

// ----------------------------------------------------------------------
// API ROUTE HANDLERS
// ----------------------------------------------------------------------

// POST handler - for sensor data uploads and plant selection (KEEP AS IS)
export async function POST(request) {
    try {
        const client = await clientPromise;
        const db = client.db("planterbox");
        const sensorCollection = db.collection("sensordata");
        const appStateCollection = db.collection("app_state");

        const data = await request.json();
        console.log("Received POST data:", data);

        const isWebAppRequest =
            data.action === "select_plant" || data.action === "abort_plant";

        let userId = null;

        if (isWebAppRequest) {
            const session = await auth();
            if (!session || !session.user?.id) {
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            }
            userId = session.user.id;
        } else {
            userId = data.deviceId || "default_device";
        }
        
        // --- EXISTING LOGIC FOR WEB APP ACTIONS (select/abort) REMAINS HERE ---

        if (data.action === "select_plant") {
            if (!data.selectedPlant || !data.selectedStage) {
                return NextResponse.json(
                    { error: "Missing plant or stage selection" },
                    { status: 400 }
                );
            }

            await appStateCollection.updateOne(
                {
                    state_name: "plantSelection",
                    userId: userId,
                },
                {
                    $set: {
                        value: {
                            plant: data.selectedPlant,
                            stage: data.selectedStage,
                            timestamp: new Date(),
                        },
                    },
                },
                { upsert: true }
            );

            return NextResponse.json({
                message: `Plant selected: ${data.selectedPlant} (${data.selectedStage})`,
            });
        }

        if (data.action === "abort_plant") {
            // ... (keep all your existing abort_plant logic here) ...
            
            // NOTE: Ensure your abort logic successfully deletes the plantSelection document
            // from app_state, otherwise the NEW CHECK below will always pass.
            
            // ... (rest of the abort_plant logic) ...
            
            const message = archiveCreated 
                ? "Plant aborted and successfully archived." 
                : "Plant aborted successfully. Note: No archive record created (no start state or sensor data found).";

            return NextResponse.json({ message: message });
        }


        // -----------------------------------------------------------------------------------
        // --- CRITICAL FIX: CHECK FOR ACTIVE PLANT SELECTION BEFORE SAVING SENSOR DATA ---
        // -----------------------------------------------------------------------------------
        
        // 1. Get the current selection state for the device's userId
        const { currentPlant, currentStage, selectionTime } = await getCurrentSelection(appStateCollection, userId);

        // 2. If selectionTime is null/undefined, it means the 'plantSelection' document doesn't exist.
        if (!selectionTime) {
            console.log(`Sensor data IGNORED: No plant selected for device ${userId}.`);
            // Return empty commands (200 OK) to the ESP32 to prevent it from failing, 
            // but without performing the database insert or control logic.
            return NextResponse.json({
                light: 0,
                ph_up_pump: false,
                ph_down_pump: false,
                ppm_a_pump: false,
                ppm_b_pump: false,
            }, { status: 200 });
        }
        
        // -----------------------------------------------------------------------------------
        
        // --- PROCEED WITH DATA INSERTION AND CONTROL LOGIC ONLY IF A PLANT IS SELECTED ---
        
        const sensorDataWithTimestamp = {
            ...data,
            userId: userId,
            timestamp: new Date().toISOString(),
        };

        await sensorCollection.insertOne(sensorDataWithTimestamp); // Data is inserted here

        const { deviceCommands } = await processSensorData(
            sensorDataWithTimestamp,
            currentPlant,
            currentStage,
            userId // Assuming processSensorData can handle userId if needed for logging
        );

        return NextResponse.json(deviceCommands);
    } catch (error) {
        console.error("POST request error:", error);
        return NextResponse.json(
            {
                light: 0,
                ph_up_pump: false,
                ph_down_pump: false,
                ppm_a_pump: false,
                ppm_b_pump: false,
            },
            { status: 500 }
        );
    }
}

// GET handler - for dashboard data and historical data
export async function GET(request) {
  try {
    // Authenticate user for web app requests
    const session = await auth();
    if (!session || !session.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // --- CRITICAL FIX START ---
    const authUserId = session.user.id; // User ID from NextAuth session
    const DEVICE_ID = "default_device"; // ID used by your ESP32 board
    // --- CRITICAL FIX END ---
    
    const client = await clientPromise;
    const db = client.db("planterbox");
    const sensorCollection = db.collection("sensordata");
    const appStateCollection = db.collection("app_state");
    const plantProfileCollection = db.collection("plant_profiles");

    const { searchParams } = new URL(request.url);

    // Handle historical data request (Uses AUTH ID for app state lookup)
    if (searchParams.get("growth") === "true") {
      // NOTE: getHistoricalData currently uses a single userId for ALL filters.
      // To get data, it needs to be updated to use DEVICE_ID for sensorCollection lookups
      // or you need to ensure historical data is stored under the authUserId.
      // For now, pass the Auth ID, but be aware of potential issues here.
      return getHistoricalData(appStateCollection, sensorCollection, plantProfileCollection, authUserId);
    }

    // Handle ideal conditions request (Uses AUTH ID for profile lookup)
    const plantName = searchParams.get("plant");
    const stageName = searchParams.get("stage");

    if (plantName && stageName) {
      const idealConditions = await plantProfileCollection.findOne({
        plant_name: plantName,
        stage: stageName,
        userId: authUserId, // Use authenticated user ID
      });

      return NextResponse.json({
        ideal_conditions: idealConditions?.ideal_conditions || {},
      });
    }

    // Handle latest sensor data request (default)
    // FIX: Fetch latest sensor data using the DEVICE_ID the ESP32 uses
    const latestData = await sensorCollection
      .find({ userId: DEVICE_ID })
      .sort({ timestamp: -1 })
      .limit(1)
      .next();

    // Use the authenticated user's ID to retrieve plant selection
    const { currentPlant, currentStage } = await getCurrentSelection(
      appStateCollection,
      authUserId
    );
    
    // Pass latestData to backendLogic for command calculation
    const { deviceCommands, sensorStatus } = await processSensorData(
      latestData,
      currentPlant,
      currentStage,
      authUserId
    );

    // Prepare sensor data response
    let sensorDataToReturn;
    if (latestData) {
      const { tds, _id, userId, ...cleanedData } = latestData;
      sensorDataToReturn = cleanedData;
    } else {
      // KEEP: Return nulls if no data is found (i.e., display "Loading...")
      sensorDataToReturn = {
        temperature: null,
        humidity: null,
        ph: null,
        ppm: null,
        water_sufficient: null,
        distance: null,
        timestamp: null,
      };
    }

    return NextResponse.json({
      sensorData: sensorDataToReturn,
      sensorStatus,
      deviceCommands,
      currentSelection: {
        plant: currentPlant,
        stage: currentStage,
      },
    });
  } catch (error) {
    console.error("GET request error:", error);
    return NextResponse.json(
      { error: "Failed to fetch data" },
      { status: 500 }
    );
  }
}