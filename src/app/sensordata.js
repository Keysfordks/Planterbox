
export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

  const data = req.body;
  console.log("ESP32 says:", data);

  // Example response back to ESP32
  return res.status(200).json({ command: "relay_on" });
}
