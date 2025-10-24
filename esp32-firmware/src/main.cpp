
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <DHT.h>
#include <Adafruit_Sensor.h>
#include <ArduinoJson.h>

// -------- WiFi & API --------
const char* ssid     = "SockMnky";
const char* password = "04072024";

// Use hostname + path (no "https://" in HOSTNAME)
const char* HOSTNAME  = "planterbox-orcin.vercel.app";
const int   HTTPS_PORT = 443;
const char* API_PATH   = "/api/sensordata";

// -------- Sensors / Pins --------
#define DHTPIN   33
#define DHTTYPE  DHT11

#define TRIG_PIN 35
#define ECHO_PIN 34

#define PPM_SENSOR_PIN 36
#define PH_SENSOR_PIN  39

#define WATER_SENSOR_PIN 32
const int WATER_THRESHOLD = 680;

#define LIGHT_PIN 15

#define PH_UP_PUMP_PIN   21
#define PH_DOWN_PUMP_PIN 19
#define PPM_A_PUMP_PIN   18
#define PPM_B_PUMP_PIN   5

// --- Optional stepper motor to move light height (simple 28BYJ-48 style) ---
#define MOTOR_IN1 27
#define MOTOR_IN2 14
#define MOTOR_IN3 12
#define MOTOR_IN4 13
int motorStep = 0;

// -------- LEDC (PWM for grow light) --------
const int ledChannel    = 0;
const int ledFreq       = 5000;
const int ledResolution = 8; // 0..255

// -------- Dosing State Machines --------
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
PhDosingState  phState  = PH_IDLE;

unsigned long ppmStateChangeTime = 0;
unsigned long phStateChangeTime  = 0;

// How long each pump runs when commanded (ms)
unsigned long dosingDuration = 2000;   // 2 seconds each pump (A and B; change if you want longer dosing)
// Delay between A and B (ms) — keep short unless you really want a long gap between nutrients
unsigned long delayDuration  = 2000;   // 2 seconds between A and B; set to 120000 for 2 minutes if desired

// -------- Global Lockout (local, no DB) --------
// Block starting ANY new pump while locked out (A→B continues once started)
unsigned long globalLockoutUntil = 0;
bool isLockedOut() { return millis() < globalLockoutUntil; }

// -------- Globals --------
DHT dht(DHTPIN, DHTTYPE);
StaticJsonDocument<256> sensorData; // keep small
float currentTempC = 25.0;

// ===============================
// Helpers
// ===============================

void stopMotor() {
  digitalWrite(MOTOR_IN1, LOW);
  digitalWrite(MOTOR_IN2, LOW);
  digitalWrite(MOTOR_IN3, LOW);
  digitalWrite(MOTOR_IN4, LOW);
}

void stepMotor(bool clockwise) {
  static const uint8_t seq[8][4] = {
    {1,0,0,0},
    {1,1,0,0},
    {0,1,0,0},
    {0,1,1,0},
    {0,0,1,0},
    {0,0,1,1},
    {0,0,0,1},
    {1,0,0,1}
  };
  motorStep = (motorStep + (clockwise ? 1 : 7)) & 7;
  digitalWrite(MOTOR_IN1, seq[motorStep][0]);
  digitalWrite(MOTOR_IN2, seq[motorStep][1]);
  digitalWrite(MOTOR_IN3, seq[motorStep][2]);
  digitalWrite(MOTOR_IN4, seq[motorStep][3]);
}

void stopAllPumps() {
  digitalWrite(PH_UP_PUMP_PIN, LOW);
  digitalWrite(PH_DOWN_PUMP_PIN, LOW);
  digitalWrite(PPM_A_PUMP_PIN, LOW);
  digitalWrite(PPM_B_PUMP_PIN, LOW);
}

void controlGrowLight(int brightness) {
  if (brightness < 0) brightness = 0;
  if (brightness > 255) brightness = 255;
  ledcWrite(ledChannel, brightness);
  Serial.print("Grow Light Brightness (PWM 0-255): ");
  Serial.println(brightness);
}

// ===============================
// Sensor Reading
// ===============================

void readDHT() {
  float humidity = dht.readHumidity();
  float tempC    = dht.readTemperature();
  if (isnan(humidity)) {
    Serial.println("Failed to read humidity from DHT sensor!");
    humidity = 0.0;
  }
  if (isnan(tempC)) {
    Serial.println("Failed to read temperature from DHT sensor!");
    tempC = 0.0;
  }
  sensorData["temperature"] = tempC;
  sensorData["humidity"]    = humidity;
  currentTempC = tempC;
}

void readUltrasonic() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH);
  float distanceCm = duration * 0.034f / 2.0f;
  if (distanceCm > 0) {
    sensorData["distance"] = distanceCm;
  }
}

void readPpmSensor() {
  long sumAnalogValue = 0;
  for (int i = 0; i < 10; i++) {
    sumAnalogValue += analogRead(PPM_SENSOR_PIN);
    delay(10);
  }
  float avgAnalogValue = (float)sumAnalogValue / 10.0f;
  float voltage = avgAnalogValue * 3.3f / 4096.0f;
  float ppmValue = 640.0f * voltage;
  if (currentTempC > 0.0f) {
    float compensationCoefficient = 1.0f + 0.02f * (currentTempC - 25.0f);
    ppmValue = ppmValue / compensationCoefficient;
  }
  sensorData["ppm"] = ppmValue;
}

void readPhSensor() {
  long sumAnalog = 0;
  const int numSamples = 30;
  for (int i = 0; i < numSamples; i++) {
    sumAnalog += analogRead(PH_SENSOR_PIN);
    delay(10);
  }
  float avgAnalog = sumAnalog / (float)numSamples;

  float phValue;
  if (avgAnalog == 0) {
    phValue = 0.0f;
  } else {
    float voltage = avgAnalog * 3.3f / 4096.0f;
    const float PH_SLOPE = 3.57f;
    const float PH_OFFSET = 21.34f;
    phValue = PH_OFFSET - (PH_SLOPE * voltage);
  }
  if (phValue < 0)  phValue = 0;
  if (phValue > 14) phValue = 14;

  Serial.print("Raw pH Analog: ");
  Serial.print(avgAnalog);
  Serial.print(" | Measured pH: ");
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

// ===============================
// Setup / Loop
// ===============================

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

  pinMode(MOTOR_IN1, OUTPUT);
  pinMode(MOTOR_IN2, OUTPUT);
  pinMode(MOTOR_IN3, OUTPUT);
  pinMode(MOTOR_IN4, OUTPUT);
  stopMotor();

  stopAllPumps();

  ledcSetup(ledChannel, ledFreq, ledResolution);
  ledcAttachPin(LIGHT_PIN, ledChannel);
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {

    // --- PPM dosing state machine ---
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

    // --- pH dosing state machine ---
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

    // --- Read sensors & build payload ---
    sensorData.clear();
    readDHT();
    readUltrasonic();
    readPpmSensor();
    readPhSensor();
    readWaterSensor();

    String payload;
    serializeJson(sensorData, payload);
    Serial.println("Sending payload: " + payload);

    // --- HTTPS POST to server ---
    WiFiClientSecure client;
    client.setInsecure();

    HTTPClient http;
    if (http.begin(client, HOSTNAME, HTTPS_PORT, API_PATH, true)) {
      http.addHeader("Content-Type", "application/json");
      int httpResponseCode = http.POST(payload);

      if (httpResponseCode > 0) {
        String response = http.getString();

        Serial.print("POST Response Code: ");
        Serial.println(httpResponseCode);
        Serial.println("Server response (JSON expected):");
        Serial.println(response);

        if (httpResponseCode == HTTP_CODE_OK || httpResponseCode == HTTP_CODE_CREATED) {
          StaticJsonDocument<256> doc;
          DeserializationError error = deserializeJson(doc, response);
          if (!error) {
            // --- Commands from Server ---
            int  lightBrightness    = doc["light"] | 0;
            bool ph_up_pump_cmd     = doc["ph_up_pump"] | false;
            bool ph_down_pump_cmd   = doc["ph_down_pump"] | false;
            bool ppm_a_pump_cmd     = doc["ppm_a_pump"] | false;
            bool ppm_b_pump_cmd     = doc["ppm_b_pump"] | false;

            // Optional motor command used by your UI (keep as-is if you send it)
            const char* light_motor_cmd = doc["light_motor_cmd"] | "STOP";

            // NEW: global lockout hint (ms) — default 120000 if not provided
            unsigned long lockoutMsHint = doc["lockout_ms"] | 0;

            // --- Apply Light & Motor ---
            controlGrowLight(lightBrightness);

            if (strcmp(light_motor_cmd, "UP") == 0) {
              stepMotor(true);
              delay(5);
            } else if (strcmp(light_motor_cmd, "DOWN") == 0) {
              stepMotor(false);
              delay(5);
            } else {
              stopMotor();
            }

            // --- Pump Control Logic with LOCAL GLOBAL LOCKOUT ---
            // Don't start anything new while locked out.
            if (!isLockedOut()) {
              // Priority: pH corrections before nutrients
              if (ph_up_pump_cmd && phState == PH_IDLE) {
                phState = PH_DOSING_UP;
                phStateChangeTime = millis();
                digitalWrite(PH_UP_PUMP_PIN, HIGH);

                unsigned long base = lockoutMsHint ? lockoutMsHint : 120000UL; // 2 min default
                globalLockoutUntil = millis() + base;

              } else if (ph_down_pump_cmd && phState == PH_IDLE) {
                phState = PH_DOSING_DOWN;
                phStateChangeTime = millis();
                digitalWrite(PH_DOWN_PUMP_PIN, HIGH);

                unsigned long base = lockoutMsHint ? lockoutMsHint : 120000UL;
                globalLockoutUntil = millis() + base;

              } else if (ppm_a_pump_cmd && ppm_b_pump_cmd && ppmState == PPM_IDLE) {
                // Start the entire nutrients sequence (A → delay → B)
                ppmState = PPM_DOSING_A;
                ppmStateChangeTime = millis();
                digitalWrite(PPM_A_PUMP_PIN, HIGH);

                // Reserve lockout for: A run + gap + B run + 2 min settle
                unsigned long seqMs  = dosingDuration + delayDuration + dosingDuration;
                unsigned long settle = lockoutMsHint ? lockoutMsHint : 120000UL; // 2 min
                globalLockoutUntil = millis() + seqMs + settle;
              }
            } else {
              // Still in lockout — ignore new start commands; let existing states complete
              // (No action needed here)
            }

          } else {
            Serial.print("JSON parse error: ");
            Serial.println(error.c_str());
          }
        }

      } else {
        Serial.print("HTTP request failed, error: ");
        Serial.println(http.errorToString(httpResponseCode));
      }

      http.end();
    } else {
      Serial.println("HTTP begin() failed.");
    }
  } // WiFi connected

  // Small loop delay to keep things sane
  delay(100);
}
