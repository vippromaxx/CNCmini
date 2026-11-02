#include <algorithm>
#include <cstdint>
#include <iostream>
#include <string>
using std::min;
struct String : std::string {
  using std::string::string;
  String(const std::string &s) : std::string(s) {}
  String(uint32_t, int) : std::string("fixture-chip") {}
  bool isEmpty() const { return empty(); }
};
constexpr int HEX = 16, OUTPUT = 1, WIFI_STA = 1, WL_CONNECTED = 3;
constexpr int PIN_SERVO=8, PIN_X_STEP=4, PIN_X_DIR=5, PIN_X_EN=23, PIN_Y_STEP=24,
              PIN_Y_DIR=0, PIN_Y_EN=1, PIN_LED=6, PIN_ACT_LED=3, PIN_LCD_SDA=10,
              PIN_LCD_SCL=11, PIN_DHT=9, LCD_I2C_ADDR=0x27;
constexpr const char *WIFI_AP_IP_STR = "192.168.4.1", *DEVICE_ID = "fixture-cnc";
constexpr int MQTT_CONNECT_BAD_CREDENTIALS = 4, MQTT_CONNECT_UNAUTHORIZED = 5;
struct RuntimeConfig {
  String ssid="fixture-wifi", password="fixture-wifi-pass", mqttHost="192.0.2.10",
         mqttUser="fixture-device", mqttPassword="fixture-pass";
  uint16_t mqttPort = 1883;
} cfg;
uint32_t nowMs=0;
uint32_t millis() { return nowMs; }
void delay(uint32_t ms) { nowMs += ms; }
bool wifiWorks=true, failBuffer=false, configMode=false, lcdAvailable=false;
bool motorsEnabled=false, penDownState=false, bufferReady=true;
int penUpAngle=90, penDownAngle=71, successOnAttempt=1, failureCode=-2,
    publishes=0, apStarts=0;
uint32_t attemptDuration=0;
bool dropWifiDuringMqtt=false;
struct SerialStub {
  void begin(int) {}
  template<class... T> void printf(T...) {}
  template<class... T> void println(T...) {}
  template<class... T> void print(T...) {}
} Serial;
struct PreferencesStub {
  bool forceConfig=false;
  bool getBool(const char *, bool) { return forceConfig; }
} prefs;
struct WiFiStub {
  int begins=0;
  void mode(int) {}
  void begin(const char *, const char *) { ++begins; }
  int status() { return wifiWorks ? WL_CONNECTED : 0; }
  struct IP { String toString() { return "192.0.2.20"; } };
  IP localIP() { return {}; }
} WiFi;
struct ClientStub {
  uint32_t timeout=30000;
  int stops=0;
  void setConnectionTimeout(uint32_t value) { timeout=value; }
  void stop() { ++stops; }
} netClient;
struct MqttStub {
  bool live=false;
  int attempts=0, subscriptions=0, socketTimeout=15, lastState=-1;
  void setServer(const char *, uint16_t) {}
  bool setBufferSize(int) { return !failBuffer; }
  void setSocketTimeout(uint16_t value) { socketTimeout=value; }
  template<class T> void setCallback(T) {}
  bool connected() { return live; }
  bool connect(const char *,const char *,const char *,const char *,int,bool,const char *) {
    ++attempts;
    nowMs += attemptDuration;
    if (dropWifiDuringMqtt) wifiWorks=false;
    live = wifiWorks && successOnAttempt>0 && attempts>=successOnAttempt;
    lastState = live ? 0 : failureCode;
    return live;
  }
  bool subscribe(const char *, int) { ++subscriptions; return live; }
  int state() { return lastState; }
  void disconnect() { live=false; }
} mqtt;
struct EspStub { uint64_t getEfuseMac() { return 123; } } ESP;
struct WireStub { void begin(int,int) {} void beginTransmission(int) {} int endTransmission() { return 4; } } Wire;
struct LiquidCrystal_I2C {
  LiquidCrystal_I2C(int=0,int=0,int=0) {}
  void init() {} void backlight() {} void clear() {}
} lcd;
struct DhtStub { void begin() {} } dht;
void pinMode(int,int) {}
void ledcAttach(int,int,int) {}
void loadConfig() {}
bool prepareJobBuffer() { return bufferReady; }
void setPen(bool down,int) { penDownState=down; }
void enableMotors(bool enabled) { motorsEnabled=enabled; }
void lcdPrintLines(const char *,const char *) {}
void startConfigMode() { configMode=true; ++apStarts; }
void handleMqttMessage(char *,uint8_t *,unsigned int) {}
String mqttTopic(const char *topic) { return String("cnc/fixture-cnc/") + topic; }
void publishStatus() { ++publishes; }
#include "startup_under_test.inc"

void reset() {
  cfg={}; WiFi={}; mqtt={}; prefs={}; netClient={};
  nowMs=0; configMode=false; wifiWorks=true; failBuffer=false; bufferReady=true;
  motorsEnabled=true; penDownState=true; successOnAttempt=1; failureCode=-2;
  publishes=apStarts=0; attemptDuration=0; dropWifiDuringMqtt=false;
}
int main() {
  int failures=0;
  auto check=[&](bool ok,const char *name) { std::cout<<(ok?"PASS ":"FAIL ")<<name<<'\n'; failures+=!ok; };
  reset(); setup();
  check(!configMode && mqtt.connected() && mqtt.subscriptions>0 && publishes==1,
        "Wi-Fi plus accepted MQTT starts control and subscribes once");
  reset(); wifiWorks=false; setup();
  check(configMode && mqtt.attempts==0 && !motorsEnabled && !penDownState,
        "wrong Wi-Fi returns to AP without trying MQTT or enabling motion");
  reset(); successOnAttempt=0; failureCode=5; setup();
  check(configMode && mqtt.attempts==1 && !motorsEnabled && !penDownState && cfg.mqttUser=="fixture-device",
        "MQTT rejects credentials: return to AP immediately and keep saved fields");
  reset(); successOnAttempt=0; attemptDuration=3000; setup();
  check(configMode && mqtt.attempts>1 && nowMs>=30000 && nowMs<=37000,
        "unreachable broker has a bounded startup retry window then AP");
  reset(); cfg.mqttHost=""; setup();
  check(configMode && mqtt.attempts==0 && nowMs<3000,
        "empty broker address goes directly to AP");
  reset(); cfg.mqttPort=0; setup();
  check(configMode && mqtt.attempts==0 && nowMs<3000,
        "invalid broker port goes directly to AP");
  reset(); successOnAttempt=3; setup();
  check(!configMode && mqtt.attempts==3 && mqtt.connected() && publishes==1,
        "broker recovers within startup window: enter control without AP");
  reset(); prefs.forceConfig=true; setup();
  check(configMode && WiFi.begins==0 && mqtt.attempts==0,
        "explicit configuration request remains AP even if network is available");
  reset(); dropWifiDuringMqtt=true; setup();
  check(configMode && !mqtt.connected() && !motorsEnabled,
        "Wi-Fi drops during MQTT startup: fall back to AP");
  reset(); failBuffer=true; setup();
  check(configMode && mqtt.attempts==0,
        "MQTT packet buffer allocation failure cannot enter control");
  reset(); bufferReady=false; setup();
  check(configMode && WiFi.begins==0 && mqtt.attempts==0,
        "job buffer allocation failure enters AP before networking");
  reset(); nowMs=UINT32_MAX-10000; successOnAttempt=0; attemptDuration=3000;
  const uint32_t start=nowMs;
  setup();
  check(configMode && uint32_t(nowMs-start)>=30000 && uint32_t(nowMs-start)<=37000,
        "startup timeout survives millis wraparound");
  return failures ? 1 : 0;
}
