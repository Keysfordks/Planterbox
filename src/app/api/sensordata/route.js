import { NextResponse } from "next/server";
import clientPromise from "../../../lib/mongodb";
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
        userId: userId, // Ensure you fetch the user's specific profile
    });
    return idealConditions?.ideal_conditions || {};
}


// ----------------------------------------------------------------------
// HISTORICAL DATA FUNCTION (MongoDB Aggregation)
// ----------------------------------------------------------------------

// NOTE: This now uses authUserId for profile lookups and DEVICE_ID for sensor data
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
      }
      // ... (rest of the pipeline remains the same)
      ,
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

        let userId = null; // The ID used for the database operation (will be DEVICE_ID or authUserId)
        let authUserId = null; // For operations that require the logged-in user's ID (e.g., profiles)

        if (isWebAppRequest) {
            const session = await auth();
            if (!session || !session.user?.id) {
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            }
            authUserId = session.user.id;
            // CRITICAL FIX: Web app actions must target the DEVICE_ID for app_state
            userId = DEVICE_ID; 
        } else {
            // This is the ESP32 POST request. The ID is the device ID.
            userId = data.deviceId || DEVICE_ID;
        }

        if (data.action === "select_plant") {
            if (!data.selectedPlant || !data.selectedStage) {
                return NextResponse.json(
                    { error: "Missing plant or stage selection" },
                    { status: 400 }
                );
            }

            // CRITICAL FIX: The plant selection state is saved under the DEVICE_ID
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
            // ... (keep your abort_plant logic as it was in the previous correct version)
            
            // Fetch the active plant state (targets DEVICE_ID)
            const appState = await appStateCollection.findOne({
                state_name: "plantSelection",
                userId: userId, 
            });

            const startDate = appState?.value?.timestamp;
            let archiveCreated = false;

            // --- 1. ATTEMPT TO CREATE ARCHIVE RECORD (IF STATE EXISTS) ---
            if (startDate) {
                try {
                    const plantName = appState.value?.plant || 'Unknown Plant';
                    const stageName = appState.value?.stage || 'Unknown Stage';
                    const endDate = new Date().toISOString();
                    
                    // Fetch data using the DEVICE_ID
                    const latestData = await sensorCollection 
                        .find({ userId: DEVICE_ID })
                        .sort({ timestamp: -1 })
                        .limit(1)
                        .next();
                        
                    // Fetch profile using the AUTH USER ID
                    const plantProfile = await plantProfileCollection.findOne({ 
                        plant_name: plantName, 
                        stage: stageName,
                        userId: authUserId
                    });

                    // Construct the archive object
                    const archiveCollection = db.collection("archived_projects");
                    await archiveCollection.insertOne({
                        userId: authUserId, // Archive under the authenticated user's ID
                        deviceId: DEVICE_ID,
                        plantName: plantName,
                        startDate: startDate,
                        endDate: endDate,
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

            // --- 2. DELETE ACTIVE STATE ---
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
        // --- PLANT SELECTION CHECK (Saves sensor data only if a plant is selected) ---
        // -----------------------------------------------------------------------------------
        
        // 1. Get the current selection state using the device's userId (which is DEVICE_ID)
        const { selectionTime } = await getCurrentSelection(appStateCollection, userId);

        // 2. If selectionTime is null/undefined, IGNORE the data
        if (!selectionTime) {
            console.log(`Sensor data IGNORED: No plant selected for device ${userId}.`);
            // Return empty commands (200 OK) to the ESP32
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

        const { currentPlant, currentStage } = await getCurrentSelection(
            appStateCollection,
            userId // This is DEVICE_ID
        );
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
    // Authenticate user for web app requests
    const session = await auth();
    if (!session || !session.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // --- CRITICAL FIX: Use the constant DEVICE_ID ---
    const client = await clientPromise;
    const db = client.db("planterbox");
    const sensorCollection = db.collection("sensordata");
    const appStateCollection = db.collection("app_state");
    const plantProfileCollection = db.collection("plant_profiles");

    const { searchParams } = new URL(request.url);

    // Handle historical data request
    if (searchParams.get("growth") === "true") {
      // Pass authUserId to allow historical data to fetch the user's profile
      return getHistoricalData(appStateCollection, sensorCollection, plantProfileCollection, session.user.id);
    }

    // Handle ideal conditions request
    const plantName = searchParams.get("plant");
    const stageName = searchParams.get("stage");

    if (plantName && stageName) {
      const idealConditions = await plantProfileCollection.findOne({
        plant_name: plantName,
        stage: stageName,
        userId: session.user.id, // Use authenticated user ID for profiles
      });

      return NextResponse.json({
        ideal_conditions: idealConditions?.ideal_conditions || {},
      });
    }

    // Handle latest sensor data request (default)
    const latestData = await sensorCollection
      .find({ userId: DEVICE_ID }) // Fetch data using DEVICE_ID
      .sort({ timestamp: -1 })
      .limit(1)
      .next();

    const { currentPlant, currentStage } = await getCurrentSelection(
      appStateCollection,
      DEVICE_ID // Get state using DEVICE_ID
    );
    const { deviceCommands, sensorStatus } = await processSensorData(
      latestData,
      currentPlant,
      currentStage,
      session.user.id // Pass authUserId to the backend logic (for profile lookups)
    );

    // Prepare sensor data response
    let sensorDataToReturn;
    if (latestData) {
      // Hide _id, tds, and userId
      const { tds, _id, userId, ...cleanedData } = latestData; 
      sensorDataToReturn = cleanedData;
    } else {
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