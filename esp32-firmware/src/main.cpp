#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <Adafruit_Sensor.h>
#include <ArduinoJson.h>

const char* ssid = "SockMnky";
const char* password = "04072024";

const char* serverName = "http://192.168.1.203:3000/api/sensordata"; // Your PC's IP

#define DHTPIN 4
#define DHTTYPE DHT11

#define TRIG_PIN 5
#define ECHO_PIN 18

#define PPM_SENSOR_PIN 34

#define PH_SENSOR_PIN 33

#define WATER_SENSOR_PIN 35 
const int WATER_THRESHOLD = 600;

#define LIGHT_PIN 26

#define PH_UP_PUMP_PIN 19
#define PH_DOWN_PUMP_PIN 21
#define PPM_A_PUMP_PIN 22
#define PPM_B_PUMP_PIN 23

const int ledChannel = 0;
const int ledFreq = 5000;
const int ledResolution = 8;

enum PpmDosingState {
  PPM_IDLE,
  PPM_DOSING_A,
  PPM_DELAYING,
  PPM_DOSING_B,
};

enum PhDosingState {
  PH_IDLE,
  PH_DOSING_UP,
  PH_DOSING_DOWN,
};

PpmDosingState ppmState = PPM_IDLE;
PhDosingState phState = PH_IDLE;
unsigned long ppmStateChangeTime = 0;
unsigned long phStateChangeTime = 0;

// *** UPDATED: Pump run time is now 2 seconds (2000 ms) ***
const unsigned long dosingDuration = 2000; // 2 seconds for each pump
const unsigned long delayDuration = 2000; // 2-second delay between pumps

DHT dht(DHTPIN, DHTTYPE);
StaticJsonDocument<200> sensorData;
float currentTempC = 25.0;

void readDHT() {
  float humidity = dht.readHumidity();
  float tempC = dht.readTemperature();
  if (isnan(humidity)) {
    Serial.println("Failed to read humidity from DHT sensor!");
    humidity = 0.0;
  }
  if (isnan(tempC)) {
    Serial.println("Failed to read temperature from DHT sensor!");
    tempC = 0.0;
  }
  sensorData["temperature"] = tempC;
  sensorData["humidity"] = humidity;
  currentTempC = tempC;
}

void readUltrasonic() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH);
  float distanceCm = duration * 0.034 / 2;
  if (distanceCm > 0) {
    sensorData["distance"] = distanceCm;
  } else {
    sensorData["distance"] = 0.0;
  }
}

void readPpmSensor() {
  long sumAnalogValue = 0;
  for (int i = 0; i < 10; i++) {
    sumAnalogValue += analogRead(PPM_SENSOR_PIN);
    delay(10);
  }
  float avgAnalogValue = (float)sumAnalogValue / 10.0;
  float voltage = avgAnalogValue * 3.3 / 4096.0;
  float ppmValue = 640 * voltage;
  if (currentTempC > 0.0) {
    float compensationCoefficient = 1.0 + 0.02 * (currentTempC - 25.0);
    ppmValue = ppmValue / compensationCoefficient;
  }
  sensorData["ppm"] = ppmValue;
}

void readPhSensor() {
  long sumAnalog = 0;
  const int numSamples = 30; // Increased samples for better stability
  for (int i = 0; i < numSamples; i++) {
    sumAnalog += analogRead(PH_SENSOR_PIN);
    delay(10);
  }
  float avgAnalog = sumAnalog / (float)numSamples;
  // Convert analog reading to voltage (3.3V reference)
  // Voltage at PH_SENSOR_PIN = avgAnalog * (3.3 / 4096.0)
  float voltage = avgAnalog * 3.3 / 4096.0;

  // --- pH Calculation using a standard approximation for these modules ---
  // The sensor module typically outputs ~2.5V at pH 7.0.
  // A common, simplified formula is: pH = Offset - Slope * Voltage
  
  // You might need to adjust these based on calibration for true accuracy
  // but these are better starting values than 0.18 and the old offset.
  const float PH_SLOPE = 3.57; 
  const float PH_OFFSET = 21.34;

  float phValue = PH_OFFSET - (PH_SLOPE * voltage);

  // Apply bounds
  if (phValue < 0) phValue = 0;
  if (phValue > 14) phValue = 14;
  
  // Debug output
  Serial.print("Raw pH Analog: ");
  Serial.print(avgAnalog);
  Serial.print(" | Voltage: ");
  Serial.print(voltage, 3);
  Serial.print("V | Measured pH: ");
  Serial.println(phValue, 2);

  sensorData["ph"] = phValue;
}

void readWaterSensor() {
  int waterAnalogValue = analogRead(WATER_SENSOR_PIN);
  bool isWaterSufficient = waterAnalogValue > WATER_THRESHOLD; 
  sensorData["water_sufficient"] = isWaterSufficient;
  Serial.print("Raw water sensor analog value: ");
  Serial.println(waterAnalogValue); 
  Serial.print("Water Sufficient: ");
  Serial.println(isWaterSufficient ? "Yes" : "No");
}

void controlGrowLight(int brightness) {
  if (brightness < 0) brightness = 0;
  if (brightness > 255) brightness = 255;
  ledcWrite(ledChannel, brightness);
  Serial.print("Grow Light Brightness: ");
  Serial.println(brightness);
}

void stopAllPumps() {
  digitalWrite(PH_UP_PUMP_PIN, LOW);
  digitalWrite(PH_DOWN_PUMP_PIN, LOW);
  digitalWrite(PPM_A_PUMP_PIN, LOW);
  digitalWrite(PPM_B_PUMP_PIN, LOW);
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected to WiFi!");
  
  dht.begin();
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(PPM_SENSOR_PIN, INPUT);
  pinMode(PH_SENSOR_PIN, INPUT);
  pinMode(WATER_SENSOR_PIN, INPUT);
  pinMode(PH_UP_PUMP_PIN, OUTPUT);
  pinMode(PH_DOWN_PUMP_PIN, OUTPUT);
  pinMode(PPM_A_PUMP_PIN, OUTPUT);
  pinMode(PPM_B_PUMP_PIN, OUTPUT);
  
  stopAllPumps();

  ledcSetup(ledChannel, ledFreq, ledResolution);
  ledcAttachPin(LIGHT_PIN, ledChannel);
  randomSeed(analogRead(0));
}

void loop() {
  switch (ppmState) {
    case PPM_IDLE:
      break;
    case PPM_DOSING_A:
      if (millis() - ppmStateChangeTime >= dosingDuration) {
        Serial.println("PPM A pump finished. Starting delay...");
        digitalWrite(PPM_A_PUMP_PIN, LOW);
        ppmState = PPM_DELAYING;
        ppmStateChangeTime = millis();
      }
      break;
    case PPM_DELAYING:
      if (millis() - ppmStateChangeTime >= delayDuration) {
        Serial.println("Delay finished. Starting PPM B pump...");
        ppmState = PPM_DOSING_B;
        ppmStateChangeTime = millis();
        digitalWrite(PPM_B_PUMP_PIN, HIGH);
      }
      break;
    case PPM_DOSING_B:
      if (millis() - ppmStateChangeTime >= dosingDuration) {
        Serial.println("PPM B pump finished. Returning to idle.");
        digitalWrite(PPM_B_PUMP_PIN, LOW);
        ppmState = PPM_IDLE;
      }
      break;
  }
  
  switch (phState) {
    case PH_IDLE:
      break;
    case PH_DOSING_UP:
      if (millis() - phStateChangeTime >= dosingDuration) {
        Serial.println("pH Up pump finished. Returning to idle.");
        digitalWrite(PH_UP_PUMP_PIN, LOW);
        phState = PH_IDLE;
      }
      break;
    case PH_DOSING_DOWN:
      if (millis() - phStateChangeTime >= dosingDuration) {
        Serial.println("pH Down pump finished. Returning to idle.");
        digitalWrite(PH_DOWN_PUMP_PIN, LOW);
        phState = PH_IDLE;
      }
      break;
  }

  if (WiFi.status() == WL_CONNECTED) {
    sensorData.clear();
    readDHT();
    readUltrasonic();
    readPpmSensor();
    readPhSensor();
    readWaterSensor();
    HTTPClient http;
    http.begin(serverName);
    http.addHeader("Content-Type", "application/json");
    String payload;
    serializeJson(sensorData, payload);
    Serial.println("Sending payload: " + payload);
    int httpResponseCode = http.POST(payload);

    if (httpResponseCode > 0) {
      String response = http.getString();
      Serial.println("Server response:");
      Serial.println(response);
      StaticJsonDocument<200> doc;
      DeserializationError error = deserializeJson(doc, response);
      if (!error) {
        int lightBrightness = doc["light"] | 0;
        bool ph_up_pump_cmd = doc["ph_up_pump"] | false;
        bool ph_down_pump_cmd = doc["ph_down_pump"] | false;
        bool ppm_a_pump_cmd = doc["ppm_a_pump"] | false;
        bool ppm_b_pump_cmd = doc["ppm_b_pump"] | false;
        controlGrowLight(lightBrightness);
        
        // PH Pump Control: Only act if currently IDLE
        if (ph_up_pump_cmd && phState == PH_IDLE) {
          phState = PH_DOSING_UP;
          phStateChangeTime = millis();
          digitalWrite(PH_UP_PUMP_PIN, HIGH);
        } else if (ph_down_pump_cmd && phState == PH_IDLE) {
          phState = PH_DOSING_DOWN;
          phStateChangeTime = millis();
          digitalWrite(PH_DOWN_PUMP_PIN, HIGH);
        } else if (phState == PH_IDLE) {
          // If server didn't send a command AND we are IDLE, ensure pumps are off
          digitalWrite(PH_UP_PUMP_PIN, LOW);
          digitalWrite(PH_DOWN_PUMP_PIN, LOW);
        }

        // PPM Pump Control: Only act if currently IDLE
        if (ppm_a_pump_cmd && ppm_b_pump_cmd && ppmState == PPM_IDLE) {
          // Server sends both true to initiate the A-delay-B sequence
          ppmState = PPM_DOSING_A;
          ppmStateChangeTime = millis();
          digitalWrite(PPM_A_PUMP_PIN, HIGH);
        } else if (ppmState == PPM_IDLE) {
          // If server didn't send a command AND we are IDLE, ensure pumps are off
          digitalWrite(PPM_A_PUMP_PIN, LOW);
          digitalWrite(PPM_B_PUMP_PIN, LOW);
        }
      } else {
        Serial.print(F("deserializeJson() failed: "));
        Serial.println(error.f_str());
      }
    } else {
      Serial.print("POST failed. Code: ");
      Serial.println(httpResponseCode);
    }
    http.end();
  } else {
    Serial.println("WiFi Disconnected");
  }

  // The 5-second delay is adequate for frequent sensor reads
  delay(5000); 
}