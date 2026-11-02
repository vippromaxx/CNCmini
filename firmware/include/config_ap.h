#pragma once
#include <Arduino.h>

// ═══════════════════════════════════════════
// CẤU HÌNH WIFI ACCESS POINT (CHẾ ĐỘ CỨU HỘ / CONFIG PORTAL)
// ═══════════════════════════════════════════

#if __has_include("secrets.h")
#include "secrets.h"
#endif

// Tên WiFi Access Point phát ra từ ESP32
#ifndef WIFI_AP_SSID
#define WIFI_AP_SSID "KimPang"
#endif

// Mật khẩu WiFi AP (Tối thiểu 8 ký tự theo chuẩn WPA2)
#ifndef WIFI_AP_PASSWORD
#define WIFI_AP_PASSWORD "12345678"
#endif

// Cấu hình địa chỉ IP cho chế độ AP
#define WIFI_AP_IP       IPAddress(192, 168, 4, 1)
#define WIFI_AP_GATEWAY  IPAddress(192, 168, 4, 1)
#define WIFI_AP_SUBNET   IPAddress(255, 255, 255, 0)
#define WIFI_AP_IP_STR   "192.168.4.1"

// Kênh phát WiFi AP (1 - 13)
#define WIFI_AP_CHANNEL  1

// Ẩn mạng WiFi AP (0: hiển thị SSID, 1: ẩn SSID)
#define WIFI_AP_HIDDEN   0

// Giới hạn số lượng thiết bị kết nối cùng lúc
#define WIFI_AP_MAX_CONN 4

// Giao diện web cấu hình Captive Portal
#include "config_html.h"
