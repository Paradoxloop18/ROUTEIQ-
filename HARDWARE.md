# CMR RouteIQ — Hardware Architecture & Integration Guide

This document specifies the exact component identification, electrical connections, wiring plan, and power requirements for the CMR RouteIQ hardware tracking unit.

> [!CAUTION]
> **CRITICAL SAFETY DIRECTIVE: VERIFY POWER LABELS WITH A MULTIMETER BEFORE POWERING ON!**
> 1. Power the SIMCom A7670C **only** at the voltage required by its board input label/documentation using a dedicated power supply that can handle cellular current bursts (up to 2A peak).
> 2. **NEVER** power the A7670C cellular board from the ESP32 3.3V pin, ESP32 5V (VIN) pin, or breadboard power rail!
> 3. Configure the LM2596 buck converter output voltage using a digital multimeter **before** connecting the A7670C.
> 4. All modules must share a **common ground (GND)**.
> 5. **PHYSICAL HARDWARE STATUS: [NOT TESTED PHYSICALLY]** — The software and backend endpoints are complete; physical hardware connections must be executed and tested by the user.

---

## 🔍 1. Identified Hardware Components

| Component | Exact Model / Part Number | Key Specifications & Operating Voltages |
|---|---|---|
| **Microcontroller** | **ESP32 DevKit V1** (ESP-WROOM-32) | 3.3V logic level, Dual-core Xtensa 240MHz, 520KB SRAM, 3x UART, Micro-USB programming port. Powered via USB 5V or external 5V on VIN. |
| **GPS / GNSS Module** | **u-blox NEO-6M** (GY-GPS6MV2 / HW-248) | Operating voltage: 3.3V–5.0V (on-board 3.3V LDO regulator). 3.3V TTL UART logic, default baud rate 9600 bps. High-gain ceramic patch antenna. |
| **Cellular Modem** | **SIMCom A7670C** (P/N: S2-10AGV-Z32X0) | 4G LTE Cat-1 with 2G fallback, SIMCOM AT command set, SMA female antenna connector, standard micro-SIM slot. Supply: 3.4V–4.2V (VBAT direct) or 5.0V–12.0V via development board barrel jack / LM317 regulator. Peak current: ~2.0A during RF bursts. |
| **DC-DC Buck Converter** | **LM2596 Step-Down Module** (LM2596S - ADJ) | Input: 7V–35V DC (e.g. 9V battery or 12V vehicle battery). Output: 1.25V–30V adjustable via multi-turn potentiometer 103. Rated current: 2A continuous, 3A peak with heatsink. |
| **Optional Ultrasonic Sensor** | **HC-SR04** | Operating voltage: 5V DC. Optional obstacle/passenger detection sensor — **excluded from initial GPS tracking implementation** per system requirements. |

---

## 🔌 2. Wiring Plan & Interconnection Table

```
   +--------------------+          +--------------------+
   |   u-blox NEO-6M    |          |    ESP32 DevKit    |          +--------------------+
   |     GPS Module     |          |   Microcontroller  |          |   SIMCom A7670C    |
   |                    |          |                    |          |   4G LTE Modem     |
   |  TX  ------------->|=========>| GPIO16 (RX2)       |          |                    |
   |  RX  <-------------|----------| GPIO17 (TX2)       |          |                    |
   |  GND ------------->|--------->| GND           GND  |<---------| GND                |
   |  VCC <-------------|--+       | GPIO26 (RX1) <=====|<---------| TXD                |
   +--------------------+  |       | GPIO27 (TX1) ----->|==[R-DIV]=| RXD                |
                           |       +--------------------+          +--------------------+
                           |                  ^                              ^
                           |                  |                              |
             +5V / +3.3V --+                  | USB / 5V VIN                 | High Current Power
                                              |                              | (4.0V - 5.0V)
                                       +-------------+                       |
                                       | Common GND  |                       |
                                       +-------------+                       |
                                              ^                              |
                                              |                              |
                                      +---------------------------------------------+
                                      |          LM2596 DC-DC Buck Converter        |
                                      |   IN+: 9V-12V Battery / Vehicle Power       |
                                      |   IN-: Ground                               |
                                      |   OUT+: Tuned to A7670C required input      |
                                      |   OUT-: Ground (Common Ground)              |
                                      +---------------------------------------------+
```

### Table 1: NEO-6M GPS to ESP32
| NEO-6M Pin | ESP32 Pin | Logic Level | Connection Notes |
|---|---|---|---|
| **TX** | **GPIO16 (RX2)** | 3.3V | GPS NMEA serial output stream to ESP32 Hardware Serial 2 RX. |
| **RX** | **GPIO17 (TX2)** | 3.3V | Optional configuration pin; can be left unconnected for basic tracking. |
| **GND** | **GND** | 0V | Common system ground. |
| **VCC** | **3.3V or 5V** | 3.3V / 5V | Connect to ESP32 3.3V or 5V rail (the GY-GPS6MV2 has an on-board 3.3V LDO regulator). |

### Table 2: SIMCom A7670C Cellular Modem to ESP32
| A7670C Pin | ESP32 Pin | Logic Level | Connection Notes |
|---|---|---|---|
| **TXD** | **GPIO26 (RX1)** | 3.3V | Modem serial response to ESP32 Hardware Serial 1 RX. |
| **RXD** | **GPIO27 (TX1)** | 3.3V / 5V | ESP32 TX to modem RX. If the A7670C board is not confirmed 3.3V tolerant, use a voltage divider (1kΩ and 2kΩ resistors) or logic level shifter. |
| **GND** | **GND** | 0V | **MANDATORY**: Connect to common ground with ESP32 and LM2596. |
| **VCC / DC IN** | **LM2596 OUT+** | High Current | Connect **only** to the tuned output of the LM2596 buck converter. |

---

## ⚡ 3. Power Architecture & Multimeter Tuning Procedure

### LM2596 Pre-Flight Calibration Steps:
1. Connect your input power source (e.g. 9V battery or 12V supply) to the **IN+** and **IN-** terminals of the LM2596 module.
2. Ensure **NO** other components (especially the A7670C or ESP32) are connected to the LM2596 **OUT** terminals!
3. Power on the input power source.
4. Set your digital multimeter to **DC Volts (20V scale)**.
5. Place the black multimeter probe on **OUT-** and the red probe on **OUT+**.
6. Using a precision flathead screwdriver, turn the brass adjustment screw on the blue potentiometer (103):
   - Counter-clockwise turns decrease output voltage.
   - Clockwise turns increase output voltage.
7. Adjust until the multimeter reading is precisely:
   - **4.0V to 4.2V** if powering the A7670C via direct battery terminals (VBAT).
   - **5.0V** if powering the A7670C development board via the DC barrel jack or 5V input header.
8. Power off the system, make the connections to the A7670C, and re-verify voltage under idle conditions.

---

## 📡 4. Antenna Placement Guidelines
1. **NEO-6M GPS Antenna:** Place the square ceramic patch antenna horizontally facing upward with a clear, unobstructed view of the open sky (near a window or outside). GPS signals cannot penetrate concrete buildings or metal roofs.
2. **A7670C LTE Antenna:** Connect the external rod or patch LTE antenna to the SMA connector labeled "MAIN" or "LTE". Keep the cellular antenna at least 10 cm away from the GPS patch antenna to avoid RF noise interference.

---

## 📸 5. Visual Inspection of Uploaded Hardware Setup

Based on a forensic examination of your 4 uploaded photographs (`components/WhatsApp Image 2026-10-27 at 10.19.*`):

### 1. u-blox NEO-6M GPS Module (Photo 4)
- **Module Version:** `u-blox NEO-6M-0-001`, Board model `GPS6MV2. / HW-248`.
- **Wire Colors Connected to GPS Header:**
  - `VCC`: **Red Wire** → Connects to ESP32 3.3V / 5V rail.
  - `RX`: **Green Wire** → Connects to ESP32 **GPIO17 (TX2)**.
  - `TX`: **Orange Wire** → Connects to ESP32 **GPIO16 (RX2)**.
  - `GND`: **Yellow Wire** → Connects to ESP32 **GND**.
- ⚠️ **CRITICAL PHYSICAL ACTION REQUIRED (ANTENNA DETACHED):**
  In Photo 4, the gold U.FL / IPEX coaxial socket in the upper-left corner of the blue GPS board is **empty**. The square ceramic patch antenna (shown in Photo 3) is sitting detached on the table.
  **You must gently press and snap the gold U.FL connector of the ceramic patch antenna into the IPEX socket on the NEO-6M board.** Without this antenna connected, the GPS receiver cannot detect satellite radio signals, resulting in 0 satellites and `GPS SIGNAL SEARCHING`.

### 2. ESP32 DevKit V1 on Breadboard (Photo 2)
- **Microcontroller:** ESP32 DevKit V1 (ESP-WROOM-32, 30-pin variant).
- **USB Connection:** Connected to laptop via micro-USB cable (provides 5V power and serial data to RouteIQ).
- **Wiring Verification:**
  - Orange wire (GPS TX) connects to ESP32 GPIO16 (RX2).
  - Green wire (GPS RX) connects to ESP32 GPIO17 (TX2).
  - Resistor divider network (1kΩ / 2kΩ) is present on the breadboard rail for voltage shifting.

### 3. SIMCom A7670C & Power (Photo 3)
- **Modem:** SIMCom A7670C LTE Cat-1 board (P/N: `S2-10AGV-Z32X0`, IMEI: `863110084450058`).
- **Power State:** LM2596 buck converter and 9V transistor battery are currently unpowered/disconnected. This is completely safe and intentional for the initial USB-based integration stage.

### 4. HC-SR04 Ultrasonic Sensor (Photo 1)
- Ultrasonic sensor is disconnected on the table, which matches our design to keep the initial GPS tracking integration lightweight and reliable.

