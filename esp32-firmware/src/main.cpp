#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <Adafruit_Sensor.h>
#include <ArduinoJson.h>
#include <cstdlib>

const char* ssid = getenv(SSID);
const char* password = getenv(PASSWORD);

const char* serverName = "http://192.168.1.83:3000/api/sensordata"; // Your PC's IP

// Define pin for the DHT11
#define DHTPIN 4
#define DHTTYPE DHT11

// Define pins for the HC-SR04
#define TRIG_PIN 5
#define ECHO_PIN 18

// Define pin for the TDS sensor (now named PPM)
#define PPM_SENSOR_PIN 34

// Define pin for the pH sensor
#define PH_SENSOR_PIN 33

// Define the grow light control pin
#define LIGHT_PIN 26

// Define the pump motor control pins
#define PH_UP_PUMP_PIN 19
#define PH_DOWN_PUMP_PIN 21
#define PPM_A_PUMP_PIN 22
#define PPM_B_PUMP_PIN 23

// PWM settings for the grow light
const int ledChannel = 0;
const int ledFreq = 5000;
const int ledResolution = 8;

// State machine for PPM dosing
enum PpmDosingState {
  PPM_IDLE,
  PPM_DOSING_A,
  PPM_DELAYING,
  PPM_DOSING_B,
};

// State machine for pH dosing
enum PhDosingState {
  PH_IDLE,
  PH_DOSING_UP,
  PH_DOSING_DOWN,
};

// Global variables for the state machines
PpmDosingState ppmState = PPM_IDLE;
PhDosingState phState = PH_IDLE;
unsigned long ppmStateChangeTime = 0;
unsigned long phStateChangeTime = 0;

const unsigned long dosingDuration = 5000; // 5 seconds for each pump
const unsigned long delayDuration = 2000;  // 2-second delay between pumps

DHT dht(DHTPIN, DHTTYPE);
StaticJsonDocument<200> sensorData;
// Global variable to store temperature for PPM compensation
float currentTempC = 25.0;

// Function to read DHT sensor data
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

// Function to read HC-SR04 data
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

// Function to read PPM sensor data (formerly TDS)
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

// Function to read pH sensor data
void readPhSensor() {
  long sumAnalog = 0;
  const int numSamples = 10;
  for (int i = 0; i < numSamples; i++) {
    sumAnalog += analogRead(PH_SENSOR_PIN);
    delay(5);
  }
  float avgAnalog = sumAnalog / (float)numSamples;

  float voltage = avgAnalog * 3.3 / 4096.0;
  float slope = 0.18; // adjust according to sensor
  float offset = 7.0 - (2.5 / slope); // pH at 2.5V = 7
  float phValue = voltage / slope + offset;

  if (phValue < 0) phValue = 0;
  if (phValue > 14) phValue = 14;

  Serial.print("Measured pH: ");
  Serial.println(phValue);
  sensorData["ph"] = phValue;
}

// Function to control the grow light brightness with PWM
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
  pinMode(PH_UP_PUMP_PIN, OUTPUT);
  pinMode(PH_DOWN_PUMP_PIN, OUTPUT);
  pinMode(PPM_A_PUMP_PIN, OUTPUT);
  pinMode(PPM_B_PUMP_PIN, OUTPUT);
  
  stopAllPumps(); // Ensure all pumps are off at startup

  ledcSetup(ledChannel, ledFreq, ledResolution);
  ledcAttachPin(LIGHT_PIN, ledChannel);
  
  randomSeed(analogRead(0));
}

void loop() {
  // PPM dosing state machine logic (non-blocking)
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
  
  // pH dosing state machine logic (non-blocking)
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

  // Normal loop logic
  if (WiFi.status() == WL_CONNECTED) {
    sensorData.clear();
    readDHT();
    readUltrasonic();
    readPpmSensor();
    readPhSensor();

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
        
        // Check for pH dosing commands and activate state machine
        if (ph_up_pump_cmd && phState == PH_IDLE) {
            phState = PH_DOSING_UP;
            phStateChangeTime = millis();
            digitalWrite(PH_UP_PUMP_PIN, HIGH);
        } else if (ph_down_pump_cmd && phState == PH_IDLE) {
            phState = PH_DOSING_DOWN;
            phStateChangeTime = millis();
            digitalWrite(PH_DOWN_PUMP_PIN, HIGH);
        } else if (phState == PH_IDLE) {
            digitalWrite(PH_UP_PUMP_PIN, LOW);
            digitalWrite(PH_DOWN_PUMP_PIN, LOW);
        }

        // Check for PPM dosing command and activate state machine
        if (ppm_a_pump_cmd && ppm_b_pump_cmd && ppmState == PPM_IDLE) {
          ppmState = PPM_DOSING_A;
          ppmStateChangeTime = millis();
          digitalWrite(PPM_A_PUMP_PIN, HIGH);
        } else if (ppmState == PPM_IDLE) { // Ensure pumps are off only if not in a dosing cycle
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

  delay(5000); // update every 5s
}