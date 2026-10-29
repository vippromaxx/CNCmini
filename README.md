# MiniCNC - phần ngoài PlatformIO

Thư mục này chứa các thành phần web, broker, database, tài liệu và dữ liệu khôi phục. Mã firmware PlatformIO được giữ riêng tại:

`C:\Users\ThinkPad\Documents\PlatformIO\Projects\CNC`

## Chạy broker và web

```powershell
cd broker
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
kjllkfdfsaflkj