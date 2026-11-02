// Exercises extracted production functions across simulated resets; no real credentials.
#include <cstdint>
#include <cstring>
#include <iostream>
#include <map>
#include <string>

struct String : std::string {
  using std::string::string;
  String(const std::string &value) : std::string(value) {}
  bool isEmpty() const { return empty(); }
};
constexpr const char *WIFI_SSID = "factory-wifi", *WIFI_PASSWORD = "fixture-factory";
constexpr const char *MQTT_HOST = "old-broker.invalid", *MQTT_USER = "fixture-user", *MQTT_PASSWORD = "fixture-mqtt";
constexpr uint16_t MQTT_PORT = 1883;
constexpr const char *WIFI_AP_IP_STR = "192.168.4.1";
constexpr int DEFAULT_X_LIMIT = 230, DEFAULT_Y_LIMIT = 850;
constexpr int DEFAULT_PEN_UP_ANGLE = 110, DEFAULT_PEN_DOWN_ANGLE = 80;
constexpr int PIN_ACT_LED = 3, LOW = 0, WIFI_STA = 1, WL_CONNECTED = 3;
struct RuntimeConfig { String ssid, password, mqttHost, mqttUser, mqttPassword; uint16_t mqttPort = 1883; } cfg;
struct PreferencesStub {
  std::map<std::string, String> strings;
  std::map<std::string, double> numbers;
  int writes = 0;
  void begin(const char *, bool) {}
  String getString(const char *key, const char *fallback = "") { return strings.count(key) ? strings[key] : String(fallback); }
  double get(const char *key, double fallback) { return numbers.count(key) ? numbers[key] : fallback; }
  uint16_t getUShort(const char *key, uint16_t fallback) { return get(key, fallback); }
  uint8_t getUChar(const char *key, uint8_t fallback) { return get(key, fallback); }
  bool getBool(const char *key, bool fallback = false) { return get(key, fallback); }
  int getInt(const char *key, int fallback) { return get(key, fallback); }
  long getLong(const char *key, long fallback) { return get(key, fallback); }
  float getFloat(const char *key, float fallback) { return get(key, fallback); }
  size_t putString(const char *key, const String &value) { strings[key] = value; ++writes; return value.size(); }
  size_t putUShort(const char *key, uint16_t value) { numbers[key] = value; ++writes; return 2; }
  size_t putBool(const char *key, bool value) { numbers[key] = value; ++writes; return 1; }
  void remove(const char *key) { strings.erase(key); numbers.erase(key); ++writes; }
} prefs;
struct SerialStub {
  template<class... T> void printf(T...) {}
  template<class... T> void print(T...) {}
  template<class... T> void println(T...) {}
} Serial;
uint32_t nowMs = 1000, restartAt = 0, lastStatus = 0, lastReconnect = 0, lastActivity = 0, lastLcdUpdate = 0, actLedUntil = 0;
uint32_t millis() { return nowMs; }
void delay(uint32_t duration) { nowMs += duration; }
struct WiFiStub {
  int begins = 0;
  String ssid, password;
  void mode(int) {}
  void begin(const char *network, const char *secret) { ++begins; ssid = network; password = secret; }
  int status() { return WL_CONNECTED; }
  void reconnect() {}
  struct Address { String toString() { return "192.0.2.2"; } };
  Address localIP() { return {}; }
} WiFi;
struct MqttStub { int loops = 0; bool connected() { return true; } void loop() { ++loops; } } mqtt;
struct EspStub { int restarts = 0; void restart() { ++restarts; } } ESP;
struct DnsStub { void processNextRequest() {} } dnsServer;
struct ServerStub { void handleClient() {} } configServer;
bool configMode = false, restartPending = false, calibrated = false, measuredCalibration = false;
bool penDownState = false, motorsEnabled = false, stopRequested = false;
String jobState = "idle";
int penUpAngle = 110, penDownAngle = 80, jobRuns = 0;
int32_t xMin = 0, xMax = 230, yMin = 0, yMax = 850;
float axisScaleX = 1, axisScaleY = 1;
void lcdPrintLines(const char *, const char *) {}
void triggerActLed(int) {}
void setPen(bool down, int = 110) { penDownState = down; }
void enableMotors(bool enabled) { motorsEnabled = enabled; }
void publishStatus(bool = true) {}
void connectMqtt() {}
void runJob() { ++jobRuns; }
void updateLcdDisplay() {}
void digitalWrite(int, int) {}
#include "network_under_test.inc"

bool reboot() {
  cfg = {}; WiFi = {}; restartPending = false; configMode = false;
  loadConfig();
  const bool connected = connectWiFi();
  configMode = !connected;
  return connected;
}

int main() {
  int failures = 0;
  auto check = [&](bool ok, const char *name) {
    std::cout << (ok ? "PASS " : "FAIL ") << name << '\n'; failures += !ok;
  };
  check(reboot() && cfg.ssid == WIFI_SSID && cfg.mqttHost == MQTT_HOST,
        "first boot uses compiled defaults when NVS has no network");

  cfg = {"new-wifi", "fixture-new", "new-broker.invalid", "new-user", "fixture-new-mqtt", 2883};
  saveConfig();
  const int writes = prefs.writes;
  check(reboot() && cfg.ssid == "new-wifi" && cfg.password == "fixture-new" &&
        cfg.mqttHost == "new-broker.invalid" && cfg.mqttPort == 2883 &&
        cfg.mqttUser == "new-user" && cfg.mqttPassword == "fixture-new-mqtt" && prefs.writes == writes,
        "saved Wi-Fi and broker survive reboot without being overwritten by defaults");

  // Start with an active connection/job and request configuration through the real MQTT branch.
  jobState = "run"; penDownState = true; motorsEnabled = true;
  requestConfigUnderTest();
  check(restartPending && stopRequested && !penDownState && !motorsEnabled && jobState == "stop",
        "online configuration request stops motion and lifts the pen before restart");
  const int previousJobRuns = jobRuns, previousMqttLoops = mqtt.loops;
  nowMs = restartAt - 1;
  loop();
  check(jobRuns == previousJobRuns && mqtt.loops == previousMqttLoops && ESP.restarts == 0,
        "restart wait does not run jobs or accept more MQTT commands");
  nowMs = restartAt;
  loop();
  check(ESP.restarts == 1 && jobRuns == previousJobRuns && mqtt.loops == previousMqttLoops,
        "requested restart fires without processing further commands");

  check(!reboot() && WiFi.begins == 0 && cfg.ssid == "new-wifi" && cfg.mqttHost == "new-broker.invalid",
        "reboot enters AP even while old Wi-Fi is available and keeps saved form values");
  check(!reboot() && WiFi.begins == 0,
        "power cycling before saving stays in configuration mode");

  cfg = {"third-wifi", "fixture-third", "third-broker.invalid", "third-user", "fixture-third-mqtt", 1884};
  saveConfig();
  check(reboot() && WiFi.begins == 1 && WiFi.ssid == "third-wifi" && WiFi.password == "fixture-third" &&
        cfg.mqttHost == "third-broker.invalid" && cfg.mqttPort == 1884 && cfg.mqttUser == "third-user" &&
        cfg.mqttPassword == "fixture-third-mqtt",
        "saving from AP reconnects using the new Wi-Fi and broker");
  requestConfigUnderTest();
  check(!reboot(), "can enter AP again after connecting to the new network");
  cfg.mqttHost = "broker-only.invalid"; cfg.mqttPort = 1885;
  saveConfig();
  check(reboot() && cfg.ssid == "third-wifi" && cfg.mqttHost == "broker-only.invalid" && cfg.mqttPort == 1885,
        "broker-only change preserves Wi-Fi and survives reboot");
  return failures ? 1 : 0;
}
