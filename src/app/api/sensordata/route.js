export async function POST(request) {
  const data = await request.json();
  console.log("ESP32 says:", data);

  return new Response(JSON.stringify({ command: "relay_on" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
