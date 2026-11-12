# CMR RouteIQ — Institutional Bus Tracking & Hardware Telemetry Integration

**Project:** CMR RouteIQ  
**Institution:** CMR Group of Institutions (CMRCET, CMREC, CMRIT)  
**Firebase Project ID:** `routeiq-d2104`  
**Local Development Server:** `http://localhost:3000/`  
**Deployment Status:** `NOT DEPLOYED` (Local workspace implementation only; no code pushed or published to production)  
**Hardware Verification Status:** `NOT TESTED PHYSICALLY` (Awaiting physical assembly and multimeter calibration by technician)

---

## 1. System Architecture

RouteIQ integrates physical IoT hardware mounted on institutional buses with a secure local Node.js gateway and Google Cloud Firestore to display real-time bus locations on the web dashboard map.

```
┌─────────────────────────────────┐
│ u-blox NEO-6M GPS Module       │
│ - External Ceramic Antenna      │
│ - 9600 Baud NMEA (UART2)        │
└───────────────┬─────────────────┘
                │ NMEA Sentences (GPIO16/17)
                ▼
┌─────────────────────────────────┐
│ ESP32 DevKit V1 (ESP-WROOM-32)  │
│ - TinyGPSPlus Parsing           │
│ - 10s Moving / 60s Stationary   │
│ - Circular Buffer Offline Queue │
│ - Token Authentication          │
└───────────────┬─────────────────┘
                │ AT HTTPS Commands (GPIO26/27)
                ▼
┌─────────────────────────────────┐
│ SIMCom A7670C 4G LTE Modem      │
│ - External Cellular Antenna     │
│ - Powered via LM2596 Buck Conv  │
└───────────────┬─────────────────┘
                │ HTTPS POST (TLS)
                ▼
┌─────────────────────────────────┐
│ RouteIQ Telemetry Endpoint      │
│ POST /api/telemetry             │
│ - Device Token Auth             │
│ - Coordinate Range Validation   │
│ - Rate Limiting (Min 3s)        │
│ - Anti-Replay Detection         │
│ - Firebase Admin SDK            │
└───────────────┬─────────────────┘
                │ Admin Batch Write
                ▼
┌─────────────────────────────────┐
│ Cloud Firestore (routeiq-d2104) │
│ - gps_locations/{busId}         │
│ - gps_locations/{busId}/history │
└───────────────┬─────────────────┘
                │ onSnapshot() Real-Time Stream
                ▼
┌─────────────────────────────────┐
│ RouteIQ Web Dashboard Map       │
│ - Live Bus Marker (Leaflet)     │
│ - Velocity, Satellites & Fix HUD│
│ - Online / Stale / Offline State│
│ - Stop-by-Stop Dynamic Arrival  │
└─────────────────────────────────┘
```

---

## 2. Hardware Wiring & Calibration Guide

> [!CAUTION]
> **CRITICAL PRE-FLIGHT REQUIREMENT: MULTIMETER CALIBRATION**
> Always disconnect the SIMCom A7670C module and measure the output voltage of the LM2596 buck converter with a digital multimeter before connecting power. Set the potentiometer to precisely the rated operating voltage of your A7670C board (typically 3.8 V – 4.2 V, or 5.0 V if using a 5 V carrier).
> 
> **NEVER power the A7670C from the ESP32 3.3V or 5V pins.** The cellular module draws high-current transmission bursts (up to 2 A) that will brown out or permanently damage the ESP32.

### Pinout Connection Table

| Subsystem | Peripheral Pin | ESP32 GPIO / Rail | Notes |
|---|---|---|---|
| **NEO-6M GPS** | VCC | 3.3V or 5.0V | Verify voltage marking on breakout board |
| | GND | GND | Common system ground |
| | TX | GPIO16 (RX2) | Serial2 hardware UART receive |
| | RX | GPIO17 (TX2) | Optional (for configuration commands) |
| **SIMCom A7670C** | VCC / VBAT | LM2596 Output (+) | Multimeter verified; dedicated high-current feed |
| | GND | LM2596 Output (-) & ESP32 GND | Common system ground |
| | TXD | GPIO26 (RX1) | Serial1 hardware UART receive |
| | RXD | GPIO27 (TX1) | Serial1 hardware UART transmit (use 3.3V divider if required) |
| | PWRKEY | Grounded or controlled pin | Pulse LOW for 1.5s if auto-power is not wired |
| **LM2596 Buck** | IN (+) | External Battery / DC Input | 9V – 24V bus power |
| | IN (-) | External Battery Ground | |
| | OUT (+) | A7670C VCC / VBAT | **Calibrate to 3.8V–4.2V (or 5.0V)** |
| | OUT (-) | A7670C GND & ESP32 GND | Must connect to ESP32 GND |
| **HC-SR04** | — | — | **Optional:** Excluded from initial GPS tracking implementation |

---

## 3. Cloud Firestore Database Schema

RouteIQ organizes telemetry into clean, scalable documents within Firestore:

### Most Recent Position: `gps_locations/{busId}`
Stores the current real-time state of each bus. When queried or listened to via `onSnapshot`, this delivers instant location packets to the web map:

```json
{
  "busId": "TS-08-UB-4516",
  "busPlate": "TS-08-UB-4516",
  "routeId": "Route 16",
  "latitude": 17.53852,
  "longitude": 78.49210,
  "speed": 34.5,
  "speed_kmh": 34.5,
  "heading": 142.0,
  "satellites": 8,
  "fixStatus": "3D Fix",
  "accuracy": 4.5,
  "status": "online",
  "source": "esp32-a7670c-hardware",
  "gpsTimestamp": "2026-10-27T06:15:30.000Z",
  "timestamp_ist": "11:45:30 AM IST",
  "updatedAt": "FieldValue.serverTimestamp()",
  "serverReceivedAt": "FieldValue.serverTimestamp()"
}
```

### Route Alias: `gps_locations/{routeId}`
An automatic alias document (`Route 16`, `Route 03`, etc.) is maintained simultaneously by the backend so that web clients subscribed by route ID receive updates instantly without extra client-side queries.

### Time-Series History: `gps_locations/{busId}/history/{historyId}`
Every telemetry point is appended as a distinct history document inside a subcollection:

```json
{
  "latitude": 17.53852,
  "longitude": 78.49210,
  "speed": 34.5,
  "heading": 142.0,
  "satellites": 8,
  "accuracy": 4.5,
  "gpsTimestamp": "2026-10-27T06:15:30.000Z",
  "serverTimestamp": "FieldValue.serverTimestamp()",
  "timestamp_ist": "11:45:30 AM IST"
}
```

### Historical Data Retention & Cleanup Strategy
To prevent uncontrolled database growth:
1. **Time-To-Live (TTL) Policy:** Configure Firestore TTL on the `gps_locations/{busId}/history` subcollection using the `serverTimestamp` field to automatically purge points older than 30 days.
2. **Scheduled Cloud Function:** Alternatively, deploy a scheduled maintenance function (`firebase-functions`) that deletes documents where `serverTimestamp < Date.now() - 30 * 86400000`.

---

## 4. Environment Variables & Security Configuration

Create a `.env` file or provide system environment variables for `server.js`:

| Variable | Required | Default | Description |
|---|---|---|---|
| `ROUTEIQ_DEVICE_TOKEN` | Yes | `routeiq_hw_sec_9a748879b565b17c` | Secret hardware authorization token shared between ESP32 firmware and backend |
| `PORT` | No | `3000` | Local HTTP development server port |
| `GOOGLE_APPLICATION_CREDENTIALS` | Recommended | `./routeiq-d2104-8599cf6363fd.json` | Path to Firebase Admin service account key |

> [!IMPORTANT]
> Never commit `config.h`, service account JSON keys, or `.env` to git. Both `config.h` and `firmware/**/config.h` are explicitly protected in [`.gitignore`](./.gitignore).

---

## 5. Required Firebase Console Setup

To complete the backend setup in your Firebase project `routeiq-d2104`:

1. **Publish Firestore Security Rules:**
   - Go to [Firebase Console > Firestore Database > Rules](https://console.firebase.google.com/project/routeiq-d2104/firestore/rules).
   - Copy the contents of [`firestore.rules`](./firestore.rules) into the editor.
   - Click **Publish**.

2. **Verify Service Account Key:**
   - Go to [Project Settings > Service Accounts](https://console.firebase.google.com/project/routeiq-d2104/settings/serviceaccounts/adminsdk).
   - Ensure a private key is downloaded and placed in the project root as `routeiq-d2104-8599cf6363fd.json` (or set `GOOGLE_APPLICATION_CREDENTIALS`).

3. **Verify Auth Configuration:**
   - Under [Authentication > Sign-in method](https://console.firebase.google.com/project/routeiq-d2104/authentication/providers), verify **Email/Password** is enabled.

---

## 6. Firmware Configuration & ESP32 Upload Guide

The ESP32 source code is located in [`firmware/esp32_routeiq_tracker/`](./firmware/esp32_routeiq_tracker/).

### Required Arduino IDE Libraries
Install via **Tools > Manage Libraries...**:
- `TinyGPSPlus` by Mikal Hart
- Built-in `HardwareSerial` and `WiFi` (included with the ESP32 board package)

### Step 1: Create `config.h`
In `firmware/esp32_routeiq_tracker/`, copy `config.example.h` to `config.h`:

```bash
## 6. Firmware Configuration & ESP32 Upload Guide

The ESP32 source code is located in [`firmware/esp32_routeiq_tracker/`](./firmware/esp32_routeiq_tracker/).

### Required Arduino IDE Libraries
Install via **Tools > Manage Libraries...**:
- `TinyGPSPlus` by Mikal Hart
- Built-in `HardwareSerial` (included with the ESP32 board package)

### Step 1: Configuration (`config.h`)
In `firmware/esp32_routeiq_tracker/`, [`config.h`](./firmware/esp32_routeiq_tracker/config.h) is pre-configured for your active vehicle:
```cpp
#define ROUTEIQ_DEVICE_ID       "ESP32_BUS_01"
#define ROUTEIQ_BUS_ID          "TS-08-UB-4516"
#define ROUTEIQ_ROUTE_ID        "Route 16"
#define ROUTEIQ_DEVICE_TOKEN    "routeiq_hw_sec_9a748879b565b17c"
#define ENABLE_CELLULAR         false   // Set to false for USB serial testing
#define USB_TELEMETRY_INTERVAL_MS 1000  // 1-second live streaming to USB
#define DEBUG_SERIAL_BAUD       115200
#define GPS_RX_PIN              16      // GPIO16 -> GPS TX (Orange wire)
#define GPS_TX_PIN              17      // GPIO17 -> GPS RX (Green wire)
#define GPS_BAUD_RATE           9600
```

### Step 2: Upload Firmware
1. Connect the ESP32 DevKit V1 to your laptop via USB cable.
2. In Arduino IDE:
   - **Board:** `DOIT ESP32 DEVKIT V1` (or `ESP32 Dev Module`)
   - **Upload Speed:** `921600` (or `115200`)
   - **Port:** Select your ESP32 COM port (e.g., `COM3` / `COM4`)
3. Hold the `BOOT` button on the ESP32 if `Connecting........` appears until uploading starts.
4. Close Arduino IDE Serial Monitor after flashing, so the COM port is free for the browser.

---

## 7. Web Serial Testing Workflow (USB Hardware Integration)

### Why did "HARDWARE DEVICE OFFLINE" appear originally?
When `index.html` loads, it listens to Cloud Firestore `gps_locations`. When the last packet stored for a bus is older than 120 seconds (`ageSeconds > 120`), it accurately displays:
`⚠️ HARDWARE DEVICE OFFLINE — Route 16 (TS-08-UB-4516) last seen at 12:04:39 pm IST. Showing last recorded location.`
Because the physical ESP32 was connected via USB but RouteIQ did not yet have a direct USB serial bridge to ingest packets and forward them to Firebase, no fresh packets were being sent to reset the offline timer.

### How to Connect & Test Real Hardware:
1. **Connect External GPS Antenna:**
   - In your uploaded hardware photos (Photo 4), the gold IPEX socket on the NEO-6M is empty.
   - Gently press and snap the gold U.FL connector of the square ceramic patch antenna (Photo 3) into the IPEX socket on the NEO-6M.
2. **Open RouteIQ in Google Chrome or Microsoft Edge:**
   - Navigate to `http://localhost:3000/`.
   - Go to **Live GPS Tracking**.
   - Ensure **🔌 HARDWARE MODE** is selected.
3. **Click "CONNECT HARDWARE":**
   - The browser will display the native Web Serial port picker.
   - Select your ESP32 device and click **Connect**.
   - Baud rate will automatically sync at `115200 baud`.
4. **Live Telemetry Stream:**
   - The status changes to `USB: Connected`, `Hardware: Online`.
   - If indoors without GPS lock, it displays: `🟡 GPS SIGNAL SEARCHING (0 Sats)`.
   - Place the antenna outdoors or near an open window: once locked, the red PPS LED pulses and the UI displays `🟢 3D Fix (8 Sats)`, coordinates, speed, and dynamically moves the bus marker on the map!
   - Every valid packet is automatically synchronized to Firebase Cloud Firestore.
5. **Disconnect Test:**
   - Click **🛑 DISCONNECT HARDWARE** or unplug the USB cable.
   - The UI immediately reports `USB: Disconnected`, `Hardware: Offline`, and displays the offline warning banner.

---

## 8. End-to-End Verification & Test Suite

Run the automated integration test suites locally:

```bash
# 1. Run Telemetry Endpoint & Validation Test Suite:
node test_telemetry_endpoint.js

# 2. Run Role-Based Access & Cockpit Test Suite:
node test_roles_and_cockpit_suite.js
```

---

## 9. Troubleshooting Guide

### 1. No GPS Fix (Satellites = 0, FixStatus = GPS SIGNAL SEARCHING)
- **Primary Cause:** Ceramic patch antenna is detached from the IPEX socket (observed in Photo 4).
- **Remedy:** Snap the ceramic antenna into the NEO-6M IPEX socket and place it outdoors facing the sky. Cold starts take 2–5 minutes to acquire an ephemeris almanac.

### 2. Browser Serial Port Permission Denied
- **Cause:** Arduino IDE Serial Monitor or another terminal application is holding the COM port open.
- **Remedy:** Close Arduino IDE Serial Monitor or PuTTY. A COM port can only be opened by one application at a time.

### 3. Web Serial API Not Supported
- **Remedy:** Use Google Chrome, Microsoft Edge, or Opera on Windows/Mac/Linux. Firefox and Safari do not support the Web Serial API.

### 4. API Ingestion Rejection (HTTP 401 / 400 / 429)
- **401 Unauthorized:** Ensure `ROUTEIQ_DEVICE_TOKEN` in `server.js` matches `config.h`.
- **400 Bad Request:** GPS sent `(0,0)` coordinates or `No Fix`. The backend rejects zero-coordinate packets to protect map accuracy.
- **429 Rate Limit:** ESP32 sent packets less than 3 seconds apart. The firmware is calibrated for 10s moving / 60s stationary.

### 5. Web Map Not Updating
- **Remedy:**
  - Check that the active route selected in the dropdown matches the route associated with the transmitting bus (`Route 16` for `TS-08-UB-4516`).
  - Open browser console (F12) to verify `🔥 Firestore onSnapshot (gps_locations)` is receiving snapshots.

