/**
 * ============================================================================
 * CMR RouteIQ — Institutional Bus GPS Telemetry Firmware
 * Target Microcontroller: ESP32 DevKit V1 (ESP-WROOM-32)
 * GPS Module:             u-blox NEO-6M (GY-GPS6MV2 / HW-248) on UART2 (GPIO16/17)
 * Cellular Modem:         SIMCom A7670C (4G LTE) on UART1 (GPIO26/27)
 * USB Serial Interface:   115200 Baud JSON Telemetry Stream to RouteIQ Web Serial
 * ============================================================================
 */

#if __has_include("config.h")
  #include "config.h"
#else
  #include "config.example.h"
  #warning "Using config.example.h! Please copy to config.h and customize settings."
#endif

#include <HardwareSerial.h>
#include <TinyGPSPlus.h>

// --- Serial Interfaces ---
// UART2 for NEO-6M GPS (GPS TX -> ESP32 GPIO16, GPS RX -> ESP32 GPIO17)
HardwareSerial SerialGPS(2);

// UART1 for A7670C LTE Modem (A7670C TXD -> ESP32 GPIO26, A7670C RXD -> ESP32 GPIO27)
HardwareSerial SerialModem(1);

TinyGPSPlus gps;

// --- Telemetry Packet Structure ---
struct TelemetryPacket {
  double latitude;
  double longitude;
  float speedKmh;
  float heading;
  uint8_t satellites;
  char fixStatus[24];
  float accuracy;
  char gpsTimestamp[32];
  bool valid;
};

// --- Circular Buffer Queue for Offline Telemetry Packets ---
#define QUEUE_CAPACITY 10
TelemetryPacket packetQueue[QUEUE_CAPACITY];
int queueHead = 0;
int queueTail = 0;
int queueCount = 0;

void enqueuePacket(const TelemetryPacket &pkt) {
  if (queueCount >= QUEUE_CAPACITY) {
    queueHead = (queueHead + 1) % QUEUE_CAPACITY;
    queueCount--;
  }
  packetQueue[queueTail] = pkt;
  queueTail = (queueTail + 1) % QUEUE_CAPACITY;
  queueCount++;
}

bool dequeuePacket(TelemetryPacket &pkt) {
  if (queueCount == 0) return false;
  pkt = packetQueue[queueHead];
  queueHead = (queueHead + 1) % QUEUE_CAPACITY;
  queueCount--;
  return true;
}

// --- Timing Variables ---
unsigned long lastUsbTelemetryMs = 0;
unsigned long lastCellularTransmissionMs = 0;
unsigned long lastModemCheckMs = 0;
int consecutiveFailures = 0;
unsigned long backoffDelayMs = 0;

// Modem connection state
bool modemReady = false;
bool pdpActive = false;

// --- Forward Declarations ---
void sendUsbSerialTelemetry();
void formatIsoTimestamp(char *buffer, size_t len);
bool sendATCommand(const String &cmd, const String &expectedResponse, unsigned long timeoutMs = 2000, String *outResponse = nullptr);
bool initModem();
bool setupCellularData();
bool sendTelemetryHTTP(const TelemetryPacket &pkt);
void checkNetworkHealth();

// ============================================================================
// Setup Routine
// ============================================================================
void setup() {
  // Initialize USB Serial (Communication with Laptop & RouteIQ Web Serial)
  Serial.begin(DEBUG_SERIAL_BAUD);
  delay(500);

  // Diagnostic Header (commented lines will not interfere with JSON parsing)
  Serial.println(F("# ========================================================"));
  Serial.println(F("# 🚌 CMR RouteIQ — ESP32 GPS Tracker Firmware Starting"));
  Serial.printf( F("# 📍 Bus: %s | Route: %s | Device: %s\n"), ROUTEIQ_BUS_ID, ROUTEIQ_ROUTE_ID, ROUTEIQ_DEVICE_ID);
  Serial.printf( F("# ⚡ USB Serial Stream Active at %d Baud\n"), DEBUG_SERIAL_BAUD);
  Serial.println(F("# ========================================================"));

  // Initialize NEO-6M GPS UART (Serial2: GPIO16 RX, GPIO17 TX)
  SerialGPS.begin(GPS_BAUD_RATE, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.printf("# [GPS] Serial2 initialized: RX=GPIO%d, TX=GPIO%d @ %d baud\n", GPS_RX_PIN, GPS_TX_PIN, GPS_BAUD_RATE);

#if ENABLE_CELLULAR
  // Initialize A7670C Modem UART (Serial1: GPIO26 RX, GPIO27 TX)
  SerialModem.begin(MODEM_BAUD_RATE, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  Serial.printf("# [CELLULAR] Initializing A7670C modem on GPIO%d/GPIO%d...\n", MODEM_RX_PIN, MODEM_TX_PIN);

  if (MODEM_RESET_PIN >= 0) {
    pinMode(MODEM_RESET_PIN, OUTPUT);
    digitalWrite(MODEM_RESET_PIN, LOW);
    delay(200);
    digitalWrite(MODEM_RESET_PIN, HIGH);
    delay(2000);
  }

  if (initModem()) {
    Serial.println(F("# [CELLULAR] ✅ A7670C registered on cellular network."));
    setupCellularData();
    modemReady = true;
  } else {
    Serial.println(F("# [CELLULAR] ⚠️ A7670C not responding. USB Serial continues unaffected."));
  }
#else
  Serial.println(F("# [MODE] USB Testing Mode Active (ENABLE_CELLULAR=false). Streaming GPS via USB."));
#endif

  Serial.println(F("# [READY] Listening for NEO-6M satellite lock..."));
}

// ============================================================================
// Main Execution Loop
// ============================================================================
void loop() {
  // 1. Process incoming NMEA bytes from NEO-6M GPS Module
  while (SerialGPS.available() > 0) {
    char c = SerialGPS.read();
    gps.encode(c);
  }

  unsigned long now = millis();

  // 2. Broadcast Real-Time JSON Telemetry to Laptop via USB Serial
  // Fired every USB_TELEMETRY_INTERVAL_MS (typically 1000ms)
  if (now - lastUsbTelemetryMs >= USB_TELEMETRY_INTERVAL_MS) {
    lastUsbTelemetryMs = now;
    sendUsbSerialTelemetry();
  }

#if ENABLE_CELLULAR
  // 3. Optional: Cellular LTE HTTP Telemetry Ingestion (When enabled)
  if (now - lastModemCheckMs > 30000) {
    lastModemCheckMs = now;
    checkNetworkHealth();
  }

  float currentSpeed = gps.speed.isValid() ? (float)gps.speed.kmph() : 0.0f;
  unsigned long activeInterval = (currentSpeed > SPEED_THRESHOLD_KMH) ? INTERVAL_MOVING_MS : INTERVAL_STATIONARY_MS;
  unsigned long effectiveInterval = activeInterval + backoffDelayMs;

  if (now - lastCellularTransmissionMs >= effectiveInterval) {
    lastCellularTransmissionMs = now;

    if (gps.location.isValid() && gps.location.age() < 2500 && gps.satellites.value() >= 3) {
      double lat = gps.location.lat();
      double lng = gps.location.lng();

      if (lat != 0.0 && lng != 0.0 && lat >= -90.0 && lat <= 90.0 && lng >= -180.0 && lng <= 180.0) {
        TelemetryPacket pkt;
        pkt.latitude = lat;
        pkt.longitude = lng;
        pkt.speedKmh = currentSpeed;
        pkt.heading = gps.course.isValid() ? (float)gps.course.deg() : 0.0f;
        pkt.satellites = (uint8_t)gps.satellites.value();
        pkt.accuracy = gps.hdop.isValid() ? (float)(gps.hdop.hdop() * 4.0f) : 5.0f;
        pkt.valid = true;
        strncpy(pkt.fixStatus, (pkt.satellites >= 6) ? "3D Fix" : "2D Fix", sizeof(pkt.fixStatus));
        formatIsoTimestamp(pkt.gpsTimestamp, sizeof(pkt.gpsTimestamp));

        if (!sendTelemetryHTTP(pkt)) {
          enqueuePacket(pkt);
          consecutiveFailures++;
          backoffDelayMs = min((unsigned long)(1000 * (1 << min(consecutiveFailures, 6))), 60000UL);
        } else {
          consecutiveFailures = 0;
          backoffDelayMs = 0;
          while (queueCount > 0) {
            TelemetryPacket queuedPkt;
            if (dequeuePacket(queuedPkt)) {
              sendTelemetryHTTP(queuedPkt);
              delay(500);
            }
          }
        }
      }
    }
  }
#endif
}

// ============================================================================
// USB Serial Telemetry Broadcaster (For RouteIQ Web Serial API)
// ============================================================================
void sendUsbSerialTelemetry() {
  bool hasValidLocation = gps.location.isValid() && 
                          gps.location.age() < 3000 &&
                          gps.location.lat() != 0.0 && 
                          gps.location.lng() != 0.0 &&
                          (gps.location.lat() >= -90.0 && gps.location.lat() <= 90.0) &&
                          (gps.location.lng() >= -180.0 && gps.location.lng() <= 180.0);

  int satellites = gps.satellites.isValid() ? gps.satellites.value() : 0;
  bool hasFix = hasValidLocation && (satellites >= 3);

  char isoTime[32];
  formatIsoTimestamp(isoTime, sizeof(isoTime));

  if (hasFix) {
    double lat = gps.location.lat();
    double lng = gps.location.lng();
    float speedKmh = gps.speed.isValid() ? (float)gps.speed.kmph() : 0.0f;
    float heading = gps.course.isValid() ? (float)gps.course.deg() : 0.0f;
    float accuracy = gps.hdop.isValid() ? (float)(gps.hdop.hdop() * 4.0f) : 4.5f;
    const char *fixStatus = (satellites >= 6) ? "3D Fix" : "2D Fix";

    // Format single-line JSON packet for RouteIQ Web Serial reader
    Serial.printf(
      "{\"deviceId\":\"%s\",\"busId\":\"%s\",\"routeId\":\"%s\",\"latitude\":%.6f,\"longitude\":%.6f,\"speed\":%.1f,\"heading\":%.1f,\"satellites\":%d,\"accuracy\":%.1f,\"gpsValid\":true,\"fixStatus\":\"%s\",\"timestamp\":\"%s\"}\n",
      ROUTEIQ_DEVICE_ID,
      ROUTEIQ_BUS_ID,
      ROUTEIQ_ROUTE_ID,
      lat,
      lng,
      speedKmh,
      heading,
      satellites,
      accuracy,
      fixStatus,
      isoTime
    );
  } else {
    // Report GPS searching / signal acquiring (DO NOT generate fake coordinates)
    const char *fixStatus = (satellites > 0) ? "ACQUIRING SATELLITES" : "GPS SIGNAL SEARCHING";

    Serial.printf(
      "{\"deviceId\":\"%s\",\"busId\":\"%s\",\"routeId\":\"%s\",\"latitude\":0.0,\"longitude\":0.0,\"speed\":0.0,\"heading\":0.0,\"satellites\":%d,\"accuracy\":0.0,\"gpsValid\":false,\"fixStatus\":\"%s\",\"timestamp\":\"%s\"}\n",
      ROUTEIQ_DEVICE_ID,
      ROUTEIQ_BUS_ID,
      ROUTEIQ_ROUTE_ID,
      satellites,
      fixStatus,
      isoTime
    );
  }
}

// ============================================================================
// Timestamp Formatter
// ============================================================================
void formatIsoTimestamp(char *buffer, size_t len) {
  if (gps.date.isValid() && gps.time.isValid() && gps.date.year() >= 2024) {
    snprintf(buffer, len, "%04d-%02d-%02dT%02d:%02d:%02d.000Z",
      gps.date.year(), gps.date.month(), gps.date.day(),
      gps.time.hour(), gps.time.minute(), gps.time.second());
  } else {
    unsigned long sec = millis() / 1000;
    snprintf(buffer, len, "UPTIME_%02lu:%02lu:%02lu", (sec / 3600), (sec % 3600) / 60, (sec % 60));
  }
}

#if ENABLE_CELLULAR
// ============================================================================
// SIMCom A7670C Cellular Routines
// ============================================================================
bool sendATCommand(const String &cmd, const String &expectedResponse, unsigned long timeoutMs, String *outResponse) {
  while (SerialModem.available()) SerialModem.read();

  if (cmd.length() > 0) {
    SerialModem.println(cmd);
  }

  String response = "";
  unsigned long start = millis();

  while (millis() - start < timeoutMs) {
    while (SerialModem.available()) {
      response += (char)SerialModem.read();
    }
    if (expectedResponse.length() > 0 && response.indexOf(expectedResponse) != -1) {
      if (outResponse) *outResponse = response;
      return true;
    }
    delay(10);
  }

  if (outResponse) *outResponse = response;
  return (expectedResponse.length() == 0);
}

bool initModem() {
  for (int i = 0; i < 4; i++) {
    if (sendATCommand("AT", "OK", 1000)) break;
    delay(400);
  }
  sendATCommand("ATE0", "OK", 1000);
  sendATCommand("AT+CMEE=2", "OK", 1000);

  String cpinRes;
  if (!sendATCommand("AT+CPIN?", "READY", 2500, &cpinRes)) {
    return false;
  }

  unsigned long regStart = millis();
  while (millis() - regStart < 15000) {
    String cregRes;
    sendATCommand("AT+CREG?", "OK", 2000, &cregRes);
    if (cregRes.indexOf(",1") != -1 || cregRes.indexOf(",5") != -1) {
      return true;
    }
    delay(1500);
  }
  return false;
}

bool setupCellularData() {
  sendATCommand("AT+CGATT=1", "OK", 5000);
  String cgdcontCmd = "AT+CGDCONT=1,\"IP\",\"" + String(CELLULAR_APN) + "\"";
  sendATCommand(cgdcontCmd, "OK", 2000);
  sendATCommand("AT+NETOPEN", "OK", 8000);
  pdpActive = true;
  return true;
}

bool sendTelemetryHTTP(const TelemetryPacket &pkt) {
  if (!pdpActive) {
    setupCellularData();
  }

  sendATCommand("AT+HTTPINIT", "OK", 2000);
  sendATCommand("AT+HTTPPARA=\"URL\",\"" + String(ROUTEIQ_SERVER_URL) + "\"", "OK", 2000);
  sendATCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"", "OK", 1000);

  char payload[384];
  snprintf(payload, sizeof(payload),
    "{\"busId\":\"%s\",\"routeId\":\"%s\",\"latitude\":%.6f,\"longitude\":%.6f,\"speed\":%.1f,\"heading\":%.1f,\"satellites\":%d,\"accuracy\":%.1f,\"fixStatus\":\"%s\",\"gpsTimestamp\":\"%s\"}",
    ROUTEIQ_BUS_ID, ROUTEIQ_ROUTE_ID, pkt.latitude, pkt.longitude, pkt.speedKmh, pkt.heading, pkt.satellites, pkt.accuracy, pkt.fixStatus, pkt.gpsTimestamp);

  int payloadLen = strlen(payload);
  String dataCmd = "AT+HTTPDATA=" + String(payloadLen) + ",5000";

  if (!sendATCommand(dataCmd, "DOWNLOAD", 3000)) {
    sendATCommand("AT+HTTPTERM", "OK", 1000);
    return false;
  }

  SerialModem.write(payload, payloadLen);
  delay(100);

  String actionRes;
  bool success = sendATCommand("AT+HTTPACTION=1", "+HTTPACTION: 1,200", 10000, &actionRes);
  sendATCommand("AT+HTTPTERM", "OK", 1000);
  return success;
}

void checkNetworkHealth() {
  String csqRes;
  sendATCommand("AT+CSQ", "OK", 1000, &csqRes);
}
#endif
