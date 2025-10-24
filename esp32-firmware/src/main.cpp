#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <Adafruit_Sensor.h>
#include <ArduinoJson.h>
#include <cstdlib>
#include <WiFiClientSecure.h>

const char* ssid = "SockMnky";
const char* password = "04072024";

// !!! CRITICAL FIX: Use the hostname and path for a robust connection !!!

// 1. HOSTNAME: Use ONLY the domain name (no https:// or /api/sensordata)
const char* HOSTNAME = "planterbox-orcin.vercel.app"; 
// 2. PORT: HTTPS standard port
const int HTTPS_PORT = 443;
// 3. API PATH: The rest of the URL
const char* API_PATH = "/api/sensordata"; 


#define DHTPIN 33
#define DHTTYPE DHT11

#define TRIG_PIN 35
#define ECHO_PIN 34

#define PPM_SENSOR_PIN 36

#define PH_SENSOR_PIN 39

#define WATER_SENSOR_PIN 32
const int WATER_THRESHOLD = 680;

#define LIGHT_PIN 15

#define PH_UP_PUMP_PIN 21
#define PH_DOWN_PUMP_PIN 19
#define PPM_A_PUMP_PIN 18
#define PPM_B_PUMP_PIN 5

// --- Stepper Motor Pins for Light Adjustment ---
#define MOTOR_IN1 27 
#define MOTOR_IN2 14 
#define MOTOR_IN3 12 
#define MOTOR_IN4 13 
int motorStep = 0;
// ---------------------------------------------------

const int ledChannel = 0;
const int ledFreq = 5000;
const int ledResolution = 8; // 8-bit resolution (0-255)

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

void stopMotor() {
    digitalWrite(MOTOR_IN1, LOW);
    digitalWrite(MOTOR_IN2, LOW);
    digitalWrite(MOTOR_IN3, LOW);
    digitalWrite(MOTOR_IN4, LOW);
}

void stepMotor(bool isUp) {
    if (isUp) { 
        motorStep = (motorStep + 1) % 4; 
    } else { 
        motorStep = (motorStep - 1 + 4) % 4;
    }

    switch (motorStep) {
        case 0: // Step AB: 1,1,0,0
            digitalWrite(MOTOR_IN1, HIGH);
            digitalWrite(MOTOR_IN2, HIGH);
            digitalWrite(MOTOR_IN3, LOW);
            digitalWrite(MOTOR_IN4, LOW);
            break;
        case 1: // Step BC: 0,1,1,0
            digitalWrite(MOTOR_IN1, LOW);
            digitalWrite(MOTOR_IN2, HIGH);
            digitalWrite(MOTOR_IN3, HIGH);
            digitalWrite(MOTOR_IN4, LOW);
            break;
        case 2: // Step CD: 0,0,1,1
            digitalWrite(MOTOR_IN1, LOW);
            digitalWrite(MOTOR_IN2, LOW);
            digitalWrite(MOTOR_IN3, HIGH);
            digitalWrite(MOTOR_IN4, HIGH);
            break;
        case 3: // Step DA: 1,0,0,1
            digitalWrite(MOTOR_IN1, HIGH);
            digitalWrite(MOTOR_IN2, LOW);
            digitalWrite(MOTOR_IN3, LOW);
            digitalWrite(MOTOR_IN4, HIGH);
            break;
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
  const int numSamples = 30; 
  for (int i = 0; i < numSamples; i++) {
    sumAnalog += analogRead(PH_SENSOR_PIN);
    delay(10);
  }
  float avgAnalog = sumAnalog / (float)numSamples;
  
  // --- MODIFICATION START ---
  float phValue;
  if (avgAnalog == 0) {
    // If the raw analog read is 0, default the pH value to 0.0
    phValue = 0.0; 
  } else {
    // Proceed with calculation if the reading is non-zero
    float voltage = avgAnalog * 3.3 / 4096.0;

    const float PH_SLOPE = 3.57; 
    const float PH_OFFSET = 21.34;

    phValue = PH_OFFSET - (PH_SLOPE * voltage);
  }
  // --- MODIFICATION END ---

  if (phValue < 0) phValue = 0;
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

void controlGrowLight(int brightness) {
  if (brightness < 0) brightness = 0;
  if (brightness > 255) brightness = 255;
  
  ledcWrite(ledChannel, brightness); 
  
  Serial.print("Grow Light Brightness (PWM 0-255): ");
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
    
    // --- Dosing state machine logic ---
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
    // -------------------------------------------------

    // --- Sensor reading and payload preparation ---
    sensorData.clear();
    readDHT();
    readUltrasonic();
    readPpmSensor();
    readPhSensor();
    readWaterSensor();
    
    String payload;
    serializeJson(sensorData, payload);
    Serial.println("Sending payload: " + payload);

    // 1. Setup Secure Client
    WiFiClientSecure client; 
    client.setInsecure(); 
    
    HTTPClient http;

    // 2. Begin connection using HOSTNAME, HTTPS_PORT, API_PATH, and enable redirects
    if (http.begin(client, HOSTNAME, HTTPS_PORT, API_PATH, true)) { 
      
      http.addHeader("Content-Type", "application/json");
      
      // 3. Execute POST request
      int httpResponseCode = http.POST(payload);
      
      if (httpResponseCode > 0) { 
        String response = http.getString();
        
        Serial.print("POST Response Code: ");
        Serial.println(httpResponseCode);
        Serial.println("Server response (JSON expected):");
        Serial.println(response);

        if (httpResponseCode == HTTP_CODE_OK || httpResponseCode == HTTP_CODE_CREATED) {
            StaticJsonDocument<200> doc;
            DeserializationError error = deserializeJson(doc, response);
            if (!error) {
                // --- Commands from Server ---
                int lightBrightness = doc["light"] | 0; 
                bool ph_up_pump_cmd = doc["ph_up_pump"] | false;
                bool ph_down_pump_cmd = doc["ph_down_pump"] | false;
                bool ppm_a_pump_cmd = doc["ppm_a_pump"] | false;
                bool ppm_b_pump_cmd = doc["ppm_b_pump"] | false;
                const char* light_motor_cmd = doc["light_motor_cmd"] | "STOP"; 
                
                // --- Execute Light and Motor Commands ---
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
                
                // --- Pump Control Logic ---
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

                if (ppm_a_pump_cmd && ppm_b_pump_cmd && ppmState == PPM_IDLE) {
                    ppmState = PPM_DOSING_A;
                    ppmStateChangeTime = millis();
                    digitalWrite(PPM_A_PUMP_PIN, HIGH);
                } else if (ppmState == PPM_IDLE) {
                    digitalWrite(PPM_A_PUMP_PIN, LOW);
                    digitalWrite(PPM_B_PUMP_PIN, LOW);
                }
            } else {
                Serial.print(F("deserializeJson() failed: "));
                Serial.println(error.f_str());
            }
        } else {
             Serial.println("Skipping JSON parsing due to non-OK HTTP status.");
        }
      } else {
        Serial.print("POST failed. Code: ");
        Serial.println(httpResponseCode);
      }
      
      http.end();
    } else {
      Serial.println("HTTP begin failed!");
    }
  } else {
    // --- Failsafe: WiFi Disconnected ---
    Serial.println("WiFi Disconnected! Activating Failsafe: Stopping all pumps.");
    
    stopAllPumps();

    ppmState = PPM_IDLE;
    phState = PH_IDLE;
  }

  delay(5000); 
}