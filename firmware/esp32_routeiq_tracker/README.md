# CMR RouteIQ — ESP32 GPS Tracker Firmware

This directory contains the production-ready embedded firmware for the RouteIQ institutional fleet tracking hardware.

> [!CAUTION]
> **VERIFY POWER LABELS WITH A MULTIMETER BEFORE POWERING ON!**
> Do NOT connect the SIMCom A7670C modem directly to the ESP32 3.3V or 5V power rails. Cellular modems require up to 2A burst current during transmission and will cause severe brownouts or destroy the ESP32.
> Physical hardware status: **NOT TESTED PHYSICALLY**. The software and protocol integration are fully implemented.

---

## 📋 Required Hardware Components
1. **ESP32 DevKit V1** (ESP-WROOM-32, 30-pin or 38-pin)
2. **u-blox NEO-6M GPS Module** (GY-GPS6MV2 / HW-248) with external ceramic patch antenna
3. **SIMCom A7670C 4G LTE Development Board** (P/N: S2-10AGV-Z32X0) with micro-SIM card and LTE antenna
4. **LM2596 DC-DC Buck Step-Down Voltage Regulator Module**
5. Power supply (e.g., 9V–12V DC battery or external adapter)
6. *Optional:* HC-SR04 ultrasonic sensor (excluded from initial GPS tracking)

---

## 🔌 Hardware Wiring Diagram & Pinout

### 1. NEO-6M GPS to ESP32 (UART2)
| NEO-6M Pin | ESP32 Pin | Function | Notes |
|---|---|---|---|
| **VCC** | **5V or 3.3V** | Power | Verify whether breakout board has on-board 3.3V regulator (most GY-GPS6MV2 accept 3.3V–5V) |
| **GND** | **GND** | Ground | Common system ground |
| **TX** | **GPIO16 (RX2)** | Serial Data | GPS NMEA output → ESP32 Hardware Serial 2 RX |
| **RX** | **GPIO17 (TX2)** | Serial Data | ESP32 TX2 → GPS RX (Optional, used for UBX configuration) |

### 2. SIMCom A7670C Cellular Modem to ESP32 (UART1)
| A7670C Pin | ESP32 Pin | Function | Notes |
|---|---|---|---|
| **TXD** | **GPIO26 (RX)** | Serial Data | Modem AT response → ESP32 Serial 1 RX |
| **RXD** | **GPIO27 (TX)** | Serial Data | ESP32 TX → Modem AT command input (Use resistor divider if modem RX is strictly 3.3V logic) |
| **GND** | **GND** | Ground | **MANDATORY**: Must connect to common ground with ESP32 and LM2596 |
| **VCC / DC IN** | **LM2596 Output** | High-Current Power | **DO NOT connect to ESP32!** Power via adjusted LM2596 output (verify with multimeter) |

### 3. Power Architecture (LM2596 Buck Converter)
1. Connect DC input (e.g. 9V/12V battery) to **IN+** and **IN-** of the LM2596 module.
2. Disconnect all modules from the LM2596 output.
3. Power on the input and use a digital multimeter on **OUT+** and **OUT-**.
4. Turn the multi-turn trimmer potentiometer with a precision screwdriver until the output reads the voltage specified on your A7670C board (typically **4.0V–4.2V** for direct battery input, or **5.0V** for 5V DC barrel jack input).
5. Only connect the A7670C power once the voltage is confirmed stable.

---

## 💻 Arduino IDE Setup & Compilation

### Step 1: Install Required Libraries
Open Arduino IDE → **Tools** → **Manage Libraries...** and install:
- **TinyGPSPlus** by Mikal Hart (Version 1.0.3 or later)

### Step 2: Configure Vehicle & Network Settings
1. In this directory (`firmware/esp32_routeiq_tracker`), duplicate `config.example.h` and rename it to `config.h`:
   ```bash
   cp config.example.h config.h
   ```
2. Open `config.h` and configure:
   - `ROUTEIQ_BUS_ID`: e.g. `"TS-08-UB-4516"`
   - `ROUTEIQ_ROUTE_ID`: e.g. `"Route 16"`
   - `ROUTEIQ_SERVER_URL`: e.g. `"http://<YOUR_SERVER_IP>:3000/api/telemetry"`
   - `ROUTEIQ_DEVICE_TOKEN`: e.g. `"routeiq_hw_sec_9a748879b565b17c"`
   - `CELLULAR_APN`: e.g. `"airtelgprs.com"`, `"jionet"`, or your telecom provider's APN.

### Step 3: Board Selection
- **Board:** `ESP32 Dev Module`
- **Upload Speed:** `921600` or `115200`
- **CPU Frequency:** `240MHz (WiFi/BT)`
- **Flash Frequency:** `80MHz`
- **Partition Scheme:** `Default 4MB with spiffs (1.2MB APP/1.5MB SPIFFS)`
- **Port:** Select the COM port corresponding to your ESP32.

### Step 4: Upload Firmware
Click **Upload** (or press Ctrl+U). If the ESP32 fails to connect during uploading, press and hold the **BOOT** button on the ESP32 board until the flashing begins.

---

## 🔍 Serial Monitor & Diagnostics
Open **Tools** → **Serial Monitor** at **115200 baud**:
- `[GPS]`: Shows GPS sentences received, 3D lock status, latitude, longitude, speed, and satellites.
- `[MODEM]`: Shows SIMCom A7670C AT synchronization, network registration status, and signal quality.
- `[HTTP]`: Displays HTTPS POST telemetry status code (`HTTP 200 OK`) and transmission latency.
- `[QUEUE]`: Displays packet queue and buffer state during mobile network fluctuations.
