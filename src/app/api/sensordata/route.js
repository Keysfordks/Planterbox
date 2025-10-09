import { NextResponse } from "next/server";
import clientPromise from "../../../lib/mongodb";
import { processSensorData } from "./backendLogic";
import { auth } from "../auth/[...nextauth]/route";

// Get current plant and stage selection for a specific user
async function getCurrentSelection(appStateCollection, userId) {
  const appState = await appStateCollection.findOne({
    state_name: "plantSelection",
    userId: userId,
  });
  return {
    currentPlant: appState?.value?.plant || "pothos",
    currentStage: appState?.value?.stage || "seedling",
  };
}

// Fetch historical sensor data for a specific user
async function getHistoricalData(appStateCollection, sensorCollection, userId) {
  try {
    // Get plant selection date for this user
    const appState = await appStateCollection.findOne({
      state_name: "plantSelection",
      userId: userId,
    });
    const selectionTime = appState?.value?.timestamp
      ? new Date(appState.value.timestamp)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const startTime =
      selectionTime > sevenDaysAgo ? selectionTime : sevenDaysAgo;

    // Query sensor data for this user only
    const historicalData = await sensorCollection
      .find({
        userId: userId,
        timestamp: { $gte: startTime.toISOString() },
      })
      .sort({ timestamp: 1 })
      .toArray();

    return NextResponse.json({
      historicalData,
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

// POST handler - for sensor data uploads and plant selection
export async function POST(request) {
  try {
    const client = await clientPromise;
    const db = client.db("planterbox");
    const sensorCollection = db.collection("sensordata");
    const appStateCollection = db.collection("app_state");

    const data = await request.json();
    console.log("Received POST data:", data);

    // Check if this is a web app request (requires auth)
    const isWebAppRequest =
      data.action === "select_plant" || data.action === "abort_plant";

    let userId = null;

    if (isWebAppRequest) {
      // Web app requests require authentication
      const session = await auth();
      if (!session || !session.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      userId = session.user.id;
    } else {
      // ESP32 requests include deviceId
      userId = data.deviceId || "default_device";
    }

    // Handle plant selection
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

    // Handle plant abort
    if (data.action === "abort_plant") {
      await appStateCollection.deleteOne({
        state_name: "plantSelection",
        userId: userId,
      });
      return NextResponse.json({ message: "Plant aborted successfully" });
    }

    // Handle sensor data upload from ESP32
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
      userId
    );

    // Return commands to ESP32
    return NextResponse.json(deviceCommands);
  } catch (error) {
    console.error("POST request error:", error);
    // Return safe defaults on error
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

    const userId = session.user.id;
    const client = await clientPromise;
    const db = client.db("planterbox");
    const sensorCollection = db.collection("sensordata");
    const appStateCollection = db.collection("app_state");
    const plantProfileCollection = db.collection("plant_profiles");

    const { searchParams } = new URL(request.url);

    // Handle historical data request
    if (searchParams.get("growth") === "true") {
      return getHistoricalData(appStateCollection, sensorCollection, userId);
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
