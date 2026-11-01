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
#define MQTT_PORT 1883
#define MQTT_USER "user1"
#define MQTT_PASSWORD "1"
// Original GPIO11 is UART TX. Reserve it for serial monitoring in this circuit.
#define PIN_LCD_SCL 7
