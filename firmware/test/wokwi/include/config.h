#pragma once

// Reuse CNC mechanics/pin definitions, then replace only simulator settings.
#include "../../../include/config.h"

#undef DEVICE_ID
#undef WIFI_SSID
#undef WIFI_PASSWORD
#undef MQTT_HOST
#undef MQTT_PORT
#undef MQTT_USER
#undef MQTT_PASSWORD
#undef PIN_LCD_SCL

#define DEVICE_ID "cnc01"
#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""
#define MQTT_HOST "host.wokwi.internal"
#ifndef WOKWI_MQTT_PORT
#define WOKWI_MQTT_PORT 1883
#endif
#define MQTT_PORT WOKWI_MQTT_PORT
#define MQTT_USER "user1"
#define MQTT_PASSWORD "1"
// Original GPIO11 is UART TX. Reserve it for serial monitoring in this circuit.
#define PIN_LCD_SCL 7

// The web accepts at most 8000 operations. Keep 48 KB available for Wi-Fi
// instead of reserving another 4000 unused JobOp entries on simulated C5.
#undef JOB_MAX_OPS
#define JOB_MAX_OPS 8000
