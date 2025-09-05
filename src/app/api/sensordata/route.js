let sensorData = { temperature: null, humidity: null, distance: null, ppm: null };
let deviceCommands = { pump: false, light: false };

export async function POST(request) {
  const data = await request.json();
  console.log("ESP32 says:", data);

  // If this came from the ESP32 (contains sensor values)
  if (data.temperature !== undefined || data.humidity !== undefined) {
    sensorData = data;
    return new Response(JSON.stringify(deviceCommands), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Otherwise it came from the website (command update)
  if (data.pump !== undefined) deviceCommands.pump = data.pump;
  if (data.light !== undefined) deviceCommands.light = data.light;

  return new Response(JSON.stringify({ status: "ok", deviceCommands }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function GET() {
  return new Response(JSON.stringify({ ...sensorData, ...deviceCommands }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
