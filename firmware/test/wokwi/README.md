# MiniCNC Wokwi

Dự án mô phỏng riêng dùng **ESP32-C5 DevKitC-1**. Không sửa `firmware/src/main.cpp`, `firmware/include/config.h` hoặc cấu hình build máy thật.

Từ thư mục `firmware/`:

```powershell
pio run --project-dir test/wokwi
```

Trong IDE chọn **Wokwi: Select Config File → test/wokwi/wokwi.toml**, rồi **Start Simulator**.

Web: **http://localhost:3000**, tài khoản **user1 / 1**. Broker MQTT: **host.wokwi.internal:1883**, topic **cnc/cnc01/**.

Adapter đọc lại logic CNC gốc và dùng DHT22 của Wokwi cho dữ liệu nhiệt độ/độ ẩm. Cấu hình mạng và sơ đồ chân mô phỏng nằm riêng ở đây. Cần giữ toàn bộ thư mục `firmware/` khi checkout vì project dùng chung source gốc qua đường dẫn tương đối.

[Hướng dẫn và kiểm thử](../WOKWI.md).
