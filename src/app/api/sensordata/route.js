import { NextResponse } from "next/server";
import clientPromise from "../../../lib/mongodb";
import { processSensorData } from "./backendLogic";
import { auth } from "../auth/[...nextauth]/route";

// Define the static ID used by the ESP32 for all device-related queries
const DEVICE_ID = "default_device"; 

// ----------------------------------------------------------------------
// HELPER FUNCTIONS
// ----------------------------------------------------------------------

// Get current plant and stage selection for a specific user/device
async function getCurrentSelection(appStateCollection, userId) {
  // NOTE: userId here can be the authUserId (for profiles) or DEVICE_ID (for state)
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
    // CRITICAL: We use DEVICE_ID for sensor data lookups, but authUserId for profiles
    const historyQueryId = DEVICE_ID; // Use device ID for the actual sensor data

    // 1. Get current plant and stage selection and start time (using AUTH ID or DEVICE ID)
    const { currentPlant, currentStage, selectionTime } = await getCurrentSelection(appStateCollection, authUserId);
    
    // 2. Fetch ideal conditions for the current selection (using AUTH ID)
    const idealConditions = await getIdealConditions(plantProfileCollection, currentPlant, currentStage, authUserId);

    // Define the start date: use the plant selection time, or a default fallback (e.g., 7 days ago)
    const selectionStartTime = selectionTime ? new Date(selectionTime) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const startTime = selectionStartTime;

    const pipeline = [
      // --- STAGE 1: Filter by User ID (Device ID) and Time ---
      {
        $match: {
          userId: historyQueryId, // Filter by the DEVICE_ID
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

        let userId = null; // The ID used for the database operation

        if (isWebAppRequest) {
            const session = await auth();
            if (!session || !session.user?.id) {
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            }
            // For web app actions, we use the device ID to manipulate the device state
            // to keep it consistent with what the ESP32 checks for.
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
            // so the ESP32 can look it up successfully.
            await appStateCollection.updateOne(
                {
                    state_name: "plantSelection",
                    userId: userId, // userId is now DEVICE_ID
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
            // Fetch the active plant state
            const appState = await appStateCollection.findOne({
                state_name: "plantSelection",
                userId: userId, // userId is DEVICE_ID
            });

            const startDate = appState?.value?.timestamp;
            let archiveCreated = false;
            
            // Assume the authenticated user is the one whose profile we want to use for the archive
            const session = await auth();
            const authUserId = session.user.id; 

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
                    const archivedProject = {
                        userId: authUserId, // Archive under the authenticated user's ID
                        deviceId: DEVICE_ID,
                        plantName: plantName,
                        startDate: startDate,
                        endDate: endDate,
                        finalStage: stageName,
                        idealConditions: plantProfile?.ideal_conditions || {},
                        finalSensorData: latestData || null, 
                        sensorDataQueryKey: startDate, 
                    };
                    
                    const archiveCollection = db.collection("archived_projects");
                    await archiveCollection.insertOne(archivedProject);
                    
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
        // --- CRITICAL FIX: CHECK FOR ACTIVE PLANT SELECTION BEFORE SAVING SENSOR DATA ---
        // -----------------------------------------------------------------------------------
        
        // 1. Get the current selection state using the device's userId (which is DEVICE_ID)
        const { currentPlant, currentStage, selectionTime } = await getCurrentSelection(appStateCollection, userId);

        // 2. If selectionTime is null/undefined, ignore the data
        if (!selectionTime) {
            console.log(`Sensor data IGNORED: No plant selected for device ${userId}.`);
            // Return empty commands (200 OK) to the ESP32
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
            userId: userId, // Store the data under the DEVICE_ID
            timestamp: new Date().toISOString(),
        };

        await sensorCollection.insertOne(sensorDataWithTimestamp); // Data is inserted here

        // Use the current plant for command calculation
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

    const authUserId = session.user.id; // Authenticated user ID (for profiles)
    const client = await clientPromise;
    const db = client.db("planterbox");
    const sensorCollection = db.collection("sensordata");
    const appStateCollection = db.collection("app_state");
    const plantProfileCollection = db.collection("plant_profiles");

    const { searchParams } = new URL(request.url);

    // Handle historical data request (Uses AUTH ID for app state and DEVICE ID for data)
    if (searchParams.get("growth") === "true") {
      // getHistoricalData uses authUserId to look up plant selection/profiles
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
    // FIX: Fetch latest sensor data using the DEVICE_ID
    const latestData = await sensorCollection
      .find({ userId: DEVICE_ID })
      .sort({ timestamp: -1 })
      .limit(1)
      .next();

    // Use the DEVICE_ID to retrieve the plant selection state
    const { currentPlant, currentStage } = await getCurrentSelection(
      appStateCollection,
      DEVICE_ID
    );
    
    // Pass latestData to backendLogic for command calculation
    const { deviceCommands, sensorStatus } = await processSensorData(
      latestData,
      currentPlant,
      currentStage,
      authUserId // Pass authUserId to the backend logic (if it needs it for logging/profiles)
    );

    // Prepare sensor data response
    let sensorDataToReturn;
    if (latestData) {
      // CRITICAL FIX: Explicitly exclude 'userId'
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