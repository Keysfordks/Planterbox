#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClient.h>
#include <DHT.h>
#include <Adafruit_Sensor.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

// ===== Debug verbosity toggle =====
#define VERBOSE_LOG 1 // set to 0 to quiet things down

// -------- EEPROM Configuration --------
#define EEPROM_SIZE 512
#define SSID_ADDR 0
#define PASS_ADDR 100
#define VALID_ADDR 200

// -------- Access Point & Web Server --------
const char *ap_ssid = "planterbox_ap";
const char *ap_password = "12345678";
WiFiServer server(80);
String header;
const int blueLED = 2;
unsigned long previousMillis = 0;
const long blinkInterval = 500;
bool ledState = false;
String stored_ssid = "";
String stored_password = "";
bool config_mode = true;

// -------- API Configuration --------
// FIXED: Your laptop's IP address where Next.js is running
const char *HOSTNAME = "192.168.86.22"; // ← Your laptop hosting Next.js
const int HTTP_PORT = 3000;             // Next.js default port
const char *API_PATH = "/api/sensordata";

// -------- Sensors / Pins --------
#define DHTPIN 33
#define DHTTYPE DHT11
#define TRIG_PIN 23
#define ECHO_PIN 34
#define PPM_SENSOR_PIN 39
#define PH_SENSOR_PIN 36
#define WATER_SENSOR_PIN 32
#define LIGHT_PIN 15

#define PH_UP_PUMP_PIN 21
#define PH_DOWN_PUMP_PIN 19
#define PPM_A_PUMP_PIN 18
#define PPM_B_PUMP_PIN 5
const int WATER_THRESHOLD = 680;

// -------- Stepper Motor (ULN2003 + 28BYJ-48) --------
#define MOTOR_IN1 27
#define MOTOR_IN2 14
#define MOTOR_IN3 12
#define MOTOR_IN4 13

// ===================================================
// Stepper class to simplify movement
// ===================================================
class Stepper28BYJ
{
private:
  const uint8_t seq[8][4] = {
      {1, 0, 0, 0}, {1, 1, 0, 0}, {0, 1, 0, 0}, {0, 1, 1, 0}, {0, 0, 1, 0}, {0, 0, 1, 1}, {0, 0, 0, 1}, {1, 0, 0, 1}};
  int stepIndex = 0;
  int in1, in2, in3, in4;

public:
  Stepper28BYJ(int a, int b, int c, int d)
      : in1(a), in2(b), in3(c), in4(d) {}
  void begin()
  {
    pinMode(in1, OUTPUT);
    pinMode(in2, OUTPUT);
    pinMode(in3, OUTPUT);
    pinMode(in4, OUTPUT);
    stop();
  }
  void stop()
  {
    digitalWrite(in1, LOW);
    digitalWrite(in2, LOW);
    digitalWrite(in3, LOW);
    digitalWrite(in4, LOW);
  }
  void step(bool clockwise)
  {
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
const int LIGHT_ADJUST_STEPS = 4096;
const int MOTOR_STEP_DELAY_US = 800;
const unsigned long LIGHT_ADJUST_INTERVAL_MS = 1000;
unsigned long lastLightAdjustTime = 0;

// -------- Grow light PWM --------
const int ledChannel = 0, ledFreq = 5000, ledResolution = 8;

// -------- Dosing states --------
enum PpmDosingState
{
  PPM_IDLE,
  PPM_DOSING_A,
  PPM_DELAYING,
  PPM_DOSING_B
};
enum PhDosingState
{
  PH_IDLE,
  PH_DOSING_UP,
  PH_DOSING_DOWN
};
PpmDosingState ppmState = PPM_IDLE;
PhDosingState phState = PH_IDLE;

unsigned long ppmStateChangeTime = 0, phStateChangeTime = 0;
unsigned long dosingDuration = 2000, delayDuration = 2000;

// -------- Global Lockout --------
unsigned long globalLockoutUntil = 0;
bool isLockedOut() { return millis() < globalLockoutUntil; }
unsigned long lockoutRemaining() { return isLockedOut() ? (globalLockoutUntil - millis()) : 0; }

// -------- Cached raw readings for logs --------
static int lastWaterADC = 0;
static long lastPhSum = 0;
static float lastPhAvg = 0;
static float lastPhVolt = 0;
static float lastPhValue = 0;
static long lastPpmSum = 0;
static float lastPpmVolt = 0;
static float lastPpmVal = 0;

// Forward declarations
void sendConfigPage(WiFiClient &client);
void sendScanLoadingPage(WiFiClient &client);
void handleWiFiScan(WiFiClient &client);
void handleWiFiConnect(WiFiClient &client);
void sendControlPage(WiFiClient &client);
bool loadCredentials();
void saveCredentials(String ssid, String password);
String urlDecode(String str);
void startConfigMode();
void clearCredentials();

// ===================================================
// Utility functions
// ===================================================
void stopAllPumps()
{
  digitalWrite(PH_UP_PUMP_PIN, LOW);
  digitalWrite(PH_DOWN_PUMP_PIN, LOW);
  digitalWrite(PPM_A_PUMP_PIN, LOW);
  digitalWrite(PPM_B_PUMP_PIN, LOW);
}

void controlGrowLight(int brightness)
{
  brightness = constrain(brightness, 0, 255);
  ledcWrite(ledChannel, brightness);
#if VERBOSE_LOG
  Serial.printf("[LIGHT] PWM: %d (0-255)\n", brightness);
#endif
}

void logHeaderCycle()
{
#if VERBOSE_LOG
  Serial.println();
  Serial.println(F("========== LOOP =========="));
  Serial.printf("[TIME] millis=%lu | WiFi=%s\n",
                millis(),
                (WiFi.status() == WL_CONNECTED ? "CONNECTED" : "NOT CONNECTED"));
  Serial.printf("[LOCKOUT] %s | remaining: %lu ms\n",
                isLockedOut() ? "ACTIVE" : "INACTIVE",
                lockoutRemaining());
#endif
}

// ===================================================
// Sensor reading
// ===================================================
void readDHT()
{
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (isnan(h))
  {
    h = 0;
  }
  if (isnan(t))
  {
    t = 0;
  }
  sensorData["temperature"] = t;
  sensorData["humidity"] = h;
  currentTempC = t;

#if VERBOSE_LOG
  Serial.printf("[DHT11] Temp: %.2f C | Humidity: %.2f %%\n", t, h);
#endif
}

void readUltrasonic()
{
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000); // 30 ms timeout
  float dist = duration * 0.034f / 2.0f;
  if (dist > 0 && dist < 400)
  {
    currentDistanceCm = dist;
    lastEchoDurationUs = duration;
  }
  sensorData["distance"] = currentDistanceCm;

#if VERBOSE_LOG
  Serial.printf("[ULTRASONIC] Duration: %ld us | Distance: %.2f cm\n", lastEchoDurationUs, currentDistanceCm);
#endif
}

void readPpmSensor()
{
  long sum = 0;
  for (int i = 0; i < 10; i++)
  {
    sum += analogRead(PPM_SENSOR_PIN);
    delay(10);
  }
  float avg = (sum / 10.0f);
  float v = avg * 3.3f / 4096.0f;
  float ppm = 420.0f * v;
  float comp = 1.0f + 0.02f * (currentTempC - 25.0f);
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

void readPhSensor()
{
  const int N = 30;
  long sum = 0;
  for (int i = 0; i < N; i++)
  {
    sum += analogRead(PH_SENSOR_PIN);
    delay(10);
  }
  float avg = sum / (float)N;
  float v = avg * 3.3f / 4095.0f; // ESP32 ADC -> volts

  // --- Jonathan's 5–9 pH local calibration ---
  const float m = -9.76f; // slope  (pH per V)
  const float b = 19.45f; // intercept
  float ph = m * v + b;

  // Clamp to a reasonable plant range
  ph = constrain(ph, 4.5f, 9.5f);

  sensorData["ph"] = ph;

  lastPhSum = sum;
  lastPhAvg = avg;
  lastPhVolt = v;
  lastPhValue = ph;

#if VERBOSE_LOG
  Serial.printf("[pH] avgADC: %.1f | Volt: %.3f V | pH: %.2f\n", avg, v, ph);
#endif
}

void readWaterSensor()
{
  int val = analogRead(WATER_SENSOR_PIN);
  bool ok = val > WATER_THRESHOLD;
  sensorData["water_sufficient"] = ok;
  // sensorData["water_sufficient"] = true;
  lastWaterADC = val;

#if VERBOSE_LOG
  Serial.printf("[WATER] ADC: %d | threshold: %d | Sufficient: %s\n",
                val, WATER_THRESHOLD, ok ? "YES" : "NO");
#endif
}

// ===================================================
// Automatic light height control
// ===================================================
void adjustLightHeightAuto()
{
  if (millis() - lastLightAdjustTime < LIGHT_ADJUST_INTERVAL_MS)
    return;
  lastLightAdjustTime = millis();

  if (currentDistanceCm == 0.0f)
  {
#if VERBOSE_LOG
    Serial.println("[STEPPER] Skipped adjust: no valid distance yet");
#endif
    return;
  }

  if (currentDistanceCm < TARGET_MIN_CM)
  {
#if VERBOSE_LOG
    Serial.printf("[STEPPER] Too close (%.2f < %.2f): moving UP, %d steps\n",
                  currentDistanceCm, TARGET_MIN_CM, LIGHT_ADJUST_STEPS);
#endif
    for (int i = 0; i < LIGHT_ADJUST_STEPS; i++)
    {
      stepper.step(true);
      delayMicroseconds(MOTOR_STEP_DELAY_US);
    }
  }
  else if (currentDistanceCm > TARGET_MAX_CM)
  {
#if VERBOSE_LOG
    Serial.printf("[STEPPER] Too far (%.2f > %.2f): moving DOWN, %d steps\n",
                  currentDistanceCm, TARGET_MAX_CM, LIGHT_ADJUST_STEPS);
#endif
    for (int i = 0; i < LIGHT_ADJUST_STEPS; i++)
    {
      stepper.step(false);
      delayMicroseconds(MOTOR_STEP_DELAY_US);
    }
  }
  else
  {
    stepper.stop();
#if VERBOSE_LOG
    Serial.printf("[STEPPER] In range (%.2f within [%.2f, %.2f]): STOP\n",
                  currentDistanceCm, TARGET_MIN_CM, TARGET_MAX_CM);
#endif
  }
}

// ===================================================
// Web Server HTML Pages
// ===================================================
void sendConfigPage(WiFiClient &client)
{
  client.println("HTTP/1.1 200 OK");
  client.println("Content-type:text/html");
  client.println("Connection: close");
  client.println();

  client.println("<!DOCTYPE html><html>");
  client.println("<head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">");
  client.println("<style>");
  client.println("body { font-family: Arial; text-align: center; margin: 50px; }");
  client.println("h1 { color: #4CAF50; }");
  client.println("button { background-color: #4CAF50; color: white; padding: 15px 32px;");
  client.println("         text-align: center; font-size: 16px; margin: 10px; cursor: pointer;");
  client.println("         border: none; border-radius: 4px; }");
  client.println("button:hover { background-color: #45a049; }");
  client.println(".danger { background-color: #f44336; }");
  client.println(".danger:hover { background-color: #da190b; }");
  client.println("</style></head>");
  client.println("<body>");
  client.println("<h1>PlanterBox Configuration</h1>");
  client.println("<p>Click below to scan for available WiFi networks</p>");
  client.println("<button onclick=\"location.href='/scan'\">Scan WiFi Networks</button>");
  client.println("<br><br>");
  client.println("<button class=\"danger\" onclick=\"if(confirm('Clear saved WiFi credentials?')) location.href='/clear'\">Clear Saved WiFi</button>");
  client.println("</body></html>");
  client.println();
}

void sendScanLoadingPage(WiFiClient &client)
{
  client.println("HTTP/1.1 200 OK");
  client.println("Content-type:text/html");
  client.println("Connection: close");
  client.println();

  client.println("<!DOCTYPE html><html>");
  client.println("<head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">");
  client.println("<meta http-equiv=\"refresh\" content=\"3;url=/scan_results\">");
  client.println("<style>");
  client.println("body { font-family: Arial; text-align: center; margin: 50px; }");
  client.println("h1 { color: #4CAF50; }");
  client.println(".spinner { border: 8px solid #f3f3f3; border-top: 8px solid #4CAF50;");
  client.println("           border-radius: 50%; width: 60px; height: 60px;");
  client.println("           animation: spin 2s linear infinite; margin: 20px auto; }");
  client.println("@keyframes spin { 0% { transform: rotate(0deg); }");
  client.println("                 100% { transform: rotate(360deg); } }");
  client.println("</style></head>");
  client.println("<body>");
  client.println("<h1>Scanning WiFi Networks...</h1>");
  client.println("<div class=\"spinner\"></div>");
  client.println("<p>This will take a few seconds...</p>");
  client.println("</body></html>");
  client.println();
}

void handleWiFiScan(WiFiClient &client)
{
  Serial.println("Scanning WiFi networks...");
  int n = WiFi.scanNetworks();

  client.println("HTTP/1.1 200 OK");
  client.println("Content-type:text/html");
  client.println("Connection: close");
  client.println();

  client.println("<!DOCTYPE html><html>");
  client.println("<head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">");
  client.println("<style>");
  client.println("body { font-family: Arial; margin: 20px; }");
  client.println("h1 { color: #4CAF50; }");
  client.println(".network { background-color: #f9f9f9; padding: 15px; margin: 10px 0;");
  client.println("          border-radius: 5px; cursor: pointer; }");
  client.println(".network:hover { background-color: #e9e9e9; }");
  client.println("input[type=password] { width: 100%; padding: 12px; margin: 8px 0;");
  client.println("                      box-sizing: border-box; border-radius: 4px; border: 1px solid #ccc; }");
  client.println("button { background-color: #4CAF50; color: white; padding: 12px 24px;");
  client.println("        border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }");
  client.println("button:hover { background-color: #45a049; }");
  client.println("</style>");
  client.println("<script>");
  client.println("function selectNetwork(ssid) {");
  client.println("  document.getElementById('ssid').value = ssid;");
  client.println("  document.getElementById('password').focus();");
  client.println("}");
  client.println("function connect() {");
  client.println("  var ssid = document.getElementById('ssid').value;");
  client.println("  var pass = document.getElementById('password').value;");
  client.println("  if(ssid && pass) {");
  client.println("    window.location.href = '/connect?ssid=' + encodeURIComponent(ssid) + '&password=' + encodeURIComponent(pass);");
  client.println("  }");
  client.println("}");
  client.println("</script></head>");
  client.println("<body>");
  client.println("<h1>Available Networks</h1>");

  if (n == 0)
  {
    client.println("<p>No networks found</p>");
  }
  else
  {
    for (int i = 0; i < n; i++)
    {
      client.print("<div class=\"network\" onclick=\"selectNetwork('");
      client.print(WiFi.SSID(i));
      client.print("')\">");
      client.print("<strong>");
      client.print(WiFi.SSID(i));
      client.print("</strong> (");
      client.print(WiFi.RSSI(i));
      client.print(" dBm)");
      if (WiFi.encryptionType(i) != WIFI_AUTH_OPEN)
      {
        client.print(" [LOCKED]");
      }
      client.println("</div>");
    }
  }

  client.println("<h2>Connect to Network</h2>");
  client.println("<input type=\"text\" id=\"ssid\" placeholder=\"SSID\" readonly>");
  client.println("<input type=\"password\" id=\"password\" placeholder=\"Password\">");
  client.println("<button onclick=\"connect()\">Connect</button>");
  client.println("</body></html>");
  client.println();
}

void handleWiFiConnect(WiFiClient &client)
{
  int ssidStart = header.indexOf("ssid=") + 5;
  int ssidEnd = header.indexOf("&", ssidStart);
  int passStart = header.indexOf("password=") + 9;
  int passEnd = header.indexOf(" ", passStart);

  String ssid = urlDecode(header.substring(ssidStart, ssidEnd));
  String password = urlDecode(header.substring(passStart, passEnd));

  client.println("HTTP/1.1 200 OK");
  client.println("Content-type:text/html");
  client.println("Connection: close");
  client.println();

  client.println("<!DOCTYPE html><html>");
  client.println("<head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">");
  client.println("<style>");
  client.println("body { font-family: Arial; text-align: center; margin: 50px; }");
  client.println("h1 { color: #4CAF50; }");
  client.println("</style></head>");
  client.println("<body>");
  client.println("<h1>Connecting...</h1>");
  client.println("<p>Attempting to connect to: " + ssid + "</p>");
  client.println("<p>The device will restart if successful.</p>");
  client.println("</body></html>");
  client.println();

  // Save credentials and attempt connection
  saveCredentials(ssid, password);
  delay(1000);
  ESP.restart();
}

void sendControlPage(WiFiClient &client)
{
  // Read all sensors first
  sensorData.clear();
  readDHT();
  readUltrasonic();
  readPpmSensor();
  readPhSensor();
  readWaterSensor();

  client.println("HTTP/1.1 200 OK");
  client.println("Content-type:text/html");
  client.println("Connection: close");
  client.println();

  client.println("<!DOCTYPE html><html>");
  client.println("<head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">");
  client.println("<meta http-equiv=\"refresh\" content=\"5\">");
  client.println("<style>");
  client.println("body { font-family: Arial; margin: 20px; background-color: #f0f0f0; }");
  client.println("h1 { color: #4CAF50; text-align: center; }");
  client.println(".container { max-width: 800px; margin: 0 auto; }");
  client.println(".card { background-color: white; padding: 20px; margin: 10px 0;");
  client.println("       border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }");
  client.println(".sensor { display: flex; justify-content: space-between; padding: 10px 0; }");
  client.println(".value { font-weight: bold; color: #4CAF50; }");
  client.println("</style></head>");
  client.println("<body>");
  client.println("<div class=\"container\">");
  client.println("<h1>PlanterBox Control Panel</h1>");

  client.println("<div class=\"card\">");
  client.println("<h2>Sensor Readings</h2>");

  client.println("<div class=\"sensor\">");
  client.println("<span>Temperature:</span>");
  client.print("<span class=\"value\">");
  client.print(sensorData["temperature"].as<float>(), 1);
  client.println(" °C</span></div>");

  client.println("<div class=\"sensor\">");
  client.println("<span>Humidity:</span>");
  client.print("<span class=\"value\">");
  client.print(sensorData["humidity"].as<float>(), 1);
  client.println(" %</span></div>");

  client.println("<div class=\"sensor\">");
  client.println("<span>Distance:</span>");
  client.print("<span class=\"value\">");
  client.print(sensorData["distance"].as<float>(), 1);
  client.println(" cm</span></div>");

  client.println("<div class=\"sensor\">");
  client.println("<span>pH:</span>");
  client.print("<span class=\"value\">");
  client.print(sensorData["ph"].as<float>(), 2);
  client.println("</span></div>");

  client.println("<div class=\"sensor\">");
  client.println("<span>PPM:</span>");
  client.print("<span class=\"value\">");
  client.print(sensorData["ppm"].as<float>(), 0);
  client.println("</span></div>");

  client.println("<div class=\"sensor\">");
  client.println("<span>Water Detected:</span>");
  client.print("<span class=\"value\">");
  client.print(sensorData["water_sufficient"].as<bool>() ? "YES" : "NO");
  client.println("</span></div>");

  client.println("</div>");

  client.println("<div class=\"card\">");
  client.println("<h2>Connection Info</h2>");
  client.println("<div class=\"sensor\">");
  client.println("<span>WiFi SSID:</span>");
  client.print("<span class=\"value\">");
  client.print(WiFi.SSID());
  client.println("</span></div>");

  client.println("<div class=\"sensor\">");
  client.println("<span>IP Address:</span>");
  client.print("<span class=\"value\">");
  client.print(WiFi.localIP());
  client.println("</span></div>");

  client.println("<div class=\"sensor\">");
  client.println("<span>API Server:</span>");
  client.print("<span class=\"value\">");
  client.print(HOSTNAME);
  client.print(":");
  client.print(HTTP_PORT);
  client.println("</span></div>");

  client.println("</div>");

  client.println("<p style=\"text-align: center; color: #666; font-size: 12px;\">");
  client.println("Page auto-refreshes every 5 seconds</p>");

  client.println("</div>");
  client.println("</body></html>");
  client.println();
}

// ===================================================
// EEPROM credential management
// ===================================================
bool loadCredentials()
{
  Serial.println("[EEPROM] Attempting to load credentials...");
  EEPROM.begin(EEPROM_SIZE);

  byte valid = EEPROM.read(VALID_ADDR);
  Serial.print("[EEPROM] Valid byte at address ");
  Serial.print(VALID_ADDR);
  Serial.print(": 0x");
  Serial.println(valid, HEX);

  if (valid != 0xAA)
  {
    Serial.println("[EEPROM] No valid credentials found (valid byte != 0xAA)");
    EEPROM.end();
    return false;
  }

  // Read SSID
  stored_ssid = "";
  for (int i = 0; i < 100; i++)
  {
    char c = EEPROM.read(SSID_ADDR + i);
    if (c == 0)
      break; // Stop at null terminator
    stored_ssid += c;
  }

  // Read Password
  stored_password = "";
  for (int i = 0; i < 100; i++)
  {
    char c = EEPROM.read(PASS_ADDR + i);
    if (c == 0)
      break; // Stop at null terminator
    stored_password += c;
  }

  EEPROM.end();

  Serial.println("[EEPROM] Credentials loaded:");
  Serial.print("  SSID: '");
  Serial.print(stored_ssid);
  Serial.println("'");
  Serial.print("  SSID Length: ");
  Serial.println(stored_ssid.length());
  Serial.print("  Password Length: ");
  Serial.println(stored_password.length());

  // Validate the credentials are not empty
  if (stored_ssid.length() == 0)
  {
    Serial.println("[EEPROM] ERROR: SSID is empty!");
    return false;
  }

  return true;
}

void saveCredentials(String ssid, String password)
{
  Serial.println("[EEPROM] Saving credentials...");
  Serial.print("  SSID: '");
  Serial.print(ssid);
  Serial.println("'");
  Serial.print("  Password Length: ");
  Serial.println(password.length());

  EEPROM.begin(EEPROM_SIZE);

  // Clear the areas first
  for (int i = 0; i < 100; i++)
  {
    EEPROM.write(SSID_ADDR + i, 0);
    EEPROM.write(PASS_ADDR + i, 0);
  }

  // Write SSID
  for (int i = 0; i < ssid.length() && i < 99; i++)
  {
    EEPROM.write(SSID_ADDR + i, ssid[i]);
  }

  // Write Password
  for (int i = 0; i < password.length() && i < 99; i++)
  {
    EEPROM.write(PASS_ADDR + i, password[i]);
  }

  // Write valid marker
  EEPROM.write(VALID_ADDR, 0xAA);
  EEPROM.commit();
  EEPROM.end();

  Serial.println("[EEPROM] Credentials saved successfully");
}

void clearCredentials()
{
  Serial.println("[EEPROM] Clearing all credentials...");
  EEPROM.begin(EEPROM_SIZE);

  // Clear everything
  for (int i = 0; i < EEPROM_SIZE; i++)
  {
    EEPROM.write(i, 0);
  }

  EEPROM.commit();
  EEPROM.end();

  Serial.println("[EEPROM] Credentials cleared");
}

String urlDecode(String str)
{
  String decoded = "";
  char temp[] = "0x00";
  unsigned int len = str.length();
  unsigned int i = 0;

  while (i < len)
  {
    char decodedChar;
    char encodedChar = str.charAt(i++);

    if ((encodedChar == '%') && (i + 1 < len))
    {
      temp[2] = str.charAt(i++);
      temp[3] = str.charAt(i++);
      decodedChar = strtol(temp, NULL, 16);
    }
    else if (encodedChar == '+')
    {
      decodedChar = ' ';
    }
    else
    {
      decodedChar = encodedChar;
    }

    decoded += decodedChar;
  }

  return decoded;
}

void startConfigMode()
{
  Serial.println("[AP] Starting configuration mode...");

  // Disconnect from any existing WiFi first
  WiFi.disconnect(true);
  delay(100);

  WiFi.mode(WIFI_AP);

  // Configure AP with specific IP settings
  IPAddress local_IP(192, 168, 4, 1);
  IPAddress gateway(192, 168, 4, 1);
  IPAddress subnet(255, 255, 255, 0);

  WiFi.softAPConfig(local_IP, gateway, subnet);

  bool success = WiFi.softAP(ap_ssid, ap_password);

  if (success)
  {
    Serial.println("[AP] ✓ Access Point started successfully");
  }
  else
  {
    Serial.println("[AP] ✗ Failed to start Access Point");
  }

  IPAddress IP = WiFi.softAPIP();
  Serial.println("[AP] ========================================");
  Serial.print("[AP] SSID: ");
  Serial.println(ap_ssid);
  Serial.print("[AP] Password: ");
  Serial.println(ap_password);
  Serial.print("[AP] IP Address: ");
  Serial.println(IP);
  Serial.println("[AP] ========================================");
  Serial.println("[AP] INSTRUCTIONS:");
  Serial.println("[AP] 1. Connect your phone/laptop to WiFi:");
  Serial.println("[AP]    Network: planterbox_ap");
  Serial.println("[AP]    Password: 12345678");
  Serial.println("[AP] 2. Open browser and go to:");
  Serial.println("[AP]    http://192.168.4.1");
  Serial.println("[AP] ========================================");
}

// ===================================================
// Setup / Loop
// ===================================================
void setup()
{
  Serial.begin(115200);
  delay(1000); // Give serial time to stabilize
  Serial.println();
  Serial.println("=================================");
  Serial.println("[INIT] PlanterBox Starting...");
  Serial.println("=================================");

  // Initialize DHT sensor
  dht.begin();

  // Initialize ultrasonic
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  // Initialize LED
  pinMode(blueLED, OUTPUT);
  digitalWrite(blueLED, LOW);

  // Initialize pumps
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

  // Initialize stepper motor
  stepper.begin();

  // Initialize grow light PWM
  ledcSetup(ledChannel, ledFreq, ledResolution);
  ledcAttachPin(LIGHT_PIN, ledChannel);

  // Get MAC address
  String mac_address = WiFi.macAddress();
  Serial.print("[WiFi] MAC Address: ");
  Serial.println(mac_address);

  // Try to load saved credentials
  bool hasCredentials = loadCredentials();

  if (hasCredentials) // Starts wifi connection (NOT Access Point)
  {
    Serial.println("[WiFi] Found saved credentials, attempting to connect...");
    Serial.print("[WiFi] Connecting to: ");
    Serial.println(stored_ssid);

    WiFi.mode(WIFI_STA);
    WiFi.begin(stored_ssid.c_str(), stored_password.c_str());

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30)
    { // Increased to 30 attempts (15 seconds)
      delay(500);
      Serial.print(".");
      attempts++;

      // Print detailed status every 5 attempts
      if (attempts % 5 == 0)
      {
        Serial.println();
        Serial.print("[WiFi] Status: ");
        switch (WiFi.status())
        {
        case WL_IDLE_STATUS:
          Serial.println("IDLE");
          break;
        case WL_NO_SSID_AVAIL:
          Serial.println("NO SSID AVAILABLE");
          break;
        case WL_SCAN_COMPLETED:
          Serial.println("SCAN COMPLETED");
          break;
        case WL_CONNECTED:
          Serial.println("CONNECTED");
          break;
        case WL_CONNECT_FAILED:
          Serial.println("CONNECT FAILED");
          break;
        case WL_CONNECTION_LOST:
          Serial.println("CONNECTION LOST");
          break;
        case WL_DISCONNECTED:
          Serial.println("DISCONNECTED");
          break;
        default:
          Serial.println("UNKNOWN");
          break;
        }
      }
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED)
    {
      Serial.println("[WiFi] Successfully connected!");
      Serial.print("[WiFi] IP address: ");
      Serial.println(WiFi.localIP());
      Serial.print("[WiFi] Signal strength: ");
      Serial.print(WiFi.RSSI());
      Serial.println(" dBm");

      config_mode = false;
      digitalWrite(blueLED, HIGH);
    }
    else
    {
      Serial.println("[WiFi] Failed to connect to saved network");
      Serial.println("[WiFi] Possible reasons:");
      Serial.println("  - Wrong password");
      Serial.println("  - Network out of range");
      Serial.println("  - Network name changed");
      Serial.println("  - Router issues");
      Serial.println("[WiFi] Clearing credentials and starting config mode...");

      clearCredentials();
      config_mode = true;
    }
  }
  else
  {
    Serial.println("[WiFi] No saved credentials found");
    config_mode = true;
  }

  if (config_mode)
  {
    startConfigMode();
  }

  server.begin();
  Serial.println("[INIT] Web server started");
  Serial.println("[INIT] Setup complete!");
  Serial.println("=================================");
}

void loop()
{
  // Handle blue LED blinking when not connected
  if (!config_mode && WiFi.status() == WL_CONNECTED)
  {
    digitalWrite(blueLED, HIGH);
  }
  else // Starts Access Point if Wifi NOT connected
  {
    unsigned long currentMillis = millis();
    if (currentMillis - previousMillis >= blinkInterval)
    {
      previousMillis = currentMillis;
      ledState = !ledState;
      digitalWrite(blueLED, ledState ? HIGH : LOW);

      // In AP mode, print status every blink
      if (config_mode)
      {
        static uint8_t blinkCount = 0;
        blinkCount++;
        if (blinkCount >= 10)
        { // Every 5 seconds (10 blinks * 500ms)
          blinkCount = 0;
          Serial.println("[AP] Waiting for client connection...");
          Serial.print("[AP] Connected clients: ");
          Serial.println(WiFi.softAPgetStationNum());
          Serial.println("[AP] Access at: http://192.168.4.1");
        }
      }
    }
  }

  // Handle web server requests
  WiFiClient webClient = server.available();
  if (webClient)
  {
    Serial.println("[WEB] ========================================");
    Serial.println("[WEB] New client connected!");
    Serial.print("[WEB] Client IP: ");
    Serial.println(webClient.remoteIP());
    Serial.println("[WEB] ========================================");

    String currentLine = "";
    header = "";
    unsigned long timeout = millis() + 3000; // 3 second timeout

    while (webClient.connected() && millis() < timeout)
    {
      if (webClient.available())
      {
        char c = webClient.read();
        header += c;

        if (c == '\n')
        {
          if (currentLine.length() == 0)
          {
            Serial.print("[WEB] Request received: ");

            // Handle different requests
            if (header.indexOf("GET /clear") >= 0)
            {
              Serial.println("/clear");
              webClient.println("HTTP/1.1 200 OK");
              webClient.println("Content-type:text/html");
              webClient.println("Connection: close");
              webClient.println();
              webClient.println("<!DOCTYPE html><html><body>");
              webClient.println("<h1>Credentials Cleared</h1>");
              webClient.println("<p>Restarting...</p>");
              webClient.println("</body></html>");
              webClient.println();
              delay(1000);
              clearCredentials();
              ESP.restart();
            }
            else if (header.indexOf("GET /scan_results") >= 0)
            {
              Serial.println("/scan_results");
              handleWiFiScan(webClient);
            }
            else if (header.indexOf("GET /scan") >= 0)
            {
              Serial.println("/scan");
              sendScanLoadingPage(webClient);
            }
            else if (header.indexOf("GET /connect?") >= 0)
            {
              Serial.println("/connect");
              handleWiFiConnect(webClient);
            }
            else if (header.indexOf("GET /") >= 0)
            {
              Serial.println("/ (root)");
              if (config_mode)
              {
                sendConfigPage(webClient);
              }
              else
              {
                sendControlPage(webClient);
              }
            }
            else
            {
              Serial.println("UNKNOWN");
            }
            break;
          }
          else
          {
            currentLine = "";
          }
        }
        else if (c != '\r')
        {
          currentLine += c;
        }
      }
    }
    header = "";
    webClient.stop();
    Serial.println("[WEB] Client disconnected");
    Serial.println("[WEB] ========================================");
  }

  // Operational mode - only run when connected to WiFi
  if (!config_mode && WiFi.status() == WL_CONNECTED)
  {
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

    // Send data to web server - FIXED: Using regular WiFiClient instead of WiFiClientSecure
    String payload;
    serializeJson(sensorData, payload);
#if VERBOSE_LOG
    Serial.print("[HTTP] Outgoing JSON: ");
    Serial.println(payload);
#endif

    WiFiClient client; // Changed from WiFiClientSecure
    HTTPClient http;

    String url = "http://"; // HTTP not HTTPS
    url += HOSTNAME;
    url += ":";
    url += String(HTTP_PORT);
    url += API_PATH;

    Serial.print("[HTTP] Connecting to: ");
    Serial.println(url);

    if (http.begin(client, url))
    {
      http.addHeader("Content-Type", "application/json");
      int code = http.POST(payload);
      String resp = http.getString();

#if VERBOSE_LOG
      Serial.printf("[HTTP] POST code: %d\n", code);
      Serial.println("[HTTP] Server response:");
      Serial.println(resp);
#endif

      if (code > 0)
      {
        StaticJsonDocument<256> doc;
        DeserializationError err = deserializeJson(doc, resp);
        if (!err)
        {
          int light = doc["light"] | 0;
          bool phUp = doc["ph_up_pump"] | false;
          bool phDn = doc["ph_down_pump"] | false;
          bool ppmA = doc["ppm_a_pump"] | false;
          bool ppmB = doc["ppm_b_pump"] | false;
          unsigned long lockoutMs = doc["lockout_ms"] | 120000UL;

#if VERBOSE_LOG
          Serial.printf("[CMD] light=%d, ph_up=%d, ph_down=%d, ppm_a=%d, ppm_b=%d, lockout_hint=%lu ms\n",
                        light, phUp, phDn, ppmA, ppmB, lockoutMs);
#endif

          // Apply light immediately
          controlGrowLight(light);

          // Respect local lockout for NEW starts (existing sequences continue)
          if (!isLockedOut())
          {
            if (phUp && phState == PH_IDLE)
            {
              phState = PH_DOSING_UP;
              phStateChangeTime = millis();
              digitalWrite(PH_UP_PUMP_PIN, HIGH);
              globalLockoutUntil = millis() + lockoutMs;
#if VERBOSE_LOG
              Serial.printf("[pH] UP START | lockout until %lu (in %lu ms)\n", globalLockoutUntil, lockoutRemaining());
#endif
            }
            else if (phDn && phState == PH_IDLE)
            {
              phState = PH_DOSING_DOWN;
              phStateChangeTime = millis();
              digitalWrite(PH_DOWN_PUMP_PIN, HIGH);
              globalLockoutUntil = millis() + lockoutMs;
#if VERBOSE_LOG
              Serial.printf("[pH] DOWN START | lockout until %lu (in %lu ms)\n", globalLockoutUntil, lockoutRemaining());
#endif
            }
            else if (ppmA && ppmB && ppmState == PPM_IDLE)
            {
              ppmState = PPM_DOSING_A;
              ppmStateChangeTime = millis();
              digitalWrite(PPM_A_PUMP_PIN, HIGH);
              globalLockoutUntil = millis() + dosingDuration + delayDuration + dosingDuration + lockoutMs;
#if VERBOSE_LOG
              Serial.printf("[PPM] A START | lockout until %lu (in %lu ms)\n", globalLockoutUntil, lockoutRemaining());
#endif
            }
            else
            {
#if VERBOSE_LOG
              Serial.println("[CMD] No new dosing started (either cmd false or state busy).");
#endif
            }
          }
          else
          {
#if VERBOSE_LOG
            Serial.printf("[LOCKOUT] Active; ignoring new starts. Remaining: %lu ms\n", lockoutRemaining());
#endif
          }
        }
        else
        {
#if VERBOSE_LOG
          Serial.print("[JSON] Parse error: ");
          Serial.println(err.c_str());
#endif
        }
      }
      else
      {
#if VERBOSE_LOG
        Serial.print("[HTTP] Request failed: ");
        Serial.println(http.errorToString(code));
#endif
      }

      http.end();
    }
    else
    {
#if VERBOSE_LOG
      Serial.println("[HTTP] begin() failed (bad URL or client).");
#endif
    }
  }

  delay(100);
}
