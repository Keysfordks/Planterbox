'use client';
import { useState, useEffect } from "react";
import "./globals.css";
// Added FaChartLine for the graph button
import { FaInfoCircle, FaExclamationTriangle, FaSync, FaChartLine } from 'react-icons/fa'; 

const sensorNames = {
  temperature: "Temperature (°C)",
  humidity: "Humidity (%)",
  ph: "pH Level",
  ppm: "PPM (Nutrients)",
  water_sufficient: "Water Level",
};

const plants = ["pothos", "mint", "monstera"];
const stages = ["seedling", "vegetative", "mature"];

// NEW COMPONENT: Graph Placeholder/Renderer
const GrowthGraph = ({ data }) => {
    if (!data || data.length === 0) {
        return (
            <div className="text-center p-10 text-gray-500 dark:text-gray-400">
                No historical data available yet. Keep monitoring!
            </div>
        );
    }
    
    // Calculate the duration for the display message
    const firstTimestamp = new Date(data[0].timestamp);
    const lastTimestamp = new Date(data[data.length - 1].timestamp);
    const daysOfData = Math.ceil((lastTimestamp - firstTimestamp) / (1000 * 60 * 60 * 24));
    
    return (
        <div className="p-4">
            <h3 className="text-xl font-bold mb-4 text-center text-gray-900 dark:text-white">
                Growth Trend ({daysOfData} Days)
            </h3>
            <div className="bg-gray-100 dark:bg-gray-700 h-64 flex flex-col items-center justify-center rounded-lg border-dashed border-2 border-gray-400 p-4">
                <p className="text-gray-500 font-semibold mb-2">
                    [Placeholder for Chart Library]
                </p>
                <ul className="text-sm text-gray-500 list-disc list-inside">
                    <li>This chart would display a multi-series line graph for pH, PPM, and Temp.</li>
                    <li>Data points: {data.length} records fetched.</li>
                    <li>Time Range: {firstTimestamp.toLocaleDateString()} to {lastTimestamp.toLocaleDateString()}</li>
                </ul>
            </div>
            <p className="text-center mt-4 text-xs text-gray-500 dark:text-gray-400">
                A charting library is required here to visualize the data.
            </p>
        </div>
    );
};

export default function Home() {
  const [selectedPlant, setSelectedPlant] = useState(null);
  const [selectedStage, setSelectedStage] = useState(null); 
  const [dropdownPlant, setDropdownPlant] = useState("pothos");
  const [dropdownStage, setDropdownStage] = useState("seedling"); 
  const [newStage, setNewStage] = useState("seedling"); 
  const [sensorData, setSensorData] = useState({});
  const [idealConditions, setIdealConditions] = useState({});
  const [sensorStatus, setSensorStatus] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isTooltipVisible, setIsTooltipVisible] = useState(false); 
  
  // *** NEW STATES FOR GRAPH ***
  const [showGraphModal, setShowGraphModal] = useState(false);
  const [historicalData, setHistoricalData] = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);
  // ***************************

  useEffect(() => {
    const savedPlant = localStorage.getItem('selectedPlant');
    const savedStage = localStorage.getItem('selectedStage'); 

    if (savedPlant) {
      setSelectedPlant(savedPlant);
      setDropdownPlant(savedPlant);
    }
    if (savedStage) {
      setSelectedStage(savedStage);
      setDropdownStage(savedStage);
      setNewStage(savedStage); 
    }
  }, []);

  useEffect(() => {
    if (!selectedPlant || !selectedStage) return; 

    const fetchIdealConditions = async () => {
      try {
        const response = await fetch(`/api/sensordata?plant=${selectedPlant}&stage=${selectedStage}`);
        const data = await response.json();
        setIdealConditions(data.ideal_conditions);
      } catch (error) {
        console.error("Failed to fetch ideal conditions:", error);
      }
    };

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
  }, [selectedPlant, selectedStage]); 

  // Combined function to handle initial selection and stage updates
  const handlePlantSelection = async (plantName, stageName) => { 
    try {
      const response = await fetch('/api/sensordata', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          action: "select_plant", 
          selectedPlant: plantName,
          selectedStage: stageName, 
        }),
      });
      if (response.ok) {
        setSelectedPlant(plantName);
        setSelectedStage(stageName); 
        setNewStage(stageName); 
        localStorage.setItem('selectedPlant', plantName);
        localStorage.setItem('selectedStage', stageName); 
      } else {
        console.error("Failed to save plant selection/stage update.");
      }
    } catch (error) {
      console.error("Failed to send plant selection/stage update:", error);
    }
  };
  
  const handleStageUpdate = () => {
      handlePlantSelection(selectedPlant, newStage);
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
        setSelectedStage(null); 
        localStorage.removeItem('selectedPlant');
        localStorage.removeItem('selectedStage'); 
        setSensorData({});
        setIdealConditions({});
        setDropdownPlant("pothos");
        setDropdownStage("seedling"); 
        setNewStage("seedling"); 
      } else {
        console.error("Failed to abort plant.");
      }
    } catch (error) {
      console.error("Request failed:", error);
    }
  };
  
  // *** NEW FUNCTION: Fetch historical data for graph ***
  const fetchHistoricalData = async () => {
      setGraphLoading(true);
      try {
          // New API call using the 'growth=true' query parameter
          const response = await fetch('/api/sensordata?growth=true'); 
          const data = await response.json();
          setHistoricalData(data.historicalData);
          setShowGraphModal(true);
      } catch (error) {
          console.error("Failed to fetch historical data:", error);
      } finally {
          setGraphLoading(false);
      }
  };
  
  // NEW COMPONENT: Modal structure
  const GrowthModal = () => (
      <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex justify-center items-center backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl p-6 relative">
              <button
                  onClick={() => setShowGraphModal(false)}
                  className="absolute top-4 right-4 text-gray-500 dark:text-gray-400 hover:text-red-500 text-3xl font-light leading-none"
              >
                  &times;
              </button>
              <GrowthGraph data={historicalData} />
          </div>
      </div>
  );
  // *************************************************

  if (!selectedPlant || !selectedStage) {
    return (
      <main className="min-h-screen bg-gray-100 dark:bg-gray-900 flex flex-col items-center justify-center p-6 space-y-8">
        <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Welcome to Your Smart Garden</h1>
          
          <p className="text-gray-700 dark:text-gray-300 text-lg">
            Please select the plant and its current growth stage to begin monitoring.
          </p>
        </div>
        
        {/* Plant and Stage Selection Form */}
        <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 text-center space-y-4">
          {/* Plant Dropdown */}
          <select 
            className="w-full p-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white"
            value={dropdownPlant}
            onChange={(e) => setDropdownPlant(e.target.value)}
          >
            {plants.map(plant => (
              <option key={plant} value={plant}>
                {plant.charAt(0).toUpperCase() + plant.slice(1)}
              </option>
            ))}
          </select>
          
          {/* Stage Dropdown and Info Icon Container */}
          <div className="flex items-center space-x-2 relative"> 
            <select 
              className="w-full p-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white"
              value={dropdownStage}
              onChange={(e) => setDropdownStage(e.target.value)}
            >
              {stages.map(stage => (
                <option key={stage} value={stage}>
                  {stage.charAt(0).toUpperCase() + stage.slice(1)} Stage
                </option>
              ))}
            </select>

            {/* Information Symbol with Tooltip Handlers */}
            <div 
              onMouseEnter={() => setIsTooltipVisible(true)}
              onMouseLeave={() => setIsTooltipVisible(false)}
              className="relative"
            >
              <a 
                href="https://www.saferbrand.com/articles/plant-growth-stages" 
                target="_blank" 
                rel="noopener noreferrer" 

                className="text-gray-500 dark:text-gray-400 hover:text-green-500 dark:hover:text-green-400 transition"
              >
                <FaInfoCircle className="h-6 w-6" />
              </a>

              {/* TOOLTIP POP-UP: POSITIONED TO THE RIGHT */}
              {isTooltipVisible && (
                <div 
                  className="absolute z-10 w-64 left-8 top-1/2 -translate-y-1/2 p-3 rounded-lg shadow-xl bg-gray-800 text-white text-sm border border-gray-700 pointer-events-none"
                >
                  Our kit groups plant growth into 3 broad stages. Consult the linked guide to determine which stage your specific plant is currently in.
                  {/* Triangle pointing LEFT */}
                  <div className="absolute left-[-6px] top-1/2 transform -translate-y-1/2 w-0 h-0 border-t-4 border-b-4 border-r-4 border-t-transparent border-b-transparent border-r-gray-800"></div>
                </div>
              )}
            </div>
          </div> 
          
          <button
            className="w-full px-8 py-4 rounded-full font-bold text-lg shadow-md bg-green-500 text-white hover:bg-green-600 transition"
            onClick={() => handlePlantSelection(dropdownPlant, dropdownStage)} 
          >
            Confirm Selection
          </button>
        </div>
        
        {/* NEW POSITION FOR THE SETUP NOTE (Bottom, own square, smaller) */}
        <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 text-center mt-4">
            <div className="bg-blue-100 dark:bg-blue-900 p-3 rounded-lg border border-blue-300 dark:border-blue-700">
                <p className="text-blue-800 dark:text-blue-200 text-sm font-semibold">
                    <span className="font-bold">Setup Note:</span> Please ensure the hydroponics tank is filled to the marked range with distilled water before starting. Add more water as required during operation.
                </p>
            </div>
        </div>
      </main>
    );
  }

  const headerText = `${selectedPlant.charAt(0).toUpperCase() + selectedPlant.slice(1)} - ${selectedStage.charAt(0).toUpperCase() + selectedStage.slice(1)} Stage Health Dashboard`;
  
  const { _id, timestamp, pump, light, tds, distance, ...sensors } = sensorData;
  const { light_pwm_cycle, ...idealRanges } = idealConditions || {}; 

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-6 flex flex-col items-center">
      
      {/* Main Dashboard Card */}
      <div className="w-full max-w-4xl bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-center mb-2">{headerText}</h1>
        <p className="text-center text-sm mb-6 text-gray-500 dark:text-gray-400">
          Last updated: {lastUpdated}
        </p>

        {/* Sensor Cards Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {Object.keys(sensors).map((key, index) => {
            const value = sensors[key];
            const status = sensorStatus[key] || "Loading...";
            
            let statusColor = status === "IDEAL" ? "text-green-500" : "text-red-500";
            let valueDisplay;
            if (key === "water_sufficient") {
              valueDisplay = value ? "IDEAL" : "TOO LOW";
              statusColor = value ? "text-green-500" : "text-red-500";
            } else if (key === "ppm" && status === "DILUTE_WATER") { // PPM overshoot specific styling
                valueDisplay = value !== null ? parseFloat(value).toFixed(2) : "Loading...";
                statusColor = "text-yellow-500"; 
            } else {
              valueDisplay = value !== null ? (typeof value === 'number' ? parseFloat(value).toFixed(2) : value) : "Loading...";
            }
            
            return (
              <div key={key} className="relative">
                <div className="bg-gray-50 dark:bg-gray-700 p-6 rounded-lg text-center shadow-sm h-full">
                  <div className="text-2xl font-semibold mb-2">
                    {sensorNames[key] || key}
                  </div>
                  
                  <div className={`text-4xl font-extrabold mb-1 ${statusColor}`}>
                    {valueDisplay}
                  </div>
                  
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Ideal: {
                        (key === 'temperature') ? `${idealRanges?.temp_min}°C – ${idealRanges?.temp_max}°C` :
                        (key === 'humidity') ? `${idealRanges?.humidity_min}% – ${idealRanges?.humidity_max}%` :
                        (key === 'ph') ? `${idealRanges?.ph_min} – ${idealRanges?.ph_max}` :
                        (key === 'ppm') ? `${idealRanges?.ppm_min} – ${idealRanges?.ppm_max}` :
                        (key === 'water_sufficient' ? 'Sufficient' : 'Range N/A')
                    }
                  </div>
                </div>

                {/* PPM DILUTION WARNING */}
                {key === "ppm" && status === "DILUTE_WATER" && (
                  <div className="absolute inset-x-0 bottom-[-50px] mt-2 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded-lg shadow-md flex items-center space-x-2">
                    <FaExclamationTriangle className="text-red-500 dark:text-red-400 h-5 w-5 flex-shrink-0" />
                    <p className="text-red-800 dark:text-red-200 text-sm font-bold">
                      PPM TOO HIGH: Manual dilution required. Please add distilled water to lower nutrient concentration.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        {/* Abort Button (Kept inside main card) */}
        <div className="mt-8 text-center">
          <button
            className="px-6 py-3 rounded-lg font-bold shadow-md bg-red-600 text-white hover:bg-red-700 transition"
            onClick={handleAbortPlant}
          >
            Abort Plant
          </button>
        </div>
      </div>

      {/* *** NEW SECTION: Separated Bottom Utility Bar (Growth & Stage Update) *** */}
      <div className="w-full max-w-4xl mt-6 flex justify-between"> 
        
        {/* NEW: View Growth Button Card (Bottom Left) */}
        <div className="max-w-xs mr-auto">
             <div className="p-4 rounded-lg shadow-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 h-full flex items-center">
                 <button
                    className="px-4 py-2 rounded-lg font-bold shadow-sm bg-green-500 text-white hover:bg-green-600 transition flex items-center text-sm disabled:bg-gray-400"
                    onClick={fetchHistoricalData}
                    disabled={graphLoading}
                >
                    <FaChartLine className="h-4 w-4 mr-2" />
                    {graphLoading ? 'Loading Growth...' : 'View Growth (7 Days)'}
                </button>
            </div>
        </div>
        
        {/* Stage Update Card (Bottom Right) */}
        <div className="max-w-xs ml-auto">
          <div className="p-4 rounded-lg shadow-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
             <p className="font-semibold text-sm mb-3 text-gray-700 dark:text-gray-300">
                Update Growth Stage:
            </p>
            <div className="flex space-x-2">
                <select 
                    className="flex-grow p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    value={newStage}
                    onChange={(e) => setNewStage(e.target.value)}
                >
                    {stages.map(stage => (
                        <option key={stage} value={stage}>
                            {stage.charAt(0).toUpperCase() + stage.slice(1)} Stage
                        </option>
                    ))}
                </select>
                <button
                    className="flex-shrink-0 px-3 py-2 rounded-lg font-bold shadow-sm bg-blue-500 text-white hover:bg-blue-600 transition flex items-center text-sm"
                    onClick={handleStageUpdate}
                >
                    <FaSync className="h-3 w-3 mr-1" />
                    Update
                </button>
            </div>
          </div>
        </div>
      </div>
      {/* *** END NEW SECTION *** */}
      
      {/* Graph Modal Render */}
      {showGraphModal && <GrowthModal />}
    </main>
  );
}