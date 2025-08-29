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

Step 1: Install the USB-to-UART Bridge VCP Driver
https://www.silabs.com/software-and-tools/usb-to-uart-bridge-vcp-drivers?tab=downloads
This driver allows your computer to recognize the ESP32 board and assign a COM port for communication.

Step 2: Set Up the PlatformIO Environment
Open your project in VS Code.
Ensure you have the PlatformIO extension installed.
Connect your ESP32 board to your computer with a micro-USB cable.
Open the platformio.ini file located in the root of your project. Add the following lines to tell PlatformIO which COM port to use and to set the correct baud rate for the Serial Monitor:

[env:upesy_wroom]
platform = espressif32
board = upesy_wroom
framework = arduino
upload_port = COM3
monitor_speed = 115200

The ESP32 code is located in the src/main.cpp file. This code connects the board to your Wi-Fi network and sends simulated sensor data to your Next.js server.

Update the variables in src/main.cpp with your Wi-Fi credentials and your computer's local IP address (this is the current main.cpp):

#include <WiFi.h>
#include <HTTPClient.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Your PC's IP address (check this using 'ipconfig' or 'ifconfig')
const char* serverName = "http://YOUR_PC_IP_ADDRESS:3000/api/sensordata"; 

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);

  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected to WiFi!");
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;

    http.begin(serverName);
    http.addHeader("Content-Type", "application/json");

    // Simulate a sensor payload with changing values
    float temp = random(200, 300) / 10.0;
    float humidity = random(600, 800) / 10.0;

    String payload = "{\"temperature\": " + String(temp) + ", \"humidity\": " + String(humidity) + "}";

    int httpResponseCode = http.POST(payload);

    if (httpResponseCode > 0) {
      String response = http.getString();
      Serial.println("Server response:");
      Serial.println(response);
    } else {
      Serial.print("POST failed. Code: ");
      Serial.println(httpResponseCode);
    }

    http.end();
  }
  delay(5000); // Wait 5 seconds before sending again
}

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
