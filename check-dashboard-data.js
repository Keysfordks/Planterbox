// Dashboard Data Diagnostic Script
// Run this to see what data your dashboard is getting
// Usage: node check-dashboard-data.js

const http = require('http');

const API_HOST = '192.168.86.22';  // Change if different
const API_PORT = 3000;

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: path,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

async function checkDashboardData() {
  console.log('🔍 Checking Dashboard Data...\n');
  console.log(`Connecting to: ${API_HOST}:${API_PORT}\n`);

  try {
    // Get the main dashboard data
    console.log('1️⃣  Fetching dashboard data from /api/sensordata...\n');
    const response = await makeRequest('/api/sensordata');

    if (response.status !== 200) {
      console.log(`Error: Received status ${response.status}`);
      return;
    }

    const data = response.data;

    console.log('✅ Successfully fetched data!\n');
    console.log('📊 Full Response Structure:');
    console.log('================================');
    console.log(JSON.stringify(data, null, 2));
    console.log('================================\n');

    // Analyze the structure
    console.log('🔍 Analyzing Structure:\n');

    // Check sensorData
    if (data.sensorData) {
      console.log('✅ sensorData exists:');
      console.log('   Keys:', Object.keys(data.sensorData));
      console.log('   Sample values:');
      Object.keys(data.sensorData).forEach(key => {
        if (!['_id', '__v', 'userId', 'deviceId'].includes(key)) {
          console.log(`   - ${key}: ${data.sensorData[key]}`);
        }
      });
      console.log();

      // This is what the dashboard extracts
      const { _id, timestamp, pump, light, tds, distance, ...sensors } = data.sensorData || {};
      console.log('📦 What dashboard extracts as "sensors":');
      console.log('   Keys:', Object.keys(sensors));
      console.log('   Values:', sensors);
      console.log();

      if (Object.keys(sensors).length === 0) {
        console.log('⚠️  WARNING: After destructuring, "sensors" object is EMPTY!');
        console.log('   This is why your grid isn\'t showing data.\n');
        console.log('   The dashboard is filtering out:', ['_id', 'timestamp', 'pump', 'light', 'tds', 'distance']);
        console.log('   But your actual sensor keys are:', Object.keys(data.sensorData));
        console.log();
      }
    } else {
      console.log('❌ sensorData is null or missing!');
      console.log('   This means no sensor readings have been received yet.\n');
    }

    // Check sensorStatus
    if (data.sensorStatus) {
      console.log('✅ sensorStatus exists:');
      console.log('   ', data.sensorStatus);
      console.log();
    } else {
      console.log('⚠️  sensorStatus is missing\n');
    }

    // Check idealConditions
    if (data.idealConditions) {
      console.log('✅ idealConditions exists:');
      console.log('   Temp: ', data.idealConditions.temp_min, '-', data.idealConditions.temp_max);
      console.log('   Humidity: ', data.idealConditions.humidity_min, '-', data.idealConditions.humidity_max);
      console.log('   pH: ', data.idealConditions.ph_min, '-', data.idealConditions.ph_max);
      console.log('   PPM: ', data.idealConditions.ppm_min, '-', data.idealConditions.ppm_max);
      console.log();
    } else {
      console.log('⚠️  idealConditions is missing');
      console.log('   Make sure you have plant profiles in MongoDB\n');
    }

    // Check currentSelection
    if (data.currentSelection) {
      console.log('✅ currentSelection exists:');
      console.log('   Plant:', data.currentSelection.plant);
      console.log('   Stage:', data.currentSelection.stage);
      console.log('   Device:', data.currentSelection.deviceId);
      console.log();
    } else {
      console.log('⚠️  currentSelection is missing\n');
    }

    // Check idealForUI
    if (data.idealForUI) {
      console.log('✅ idealForUI exists (UI-friendly format):');
      console.log('   ', JSON.stringify(data.idealForUI, null, 2));
      console.log();
    }

    // Summary
    console.log('\n📋 DIAGNOSIS SUMMARY:');
    console.log('==========================================');
    
    if (!data.sensorData) {
      console.log('❌ NO SENSOR DATA');
      console.log('   Cause: ESP32 hasn\'t sent any readings yet');
      console.log('   Solution: Check ESP32 Serial Monitor for POST success\n');
    } else {
      const { _id, timestamp, pump, light, tds, distance, ...sensors } = data.sensorData;
      if (Object.keys(sensors).length === 0) {
        console.log('❌ SENSOR DATA EXISTS BUT GRID IS EMPTY');
        console.log('   Cause: Dashboard destructuring is removing all sensor keys');
        console.log('   Your sensor keys:', Object.keys(data.sensorData));
        console.log('   Dashboard expects keys like: temperature, humidity, ph, ppm, water_detected');
        console.log('   Solution: Check if sensor data keys match expected format\n');
      } else {
        console.log('✅ SENSOR DATA SHOULD BE VISIBLE');
        console.log('   Sensor keys found:', Object.keys(sensors));
        console.log('   If not showing in UI, check browser console for errors\n');
      }
    }

    if (!data.idealConditions && !data.idealForUI) {
      console.log('⚠️  NO IDEAL CONDITIONS');
      console.log('   Cause: No plant selected or no profiles in MongoDB');
      console.log('   Solution: Add plant profiles and select a plant\n');
    }

    console.log('==========================================\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\nPossible issues:');
    console.error('1. Next.js app is not running');
    console.error('2. Wrong host/port in this script');
    console.error('3. Firewall blocking connection\n');
  }
}

checkDashboardData();