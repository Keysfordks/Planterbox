'use client';
import { useState, useEffect } from "react";
import "./globals.css";

const sensorNames = {
  temperature: "Temperature (°C)",
  humidity: "Humidity (%)",
  ph: "pH Level",
  ppm: "PPM (Nutrients)",
};

const plants = ["pothos", "mint", "monstera"];

export default function Home() {
  const [selectedPlant, setSelectedPlant] = useState(null);
  const [dropdownPlant, setDropdownPlant] = useState("pothos");
  const [sensorData, setSensorData] = useState({});
  const [idealConditions, setIdealConditions] = useState({});
  const [sensorStatus, setSensorStatus] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const savedPlant = localStorage.getItem('selectedPlant');
    if (savedPlant) {
      setSelectedPlant(savedPlant);
      setDropdownPlant(savedPlant);
    }
  }, []);

  useEffect(() => {
    if (!selectedPlant) return;

    // Fetch the plant's ideal conditions once
    const fetchIdealConditions = async () => {
      try {
        const response = await fetch(`/api/sensordata?plant=${selectedPlant}`);
        const data = await response.json();
        setIdealConditions(data.ideal_conditions);
      } catch (error) {
        console.error("Failed to fetch ideal conditions:", error);
      }
    };

    // Fetch the real-time sensor data and status
    const fetchData = async () => {
      try {
        const response = await fetch('/api/sensordata');
        const data = await response.json();
        setSensorData(data.sensorData);
        setSensorStatus(data.sensorStatus);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (error) {
        console.error("Failed to fetch sensor data:", error);
      }
    };

    fetchIdealConditions();
    fetchData();
    const intervalId = setInterval(() => {
        fetchData();
    }, 3000);
    return () => clearInterval(intervalId);
  }, [selectedPlant]);

  const handlePlantSelection = async (plantName) => {
    try {
      // Send the plant selection to the backend
      const response = await fetch('/api/sensordata', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "select_plant", selectedPlant: plantName }),
      });
      if (response.ok) {
        setSelectedPlant(plantName);
        localStorage.setItem('selectedPlant', plantName);
      } else {
        console.error("Failed to save plant selection.");
      }
    } catch (error) {
      console.error("Failed to send plant selection:", error);
    }
  };

  const handleAbortPlant = async () => {
    try {
      const response = await fetch('/api/sensordata', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: "abort_plant" }),
      });

      if (response.ok) {
        console.log("Sensor data successfully deleted.");
        setSelectedPlant(null);
        localStorage.removeItem('selectedPlant');
        setSensorData({});
        setIdealConditions({});
        setDropdownPlant("pothos");
      } else {
        console.error("Failed to abort plant.");
      }
    } catch (error) {
      console.error("Request failed:", error);
    }
  };

  const sendCommand = async (updates) => {
    try {
      await fetch('/api/sensordata', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    } catch (error) {
      console.error("Failed to send command:", error);
    }
  };

  // Conditional Rendering: Show Welcome Page or Dashboard
  if (!selectedPlant) {
    return (
      <main className="min-h-screen bg-gray-100 dark:bg-gray-900 flex flex-col items-center justify-center p-6 space-y-8">
        {/* Welcome Box */}
        <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Welcome to Your Smart Garden</h1>
          <p className="text-gray-700 dark:text-gray-300 text-lg">
            Please select the plant you are growing to begin monitoring its health.
          </p>
        </div>
        
        {/* Dropdown/Search Menu */}
        <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 text-center">
          <select 
            className="w-full p-3 mb-4 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white"
            value={dropdownPlant}
            onChange={(e) => setDropdownPlant(e.target.value)}
          >
            {plants.map(plant => (
              <option key={plant} value={plant}>
                {plant.charAt(0).toUpperCase() + plant.slice(1)}
              </option>
            ))}
          </select>
          <button
            className="w-full px-8 py-4 rounded-full font-bold text-lg shadow-md bg-green-500 text-white hover:bg-green-600 transition"
            onClick={() => handlePlantSelection(dropdownPlant)}
          >
            Confirm Plant
          </button>
        </div>
      </main>
    );
  }

  // Dashboard View
  const { _id, timestamp, pump, light, tds, distance, ...sensors } = sensorData;
  const { light_pwm_cycle, ...idealRanges } = idealConditions || {};

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-6 flex flex-col items-center">
      <div className="w-full max-w-4xl bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-center mb-2">{selectedPlant.charAt(0).toUpperCase() + selectedPlant.slice(1)} Health Dashboard</h1>
        <p className="text-center text-sm mb-6 text-gray-500 dark:text-gray-400">
          Last updated: {lastUpdated}
        </p>

        {/* Sensor Status Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {Object.keys(sensors).map(key => {
            const value = sensors[key];
            const idealRange = idealRanges?.[key];
            const status = sensorStatus[key] || "Loading...";
            const statusColor = status === "IDEAL" ? "text-green-500" : "text-red-500";
            const valueDisplay = value !== null ? (typeof value === 'number' ? parseFloat(value).toFixed(2) : value) : "Loading...";

            return (
              <div key={key} className="bg-gray-50 dark:bg-gray-700 p-6 rounded-lg text-center shadow-sm">
                <div className="text-2xl font-semibold mb-2">{sensorNames[key] || key}</div>
                <div className={`text-4xl font-extrabold mb-1 ${statusColor}`}>
                  {valueDisplay}
                </div>
                {idealRange && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Ideal: {idealRange.min || idealRange.ph_min}-{idealRange.max || idealRange.ph_max}
                  </div>
                )}
                <div className={`mt-2 font-bold ${statusColor}`}>
                  {status}
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Abort Button */}
        <div className="mt-8 text-center">
          <button
            className="px-6 py-3 rounded-lg font-bold shadow-md bg-red-600 text-white hover:bg-red-700 transition"
            onClick={handleAbortPlant}
          >
            Abort Plant
          </button>
        </div>
      </div>
    </main>
  );
}