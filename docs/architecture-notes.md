# Cấu trúc kiến thức IoT

## 1. Mạch kiến thức tổng thể

Tài liệu đi theo chuỗi:

```text
MQTT
  ↓
Mosquitto Broker
  ↓
JSON Payload
  ↓
ESP32 gửi/nhận dữ liệu
  ↓
Web MQTT qua WebSocket
  ↓
Broker Node.js/Aedes
  ↓
ACL, trạng thái thiết bị, Backend, REST API, Dashboard
```

Kiến trúc hệ thống:

```text
ESP32 / cảm biến ──MQTT TCP 1883──> MQTT Broker
                                        │
                                        ├── WebSocket 9001 ──> Trình duyệt
                                        └── MQTT client ─────> Backend
                                                               │
                                                               └── REST API / Dashboard
```

## 2. MQTT

MQTT là giao thức publish/subscribe dành cho các thiết bị có dữ liệu nhỏ, kết nối lâu dài và tài nguyên hạn chế.

- **Publisher** gửi dữ liệu lên một `topic`.
- **Subscriber** đăng ký nhận dữ liệu từ topic.
- **Broker** nhận, phân phối message và quản lý kết nối.
- Publisher và subscriber không cần biết trực tiếp địa chỉ của nhau.

Các thành phần quan trọng:

- `CONNECT` / `CONNACK`
- `PUBLISH`
- `SUBSCRIBE`
- `DISCONNECT`
- Keep Alive với `PINGREQ` / `PINGRESP`
- QoS 0, 1, 2
- Retained message
- LWT (Last Will and Testament)

Cổng thường dùng:

- `1883`: MQTT TCP, không mã hóa.
- `8883`: MQTT qua TLS.
- `9001`: MQTT over WebSocket trong các bài thực hành.

## 3. Mosquitto

Mosquitto là broker MQTT có sẵn dùng để kiểm tra nhanh bằng dòng lệnh.

Các lệnh cơ bản:

```text
mosquitto -v
mosquitto_sub -h localhost -t "test/topic"
mosquitto_pub -h localhost -t "test/topic" -m "Hello MQTT"
```

Các bài thực hành mở rộng:

- Subscribe nhiều topic bằng wildcard `+` và `#`.
- Gửi payload JSON.
- Kiểm tra QoS.
- Dùng retained message.
- Dùng LWT để thông báo thiết bị mất kết nối.
- Thêm username/password.
- Mở WebSocket listener cho trình duyệt.

## 4. JSON Payload

JSON là định dạng dữ liệu truyền qua MQTT.

Ví dụ:

```json
{
  "temp": 30,
  "hum": 70,
  "device": "ESP32"
}
```

Khi gửi trong JavaScript:

```js
client.publish("sensor/data", JSON.stringify(data));
```

Khi nhận:

```js
const data = JSON.parse(message.toString());
```

`message` thường là Buffer, vì vậy phải gọi `toString()` trước khi `JSON.parse()`.

## 5. ESP32

ESP32 thực hiện các bước:

1. Kết nối Wi-Fi.
2. Kết nối tới MQTT Broker bằng địa chỉ IP của máy chạy broker.
3. Publish dữ liệu cảm biến.
4. Subscribe topic điều khiển.
5. Gọi `client.loop()` liên tục để nhận message và duy trì Keep Alive.
6. Reconnect khi mất kết nối.

Luồng ví dụ:

```text
Cảm biến → ESP32 → JSON → MQTT Broker → Web/Backend
Web/Backend → MQTT Broker → ESP32 → LED hoặc thiết bị chấp hành
```

## 6. Web MQTT

Trình duyệt không mở TCP MQTT thuần trực tiếp. Vì vậy trình duyệt kết nối qua WebSocket:

```js
const client = mqtt.connect("ws://localhost:9001", {
  username: "user1",
  password: "123456"
});
```

Web có thể:

- Subscribe dữ liệu cảm biến.
- Parse JSON.
- Cập nhật giao diện realtime.
- Publish lệnh điều khiển.

Mosquitto hoặc Aedes phải mở listener WebSocket riêng. Không dùng `ws://localhost:1883`.

## 7. Broker Node.js/Aedes

Node.js dùng mô hình event-driven, phù hợp với nhiều kết nối MQTT sống lâu và phần lớn thời gian chờ dữ liệu.

Broker Aedes có hai cửa vào:

- TCP `1883`: ESP32, Mosquitto CLI và Node.js client.
- WebSocket `9001`: trình duyệt.

Cả hai cùng đưa dữ liệu vào `aedes.handle`.

Broker chịu trách nhiệm:

- Nhận và phân phối message.
- Theo dõi client kết nối/ngắt kết nối.
- Theo dõi publish/subscribe.
- Xác thực username/password.
- Kiểm soát quyền publish/subscribe.

## 8. Bài nâng cao

### Xác thực và phân quyền

- **Authentication** trả lời: client là ai?
- **Authorization/ACL** trả lời: client được phép làm gì?

Nguyên tắc dùng quyền tối thiểu:

- Device chỉ publish dữ liệu của chính nó và subscribe lệnh của chính nó.
- Viewer được đọc dữ liệu và gửi lệnh cần thiết.
- Không cho tài khoản web giả dữ liệu cảm biến.

### Trạng thái thiết bị

Keep Alive, LWT và retained phối hợp để biểu diễn:

```text
online → lost khi mất kết nối đột ngột
online → offline khi thiết bị thoát có chủ ý
```

### Backend và REST API

Backend là một MQTT client riêng:

- Subscribe dữ liệu cảm biến.
- Lưu dữ liệu vào JSON Lines hoặc database.
- Cung cấp REST API cho trình duyệt.
- Kiểm tra lệnh trước khi publish ngược lại MQTT.

Dashboard thường dùng cả hai:

- REST để lấy dữ liệu hiện tại khi mở trang.
- MQTT/WebSocket để cập nhật realtime.

## 9. Cơ chế CONFIG cho ESP32

### CONFIG MODE

Khi EEPROM chưa có cấu hình:

1. ESP32 tạo Wi-Fi Access Point.
2. Người dùng kết nối vào mạng của ESP32.
3. ESP32 mở Web Server tại `http://192.168.4.1`.
4. Người dùng nhập SSID, password, MQTT server, username và device ID.
5. ESP32 nhận dữ liệu từ form.
6. ESP32 ghi cấu hình vào EEPROM.
7. ESP32 khởi động lại.

### NORMAL MODE

Khi EEPROM đã có cấu hình:

1. ESP32 đọc dữ liệu cấu hình.
2. Kết nối Wi-Fi đã lưu.
3. Kết nối MQTT Broker.
4. Chạy chương trình chính.
5. Gửi dữ liệu cảm biến và nhận lệnh điều khiển.

Luồng kiểm tra:

```cpp
int flag = EEPROM.read(0);

if (flag == 1) {
    normalMode();
} else {
    configMode();
}
```

## 10. Những điểm dễ sai

- Nhầm cổng MQTT TCP `1883` với WebSocket `9001`.
- Quên dòng `protocol websockets`.
- Dùng `ws://localhost:1883` cho trình duyệt.
- Parse JSON trực tiếp từ Buffer.
- Không gọi `client.loop()` trong chương trình ESP32.
- Sai topic, ví dụ `lab/control` và `lab/controls`.
- So sánh password dạng Buffer trực tiếp với chuỗi.
- Dùng `localhost` trên ESP32 thay vì IP của máy chạy broker.
- ESP32 và laptop không cùng mạng hoặc bị Windows Firewall chặn.
- Mật khẩu giữa các tài liệu không thống nhất, cần chọn một giá trị và dùng xuyên suốt.

## 11. Trạng thái thư mục hiện tại

- `TaiLieu/`: các slide lý thuyết, tài liệu thực hành và file mẫu.
- `TaiLieu/4TH.html`: ví dụ Web MQTT dùng `mqtt.js`.
- `WEBCNC/`: broker, web, database và dữ liệu khôi phục ngoài PlatformIO.
- Firmware PlatformIO nằm trong `Documents/PlatformIO/Projects/CNC`.

