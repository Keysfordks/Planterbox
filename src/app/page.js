'use client';
import { useState, useEffect } from "react";

export default function Home() {
  const [temperature, setTemperature] = useState(null);
  const [humidity, setHumidity] = useState(null);
  const [tds, setTds] = useState(null);
  const [ph, setPh] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [pump, setPump] = useState(false);
  const [light, setLight] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/sensordata');
        const data = await response.json();
        setTemperature(data.temperature);
        setHumidity(data.humidity);
        setTds(data.tds);
        setPh(data.ph);
        setPump(data.pump);
        setLight(data.light);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (error) {
        console.error("Failed to fetch data:", error);
      }
    };

    fetchData();
    const intervalId = setInterval(fetchData, 3000);
    return () => clearInterval(intervalId);
  }, []);

  const sendCommand = async (updates) => {
    try {
      await fetch('/api/sensordata', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
    } catch (err) {
      console.error("Command failed:", err);
    }
  };

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-sans">
      <main className="flex flex-col gap-8 row-start-2 items-center w-full max-w-6xl">
        <h1 className="text-4xl font-bold text-center sm:text-left w-full">
          Planter Box Sensor Data
        </h1>

        {/* Two-column layout: sensor data (left), controls (right) */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-8 w-full">
          {/* Left: Sensor Data Cards */}
          <div className="flex flex-col gap-4 text-center sm:text-left">
            <div className="p-6 bg-gray-100 dark:bg-gray-800 rounded-lg shadow-md">
              <h2 className="text-2xl font-semibold mb-2">Temperature</h2>
              <p className="text-5xl font-extrabold text-blue-600 dark:text-blue-400">
                {temperature !== null ? `${parseFloat(temperature).toFixed(2)}°C` : 'Loading...'}
              </p>
            </div>
            <div className="p-6 bg-gray-100 dark:bg-gray-800 rounded-lg shadow-md">
              <h2 className="text-2xl font-semibold mb-2">Humidity</h2>
              <p className="text-5xl font-extrabold text-green-600 dark:text-green-400">
                {humidity !== null ? `${parseFloat(humidity).toFixed(2)}%` : 'Loading...'}
              </p>
            </div>
            <div className="p-6 bg-gray-100 dark:bg-gray-800 rounded-lg shadow-md">
              <h2 className="text-2xl font-semibold mb-2">PPM</h2>
              <p className="text-5xl font-extrabold text-purple-600 dark:text-purple-400">
                {tds !== null ? `${parseFloat(tds).toFixed(2)}` : 'Loading...'}
              </p>
            </div>
            <div className="p-6 bg-gray-100 dark:bg-gray-800 rounded-lg shadow-md">
              <h2 className="text-2xl font-semibold mb-2">pH Level</h2>
              <p className="text-5xl font-extrabold text-red-600 dark:text-red-400">
                {ph !== null ? `${parseFloat(ph).toFixed(2)}` : 'Loading...'}
              </p>
            </div>
          </div>

          {/* Right: Pump + Light Controls */}
          <div className="flex flex-col items-start justify-start gap-6">
            <button
              className={`px-6 py-3 rounded-lg font-bold shadow-md w-full ${pump ? "bg-green-600 text-white" : "bg-gray-300 text-black"}`}
              onClick={() => {
                const newState = !pump;
                setPump(newState);
                sendCommand({ pump: newState });
              }}
            >
              {pump ? "Pump ON" : "Pump OFF"}
            </button>
            <button
              className={`px-6 py-3 rounded-lg font-bold shadow-md w-full ${light ? "bg-yellow-500 text-black" : "bg-gray-300 text-black"}`}
              onClick={() => {
                const newState = !light;
                setLight(newState);
                sendCommand({ light: newState });
              }}
            >
              {light ? "Light ON" : "Light OFF"}
            </button>
          </div>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
          Last updated: {lastUpdated !== null ? lastUpdated : 'Never'}
        </p>
      </main>
    </div>
  );
}
