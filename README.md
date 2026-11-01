# MiniCNC

## App Android

App MiniCNC nhúng giao diện web, kết nối broker qua Wi-Fi/LAN. Mã nguồn, hướng dẫn build APK và cài đặt: [mobile/README.md](mobile/README.md). Kết quả kiểm chứng: [mobile/VALIDATION.md](mobile/VALIDATION.md).

Repo chứa toàn bộ mã nguồn web, broker, Android, firmware ESP32-C5 và dự án mô phỏng Wokwi riêng.

| Thành phần | Thư mục / hướng dẫn |
| --- | --- |
| Web dùng chung cho trình duyệt và APK | `web/` |
| Broker MQTT/WebSocket và kết nối database | `broker/` |
| App Android MiniCNC | [mobile/README.md](mobile/README.md) |
| Firmware ESP32-C5 | [firmware/README.md](firmware/README.md) |
| Mô phỏng Wokwi ESP32-C5 | [firmware/test/WOKWI.md](firmware/test/WOKWI.md) |
| Database schema | `database/schema.sql` |

Firmware và Wokwi dùng chung logic CNC qua đường dẫn tương đối trong repo; không cần thư mục PlatformIO trên máy của tác giả.

## Chạy broker và web

```powershell
cd broker
if (!(Test-Path users.json)) { Copy-Item users.json.example users.json }
npm install
npm start
```

Mở dashboard trên máy chạy broker bằng `http://localhost:3000` hoặc trên thiết bị cùng mạng bằng `http://IP-MÁY-BROKER:3000`.

- MQTT TCP: `1883`
- MQTT WebSocket qua HTTP: `3000/mqtt`
- Database schema: `database/schema.sql`
- Firmware dump và các dữ liệu trích xuất: `recovery/`

Đổi mật khẩu trong `broker/users.json` trước khi dùng trong mạng thật.

Broker mặc định lắng nghe trên mọi giao diện mạng (`0.0.0.0`) để máy khác truy cập được. Có thể đổi cổng bằng biến môi trường `WEB_PORT`, `MQTT_PORT` hoặc địa chỉ bind bằng `BIND_HOST`.

## Firmware và Wokwi

```powershell
cd firmware
pio run -e esp32c5
pio run --project-dir test/wokwi
```

Chọn **Wokwi: Select Config File → firmware/test/wokwi/wokwi.toml**, rồi **Start Simulator**. Web tại `http://localhost:3000`, tài khoản thử `user1 / 1`; Wokwi kết nối broker trên máy qua `host.wokwi.internal:1883`. Tài khoản này cần có quyền operator trong broker. Giữ chế độ mô phỏng nội bộ của web tắt để các nút gửi lệnh MQTT đến Wokwi.

Thông tin Wi-Fi/MQTT riêng không được đưa vào firmware trên GitHub. Để dùng máy thật, cấu hình bằng portal của thiết bị hoặc tạo `firmware/include/secrets.h` từ file mẫu; file này được gitignore. Xem hướng dẫn firmware để đổi mật khẩu Wi-Fi cấu hình trước khi nạp.
