import { NextResponse } from "next/server";
import clientPromise from "../../../lib/mongodb";
// Assuming processSensorData is correctly defined in ./backendLogic
import { processSensorData } from "./backendLogic"; 
import { auth } from "../auth/[...nextauth]/route";

// --- CRITICAL FIX: Define the Device ID globally ---
// This is the static ID the ESP32 posts data under and the one the app state must use.
const DEVICE_ID = "default_device";

// ----------------------------------------------------------------------
// HELPER FUNCTIONS
// ----------------------------------------------------------------------

// Get current plant and stage selection for a specific user/device
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
        userId: userId, 
    });
    return idealConditions?.ideal_conditions || {};
}


// ----------------------------------------------------------------------
// HISTORICAL DATA FUNCTION (MongoDB Aggregation)
// ----------------------------------------------------------------------

async function getHistoricalData(appStateCollection, sensorCollection, plantProfileCollection, authUserId) {
  try {
    // 1. Get current plant and stage selection and start time (using DEVICE_ID)
    const { currentPlant, currentStage, selectionTime } = await getCurrentSelection(appStateCollection, DEVICE_ID);
    
    // 2. Fetch ideal conditions for the current selection (using AUTH USER ID)
    const idealConditions = await getIdealConditions(plantProfileCollection, currentPlant, currentStage, authUserId);

    // Define the start date: use the plant selection time, or a default fallback (e.g., 7 days ago)
    const selectionStartTime = selectionTime ? new Date(selectionTime) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const startTime = selectionStartTime;

    const pipeline = [
      // --- STAGE 1: Filter by User ID (DEVICE_ID) and Time ---
      {
        $match: {
          userId: DEVICE_ID, // Use the device ID for sensor data
          timestamp: { $gte: startTime.toISOString() }, 
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
              date: { $dateFromString: { dateString: "$timestamp" } },
              unit: "hour",
              binSize: 6,
              timezone: "America/Chicago" 
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
          ph: { $round: ["$avg_ph", 2] },
          ppm: { $round: ["$avg_ppm", 0] },
          temperature: { $round: ["$avg_temperature", 1] },
          humidity: { $round: ["$avg_humidity", 1] },
        }
      }
    ];

    const historicalData = await sensorCollection.aggregate(pipeline).toArray();

    return NextResponse.json({
      historicalData,
      idealConditions, 
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

// POST handler - for sensor data uploads and plant selection
export async function POST(request) {
    try {
        const client = await clientPromise;
        const db = client.db("planterbox");
        const sensorCollection = db.collection("sensordata");
        const appStateCollection = db.collection("app_state");
        const plantProfileCollection = db.collection("plant_profiles");

        const data = await request.json();
        console.log("Received POST data:", data);

        const isWebAppRequest =
            data.action === "select_plant" || data.action === "abort_plant";

        let userId = null; 
        let authUserId = null; 

        if (isWebAppRequest) {
            const session = await auth();
            if (!session || !session.user?.id) {
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            }
            authUserId = session.user.id;
            // Web app actions modify the state linked to the DEVICE_ID
            userId = DEVICE_ID; 
        } else {
            // This is the ESP32 POST request. 
            userId = data.deviceId || DEVICE_ID;
        }

        if (data.action === "select_plant") {
            if (!data.selectedPlant || !data.selectedStage) {
                return NextResponse.json(
                    { error: "Missing plant or stage selection" },
                    { status: 400 }
                );
            }

            // State is saved under DEVICE_ID
            await appStateCollection.updateOne(
                {
                    state_name: "plantSelection",
                    userId: userId, // This is DEVICE_ID
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
            
            const appState = await appStateCollection.findOne({
                state_name: "plantSelection",
                userId: userId, 
            });

            const startDate = appState?.value?.timestamp;
            let archiveCreated = false;

            if (startDate) {
                try {
                    const plantName = appState.value?.plant || 'Unknown Plant';
                    const stageName = appState.value?.stage || 'Unknown Stage';
                    
                    const latestData = await sensorCollection 
                        .find({ userId: DEVICE_ID })
                        .sort({ timestamp: -1 })
                        .limit(1)
                        .next();
                        
                    const plantProfile = await plantProfileCollection.findOne({ 
                        plant_name: plantName, 
                        stage: stageName,
                        userId: authUserId
                    });

                    const archiveCollection = db.collection("archived_projects");
                    await archiveCollection.insertOne({
                        userId: authUserId, // Archive under the authenticated user's ID
                        deviceId: DEVICE_ID,
                        plantName: plantName,
                        startDate: startDate,
                        endDate: new Date().toISOString(),
                        finalStage: stageName,
                        idealConditions: plantProfile?.ideal_conditions || {},
                        finalSensorData: latestData || null, 
                        sensorDataQueryKey: startDate, 
                    });
                    
                    archiveCreated = true;

                } catch(archiveError) {
                    console.error("Warning: Failed to create archive record. Proceeding with plant state deletion.", archiveError);
                }
            } 

            await appStateCollection.deleteOne({
                state_name: "plantSelection",
                userId: userId, // Delete the state stored under DEVICE_ID
            });
            
            const message = archiveCreated 
                ? "Plant aborted and successfully archived." 
                : "Plant aborted successfully. Note: No archive record created (no start state or sensor data found).";

            return NextResponse.json({ message: message });
        }

        // -----------------------------------------------------------------------------------
        // --- CRITICAL FIX: CHECK FOR ACTIVE PLANT SELECTION BEFORE SAVING SENSOR DATA ---
        // -----------------------------------------------------------------------------------
        
        // 1. Get the current selection state using the device's userId (which is DEVICE_ID)
        const { currentPlant, currentStage, selectionTime } = await getCurrentSelection(appStateCollection, userId);

        // 2. If selectionTime is null/undefined, IGNORE the data
        if (!selectionTime) {
            console.log(`Sensor data IGNORED: No plant selected for device ${userId}.`);
            // Return empty commands (200 OK) and no motor movement to the ESP32
            return NextResponse.json({
                light: 0,
                ph_up_pump: false,
                ph_down_pump: false,
                ppm_a_pump: false,
                ppm_b_pump: false,
                light_motor_cmd: "STOP", 
            }, { status: 200 });
        }
        
        // -----------------------------------------------------------------------------------
        
        // --- PROCEED WITH DATA INSERTION AND CONTROL LOGIC ONLY IF A PLANT IS SELECTED ---
        
        const sensorDataWithTimestamp = {
            ...data,
            userId: userId, // Store the data under the DEVICE_ID
            timestamp: new Date().toISOString(),
        };

        await sensorCollection.insertOne(sensorDataWithTimestamp); // Data is inserted here

        const { deviceCommands } = await processSensorData(
            sensorDataWithTimestamp,
            currentPlant,
            currentStage,
            userId 
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
                light_motor_cmd: "STOP",
            },
            { status: 500 }
        );
    }
}


// GET handler - for dashboard data and historical data
export async function GET(request) {
  try {
    const session = await auth();
    if (!session || !session.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authUserId = session.user.id; 
    
    const client = await clientPromise;
    const db = client.db("planterbox");
    const sensorCollection = db.collection("sensordata");
    const appStateCollection = db.collection("app_state");
    const plantProfileCollection = db.collection("plant_profiles");

    const { searchParams } = new URL(request.url);

    // Historical Data (Growth Charts)
    if (searchParams.get("growth") === "true") {
      return getHistoricalData(appStateCollection, sensorCollection, plantProfileCollection, authUserId);
    }

    // Ideal Conditions lookup
    const plantName = searchParams.get("plant");
    const stageName = searchParams.get("stage");

    if (plantName && stageName) {
      const idealConditions = await plantProfileCollection.findOne({
        plant_name: plantName,
        stage: stageName,
        userId: authUserId, // Use authenticated user ID for profiles
      });

      return NextResponse.json({
        ideal_conditions: idealConditions?.ideal_conditions || {},
      });
    }

    // Default: Latest sensor data for the dashboard
    const latestData = await sensorCollection
      .find({ userId: DEVICE_ID }) // Fetch data using DEVICE_ID
      .sort({ timestamp: -1 })
      .limit(1)
      .next();

    const { currentPlant, currentStage } = await getCurrentSelection(
      appStateCollection,
      DEVICE_ID // Get state using DEVICE_ID
    );
    
    // Process data to get status and commands
    const { deviceCommands, sensorStatus } = await processSensorData(
      latestData,
      currentPlant,
      currentStage,
      authUserId // Pass authUserId for profile lookups
    );

    // Prepare sensor data response (cleaning up fields like _id and userId)
    let sensorDataToReturn;
    if (latestData) {
      const { tds, _id, userId, ...cleanedData } = latestData; 
      sensorDataToReturn = cleanedData;
    } else {
      // Return default nulls if no sensor data has ever been recorded
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