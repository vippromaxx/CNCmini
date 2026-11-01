/**
 * ═════════════════════════════════════════════════════════════════════════════════════════
 * DỰ ÁN MÁY VẼ CNC 2 TRỤC IOT (ESP32-C5 / ESP32 DEVKIT FIRMWARE)
 * ═════════════════════════════════════════════════════════════════════════════════════════
 * File: main.cpp
 * Chức năng: Điều khiển 2 động cơ bước (A4988/DRV8825) nội suy Bresenham gia tốc hình thang,
 *            Servo nâng/hạ bút vẽ, cảm biến DHT11, màn hình LCD 1602 I2C, kết nối WiFi/MQTT
 *            và chế độ phát WiFi cứu hộ (AP Captive Portal).
 *
 * MỤC LỤC CÁC PHẦN:
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *  PHẦN 1: KHAI BÁO THƯ VIỆN & CẤU TRÚC DỮ LIỆU (INCLUDES & DATA STRUCTURES)
 *  PHẦN 2: KHỞI TẠO ĐỐI TƯỢNG NGOẠI VI & BIẾN TOÀN CỤC (PERIPHERALS & GLOBAL STATE)
 *  PHẦN 3: TIỆN ÍCH NGOẠI VI CƠ BẢN: LED BÁO HIỆU & MÀN HÌNH LCD (HARDWARE UTILITIES)
 *  PHẦN 4: LƯU TRỮ CẤU HÌNH & HIỆU CHUẨN VÀO FLASH NVS (FLASH STORAGE & NVS)
 *  PHẦN 5: KẾT NỐI WIFI & CHẾ ĐỘ CỨU HỘ ACCESS POINT (WIFI & AP CAPTIVE PORTAL)
 *  PHẦN 6: ĐIỀU KHIỂN CƠ CẤU BÚT VẼ (SERVO) & DRIVER ĐỘNG CƠ (ACTUATORS & MOTORS)
 *  PHẦN 7: THUẬT TOÁN ĐIỀU KHIỂN CHUYỂN ĐỘNG NỘI SUY (MOTION CONTROL & KINEMATICS)
 *  PHẦN 8: BỘ NHẬN LỆNH & QUẢN LÝ TIẾN TRÌNH VẼ (JOB EXECUTION & TOOLPATH)
 *  PHẦN 9: GIAO TIẾP VỚI BROKER MQTT (MQTT COMMUNICATION & DISPATCHER)
 *  PHẦN 10: VÒNG ĐỜI HỆ THỐNG ARDUINO (SETUP & LOOP)
 * ═════════════════════════════════════════════════════════════════════════════════════════
 */

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 1: KHAI BÁO THƯ VIỆN & CẤU TRÚC DỮ LIỆU (INCLUDES & DATA STRUCTURES)
// ═════════════════════════════════════════════════════════════════════════════════════════

#include <Arduino.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <WiFi.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

#include "config.h"
#include "config_ap.h"

namespace {

/**
 * Cấu hình tham số mạng động (Đọc/Lưu từ bộ nhớ Flash NVS)
 */
struct RuntimeConfig {
  String ssid;              // Tên mạng WiFi kết nối
  String password;          // Mật khẩu WiFi
  String mqttHost;          // Địa chỉ IP / Host của MQTT Broker
  String mqttUser;          // Tài khoản đăng nhập MQTT
  String mqttPassword;      // Mật khẩu MQTT
  uint16_t mqttPort = 1883; // Cổng kết nối MQTT (mặc định 1883)
};

/**
 * Cấu trúc một điểm lệnh chạy dao trong hàng đợi bản vẽ
 */
struct JobOp {
  int32_t x = 0;            // Tọa độ mục tiêu trục X (mm hoặc bước)
  int32_t y = 0;            // Tọa độ mục tiêu trục Y (mm hoặc bước)
  char action = 'M';        // Hành động: 'M' = Di chuyển, 'U' = Nhấc bút (Up), 'D' = Hạ bút (Down)
};

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 2: KHỞI TẠO ĐỐI TƯỢNG NGOẠI VI & BIẾN TOÀN CỤC (PERIPHERALS & GLOBAL STATE)
// ═════════════════════════════════════════════════════════════════════════════════════════

// 1. Đối tượng ngoại vi & dịch vụ mạng
RuntimeConfig cfg;
Preferences prefs;
WiFiClient netClient;
PubSubClient mqtt(netClient);
DHT dht(PIN_DHT, DHT11);
WebServer configServer(80);
DNSServer dnsServer;
LiquidCrystal_I2C lcd(LCD_I2C_ADDR, 16, 2);

// 2. Cờ trạng thái hệ thống & mốc thời gian
bool configMode = false;        // Đang ở chế độ AP cấu hình hay không
bool restartPending = false;    // Cờ báo hiệu chuẩn bị khởi động lại ESP32
uint32_t restartAt = 0;         // Thời điểm kích hoạt ESP.restart()
uint32_t lastStatus = 0;        // Thời điểm gửi status MQTT định kỳ gần nhất
uint32_t lastReconnect = 0;     // Thời điểm thử kết nối lại WiFi/MQTT gần nhất
uint32_t lastActivity = 0;      // Thời điểm có thao tác điều khiển cuối cùng (để tự tắt motor/nhấc bút)
uint32_t lastLcdUpdate = 0;     // Chu kỳ làm mới màn hình LCD 1602
uint32_t actLedUntil = 0;       // Thời gian duy trì sáng của LED báo hiệu lệnh (GPIO 3)
bool lcdAvailable = false;      // Cờ phát hiện màn hình LCD 1602 I2C trên bus

// 3. Toạ độ, hành trình và thông số hiệu chuẩn máy CNC
int32_t posX = 0;               // Tọa độ logic hiện tại trục X (mm)
int32_t posY = 0;               // Tọa độ logic hiện tại trục Y (mm)
int32_t physicalX = 0;          // Vị trí theo số xung đã phát trục X; không có phản hồi vị trí
int32_t physicalY = 0;          // Vị trí theo số xung đã phát trục Y; không có phản hồi vị trí
int32_t xMin = 0;               // Giới hạn nhỏ nhất trục X
int32_t xMax = DEFAULT_X_LIMIT; // Limit dự phòng, chỉ có đơn vị mm sau hiệu chuẩn bằng thước
int32_t yMin = 0;               // Giới hạn nhỏ nhất trục Y
int32_t yMax = DEFAULT_Y_LIMIT; // Limit dự phòng, chỉ có đơn vị mm sau hiệu chuẩn bằng thước
float axisScaleX = 1.0f;        // Tỉ lệ scale trục X (bước xung / đơn vị logic)
float axisScaleY = 1.0f;        // Tỉ lệ scale trục Y (bước xung / đơn vị logic)
bool calibrated = false;        // Trạng thái đã chốt Limit hành trình hay chưa
bool measuredCalibration = false; // Chỉ đúng khi hệ số xung/mm có số đo hành trình thực
String calibrationError;
uint16_t speedSteps = DEFAULT_SPEED; // Tốc độ di chuyển (bước/giây)

// 4. Cơ cấu ngòi bút (Servo) & Đèn chiếu sáng
bool penDownState = false;                          // Mặc định luôn là false (Nhấc bút)
int penUpAngle = DEFAULT_PEN_UP_ANGLE;              // Góc xoay Servo khi nhấc bút an toàn (110 độ)
int penDownAngle = DEFAULT_PEN_DOWN_ANGLE;          // Góc xoay Servo khi hạ bút tì xuống giấy (80 độ)
int currentPenAngle = DEFAULT_PEN_UP_ANGLE;         // Góc hiện tại của Servo (mặc định luôn nhấc lên)
bool ledState = false;                              // Trạng thái đèn LED chiếu sáng (PIN_LED)

// 5. Cảm biến môi trường DHT11
bool dhtValid = false;          // Dữ liệu đọc từ DHT11 có hợp lệ hay không
float dhtTemperature = 0.0f;    // Nhiệt độ môi trường (°C)
float dhtHumidity = 0.0f;       // Độ ẩm môi trường (%)
uint32_t lastDhtRead = 0;       // Chu kỳ đọc cảm biến DHT11 (tối thiểu 2.5s)

// 6. Hàng đợi lệnh vẽ (Job Queue)
JobOp job[JOB_MAX_OPS];         // Mảng chứa các điểm lệnh CNC
uint16_t jobCount = 0;          // Tổng số lệnh trong bản vẽ
uint16_t jobIndex = 0;          // Vị trí lệnh đang thực thi
String jobKind = "image";       // Phân loại bản vẽ ('square', 'circle', 'image')
String jobState = "idle";       // Trạng thái bản vẽ: 'idle', 'load', 'run', 'stop', 'done'
bool stopRequested = false;     // Cờ ngắt khẩn cấp khi người dùng bấm HỦY LỆNH VẼ

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 3: TIỆN ÍCH NGOẠI VI CƠ BẢN: LED BÁO HIỆU & MÀN HÌNH LCD (HARDWARE UTILITIES)
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * Nháy LED báo hoạt động (GPIO 3) khi thiết bị nhận lệnh hoặc có thao tác
 * @param durationMs - Thời gian giữ sáng LED (mili-giây)
 */
void triggerActLed(uint32_t durationMs = 120) {
  digitalWrite(PIN_ACT_LED, HIGH);
  actLedUntil = millis() + durationMs;
}

/**
 * In 2 dòng văn bản lên màn hình LCD 1602 I2C (mỗi dòng tối đa 16 ký tự, tự căn lề đẹp)
 * @param line1 - Nội dung dòng 1
 * @param line2 - Nội dung dòng 2
 */
void lcdPrintLines(const char *line1, const char *line2) {
  if (!lcdAvailable) return;
  char b1[17]; snprintf(b1, sizeof(b1), "%-16.16s", line1 ? line1 : "");
  char b2[17]; snprintf(b2, sizeof(b2), "%-16.16s", line2 ? line2 : "");
  lcd.setCursor(0, 0); lcd.print(b1);
  lcd.setCursor(0, 1); lcd.print(b2);
}

/**
 * Cập nhật nội dung hiển thị trên màn hình LCD 1602 theo chu kỳ thời gian thực:
 * - Dòng 1: Trạng thái máy (CNC READY, DRAWING %, CNC STOPPED, AP CONFIG)
 * - Dòng 2: Trạng thái kết nối WiFi (W:+/-), Broker MQTT (M:+/-) và Đèn (LED:ON/OFF)
 */
void updateLcdDisplay() {
  if (!lcdAvailable) return;
  char l1[32];
  char l2[32];

  // Dòng 1: Trạng thái làm việc của máy
  if (configMode) {
    snprintf(l1, sizeof(l1), "AP: %s", WIFI_AP_SSID);
    snprintf(l2, sizeof(l2), "%s", WIFI_AP_IP_STR);
    lcdPrintLines(l1, l2);
    return;
  } else if (WiFi.status() != WL_CONNECTED) {
    snprintf(l1, sizeof(l1), "CONNECTING WIFI");
  } else if (!mqtt.connected()) {
    snprintf(l1, sizeof(l1), "CONNECTING MQTT");
  } else if (jobState == "run") {
    const int percent = jobCount ? (jobIndex * 100) / jobCount : 0;
    snprintf(l1, sizeof(l1), "DRAWING %3d%%", percent);
  } else if (jobState == "stop") {
    snprintf(l1, sizeof(l1), "CNC STOPPED");
  } else {
    snprintf(l1, sizeof(l1), "CNC READY");
  }

  // Dòng 2: W (WiFi) '+' có / '-' mất, M (MQTT) '+' có / '-' mất, LED: ON/OFF
  snprintf(l2, sizeof(l2), "W:%c M:%c  LED:%s",
    (WiFi.status() == WL_CONNECTED) ? '+' : '-',
    mqtt.connected() ? '+' : '-',
    ledState ? "ON " : "OFF"
  );

  lcdPrintLines(l1, l2);
}

/**
 * Đọc giá trị nhiệt độ và độ ẩm từ cảm biến DHT11 (chu kỳ lấy mẫu an toàn tối thiểu 2.5 giây)
 */
void updateDht() {
  if (millis() - lastDhtRead < 2500) return;
  lastDhtRead = millis();
  const float temperature = dht.readTemperature();
  const float humidity = dht.readHumidity();
  if (!isnan(temperature) && !isnan(humidity)) {
    dhtTemperature = temperature;
    dhtHumidity = humidity;
    dhtValid = true;
  } else {
    dhtValid = false;
    Serial.printf("[DHT] Khong doc duoc DHT11 GPIO%d\n", PIN_DHT);
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 4: LƯU TRỮ CẤU HÌNH & HIỆU CHUẨN VÀO FLASH NVS (FLASH STORAGE & NVS)
// ═════════════════════════════════════════════════════════════════════════════════════════

void saveConfig();

/**
 * Đọc cấu hình mạng WiFi, MQTT Broker và các thông số hiệu chuẩn từ bộ nhớ Flash NVS
 */
void loadConfig() {
  prefs.begin("cnc_config", false);
  cfg.ssid = prefs.getString("ssid", WIFI_SSID);
  cfg.password = prefs.getString("password", WIFI_PASSWORD);
  cfg.mqttHost = prefs.getString("mqttHost", MQTT_HOST);
  cfg.mqttPort = prefs.getUShort("mqttPort", MQTT_PORT);
  cfg.mqttUser = prefs.getString("mqttUser", MQTT_USER);
  cfg.mqttPassword = prefs.getString("mqttPassword", MQTT_PASSWORD);

  // Nếu trong config.h đã điền WiFi cụ thể, ưu tiên cập nhật cấu hình mới vào NVS
  if (strlen(WIFI_SSID) > 0 && cfg.ssid != WIFI_SSID) {
    cfg.ssid = WIFI_SSID;
    cfg.password = WIFI_PASSWORD;
    cfg.mqttHost = MQTT_HOST;
    cfg.mqttPort = MQTT_PORT;
    cfg.mqttUser = MQTT_USER;
    cfg.mqttPassword = MQTT_PASSWORD;
    saveConfig();
    Serial.println("[CONFIG] Da dong bo WiFi tu config.h vao NVS");
  }
  const uint8_t calibrationVersion = prefs.getUChar("calVersion", 0);
  // Giữ limit V2 để không thay đổi chuyển động cũ, nhưng không coi đó là số đo mm.
  calibrated = prefs.getBool("calibrated", true);
  measuredCalibration = true;
  if (calibrated) {
    xMin = prefs.getLong("xMin", 0);
    xMax = prefs.getLong("xMax", DEFAULT_X_LIMIT);
    yMin = prefs.getLong("yMin", 0);
    yMax = prefs.getLong("yMax", DEFAULT_Y_LIMIT);
    axisScaleX = prefs.getFloat("scaleX", 1.0f);
    axisScaleY = prefs.getFloat("scaleY", 1.0f);
  } else {
    calibrated = true;
    xMin = 0;
    xMax = DEFAULT_X_LIMIT;
    yMin = 0;
    yMax = DEFAULT_Y_LIMIT;
    axisScaleX = 1.0f;
    axisScaleY = 1.0f;
  }
  // Đọc góc servo nâng/hạ bút đã lưu từ lần trước (Flash NVS)
  penUpAngle = prefs.getInt("penUp", DEFAULT_PEN_UP_ANGLE);
  penDownAngle = prefs.getInt("penDown", DEFAULT_PEN_DOWN_ANGLE);
}

/**
 * Lưu thông tin WiFi và Broker MQTT mới cấu hình vào bộ nhớ Flash NVS
 */
void saveConfig() {
  prefs.putString("ssid", cfg.ssid);
  prefs.putString("password", cfg.password);
  prefs.putString("mqttHost", cfg.mqttHost);
  prefs.putUShort("mqttPort", cfg.mqttPort);
  prefs.putString("mqttUser", cfg.mqttUser);
  prefs.putString("mqttPassword", cfg.mqttPassword);
}

/**
 * Lưu thông số hiệu chuẩn hành trình (giới hạn trục X, Y và tỉ lệ scale) vào Flash NVS
 */
void saveCalibration() {
  prefs.putBool("calibrated", calibrated);
  prefs.putUChar("calVersion", measuredCalibration ? CALIBRATION_SCHEMA_VERSION : 2);
  prefs.putLong("xMin", xMin);
  prefs.putLong("xMax", xMax);
  prefs.putLong("yMin", yMin);
  prefs.putLong("yMax", yMax);
  prefs.putFloat("scaleX", axisScaleX);
  prefs.putFloat("scaleY", axisScaleY);
}

/**
 * Lưu góc xoay Servo nâng/hạ bút vào bộ nhớ Flash NVS
 */
void saveServoAngles() {
  prefs.putInt("penUp", penUpAngle);
  prefs.putInt("penDown", penDownAngle);
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 5: KẾT NỐI WIFI & CHẾ ĐỘ CỨU HỘ ACCESS POINT (WIFI & AP CAPTIVE PORTAL)
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * Trả về JSON trạng thái phục vụ trang Web cấu hình AP (/api/status)
 */
void sendConfigStatus() {
  JsonDocument doc;
  doc["ssid"] = cfg.ssid;
  doc["mqttHost"] = cfg.mqttHost;
  doc["mqttPort"] = cfg.mqttPort;
  doc["mqttUser"] = cfg.mqttUser;
  doc["deviceId"] = DEVICE_ID;
  doc["busy"] = jobState == "run" || jobState == "load";
  String body;
  serializeJson(doc, body);
  configServer.send(200, "application/json; charset=utf-8", body);
}

/**
 * Khởi động chế độ phát WiFi cứu hộ Access Point "KimPang" và Captive Portal Web Server
 */
void startConfigMode() {
  configMode = true;
  WiFi.mode(WIFI_AP);
  const IPAddress apIP = WIFI_AP_IP;
  const IPAddress netMsk = WIFI_AP_SUBNET;
  WiFi.softAPConfig(apIP, apIP, netMsk);
  WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASSWORD, WIFI_AP_CHANNEL, WIFI_AP_HIDDEN, WIFI_AP_MAX_CONN);
  dnsServer.start(53, "*", apIP);

  configServer.on("/", HTTP_GET, [] { configServer.send_P(200, "text/html; charset=utf-8", CONFIG_PAGE); });
  configServer.on("/api/status", HTTP_GET, sendConfigStatus);
  configServer.on("/save", HTTP_POST, [] {
    JsonDocument doc;
    if (deserializeJson(doc, configServer.arg("plain"))) {
      configServer.send(400, "text/plain", "JSON khong hop le");
      return;
    }
    cfg.ssid = String(doc["ssid"] | "");
    cfg.password = String(doc["password"] | "");
    cfg.mqttHost = String(doc["mqttHost"] | MQTT_HOST);
    cfg.mqttPort = (uint16_t)(doc["mqttPort"] | MQTT_PORT);
    cfg.mqttUser = String(doc["mqttUser"] | MQTT_USER);
    cfg.mqttPassword = String(doc["mqttPassword"] | "");
    if (cfg.ssid.length() == 0 || cfg.mqttHost.length() == 0 || cfg.mqttPort == 0) {
      configServer.send(400, "text/plain", "Thieu thong tin cau hinh");
      return;
    }
    saveConfig();
    restartPending = true;
    restartAt = millis() + 1200;
    configServer.send(200, "text/plain", "Da luu. ESP32 dang khoi dong lai...");
  });

  // Tự động điều hướng Captive Portal trên điện thoại / máy tính
  configServer.on("/generate_204", HTTP_GET, [] { configServer.send_P(200, "text/html; charset=utf-8", CONFIG_PAGE); });
  configServer.on("/hotspot-detect.html", HTTP_GET, [] { configServer.send_P(200, "text/html; charset=utf-8", CONFIG_PAGE); });
  configServer.onNotFound([] {
    configServer.sendHeader("Location", "http://" WIFI_AP_IP_STR "/", true);
    configServer.send(302, "text/plain", "");
  });

  configServer.begin();

  char apLine[17];
  snprintf(apLine, sizeof(apLine), "AP: %-12.12s", WIFI_AP_SSID);
  lcdPrintLines(apLine, WIFI_AP_IP_STR);
  Serial.printf("[CONFIG] AP %s, mo http://%s\n", WIFI_AP_SSID, WIFI_AP_IP_STR);
}

/**
 * Kết nối ESP32 vào mạng WiFi trạm (Station Mode) theo thông tin đã lưu
 * @returns true nếu kết nối thành công, false nếu không kết nối được
 */
bool connectWiFi() {
  if (cfg.ssid.isEmpty()) {
    lcdPrintLines("AP CONFIG MODE", WIFI_AP_IP_STR);
    return false;
  }
  lcdPrintLines("CONNECTING WIFI", "W:- M:-  LED:OFF");
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg.ssid.c_str(), cfg.password.c_str());
  Serial.printf("[WiFi] Connecting to %s", cfg.ssid.c_str());
  const uint32_t until = millis() + 15000;
  while (WiFi.status() != WL_CONNECTED && millis() < until) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() != WL_CONNECTED) {
    lcdPrintLines("WiFi Failed!", "Starting AP...");
    delay(1000);
    return false;
  }
  Serial.printf("[WiFi] connected, IP=%s\n", WiFi.localIP().toString().c_str());
  lcdPrintLines("WiFi Connected!", WiFi.localIP().toString().c_str());
  delay(600);
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 6: ĐIỀU KHIỂN CƠ CẤU BÚT VẼ (SERVO) & DRIVER ĐỘNG CƠ (ACTUATORS & MOTORS)
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * Xuất xung PWM điều khiển góc quay của Servo nâng/hạ bút (0 - 180 độ)
 * @param angle - Góc quay mục tiêu
 */
void servoWriteAngle(int angle) {
  currentPenAngle = constrain(angle, 0, 180);
  const uint32_t pulseUs = map(currentPenAngle, 0, 180, 500, 2400);
  const uint32_t duty = (pulseUs * 16383UL) / 20000UL;
  ledcWrite(PIN_SERVO, duty);
}

/**
 * Đặt trạng thái ngòi bút: Nâng bút (Up) hoặc Hạ bút (Down) tì xuống mặt phẳng vẽ
 * @param down - true: hạ bút vẽ, false: nhấc bút lên cao
 * @param angle - Góc servo chỉ định (nếu < 0 thì lấy theo penDownAngle / penUpAngle)
 */
void setPen(bool down, int angle = -1) {
  const bool wasDown = penDownState;
  const int previousAngle = currentPenAngle;
  penDownState = down;
  if (angle < 0) angle = down ? penDownAngle : penUpAngle;
  servoWriteAngle(angle);
  lastActivity = millis();

  // Chờ cả khi đổi góc trong cùng một trạng thái; nếu không, chỉnh góc lúc
  // bút đang hạ sẽ làm servo chạy nhưng lệnh kế tiếp bắt đầu ngay lập tức.
  const bool angleChanged = currentPenAngle != previousAngle;
  if (down != wasDown || angleChanged) {
    if (down) {
      // Hạ bút: Chờ 250ms để đầu bút chạm chắc chắn và ổn định xuống mặt giấy trước khi motor chạy
      delay(PEN_DOWN_DELAY_MS);
    } else {
      // Nhấc bút: Chờ đủ thời gian để đầu bút nhấc hẳn lên khỏi giấy tránh quẹt mực khi di chuyển dao
      delay(PEN_UP_DELAY_MS);
    }
  }
}

/**
 * Bật hoặc tắt chân Enable (EN) của Driver động cơ bước (A4988 / DRV8825)
 * @param enabled - true: giữ trục cứng (LOW), false: ngắt lực thả lỏng chống nóng (HIGH)
 */
void enableMotors(bool enabled) {
  digitalWrite(PIN_X_EN, enabled ? LOW : HIGH);
  digitalWrite(PIN_Y_EN, enabled ? LOW : HIGH);
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 7: THUẬT TOÁN ĐIỀU KHIỂN CHUYỂN ĐỘNG NỘI SUY (MOTION CONTROL & KINEMATICS)
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * Quy đổi tọa độ logic (mm) sang số bước xung thực tế (Physical Steps)
 * @param logical - Tọa độ logic
 * @param scale - Hệ số co giãn bước xung
 * @returns Số bước xung thực tế
 */
int32_t scaledPhysical(int32_t logical, float scale) {
  const float value = logical * scale;
  return value >= 0 ? (int32_t)(value + 0.5f) : (int32_t)(value - 0.5f);
}

/**
 * Thuật toán đường thẳng Bresenham kết hợp hồ sơ gia tốc hình thang mềm (Trapezoidal ramp)
 * Điều khiển đồng bộ 2 trục X và Y di chuyển mượt mà, chống trượt bước và giảm rung lắc cơ khí
 * @param targetX - Vị trí xung mục tiêu trục X
 * @param targetY - Vị trí xung mục tiêu trục Y
 */
void moveBresenham(int32_t targetX, int32_t targetY) {
  int32_t dx = abs(targetX - physicalX);
  int32_t dy = abs(targetY - physicalY);
  int32_t sx = (targetX >= physicalX) ? 1 : -1;
  int32_t sy = (targetY >= physicalY) ? 1 : -1;

  if (dx == 0 && dy == 0) return;

  bool dirX = (sx > 0);
  if (INVERT_X_DIR) dirX = !dirX;
  digitalWrite(PIN_X_DIR, dirX ? HIGH : LOW);

  bool dirY = (sy > 0);
  if (INVERT_Y_DIR) dirY = !dirY;
  digitalWrite(PIN_Y_DIR, dirY ? HIGH : LOW);

  enableMotors(true);

  int32_t totalSteps = max(dx, dy);
  // Cả hai nhánh đều trừ độ dài trục phụ rồi cộng trục chính.
  // Sai số phải bắt đầu dương; -dy/2 làm phát thừa bước X ở đoạn dốc.
  int32_t err = totalSteps / 2;

  // Cấu hình gia tốc hình thang: Khởi động mềm và hãm phanh mềm
  const uint32_t maxSpeed = constrain((uint32_t)speedSteps, 80UL, (uint32_t)MAX_SAFE_SPEED);
  const uint32_t minSpeed = min<uint32_t>(120UL, maxSpeed / 2);
  int32_t rampSteps = min<int32_t>(totalSteps / 3, 60);

  for (int32_t i = 0; i < totalSteps && !stopRequested; ++i) {
    uint32_t curSpeed = maxSpeed;
    if (rampSteps > 0) {
      if (i < rampSteps) {
        curSpeed = minSpeed + ((maxSpeed - minSpeed) * i) / rampSteps;
      } else if (i >= totalSteps - rampSteps) {
        int32_t remaining = totalSteps - 1 - i;
        curSpeed = minSpeed + ((maxSpeed - minSpeed) * remaining) / rampSteps;
      }
    }
    const uint32_t stepIntervalUs = max<uint32_t>(300, 1000000UL / curSpeed);

    bool stepX = false;
    bool stepY = false;

    // Khi chỉ chạy một trục, tuyệt đối không để nhánh Bresenham phát xung
    // sang trục còn lại. Trường hợp dx = 0 trước đây có err âm ở bước đầu,
    // khiến trục X nhích một bước mỗi lần jog Y.
    if (dx == 0) {
      stepY = true;
    } else if (dy == 0) {
      stepX = true;
    } else if (dx > dy) {
      stepX = true;
      err -= dy;
      if (err < 0) {
        err += dx;
        stepY = true;
      }
    } else {
      stepY = true;
      err -= dx;
      if (err < 0) {
        err += dy;
        stepX = true;
      }
    }

    if (stepX) digitalWrite(PIN_X_STEP, HIGH);
    if (stepY) digitalWrite(PIN_Y_STEP, HIGH);
    delayMicroseconds(6); // Độ rộng xung sạch 6 micro-giây
    if (stepX) {
      digitalWrite(PIN_X_STEP, LOW);
      physicalX += sx;
    }
    if (stepY) {
      digitalWrite(PIN_Y_STEP, LOW);
      physicalY += sy;
    }

    delayMicroseconds(stepIntervalUs > 6 ? stepIntervalUs - 6 : 6);

    // Kiểm tra MQTT và nhường CPU thường xuyên để đón lệnh HỦY LỆNH tức thì
    if ((i & 0x1f) == 0) {
      mqtt.loop();
      yield();
    }
  }

  // Giữ tọa độ tích lũy từ xung đã phát, không ghi đè bằng đích yêu cầu.
  lastActivity = millis();
}

/**
 * Di chuyển đầu bút đến tọa độ (x, y) với kiểm soát giới hạn hành trình an toàn (Limit Check)
 * @param x - Tọa độ mục tiêu X (mm)
 * @param y - Tọa độ mục tiêu Y (mm)
 */
void moveTo(int32_t x, int32_t y) {
  if (stopRequested) return;
  x = constrain(x, xMin, xMax);
  y = constrain(y, yMin, yMax);
  const int32_t targetPhysicalX = scaledPhysical(x, axisScaleX);
  const int32_t targetPhysicalY = scaledPhysical(y, axisScaleY);
  moveBresenham(targetPhysicalX, targetPhysicalY);
  if (!stopRequested) {
    posX = x;
    posY = y;
  } else {
    if (axisScaleX > 0.001f) posX = (int32_t)(physicalX / axisScaleX);
    if (axisScaleY > 0.001f) posY = (int32_t)(physicalY / axisScaleY);
  }
  lastActivity = millis();
}

/**
 * Đưa máy về gốc tọa độ phần mềm đã đặt (0,0) bằng một luồng duy nhất.
 * Không có limit switch nên đây là soft-home; physicalX/physicalY không bị
 * tự ý đặt lại để không che giấu tình trạng mất bước cơ khí.
 */
void returnToOrigin() {
  stopRequested = false;
  setPen(false, penUpAngle);
  enableMotors(true); // Giữ lực cả hai trục trong lúc quay về gốc
  moveTo(0, 0);
}

/**
 * Đặt vị trí cơ khí hiện tại làm gốc tọa độ (0, 0)
 */
void setCalibrationOrigin() {
  physicalX = physicalY = 0;
  posX = posY = 0;
  xMin = 0; xMax = DEFAULT_X_LIMIT;
  yMin = 0; yMax = DEFAULT_Y_LIMIT;
  axisScaleX = axisScaleY = 1.0f;
  calibrated = true;
  measuredCalibration = true;
  calibrationError = "";
  saveCalibration();
}

/**
 * Chốt vị trí cơ khí trực tiếp làm giới hạn hành trình (không bắt buộc nhập số đo mm)
 */
bool setCalibrationLimitDirect() {
  const int32_t measuredX = abs(physicalX);
  const int32_t measuredY = abs(physicalY);
  const int32_t limitX = measuredX > 0 ? measuredX : DEFAULT_X_LIMIT;
  const int32_t limitY = measuredY > 0 ? measuredY : DEFAULT_Y_LIMIT;
  axisScaleX = 1.0f;
  axisScaleY = 1.0f;
  xMin = physicalX < 0 ? -limitX : 0;
  xMax = physicalX < 0 ? 0 : limitX;
  yMin = physicalY < 0 ? -limitY : 0;
  yMax = physicalY < 0 ? 0 : limitY;
  posX = constrain(physicalX, xMin, xMax);
  posY = constrain(physicalY, yMin, yMax);
  calibrated = true;
  measuredCalibration = true;
  calibrationError = "";
  saveCalibration();
  return true;
}

/**
 * Chốt vị trí cơ khí hiện tại làm giới hạn hành trình tối đa (Max Limit)
 */
bool setCalibrationLimit(float travelXmm, float travelYmm) {
  if (!isfinite(travelXmm) || !isfinite(travelYmm) ||
      travelXmm < 1.0f || travelYmm < 1.0f || travelXmm > 10000.0f || travelYmm > 10000.0f) {
    calibrationError = "Nhap hanh trinh X/Y do bang thuoc, tu 1 den 10000 mm.";
    return false;
  }
  const int32_t measuredX = abs(physicalX);
  const int32_t measuredY = abs(physicalY);
  if (measuredX == 0 || measuredY == 0) {
    calibrationError = "Dat goc roi di chuyen ca hai truc den diem do truoc khi dat limit.";
    return false;
  }

  // Số xung là bộ đếm; chiều dài mm phải được đo độc lập bằng thước.
  axisScaleX = (float)measuredX / travelXmm;
  axisScaleY = (float)measuredY / travelYmm;
  // Giao thức tọa độ hiện nhận mm nguyên: làm tròn vào trong vùng đã đo.
  const int32_t limitX = (int32_t)floorf(travelXmm);
  const int32_t limitY = (int32_t)floorf(travelYmm);
  xMin = physicalX < 0 ? -limitX : 0;
  xMax = physicalX < 0 ? 0 : limitX;
  yMin = physicalY < 0 ? -limitY : 0;
  yMax = physicalY < 0 ? 0 : limitY;
  posX = constrain((int32_t)lroundf(physicalX / axisScaleX), xMin, xMax);
  posY = constrain((int32_t)lroundf(physicalY / axisScaleY), yMin, yMax);
  calibrated = true;
  measuredCalibration = true;
  calibrationError = "";
  saveCalibration();
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 8: BỘ NHẬN LỆNH & QUẢN LÝ TIẾN TRÌNH VẼ (JOB EXECUTION & TOOLPATH)
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * Thêm một tọa độ di chuyển vào hàng đợi lệnh vẽ
 * @param x - Tọa độ X
 * @param y - Tọa độ Y
 */
void addJobMove(int32_t x, int32_t y) {
  if (jobCount >= JOB_MAX_OPS) return;
  job[jobCount++] = { x, y, 'M' };
}

/**
 * Phân tích gói dữ liệu chuỗi lệnh nhận từ MQTT (phân tách bởi dấu ';')
 * @param payload - Chuỗi dữ liệu gồm các lệnh U, D, X,Y
 */
void parseJobData(const String &payload) {
  const char *p = payload.c_str();
  const char *end = p + payload.length();
  while (p < end && jobCount < JOB_MAX_OPS) {
    while (p < end && (*p == ';' || *p == ' ' || *p == '\r' || *p == '\n')) p++;
    if (p >= end) break;
    if (*p == 'U' || *p == 'u') {
      job[jobCount++] = { 0, 0, 'U' };
      p++;
    } else if (*p == 'D' || *p == 'd') {
      job[jobCount++] = { 0, 0, 'D' };
      p++;
    } else {
      char *next = nullptr;
      long x = strtol(p, &next, 10);
      if (next && *next == ',') {
        p = next + 1;
        long y = strtol(p, &next, 10);
        addJobMove((int32_t)x, (int32_t)y);
        p = next;
      } else {
        while (p < end && *p != ';') p++;
      }
    }
  }
}

/**
 * Khởi tạo tiến trình nạp bản vẽ mới (reset bộ đếm lệnh, nhận góc xoay servo nâng/hạ bút)
 * @param kind - Loại bản vẽ ('square', 'circle', 'image')
 * @param payload - Dữ liệu JSON chứa thông số {"n": ..., "up": ..., "down": ...}
 */
void beginJob(const String &kind, const String &payload);

/**
 * Đóng gói toàn bộ thông số hệ thống thành chuỗi JSON gửi lên topic cnc/<DEVICE_ID>/status
 * @param retained - Cờ lưu trữ tin nhắn MQTT Broker
 */
void publishStatus(bool retained = true);

void beginJob(const String &kind, const String &payload) {
  JsonDocument doc;
  if (deserializeJson(doc, payload)) return;
  jobCount = 0;
  jobIndex = 0;
  stopRequested = false;
  jobState = "load";
  jobKind = kind;
  if (doc["up"].is<int>()) {
    int newUp = constrain((int)doc["up"], 0, 180);
    if (newUp != penUpAngle) {
      penUpAngle = newUp;
      prefs.putInt("penUp", penUpAngle);
    }
  }
  if (doc["down"].is<int>()) {
    int newDown = constrain((int)doc["down"], 0, 180);
    if (newDown != penDownAngle) {
      penDownAngle = newDown;
      prefs.putInt("penDown", penDownAngle);
    }
  }
  setPen(false, penUpAngle);
  publishStatus();
}

/**
 * Thực thi từng bước lệnh vẽ trong hàng đợi job[] (chạy liên tục trong vòng lặp loop)
 */
void runJob() {
  if (jobState != "run" || jobIndex >= jobCount || stopRequested) {
    if (stopRequested && jobState == "run") {
      jobState = "stop";
      setPen(false, penUpAngle);
      publishStatus();
    }
    return;
  }
  const JobOp &op = job[jobIndex++];
  if (op.action == 'U') {
    setPen(false, penUpAngle);
  } else if (op.action == 'D') {
    setPen(true, penDownAngle);
  } else {
    moveTo(op.x, op.y);
  }

  if (stopRequested) {
    jobState = "stop";
    setPen(false, penUpAngle);
    publishStatus();
  } else if (jobIndex >= jobCount) {
    jobState = "done";
    returnToOrigin();
    publishStatus();
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 9: GIAO TIẾP VỚI BROKER MQTT (MQTT COMMUNICATION & DISPATCHER)
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * Tạo tên topic MQTT chuẩn hóa theo định dạng: cnc/<DEVICE_ID>/<suffix>
 * @param suffix - Đường dẫn topic con
 * @returns Chuỗi tên topic
 */
String mqttTopic(const char *suffix) {
  return String("cnc/") + DEVICE_ID + "/" + suffix;
}

/**
 * Đóng gói toàn bộ trạng thái máy CNC thành gói JSON gửi lên MQTT Broker
 * @param retained - Cờ lưu trữ tin nhắn
 */
void publishStatus(bool retained) {
  if (!mqtt.connected()) return;
  JsonDocument doc;
  doc["state"] = jobState == "run" ? "running" : "idle";
  doc["x"] = posX;
  doc["y"] = posY;
  doc["speed"] = speedSteps;
  updateDht();
  doc["dht11"] = dhtValid;
  if (dhtValid) {
    doc["temperature"] = dhtTemperature;
    doc["humidity"] = dhtHumidity;
  }
  doc["chipTemperature"] = temperatureRead();
  doc["calibrated"] = calibrated;
  doc["calibrationVersion"] = CALIBRATION_SCHEMA_VERSION;
  doc["measuredCalibration"] = measuredCalibration;
  doc["calibrationError"] = calibrationError;
  doc["scale"]["x"] = axisScaleX;
  doc["scale"]["y"] = axisScaleY;
  doc["physical"]["x"] = physicalX;
  doc["physical"]["y"] = physicalY;
  doc["led"] = ledState;
  doc["pen"] = penDownState ? "down" : "up";
  doc["penUp"] = penUpAngle;
  doc["penDown"] = penDownAngle;
  doc["cal"] = calibrated ? 2 : 0;
  doc["range"]["x"][0] = calibrated ? xMin : 0;
  doc["range"]["x"][1] = calibrated ? xMax : DEFAULT_X_LIMIT;
  doc["range"]["y"][0] = calibrated ? yMin : 0;
  doc["range"]["y"][1] = calibrated ? yMax : DEFAULT_Y_LIMIT;
  doc["job"]["s"] = jobState;
  doc["job"]["i"] = jobIndex;
  doc["job"]["n"] = jobCount;
  doc["job"]["k"] = jobKind;
  doc["up"] = millis() / 1000UL;
  doc["boot"] = "poweron";

  char buffer[1024];
  serializeJson(doc, buffer, sizeof(buffer));
  bool ok = mqtt.publish(mqttTopic("status").c_str(), buffer, retained);
  if (!ok) {
    Serial.printf("[STATUS] publish FAILED! len=%u, bufSize=%u\n", (unsigned)strlen(buffer), mqtt.getBufferSize());
  }
}

/**
 * Callback nhận và xử lý toàn bộ các câu lệnh điều khiển từ web gửi qua MQTT Broker
 * @param topic - Tên topic nhận được
 * @param payload - Dữ liệu nhị phân của tin nhắn
 * @param length - Độ dài dữ liệu
 */
void handleMqttMessage(char *topic, byte *payload, unsigned int length) {
  String full(topic);
  String body;
  body.reserve(length + 1);
  for (unsigned int i = 0; i < length; ++i) body += (char)payload[i];

  const String prefix = String("cnc/") + DEVICE_ID + "/";
  if (!full.startsWith(prefix)) return;

  triggerActLed(120); // Nháy LED GPIO 3 mỗi khi nhận được lệnh
  const String rest = full.substring(prefix.length());
  lastActivity = millis();

  // 1. Lệnh cấu hình lại WiFi sang AP Mode cứu hộ
  if (rest == "control/wifi/reset") {
    Serial.println("[WIFI] Received WiFi reset request. Clearing WiFi and switching to AP mode...");
    lcdPrintLines("RESETTING WIFI..", "STARTING AP MODE");
    prefs.remove("ssid");
    prefs.remove("password");
    triggerActLed(1000);
    restartPending = true;
    restartAt = millis() + 600;
    return;
  }

  // 2. Lệnh Dừng khẩn cấp / Hủy lệnh vẽ
  if (rest == "control/stop") {
    stopRequested = true;
    jobState = "stop";
    setPen(false);
    publishStatus();
    return;
  }

  // 3. Lệnh Bật/Tắt đèn LED
  if (rest == "control/led") {
    ledState = body.length() ? body != "0" : !ledState;
    digitalWrite(PIN_LED, ledState);
    publishStatus();
    return;
  }

  // 4. Lệnh thay đổi tốc độ động cơ bước
  if (rest == "control/speed") {
    speedSteps = constrain(body.toInt(), 80, MAX_SAFE_SPEED);
    publishStatus();
    return;
  }

  // 5. Lệnh đưa máy về gốc tọa độ (0, 0)
  if (rest == "control/home") {
    returnToOrigin();
    publishStatus();
    return;
  }

  // 6. Lệnh điều khiển và lưu góc Servo nhấc bút / hạ bút vào Flash NVS
  if (rest == "control/pen/config") {
    JsonDocument doc;
    if (!deserializeJson(doc, body)) {
      if (doc["up"].is<int>()) {
        int newUp = constrain((int)doc["up"], 0, 180);
        if (newUp != penUpAngle) {
          penUpAngle = newUp;
          prefs.putInt("penUp", penUpAngle);
          Serial.printf("[SERVO] Luu NVS goc nhac but: %d do\n", penUpAngle);
        }
      }
      if (doc["down"].is<int>()) {
        int newDown = constrain((int)doc["down"], 0, 180);
        if (newDown != penDownAngle) {
          penDownAngle = newDown;
          prefs.putInt("penDown", penDownAngle);
          Serial.printf("[SERVO] Luu NVS goc ha but: %d do\n", penDownAngle);
        }
      }
      publishStatus();
    }
    return;
  }
  if (rest == "control/pen/up") {
    if (body.length()) {
      int newUp = constrain(body.toInt(), 0, 180);
      if (newUp != penUpAngle) {
        penUpAngle = newUp;
        prefs.putInt("penUp", penUpAngle);
        Serial.printf("[SERVO] Luu NVS goc nhac but: %d do\n", penUpAngle);
      }
    }
    setPen(false, penUpAngle);
    publishStatus();
    return;
  }
  if (rest == "control/pen/down") {
    if (body.length()) {
      int newDown = constrain(body.toInt(), 0, 180);
      if (newDown != penDownAngle) {
        penDownAngle = newDown;
        prefs.putInt("penDown", penDownAngle);
        Serial.printf("[SERVO] Luu NVS goc ha but: %d do\n", penDownAngle);
      }
    }
    setPen(true, penDownAngle);
    publishStatus();
    return;
  }

  // 7. Lệnh hiệu chuẩn đặt gốc và chốt limit
  if (rest == "control/cal/reset" || rest == "control/cal/origin") {
    if (jobState == "run" || jobState == "load") {
      calibrationError = "Dung ban ve truoc khi hieu chuan.";
      publishStatus();
      return;
    }
    setPen(false, penUpAngle); // Nhấc bút an toàn khi đặt gốc
    setCalibrationOrigin();
    publishStatus();
    return;
  }
  if (rest == "control/cal/set" || rest == "control/cal/sync") {
    if (jobState == "run" || jobState == "load") {
      calibrationError = "Dung ban ve truoc khi hieu chuan.";
      publishStatus();
      return;
    }
    JsonDocument measurement;
    if (!deserializeJson(measurement, body) &&
        measurement["travelX"].is<float>() && measurement["travelY"].is<float>()) {
      if (setCalibrationLimit(measurement["travelX"].as<float>(), measurement["travelY"].as<float>())) {
        setPen(false, penUpAngle);
      }
    } else {
      if (setCalibrationLimitDirect()) {
        setPen(false, penUpAngle);
      }
    }
    publishStatus();
    return;
  }

  // 8. Lệnh di chuyển thủ công Jog X / Jog Y
  if (rest.startsWith("control/jog/")) {
    if (rest.startsWith("control/jog/x/")) {
      moveTo(posX + (rest.endsWith("right") ? body.toInt() : -body.toInt()), posY);
    } else {
      moveTo(posX, posY + (rest.endsWith("up") ? body.toInt() : -body.toInt()));
    }
    publishStatus();
    return;
  }

  // 9. Bộ ba lệnh nạp và thi hành bản vẽ tự động (begin -> data -> start)
  if (rest.startsWith("auto/") && rest.endsWith("/begin")) {
    beginJob(rest.substring(5, rest.indexOf('/', 5)), body);
    return;
  }
  if (rest.startsWith("auto/") && rest.endsWith("/data")) {
    if (jobState == "load") parseJobData(body);
    return;
  }
  if (rest.startsWith("auto/") && rest.endsWith("/start")) {
    if (jobCount) {
      jobIndex = 0;
      stopRequested = false;
      jobState = "run";
      Serial.printf("[JOB] Bat dau thi hanh ban ve: %d lenh\n", jobCount);
      publishStatus();
    }
    return;
  }
}

/**
 * Kết nối đến MQTT Broker, đăng ký (subscribe) các topic nhận lệnh điều khiển máy CNC
 */
void connectMqtt() {
  if (WiFi.status() != WL_CONNECTED || cfg.mqttHost.isEmpty()) return;
  mqtt.setServer(cfg.mqttHost.c_str(), cfg.mqttPort);
  mqtt.setBufferSize(4096); // 4KB buffer luôn cấp phát an toàn trên heap ESP32
  String clientId = String(DEVICE_ID) + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  if (!mqtt.connect(clientId.c_str(), cfg.mqttUser.c_str(), cfg.mqttPassword.c_str(), mqttTopic("status").c_str(), 1, true, "{\"state\":\"offline\"}")) return;

  const char *commands[] = {
    "control/jog/x/left", "control/jog/x/right", "control/jog/y/up", "control/jog/y/down",
    "control/speed", "control/pen/up", "control/pen/down", "control/pen/config", "control/led",
    "control/home", "control/stop", "control/cal/reset", "control/cal/origin",
    "control/cal/set", "control/cal/sync", "control/wifi/reset",
    "auto/circle/begin", "auto/circle/data", "auto/circle/start",
    "auto/square/begin", "auto/square/data", "auto/square/start",
    "auto/image/begin", "auto/image/data", "auto/image/start"
  };
  for (const char *command : commands) {
    mqtt.subscribe(mqttTopic(command).c_str(), 1);
  }
  publishStatus();
}

} // namespace

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 10: VÒNG ĐỜI HỆ THỐNG ARDUINO (SETUP & LOOP)
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * Khởi tạo toàn bộ phần cứng (Serial, I2C, LCD, GPIO, Servo, DHT), nạp cấu hình và kết nối mạng
 */
void setup() {
  Serial.begin(115200);
  delay(150);

  // 1. Nạp cấu hình từ Flash NVS (WiFi, MQTT, Limit và GÓC SERVO ĐÃ LƯU)
  loadConfig();
  Serial.printf("[SERVO BOOT] Nap goc tu Flash NVS: Nhac but=%d do, Ha but=%d do\n", penUpAngle, penDownAngle);

  // 2. Khởi tạo cơ cấu Servo và LẬP TỨC NHẤC BÚT LÊN theo góc vừa nạp từ NVS
  ledcAttach(PIN_SERVO, 50, 14);
  setPen(false, penUpAngle);

  // 3. Cấu hình các chân GPIO động cơ bước, LED
  pinMode(PIN_X_STEP, OUTPUT);
  pinMode(PIN_X_DIR, OUTPUT);
  pinMode(PIN_X_EN, OUTPUT);
  pinMode(PIN_Y_STEP, OUTPUT);
  pinMode(PIN_Y_DIR, OUTPUT);
  pinMode(PIN_Y_EN, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_ACT_LED, OUTPUT);
  enableMotors(false);

  // 4. Khởi động giao tiếp I2C và màn hình LCD 1602
  Wire.begin(PIN_LCD_SDA, PIN_LCD_SCL);
  Wire.beginTransmission(LCD_I2C_ADDR);
  if (Wire.endTransmission() == 0) {
    lcdAvailable = true;
    lcd.init();
    lcd.backlight();
    lcd.clear();
    lcdPrintLines("CNC STARTING...", "W:- M:-  LED:OFF");
  } else {
    Wire.beginTransmission(0x3F);
    if (Wire.endTransmission() == 0) {
      lcdAvailable = true;
      lcd = LiquidCrystal_I2C(0x3F, 16, 2);
      lcd.init();
      lcd.backlight();
      lcd.clear();
      lcdPrintLines("CNC STARTING...", "W:- M:-  LED:OFF");
    }
  }

  // 5. Khởi động cảm biến DHT11
  dht.begin();

  // 6. Kết nối WiFi (hoặc vào chế độ phát WiFi cứu hộ)
  if (!connectWiFi()) {
    startConfigMode();
    return;
  }

  // 7. Cấu hình MQTT Callback và kết nối Broker
  mqtt.setCallback(handleMqttMessage);
  connectMqtt();

  Serial.printf("=== MiniCNC ESP32-C5 ===\nMQTT %s:%u\n", cfg.mqttHost.c_str(), cfg.mqttPort);
}

/**
 * Vòng lặp chính: Duy trì kết nối WiFi/MQTT, lắng nghe lệnh, thi hành bản vẽ và bảo vệ động cơ
 */
void loop() {
  // 1. Xử lý khởi động lại nếu có cờ restart
  if (restartPending && (int32_t)(millis() - restartAt) >= 0) {
    ESP.restart();
  }

  // 2. Nếu đang ở chế độ AP Captive Portal cứu hộ
  if (configMode) {
    dnsServer.processNextRequest();
    configServer.handleClient();
    return;
  }

  // 3. Thi hành bước vẽ hiện tại (Ưu tiên độc lập từ bộ nhớ, không để rớt mạng làm đứng máy)
  runJob();

  // 4. Tự động kết nối lại WiFi nếu bị rớt mạng
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastReconnect > 5000) {
      lastReconnect = millis();
      WiFi.reconnect();
    }
    return;
  }

  // 5. Tự động kết nối lại MQTT Broker
  if (!mqtt.connected() && millis() - lastReconnect > 3000) {
    lastReconnect = millis();
    connectMqtt();
  }

  // 6. Lắng nghe gói tin MQTT
  mqtt.loop();

  // 7. Gửi gói tin Status định kỳ (khi vẽ: 300ms/lần; khi nghỉ: 2000ms/lần)
  if (millis() - lastStatus > (jobState == "run" ? 300 : 2000)) {
    lastStatus = millis();
    publishStatus();
  }

  // 7. Cập nhật màn hình LCD 1602 (400ms/lần)
  if (millis() - lastLcdUpdate > 400) {
    lastLcdUpdate = millis();
    updateLcdDisplay();
  }

  // 8. Tắt LED báo hiệu hoạt động khi hết thời gian sáng
  if (actLedUntil && millis() >= actLedUntil) {
    digitalWrite(PIN_ACT_LED, LOW);
    actLedUntil = 0;
  }

  // 9. Tự động nhấc bút sau 15 giây nếu không vẽ để bảo vệ ngòi bút
  if (penDownState && jobState != "run" && millis() - lastActivity > 15000) {
    setPen(false, penUpAngle);
    publishStatus();
  }

  // 10. Tự động ngắt lực động cơ bước (EN = HIGH) sau 15 giây không hoạt động để chống nóng
  if (jobState != "run" && millis() - lastActivity > 15000) {
    enableMotors(false);
  }
}
