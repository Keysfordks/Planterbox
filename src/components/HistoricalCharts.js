'use client'; // This must be a Client Component for Charting

import React, { useState, useEffect } from 'react';
import { Tabs, Spin, Alert, Card, Typography } from 'antd';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale, // Crucial for time series data
} from 'chart.js';
import 'chartjs-adapter-date-fns'; // Adapter for TimeScale
import annotationPlugin from 'chartjs-plugin-annotation';

// Register Chart.js components and plugins
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  annotationPlugin
);

const { Title: AntdTitle } = Typography;

// --- 1. Main Data Fetching and Tab Component ---

/**
 * Component to fetch and display historical sensor data charts.
 * It replaces the logic previously in the GrowthModal/GrowthGraph.
 */
export default function HistoricalCharts({ show }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Only fetch if the modal/component is actually visible
    if (!show) return; 

    async function fetchHistoricalData() {
      setLoading(true);
      try {
        // Use the 'growth' query param to trigger the historical data handler in route.js
        const response = await fetch('/api/sensordata?growth=true'); 
        if (!response.ok) {
          throw new Error(`Failed to fetch historical data: ${response.statusText}`);
        }
        const result = await response.json();
        setData(result);
      } catch (e) {
        console.error("Historical data fetch error:", e);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    fetchHistoricalData();
  }, [show]); // Refetch when modal opens

  if (!show) return null;

  if (loading) {
    return (
      <Card style={{ height: 600 }}>
        <Spin size="large" tip="Loading historical data..." style={{ marginTop: 200 }}/>
      </Card>
    );
  }

  if (error) {
    return <Alert message="Data Load Error" description={error} type="error" showIcon />;
  }
  
  // Check if historical data array is empty
  if (!data || !data.historicalData || data.historicalData.length === 0) {
    return <Alert message="No Historical Data Found" description={`No sensor data available since plant selection (${data?.selectionStartTime ? new Date(data.selectionStartTime).toLocaleDateString() : 'N/A'}).`} type="info" showIcon />;
  }

  // Map and format data for Chart.js
  const chartData = data.historicalData.map(d => ({
    x: new Date(d.timestamp), // Convert MongoDB timestamp string to Date object
    ph: d.ph,
    ppm: d.ppm,
    temperature: d.temperature,
    humidity: d.humidity,
  }));

  const idealRanges = data.idealConditions;

  const tabItems = [
    { key: 'ph', label: 'pH', children: <SensorLineChart sensorKey="ph" data={chartData} idealRange={idealRanges.ph} unit="" color="rgb(75, 192, 192)" /> },
    { key: 'ppm', label: 'Nutrients (PPM)', children: <SensorLineChart sensorKey="ppm" data={chartData} idealRange={idealRanges.ppm} unit=" ppm" color="rgb(255, 99, 132)" /> },
    { key: 'temperature', label: 'Temperature', children: <SensorLineChart sensorKey="temperature" data={chartData} idealRange={idealRanges.temp} unit=" °C" color="rgb(53, 162, 235)" /> },
    { key: 'humidity', label: 'Humidity', children: <SensorLineChart sensorKey="humidity" data={chartData} idealRange={idealRanges.humidity} unit=" %" color="rgb(153, 102, 255)" /> },
  ];

  return (
    <div style={{ padding: '0 20px 20px 20px' }}>
      <AntdTitle level={3} style={{ textAlign: 'center', marginBottom: '20px' }}>
        Historical Sensor Data Since Start
      </AntdTitle>
      <Tabs defaultActiveKey="ph" items={tabItems} style={{ height: 500 }} />
    </div>
  );
}

// --- 2. Individual Chart Component ---

const SensorLineChart = ({ sensorKey, data, idealRange, unit, color }) => {
  // Map ideal conditions keys from page.js format (temp_min/max) to chart format (min/max)
  const range = {
    min: idealRange?.[`${sensorKey}_min`] || idealRange?.min || idealRange?.temp_min || 0,
    max: idealRange?.[`${sensorKey}_max`] || idealRange?.max || idealRange?.temp_max || 0,
  };

  // Check if idealRange is available and has min/max properties
  if (typeof range.min !== 'number' || typeof range.max !== 'number') {
    return <Alert message="Ideal Range Not Defined" description={`Ideal conditions for ${sensorKey.toUpperCase()} are not set for your current plant stage.`} type="info" showIcon />;
  }

  // Determine a visible Y-axis scale based on data and ideal range
  const allValues = data.map(d => d[sensorKey]).filter(v => v !== null && v !== undefined);
  
  if (allValues.length === 0) {
      return <Alert message="No Data Points" description="No sensor readings available for this metric." type="warning" showIcon />;
  }

  const minData = Math.min(...allValues, range.min);
  const maxData = Math.max(...allValues, range.max);
  const padding = (maxData - minData) * 0.1 || (range.max - range.min) * 0.2 || 1; // 10% padding

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'time', 
        time: {
          unit: 'day', // Can change to 'hour', 'week', 'month'
          tooltipFormat: 'MMM d, yyyy h:mm a'
        },
        title: {
          display: true,
          text: 'Time',
        },
      },
      y: {
        title: {
          display: true,
          text: `${sensorKey.toUpperCase()} Value (${unit.trim() || 'Unit'})`,
        },
        // Dynamically set Y-axis min/max
        min: minData - padding, 
        max: maxData + padding,
      },
    },
    plugins: {
      legend: { position: 'top' },
      title: {
        display: true,
        text: `${sensorKey.toUpperCase()} Over Time (${data.length} data points)`,
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            return ` ${context.dataset.label}: ${context.parsed.y.toFixed(2)}${unit}`;
          },
          title: (context) => {
             return new Date(context[0].parsed.x).toLocaleString(); 
          }
        }
      },
      // ANNOTATION PLUGIN: Visually highlights the ideal range
      annotation: {
        annotations: {
          idealRangeBox: {
            type: 'box',
            yMin: range.min, 
            yMax: range.max, 
            backgroundColor: 'rgba(75, 192, 192, 0.15)', // Light fill color
            borderColor: color,
            borderWidth: 1,
            label: {
              content: 'Ideal Range',
              enabled: true,
              position: 'end',
              color: '#444',
            }
          }
        }
      }
    },
  };

  const chartDataSet = {
    datasets: [
      {
        label: `${sensorKey.toUpperCase()} Average Reading`,
        data: data.map(d => ({ x: d.x, y: d[sensorKey] })),
        borderColor: color,
        backgroundColor: color,
        tension: 0.1, // Smooth lines
        pointRadius: 2,
      },
    ],
  };

  return <div style={{ height: '400px' }}><Line options={chartOptions} data={chartDataSet} /></div>;
};