#pragma once
#include <Arduino.h>

#define DEVICE_ID "cnc01"

// ═══════════════════════════════════════════
// CHÂN KẾT NỐI PHẦN CỨNG (PINOUT)
// ═══════════════════════════════════════════
#define PIN_X_STEP 4
#define PIN_X_DIR 5
#define PIN_X_EN 23
#define PIN_Y_STEP 24
#define PIN_Y_DIR 0
#define PIN_Y_EN 1

// Đảo chiều động cơ nếu bị ngược hướng
#ifndef INVERT_X_DIR
#define INVERT_X_DIR true
#endif

#ifndef INVERT_Y_DIR
#define INVERT_Y_DIR true
#endif

#define PIN_LED 6
#define PIN_ACT_LED 3
#define PIN_SERVO 8
#define PIN_DHT 9

// LCD 1602 I2C
#define PIN_LCD_SDA 10
#ifndef PIN_LCD_SCL
#define PIN_LCD_SCL TX
#endif
#define LCD_I2C_ADDR 0x27

// ═══════════════════════════════════════════
// THÔNG SỐ ĐỘNG CƠ & HÀNH TRÌNH MẶC ĐỊNH
// ═══════════════════════════════════════════
#define DEFAULT_SPEED 300
#define MAX_SAFE_SPEED 800
// Limit dự phòng trước hiệu chuẩn; không dùng làm chiều dài đo thực bằng mm.
#define DEFAULT_X_LIMIT 230
#define DEFAULT_Y_LIMIT 850
#define JOB_MAX_OPS 12000
#define CALIBRATION_UNITS 1000
#define CALIBRATION_SCHEMA_VERSION 3 // V3: hành trình được đo bằng thước, không suy ra từ limit cũ

// ═══════════════════════════════════════════
// THÔNG SỐ GÓC XOAY SERVO NÂNG/HẠ BÚT MẶC ĐỊNH
// ═══════════════════════════════════════════
#ifndef DEFAULT_PEN_UP_ANGLE
#define DEFAULT_PEN_UP_ANGLE 110    // Góc xoay nhấc bút lên an toàn (độ)
#endif

#ifndef DEFAULT_PEN_DOWN_ANGLE
#define DEFAULT_PEN_DOWN_ANGLE 80   // Góc xoay hạ bút tì xuống mặt phẳng vẽ (80 độ)
#endif

// ═══════════════════════════════════════════
// THỜI GIAN CHỜ CƠ HỌC SERVO NÂNG/HẠ BÚT (MS)
// ═══════════════════════════════════════════
#ifndef PEN_DOWN_DELAY_MS
#define PEN_DOWN_DELAY_MS 250       // Chờ 250ms để đầu bút chạm chắc mặt giấy trước khi motor chạy
#endif

#ifndef PEN_UP_DELAY_MS
#define PEN_UP_DELAY_MS 250         // Chờ 250ms để đầu bút nhấc hẳn lên khỏi giấy trước khi chạy dao
#endif

// ═══════════════════════════════════════════
// CẤU HÌNH WIFI & MQTT MẶC ĐỊNH
// ═══════════════════════════════════════════
#if __has_include("secrets.h")
#include "secrets.h"
#endif

#ifndef WIFI_SSID
#define WIFI_SSID ""
#endif

#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD ""
#endif

#ifndef MQTT_HOST
#define MQTT_HOST "192.168.1.10"
#endif

#ifndef MQTT_PORT
#define MQTT_PORT 1883
#endif

#ifndef MQTT_USER
#define MQTT_USER "user1"
#endif

#ifndef MQTT_PASSWORD
#define MQTT_PASSWORD ""
#endif
