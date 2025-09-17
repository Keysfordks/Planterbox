This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Board Communication

To get started with the ESP32 and communicate with the website, you need to set up the necessary drivers and environment

**Step 1: Install the USB-to-UART Bridge VCP Driver.**

This driver allows your computer to recognize the ESP32 board and assign a COM port for communication: https://www.silabs.com/software-and-tools/usb-to-uart-bridge-vcp-drivers?tab=downloads

**Step 2: Set Up the PlatformIO Environment**

Open your project in VS Code, and ensure you have the PlatformIO extension installed.

Connect your ESP32 board to your computer with a micro-USB cable.

Open the platformio.ini file located in the root of your project. Add the following lines to tell PlatformIO which COM port to use and to set the correct baud rate for the Serial Monitor:

```bash
; PlatformIO Project Configuration File

[env:upesy_wroom]
platform = espressif32
board = upesy_wroom
framework = arduino
upload_port = COM3
monitor_speed = 115200

lib_deps =
    Adafruit Unified Sensor
    DHT sensor library
    ArduinoJson

```

The ESP32 code is located in the src/main.cpp file. This code connects the board to your Wi-Fi network and sends simulated sensor data to your Next.js server.

Update the variables in src/main.cpp with your Wi-Fi credentials and your computer's local IP address (this is the current main.cpp):

```bash
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <Adafruit_Sensor.h>
#include <ArduinoJson.h>

const char* ssid = "SockMnky";
const char* password = "04072024";

const char* serverName = "http://192.168.1.203:3000/api/sensordata"; // Your PC's IP

// Define pin for the DHT11
#define DHTPIN 4
#define DHTTYPE DHT11

// Define pins for the HC-SR04
#define TRIG_PIN 5
#define ECHO_PIN 18

// Define pin for the TDS sensor
#define TDS_SENSOR_PIN 34

// Define pin for the pH sensor
#define PH_SENSOR_PIN 33

// Define the grow light control pin
#define LIGHT_PIN 26

// Define the pump motor control pin
#define PUMP_PIN 25

// Define the built-in button for the light
#define LIGHT_BUTTON_PIN 0

// Define the new button for the pump
#define PUMP_BUTTON_PIN 27

// PWM settings for the grow light
const int ledChannel = 0;
const int ledFreq = 5000;
const int ledResolution = 8;

DHT dht(DHTPIN, DHTTYPE);
StaticJsonDocument<200> sensorData;

// Global variable to store temperature for TDS compensation
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

// Function to read HC-SR04 sensor data
void readUltrasonic() {
  long duration;
  float distanceCm;

  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration == 0) {
    distanceCm = 0.0;
    Serial.println("No echo from HC-SR04");
  } else {
    distanceCm = (duration * 0.0343) / 2;
  }

  sensorData["distance"] = distanceCm;
}

// Function to read TDS sensor data
void readTdsSensor() {
  long sumAnalogValue = 0;
  for (int i = 0; i < 10; i++) {
    sumAnalogValue += analogRead(TDS_SENSOR_PIN);
    delay(10);
  }
  float avgAnalogValue = (float)sumAnalogValue / 10.0;

  float voltage = avgAnalogValue * 3.3 / 4096.0;

  float tdsValue = 640 * voltage;

  if (currentTempC > 0.0) {
    float compensationCoefficient = 1.0 + 0.02 * (currentTempC - 25.0);
    tdsValue = tdsValue / compensationCoefficient;
  }

  sensorData["tds"] = tdsValue;
}

// Function to read pH sensor data
void readPhSensor() {
  // Take multiple readings to smooth noise
  long sumAnalog = 0;
  const int numSamples = 10;
  for (int i = 0; i < numSamples; i++) {
    sumAnalog += analogRead(PH_SENSOR_PIN);
    delay(5);
  }
  float avgAnalog = sumAnalog / (float)numSamples;

  // Convert ADC value to voltage (ESP32 ADC is 12-bit by default)
  float voltage = avgAnalog * 3.3 / 4096.0;

  // Convert voltage to pH
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

// Function to control the pump motor
void controlPumpMotor(bool on) {
  if (on) {
    digitalWrite(PUMP_PIN, HIGH);
    Serial.println("Pump Motor ON");
  } else {
    digitalWrite(PUMP_PIN, LOW);
    Serial.println("Pump Motor OFF");
  }
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

  ledcSetup(ledChannel, ledFreq, ledResolution);
  ledcAttachPin(LIGHT_PIN, ledChannel);

  pinMode(PUMP_PIN, OUTPUT);
  digitalWrite(PUMP_PIN, LOW);

  pinMode(LIGHT_BUTTON_PIN, INPUT_PULLUP);
  pinMode(PUMP_BUTTON_PIN, INPUT_PULLUP);

  randomSeed(analogRead(0));
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    sensorData.clear();

    readDHT();
    readUltrasonic();
    readTdsSensor();
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
        bool pumpCommand = doc["pump"] | false;
        bool lightCommand = doc["light"] | false;

        // Apply commands from server
        controlPumpMotor(pumpCommand);
        controlGrowLight(lightCommand ? 255 : 0);
      }
    } else {
      Serial.print("POST failed. Code: ");
      Serial.println(httpResponseCode);
    }
    http.end();
  }

  delay(5000); // update every 5s
}

```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
