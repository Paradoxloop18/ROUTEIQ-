/**
 * ============================================================================
 * RouteIQ ESP32 GPS Tracker — Configuration Example Template
 * ============================================================================
 * Copy this file to "config.h" and customize with your vehicle and APN settings.
 * ============================================================================
 */

#ifndef ROUTEIQ_CONFIG_H
#define ROUTEIQ_CONFIG_H

// --- Hardware Device & Vehicle Identity ---
#define ROUTEIQ_DEVICE_ID       "ESP32_BUS_01"
#define ROUTEIQ_BUS_ID          "TS-08-UB-4516"
#define ROUTEIQ_ROUTE_ID        "Route 16"
#define ROUTEIQ_DEVICE_TOKEN    "routeiq_hw_sec_9a748879b565b17c"

// --- Mode Configuration ---
// Set to false for USB-only serial testing with RouteIQ Web Serial.
// Set to true when external power (LM2596) and SIMCom A7670C modem are active.
#define ENABLE_CELLULAR         false

// USB Serial Telemetry Broadcast Interval (milliseconds)
#define USB_TELEMETRY_INTERVAL_MS 1000

// --- RouteIQ Backend Telemetry Server (For Cellular Mode) ---
#define ROUTEIQ_SERVER_URL      "http://192.168.1.100:3000/api/telemetry"

// --- Cellular Mobile Network (SIM Provider APN) ---
#define CELLULAR_APN            "airtelgprs.com" // or jionet / www / bsnlnet
#define CELLULAR_USER           ""
#define CELLULAR_PASS           ""

// --- Hardware Pin Definitions ---
// ESP32 to NEO-6M GPS Module (UART2)
#define GPS_RX_PIN              16    // ESP32 GPIO16 connects to GPS TX
#define GPS_TX_PIN              17    // ESP32 GPIO17 connects to GPS RX (optional)
#define GPS_BAUD_RATE           9600

// ESP32 to SIMCom A7670C Cellular Modem (UART1)
#define MODEM_RX_PIN            26    // ESP32 GPIO26 connects to A7670C TXD
#define MODEM_TX_PIN            27    // ESP32 GPIO27 connects to A7670C RXD
#define MODEM_BAUD_RATE         115200
#define MODEM_RESET_PIN         -1

// --- Telemetry Transmission Intervals (Cellular Mode) ---
#define INTERVAL_MOVING_MS      10000   // 10 seconds while moving (> 3 km/h)
#define INTERVAL_STATIONARY_MS  60000   // 60 seconds while stationary (<= 3 km/h)
#define SPEED_THRESHOLD_KMH     3.0f

// --- Serial Debug & USB Telemetry Baud Rate ---
#define DEBUG_SERIAL_BAUD       115200

#endif // ROUTEIQ_CONFIG_H
