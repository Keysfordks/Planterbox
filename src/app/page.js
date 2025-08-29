'use client';

import { useState, useEffect } from "react";

export default function Home() {
  const [temperature, setTemperature] = useState(null);
  const [humidity, setHumidity] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/sensordata');
        const data = await response.json();
        setTemperature(data.temperature);
        setHumidity(data.humidity);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (error) {
        console.error("Failed to fetch data:", error);
      }
    };

    // Fetch data initially and then every 3 seconds
    fetchData();
    const intervalId = setInterval(fetchData, 3000);

    // Clean up the interval when the component unmounts
    return () => clearInterval(intervalId);
  }, []);

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-sans">
      <main className="flex flex-col gap-8 row-start-2 items-center">
        <h1 className="text-4xl font-bold text-center sm:text-left">
          Planter Box Sensor Data
        </h1>
        <div className="flex flex-col gap-4 text-center sm:text-left">
          <div className="p-6 bg-gray-100 dark:bg-gray-800 rounded-lg shadow-md">
            <h2 className="text-2xl font-semibold mb-2">Temperature</h2>
            <p className="text-5xl font-extrabold text-blue-600 dark:text-blue-400">
              {temperature !== null ? `${temperature}°C` : 'Loading...'}
            </p>
          </div>
          <div className="p-6 bg-gray-100 dark:bg-gray-800 rounded-lg shadow-md">
            <h2 className="text-2xl font-semibold mb-2">Humidity</h2>
            <p className="text-5xl font-extrabold text-green-600 dark:text-green-400">
              {humidity !== null ? `${humidity}%` : 'Loading...'}
            </p>
          </div>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
          Last updated: {lastUpdated !== null ? lastUpdated : 'Never'}
        </p>
      </main>
    </div>
  );
}