# Firmware MiniCNC và Wokwi

Đây là dự án PlatformIO ESP32-C5 được gộp vào repo cùng web, broker và Android. `src/main.cpp` giữ nguyên logic CNC đã kiểm thử. Bản firmware đang làm việc tại thư mục PlatformIO riêng trên máy không bị thay đổi khi gộp.

## Máy thật

Tại thư mục `firmware/`:

```powershell
pio run -e esp32c5
```

Khi chủ động nạp lên thiết bị, chọn đúng cổng nối tiếp; `platformio.ini` đang đặt mặc định COM8. Không chạy lệnh upload cho dự án Wokwi lên máy thật.

Các giá trị mặc định Wi-Fi/MQTT riêng đã được thay bằng giá trị mẫu trong bản đưa lên GitHub. Có thể cấu hình Wi-Fi/MQTT qua portal của firmware, hoặc tạo file cục bộ:

```powershell
Copy-Item include/secrets.h.example include/secrets.h
```

Điền Wi-Fi, địa chỉ broker và tài khoản của bạn trong `include/secrets.h`. File này được gitignore. Tên/mật khẩu AP mặc định giữ nguyên để khớp hướng dẫn Wi-Fi trên web; đây là giá trị mặc định đã công khai trong giao diện, không phải thông tin Wi-Fi riêng. Có thể thêm `WIFI_AP_SSID` và `WIFI_AP_PASSWORD` vào `secrets.h` để đặt AP riêng trước khi nạp; khi đó dùng các giá trị đã đặt thay cho hướng dẫn mặc định trên web.

## Wokwi

```powershell
pio run --project-dir test/wokwi
node test/start-broker.cjs ..
```

Trong IDE chọn cấu hình `firmware/test/wokwi/wokwi.toml` nếu đang mở cả repo, hoặc `test/wokwi/wokwi.toml` nếu chỉ mở thư mục firmware. Start Simulator, mở `http://localhost:3000` và đăng nhập `user1 / 1`. Tài khoản thử này cần được cấu hình trong broker; không bật mô phỏng nội bộ của web.

Wokwi có adapter riêng cho DHT22 và nguồn clock PWM servo C5. Hướng dẫn sơ đồ, kết nối, kiểm tra LED/servo và các giới hạn nằm trong [test/WOKWI.md](test/WOKWI.md); kết quả kiểm chứng tại [test/WOKWI-VALIDATION.md](test/WOKWI-VALIDATION.md).

## Kiểm tra

Kết quả kiểm tra bản gộp và hai tình huống hiệu chỉnh còn lỗi có sẵn: [VALIDATION.md](VALIDATION.md).

```powershell
python test/test_motion_pulses.py
python test/test_calibration_measurements.py
node test/check-simulation.cjs ..
node test/check-web-actuators.cjs ..
```

Hai bài Python cần trình biên dịch `g++` trong PATH, chạy trên máy tính và không điều khiển thiết bị. Các bài Node cần dependency của `../mobile` và Wokwi đang chạy; bài actuators gửi lệnh LED và servo. Dừng simulator để xuất VCD rồi chạy `node test/check-actuator-signals.cjs` khi cần kiểm tra tín hiệu GPIO.

Không đưa `.pio`, `.runtime`, công cụ tải về, cache Python hoặc mật khẩu cục bộ vào Git. Các kết quả mô phỏng không thay thế kiểm chứng phần cứng CNC thật.
