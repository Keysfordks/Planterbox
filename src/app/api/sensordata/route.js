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
  // ... (Keep the original POST logic here)
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
    
    // Fetch the active plant state
    const appState = await appStateCollection.findOne({
        state_name: "plantSelection",
        userId: userId,
    });

    const startDate = appState?.value?.timestamp;
    let archiveCreated = false;

    // --- 1. ATTEMPT TO CREATE ARCHIVE RECORD (IF STATE EXISTS) ---
    if (startDate) {
        try {
            // Safely extract plant/stage names
            const plantName = appState.value?.plant || 'Unknown Plant';
            const stageName = appState.value?.stage || 'Unknown Stage';
            const endDate = new Date().toISOString();
            
            // Fetch data (can be null, but we safely handle it)
            // This is the fetch that fails if no sensor data exists
            const latestData = await sensorCollection 
                .find({ userId: userId })
                .sort({ timestamp: -1 })
                .limit(1)
                .next();
                
            const plantProfile = await plantProfileCollection.findOne({ 
                plant_name: plantName, 
                stage: stageName,
                userId: userId
            });

            // Construct the archive object
            const archivedProject = {
                userId: userId,
                plantName: plantName,
                startDate: startDate,
                endDate: endDate,
                finalStage: stageName,
                idealConditions: plantProfile?.ideal_conditions || {},
                // CRITICAL: latestData will be null if no sensor data exists, which is fine
                finalSensorData: latestData || null, 
                sensorDataQueryKey: startDate, 
            };
            
            const archiveCollection = db.collection("archived_projects");
            await archiveCollection.insertOne(archivedProject);
            
            archiveCreated = true;

        } catch(archiveError) {
            // IMPORTANT: Log the error but DO NOT re-throw it. 
            // The priority is cleaning up the active state.
            console.error("Warning: Failed to create archive record. Proceeding with plant state deletion.", archiveError);
        }
    } 

    // --- 2. DELETE ACTIVE STATE (MUST succeed to abort the plant) ---
    await appStateCollection.deleteOne({
        state_name: "plantSelection",
        userId: userId,
    });
    
    // Send a message based on whether the archive creation succeeded
    const message = archiveCreated 
        ? "Plant aborted and successfully archived." 
        : "Plant aborted successfully. Note: No archive record created (no start state or sensor data found).";

    return NextResponse.json({ message: message });
}

        const sensorDataWithTimestamp = {
            ...data,
            userId: userId,
            timestamp: new Date().toISOString(),
        };

        await sensorCollection.insertOne(sensorDataWithTimestamp);

        const { currentPlant, currentStage } = await getCurrentSelection(
            appStateCollection,
            userId
        );
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

    const userId = default_device;
    const client = await clientPromise;
    const db = client.db("planterbox");
    const sensorCollection = db.collection("sensordata");
    const appStateCollection = db.collection("app_state");
    const plantProfileCollection = db.collection("plant_profiles"); // Added

    const { searchParams } = new URL(request.url);

    // Handle historical data request (REVISED TO USE NEW getHistoricalData)
    if (searchParams.get("growth") === "true") {
      return getHistoricalData(appStateCollection, sensorCollection, plantProfileCollection, userId);
    }

    // Handle ideal conditions request
    const plantName = searchParams.get("plant");
    const stageName = searchParams.get("stage");

    if (plantName && stageName) {
      const idealConditions = await plantProfileCollection.findOne({
        plant_name: plantName,
        stage: stageName,
        userId: userId,
      });

      return NextResponse.json({
        ideal_conditions: idealConditions?.ideal_conditions || {},
      });
    }

    // Handle latest sensor data request (default)
    const latestData = await sensorCollection
      .find({ userId: userId })
      .sort({ timestamp: -1 })
      .limit(1)
      .next();

    const { currentPlant, currentStage } = await getCurrentSelection(
      appStateCollection,
      userId
    );
    const { deviceCommands, sensorStatus } = await processSensorData(
      latestData,
      currentPlant,
      currentStage,
      userId
    );

    // Prepare sensor data response
    let sensorDataToReturn;
    if (latestData) {
      const { tds, _id, ...cleanedData } = latestData;
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