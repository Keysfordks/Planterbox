let sensorData = { temperature: null, humidity: null };

export async function POST(request) {
  const data = await request.json();
  console.log("ESP32 says:", data);
  
  // Store the received data in the variable
  sensorData = data;

  return new Response(JSON.stringify({ command: "relay_on" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

export async function GET() {
  // Respond to requests from the website with the latest data
  return new Response(JSON.stringify(sensorData), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
}