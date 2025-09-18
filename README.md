# PlanterBox
Our Automated Plant Care System will
utilize sensors for various metrics (pH,
Humidity, Temp, Water, Lighting) and
automates their values to provide optimal
care in a Hydroponic, Indoor planter box
system
## Web Application
This is a [Next.js](https://nextjs.org) project, this framework is created by [Vercel](https://vercel.com/), and will be used for building React-based web applications with server-sided and static rendering. The framework provides components and tools for streamlined development, like image optimization. 

### Pre-Requisites
*This project assumes you have an understanding of React, JavaScript, HTML, and CSS.*
- [Node.js](https://nodejs.org/en/) - Is a free, open-source, cross-platform JavaScript runtime environment that lets developers create servers, web apps, command line tools and scripts.
- The Node installation also installs NPM ([Node Page Manager](https://www.npmjs.com/))
### **Setup Steps:** 
1. Install packages from package.json. `npm install`.
2. Run `npm run dev` to start the local development server.
3. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Technologies Used:
- **Websockets**: A computer communications protocol that enable real-time, two-way communication between a client and a server over a single TCP connection
- **React**: Frontend JavaScript library for building user interfaces
- **Next.js**: Is an open-source web development framework created by the private company Vercel providing React-based web applications with server-side rendering and static website generation
- **CSS**: Styling language used for designing the webpage
- **HTML**: Markup language for structuring the content
- **Node.js and npm**: Environment and package manager for running and managing dependencies
## Board Communication

To get started with the ESP32 and communicate with the website, you need to set up the necessary drivers and environment

**Step 1: Install the USB-to-UART Bridge VCP Driver.**

This driver allows your computer to recognize the ESP32 board and assign a COM port for communication: https://www.silabs.com/software-and-tools/usb-to-uart-bridge-vcp-drivers?tab=downloads

**Step 2: Set Up the PlatformIO Environment**

Open your project in VS Code, and ensure you have the PlatformIO extension installed.

Connect your ESP32 board to your computer with a micro-USB cable.

The ESP32 code is located in the esp32-firmware folder, and must be opened with the platformIO extension. This code connects the board to your Wi-Fi network and sends simulated sensor data to your Next.js server.

Update the variables in src/main.cpp with your Wi-Fi credentials and your computer's local IP address


## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.