// Simulator-only adapter. The physical CNC source is included without editing it.
// Explicit includes let PlatformIO discover libraries used by the shared source.
#include <ArduinoJson.h>
#include <DHT.h>
#include "wokwi_dht.h"
#include <Preferences.h>
#include <PubSubClient.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <WiFi.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

#define DHT WokwiDHT
#define setup cncSetup
#include "../../../src/main.cpp"
#undef setup
#undef DHT

void setup() {
  // Wokwi C5's XTAL-backed LEDC produced 48 ms frames for a 50 Hz request.
  // Select RC_FAST before the shared CNC setup attaches the servo.
  // This clock choice applies only to the simulator build.
  ledcSetClockSource(LEDC_USE_RC_FAST_CLK);
  cncSetup();
}
