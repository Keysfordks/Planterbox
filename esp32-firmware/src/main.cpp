#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <DHT.h>
#include <Adafruit_Sensor.h>
#include <ArduinoJson.h>

// ===== Debug verbosity toggle =====
#define VERBOSE_LOG 1  // set to 0 to quiet things down

// -------- WiFi & API --------
const char* ssid     = "Jonathan";
const char* password = "eeeeeeee";
const char* HOSTNAME = "planterbox-orcin.vercel.app";
const int   HTTPS_PORT = 443;
const char* API_PATH = "/api/sensordata";

// -------- Sensors / Pins --------
#define DHTPIN   33
#define DHTTYPE  DHT11
#define TRIG_PIN 26
#define ECHO_PIN 34
#define PPM_SENSOR_PIN 39
#define PH_SENSOR_PIN  36
#define WATER_SENSOR_PIN 32
#define LIGHT_PIN 15

#define PH_UP_PUMP_PIN   21
#define PH_DOWN_PUMP_PIN 19
#define PPM_A_PUMP_PIN   18
#define PPM_B_PUMP_PIN   5
const int WATER_THRESHOLD = 680;

// -------- Stepper Motor (ULN2003 + 28BYJ-48) --------
#define MOTOR_IN1 27
#define MOTOR_IN2 14
#define MOTOR_IN3 12
#define MOTOR_IN4 13

// ===================================================
// Stepper class to simplify movement
// ===================================================
class Stepper28BYJ {
private:
  const uint8_t seq[8][4] = {
    {1,0,0,0}, {1,1,0,0}, {0,1,0,0}, {0,1,1,0},
    {0,0,1,0}, {0,0,1,1}, {0,0,0,1}, {1,0,0,1}
  };
  int stepIndex = 0;
  int in1, in2, in3, in4;
public:
  Stepper28BYJ(int a, int b, int c, int d)
      : in1(a), in2(b), in3(c), in4(d) {}
  void begin() {
    pinMode(in1, OUTPUT);
    pinMode(in2, OUTPUT);
    pinMode(in3, OUTPUT);
    pinMode(in4, OUTPUT);
    stop();
  }
  void stop() {
    digitalWrite(in1, LOW);
    digitalWrite(in2, LOW);
    digitalWrite(in3, LOW);
    digitalWrite(in4, LOW);
  }
  void step(bool clockwise) {
    stepIndex = (stepIndex + (clockwise ? 1 : -1) + 8) % 8;
    digitalWrite(in1, seq[stepIndex][0]);
    digitalWrite(in2, seq[stepIndex][1]);
    digitalWrite(in3, seq[stepIndex][2]);
    digitalWrite(in4, seq[stepIndex][3]);
  }
};

Stepper28BYJ stepper(MOTOR_IN1, MOTOR_IN2, MOTOR_IN3, MOTOR_IN4);

// ===================================================
// Globals & constants
// ===================================================
DHT dht(DHTPIN, DHTTYPE);
StaticJsonDocument<256> sensorData;
float currentTempC = 25.0;
float currentDistanceCm = 0.0;

// Ultrasonic (debug)
static long lastEchoDurationUs = 0;

const float TARGET_MIN_CM = 25.0f;
const float TARGET_MAX_CM = 30.0f;
const int LIGHT_ADJUST_STEPS = 5;
const int MOTOR_STEP_DELAY_US = 5000;
const unsigned long LIGHT_ADJUST_INTERVAL_MS = 1000;
unsigned long lastLightAdjustTime = 0;

// -------- Grow light PWM --------
const int ledChannel = 0, ledFreq = 5000, ledResolution = 8;

// -------- Dosing states --------
enum PpmDosingState { PPM_IDLE, PPM_DOSING_A, PPM_DELAYING, PPM_DOSING_B };
enum PhDosingState  { PH_IDLE,  PH_DOSING_UP, PH_DOSING_DOWN };
PpmDosingState ppmState = PPM_IDLE;
PhDosingState  phState  = PH_IDLE;

unsigned long ppmStateChangeTime = 0, phStateChangeTime = 0;
unsigned long dosingDuration = 2000, delayDuration = 2000;

// -------- Global Lockout --------
unsigned long globalLockoutUntil = 0;
bool isLockedOut() { return millis() < globalLockoutUntil; }
unsigned long lockoutRemaining() { return isLockedOut() ? (globalLockoutUntil - millis()) : 0; }

// -------- Cached raw readings for logs --------
static int   lastWaterADC = 0;
static long  lastPhSum = 0;
static float lastPhAvg = 0;
static float lastPhVolt = 0;
static float lastPhValue = 0;
static long  lastPpmSum = 0;
static float lastPpmVolt = 0;
static float lastPpmVal  = 0;

// ===================================================
// Utility functions
// ===================================================
void stopAllPumps() {
  digitalWrite(PH_UP_PUMP_PIN, LOW);
  digitalWrite(PH_DOWN_PUMP_PIN, LOW);
  digitalWrite(PPM_A_PUMP_PIN, LOW);
  digitalWrite(PPM_B_PUMP_PIN, LOW);
}

void controlGrowLight(int brightness) {
  brightness = constrain(brightness, 0, 255);
  ledcWrite(ledChannel, brightness);
  #if VERBOSE_LOG
  Serial.printf("[LIGHT] PWM: %d (0-255)\n", brightness);
  #endif
}

void logHeaderCycle() {
  #if VERBOSE_LOG
  Serial.println();
  Serial.println(F("========== LOOP =========="));
  Serial.printf("[TIME] millis=%lu | WiFi=%s\n",
                millis(),
                (WiFi.status()==WL_CONNECTED ? "CONNECTED" : "NOT CONNECTED"));
  Serial.printf("[LOCKOUT] %s | remaining: %lu ms\n",
                isLockedOut() ? "ACTIVE" : "INACTIVE",
                lockoutRemaining());
  #endif
}

// ===================================================
// Sensor reading
// ===================================================
void readDHT() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (isnan(h)) { h = 0; }
  if (isnan(t)) { t = 0; }
  sensorData["temperature"] = t;
  sensorData["humidity"]    = h;
  currentTempC = t;

  #if VERBOSE_LOG
  Serial.printf("[DHT11] Temp: %.2f C | Humidity: %.2f %%\n", t, h);
  #endif
}

void readUltrasonic() {
  digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000); // 30 ms timeout
  float dist = duration * 0.034f / 2.0f;
  if (dist > 0 && dist < 400) {
    currentDistanceCm = dist;
    lastEchoDurationUs = duration;
  }
  sensorData["distance"] = currentDistanceCm;

  #if VERBOSE_LOG
  Serial.printf("[ULTRASONIC] Duration: %ld us | Distance: %.2f cm\n", lastEchoDurationUs, currentDistanceCm);
  #endif
}

void readPpmSensor() {
  long sum = 0;
  for (int i=0;i<10;i++){ sum += analogRead(PPM_SENSOR_PIN); delay(10); }
  float avg = (sum/10.0f);
  float v = avg * 3.3f / 4096.0f;
  float ppm = 420.0f * v;
  float comp = 1.0f + 0.02f*(currentTempC-25.0f);
  ppm /= comp;

  sensorData["ppm"] = ppm;

  lastPpmSum = sum;
  lastPpmVolt = v;
  lastPpmVal = ppm;

  #if VERBOSE_LOG
  Serial.printf("[PPM] avgADC: %.1f | Volt: %.3f V | Temp: %.2f C | CompPPM: %.2f\n",
                avg, v, currentTempC, ppm);
  #endif
}

void readPhSensor() {
  const int N = 30;
  long sum = 0;
  for (int i = 0; i < N; i++) { sum += analogRead(PH_SENSOR_PIN); delay(10); }
  float avg = sum / (float)N;
  float v = avg * 3.3f / 4095.0f;   // ESP32 ADC -> volts

    // If no signal, set pH = 0
  float ph;
  if (v <= 0.01f) {   // ~10 mV tolerance to catch open/faulty readings
    ph = 0.0f;
  } else {
  // --- Jonathan’s 5–9 pH local calibration ---
  const float m = -9.76f;   // slope  (pH per V)
  const float b = 19.45f;   // intercept
  float ph = m * v + b;

  // Clamp to a reasonable plant range
  ph = constrain(ph, 4.5f, 9.5f);
  }
  sensorData["ph"] = ph;

  lastPhSum   = sum;
  lastPhAvg   = avg;
  lastPhVolt  = v;
  lastPhValue = ph;

  #if VERBOSE_LOG
  Serial.printf("[pH] avgADC: %.1f | Volt: %.3f V | pH: %.2f\n", avg, v, ph);
  #endif
}

void readWaterSensor() {
  int val = analogRead(WATER_SENSOR_PIN);
  bool ok = val > WATER_THRESHOLD;
  sensorData["water_sufficient"]=ok;
  lastWaterADC = val;

  #if VERBOSE_LOG
  Serial.printf("[WATER] ADC: %d | threshold: %d | Sufficient: %s\n",
                val, WATER_THRESHOLD, ok ? "YES" : "NO");
  #endif
}

// ===================================================
// Automatic light height control
// ===================================================
void adjustLightHeightAuto() {
  if (millis() - lastLightAdjustTime < LIGHT_ADJUST_INTERVAL_MS) return;
  lastLightAdjustTime = millis();

  if (currentDistanceCm == 0.0f) {
    #if VERBOSE_LOG
    Serial.println("[STEPPER] Skipped adjust: no valid distance yet");
    #endif
    return;
  }

  if (currentDistanceCm < TARGET_MIN_CM) {
    #if VERBOSE_LOG
    Serial.printf("[STEPPER] Too close (%.2f < %.2f): moving UP, %d steps\n",
                  currentDistanceCm, TARGET_MIN_CM, LIGHT_ADJUST_STEPS);
    #endif
    for (int i=0;i<LIGHT_ADJUST_STEPS;i++){ stepper.step(true); delayMicroseconds(MOTOR_STEP_DELAY_US);}
  } else if (currentDistanceCm > TARGET_MAX_CM) {
    #if VERBOSE_LOG
    Serial.printf("[STEPPER] Too far (%.2f > %.2f): moving DOWN, %d steps\n",
                  currentDistanceCm, TARGET_MAX_CM, LIGHT_ADJUST_STEPS);
    #endif
    for (int i=0;i<LIGHT_ADJUST_STEPS;i++){ stepper.step(false); delayMicroseconds(MOTOR_STEP_DELAY_US);}
  } else {
    stepper.stop();
    #if VERBOSE_LOG
    Serial.printf("[STEPPER] In range (%.2f within [%.2f, %.2f]): STOP\n",
                  currentDistanceCm, TARGET_MIN_CM, TARGET_MAX_CM);
    #endif
  }
}

// ===================================================
// Setup / Loop
// ===================================================
void setup() {
  Serial.begin(115200);
  Serial.println("\n[BOOT] Starting...");

  WiFi.begin(ssid, password);
  Serial.print("[WiFi] Connecting");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.printf("\n[WiFi] CONNECTED | IP: %s\n", WiFi.localIP().toString().c_str());

  dht.begin();
  pinMode(TRIG_PIN, OUTPUT); pinMode(ECHO_PIN, INPUT);
  pinMode(PPM_SENSOR_PIN, INPUT); pinMode(PH_SENSOR_PIN, INPUT);
  pinMode(WATER_SENSOR_PIN, INPUT);

  pinMode(PH_UP_PUMP_PIN, OUTPUT); pinMode(PH_DOWN_PUMP_PIN, OUTPUT);
  pinMode(PPM_A_PUMP_PIN, OUTPUT); pinMode(PPM_B_PUMP_PIN, OUTPUT);
  stopAllPumps();

  stepper.begin();
  ledcSetup(ledChannel, ledFreq, ledResolution);
  ledcAttachPin(LIGHT_PIN, ledChannel);

  Serial.println("[INIT] Hardware initialized");
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    logHeaderCycle();

    // --- Dosing state machines ---
    if (ppmState == PPM_DOSING_A && millis()-ppmStateChangeTime>=dosingDuration){
      digitalWrite(PPM_A_PUMP_PIN,LOW);
      ppmState=PPM_DELAYING; ppmStateChangeTime=millis();
      #if VERBOSE_LOG
      Serial.println("[PPM] A finished -> DELAY");
      #endif
    } else if (ppmState==PPM_DELAYING && millis()-ppmStateChangeTime>=delayDuration){
      digitalWrite(PPM_B_PUMP_PIN,HIGH);
      ppmState=PPM_DOSING_B; ppmStateChangeTime=millis();
      #if VERBOSE_LOG
      Serial.println("[PPM] Delay finished -> B START");
      #endif
    } else if (ppmState==PPM_DOSING_B && millis()-ppmStateChangeTime>=dosingDuration){
      digitalWrite(PPM_B_PUMP_PIN,LOW); ppmState=PPM_IDLE;
      #if VERBOSE_LOG
      Serial.println("[PPM] B finished -> IDLE");
      #endif
    }
    if (phState==PH_DOSING_UP && millis()-phStateChangeTime>=dosingDuration){
      digitalWrite(PH_UP_PUMP_PIN,LOW); phState=PH_IDLE;
      #if VERBOSE_LOG
      Serial.println("[pH] UP finished -> IDLE");
      #endif
    }
    if (phState==PH_DOSING_DOWN && millis()-phStateChangeTime>=dosingDuration){
      digitalWrite(PH_DOWN_PUMP_PIN,LOW); phState=PH_IDLE;
      #if VERBOSE_LOG
      Serial.println("[pH] DOWN finished -> IDLE");
      #endif
    }

    // --- Sensor update ---
    sensorData.clear();
    readDHT();
    readUltrasonic();
    readPpmSensor();
    readPhSensor();
    readWaterSensor();

    // --- Auto light adjust ---
    adjustLightHeightAuto();

    // --- Send data ---
    String payload; serializeJson(sensorData, payload);
    #if VERBOSE_LOG
    Serial.print("[HTTP] Outgoing JSON: ");
    Serial.println(payload);
    #endif

    WiFiClientSecure client; client.setInsecure();
    HTTPClient http;
    if (http.begin(client, HOSTNAME, HTTPS_PORT, API_PATH, true)) {
      http.addHeader("Content-Type","application/json");
      int code=http.POST(payload);
      String resp = http.getString();

      #if VERBOSE_LOG
      Serial.printf("[HTTP] POST code: %d\n", code);
      Serial.println("[HTTP] Server response:");
      Serial.println(resp);
      #endif

      if(code>0){
        StaticJsonDocument<256> doc;
        DeserializationError err = deserializeJson(doc, resp);
        if(!err){
          int light = doc["light"]|0;
          bool phUp = doc["ph_up_pump"]|false;
          bool phDn = doc["ph_down_pump"]|false;
          bool ppmA = doc["ppm_a_pump"]|false;
          bool ppmB = doc["ppm_b_pump"]|false;
          unsigned long lockoutMs = doc["lockout_ms"]|120000UL;

          #if VERBOSE_LOG
          Serial.printf("[CMD] light=%d, ph_up=%d, ph_down=%d, ppm_a=%d, ppm_b=%d, lockout_hint=%lu ms\n",
                        light, phUp, phDn, ppmA, ppmB, lockoutMs);
          #endif

          // Apply light immediately
          controlGrowLight(light);

          // Respect local lockout for NEW starts (existing sequences continue)
          if(!isLockedOut()){
            if(phUp && phState==PH_IDLE){
              phState=PH_DOSING_UP; phStateChangeTime=millis();
              digitalWrite(PH_UP_PUMP_PIN,HIGH);
              globalLockoutUntil=millis()+lockoutMs;
              #if VERBOSE_LOG
              Serial.printf("[pH] UP START | lockout until %lu (in %lu ms)\n", globalLockoutUntil, lockoutRemaining());
              #endif
            } else if(phDn && phState==PH_IDLE){
              phState=PH_DOSING_DOWN; phStateChangeTime=millis();
              digitalWrite(PH_DOWN_PUMP_PIN,HIGH);
              globalLockoutUntil=millis()+lockoutMs;
              #if VERBOSE_LOG
              Serial.printf("[pH] DOWN START | lockout until %lu (in %lu ms)\n", globalLockoutUntil, lockoutRemaining());
              #endif
            } else if(ppmA && ppmB && ppmState==PPM_IDLE){
              ppmState=PPM_DOSING_A; ppmStateChangeTime=millis();
              digitalWrite(PPM_A_PUMP_PIN,HIGH);
              // Reserve lockout for A + gap + B + settle(lockoutMs)
              globalLockoutUntil=millis()+dosingDuration+delayDuration+dosingDuration+lockoutMs;
              #if VERBOSE_LOG
              Serial.printf("[PPM] A START | lockout until %lu (in %lu ms)\n", globalLockoutUntil, lockoutRemaining());
              #endif
            } else {
              #if VERBOSE_LOG
              Serial.println("[CMD] No new dosing started (either cmd false or state busy).");
              #endif
            }
          } else {
            #if VERBOSE_LOG
            Serial.printf("[LOCKOUT] Active; ignoring new starts. Remaining: %lu ms\n", lockoutRemaining());
            #endif
          }
        } else {
          #if VERBOSE_LOG
          Serial.print("[JSON] Parse error: ");
          Serial.println(err.c_str());
          #endif
        }
      } else {
        #if VERBOSE_LOG
        Serial.print("[HTTP] Request failed: ");
        Serial.println(http.errorToString(code));
        #endif
      }

      http.end();
    } else {
      #if VERBOSE_LOG
      Serial.println("[HTTP] begin() failed (bad URL or client).");
      #endif
    }
  } // WiFi connected

  // Small loop delay to keep things sane
  delay(100);
}
