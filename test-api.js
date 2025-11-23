// API Endpoint Test Script
// Run this with: node test-api.js
// Make sure your Next.js app is running first!

const http = require('http');

const API_HOST = '192.168.136.1';
const API_PORT = 3000;

function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (data) {
      const body = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

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

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function testAPI() {
  console.log('🧪 Testing PlanterBox API Endpoints...\n');
  console.log(`Host: ${API_HOST}:${API_PORT}\n`);

  try {
    // Test 1: GET /api/sensordata
    console.log('1️⃣  Testing GET /api/sensordata (Dashboard data)...');
    const getResponse = await makeRequest('GET', '/api/sensordata');
    
    if (getResponse.status === 200) {
      console.log('✅ GET request successful');
      console.log('   Response structure:');
      console.log(`   - sensorData: ${getResponse.data.sensorData ? 'Present' : 'null'}`);
      console.log(`   - sensorStatus: ${JSON.stringify(getResponse.data.sensorStatus)}`);
      console.log(`   - deviceCommands: ${JSON.stringify(getResponse.data.deviceCommands)}`);
      console.log(`   - currentSelection: ${JSON.stringify(getResponse.data.currentSelection)}\n`);
    } else {
      console.log(`❌ GET request failed with status ${getResponse.status}\n`);
    }

    // Test 2: POST /api/sensordata (Simulate ESP32)
    console.log('2️⃣  Testing POST /api/sensordata (ESP32 simulation)...');
    
    const testSensorData = {
      temperature: 25.5,
      humidity: 65.0,
      ph: 6.2,
      ppm: 750,
      distance: 27.3,
      water_detected: true,
      deviceId: 'test_device'
    };
    
    console.log('   Sending sensor data:', JSON.stringify(testSensorData, null, 2));
    
    const postResponse = await makeRequest('POST', '/api/sensordata', testSensorData);
    
    if (postResponse.status === 200) {
      console.log('✅ POST request successful');
      console.log('   Device commands received:');
      console.log(`   - Light: ${postResponse.data.light}`);
      console.log(`   - Light hours/day: ${postResponse.data.light_hours_per_day}`);
      console.log(`   - pH up pump: ${postResponse.data.ph_up_pump}`);
      console.log(`   - pH down pump: ${postResponse.data.ph_down_pump}`);
      console.log(`   - PPM A pump: ${postResponse.data.ppm_a_pump}`);
      console.log(`   - PPM B pump: ${postResponse.data.ppm_b_pump}\n`);
      
      if (postResponse.data.light === 0 && !postResponse.data.ph_up_pump) {
        console.log('⚠️  All commands are false/0. This is normal if:');
        console.log('   1. No plant is selected, OR');
        console.log('   2. No plant profiles exist, OR');
        console.log('   3. All sensor values are within ideal range\n');
      }
    } else {
      console.log(`❌ POST request failed with status ${postResponse.status}\n`);
    }

    // Test 3: GET with plant/stage query
    console.log('3️⃣  Testing GET /api/sensordata?plant=lettuce&stage=seedling...');
    const profileResponse = await makeRequest('GET', '/api/sensordata?plant=lettuce&stage=seedling');
    
    if (profileResponse.status === 200) {
      console.log('✅ Profile query successful');
      if (profileResponse.data.ideal_conditions) {
        console.log('   Ideal conditions found:');
        const ideal = profileResponse.data.ideal_conditions;
        console.log(`   - Temperature: ${ideal.temp_min}°C - ${ideal.temp_max}°C`);
        console.log(`   - Humidity: ${ideal.humidity_min}% - ${ideal.humidity_max}%`);
        console.log(`   - pH: ${ideal.ph_min} - ${ideal.ph_max}`);
        console.log(`   - PPM: ${ideal.ppm_min} - ${ideal.ppm_max}`);
        console.log(`   - Light intensity: ${ideal.light_intensity}`);
        console.log(`   - Light hours/day: ${ideal.light_hours_per_day}\n`);
      } else {
        console.log('⚠️  No profile found for lettuce/seedling');
        console.log('   Add plant profiles to MongoDB (see testing guide)\n');
      }
    } else {
      console.log(`❌ Profile query failed with status ${profileResponse.status}\n`);
    }

    // Test 4: GET historical data
    console.log('4️⃣  Testing GET /api/sensordata?growth=true...');
    const historyResponse = await makeRequest('GET', '/api/sensordata?growth=true');
    
    if (historyResponse.status === 200) {
      console.log('✅ Historical data query successful');
      console.log(`   Data points: ${historyResponse.data.historicalData?.length || 0}`);
      console.log(`   Ideal conditions: ${historyResponse.data.idealConditions ? 'Present' : 'null'}`);
      console.log(`   Selection start time: ${historyResponse.data.selectionStartTime || 'Not set'}\n`);
    } else {
      console.log(`❌ Historical query failed with status ${historyResponse.status}\n`);
    }

    console.log('🎉 All API tests completed!\n');
    
    // Summary
    console.log('📋 Summary:');
    console.log('   - If all tests passed: Your API is working correctly ✅');
    console.log('   - If POST returns all false/0: Add plant profiles and select a plant ⚠️');
    console.log('   - If connection errors: Check that Next.js is running ❌\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\nPossible issues:');
    console.error('1. Next.js app is not running (run: npm run dev)');
    console.error('2. Wrong host/port configuration');
    console.error('3. Firewall blocking port 3000\n');
    process.exit(1);
  }
}

testAPI();