# Web user1 điều khiển dự án Wokwi riêng

Mở **http://localhost:3000**, đăng nhập **user1 / 1**. Web tự dùng broker của trang đang mở, không có ô IP/cổng trên trình duyệt. Giao diện, nhãn DHT11 và giao thức điều khiển hiện có được giữ nguyên.

Luồng: **web → broker WEBCNC trên máy → CNC mô phỏng trong Wokwi**, và dữ liệu cảm biến đi ngược về web qua MQTT.

## Firmware CNC giữ nguyên

`firmware/src/main.cpp` và `firmware/platformio.ini` giữ nguyên logic và cấu hình build máy thật. Không thêm profile mô phỏng hoặc logic riêng vào các file này. Khi gộp lên GitHub, các mặc định mạng riêng trong `include/config.h` được thay bằng giá trị mẫu; xem [README firmware](../README.md) để cấu hình máy thật.

Dự án mô phỏng nằm ở **firmware/test/wokwi/**, có `platformio.ini`, `src/main.cpp`, `include/`, `diagram.json` và `wokwi.toml` riêng. Nó đọc lại logic CNC từ source gốc, rồi dùng adapter/cấu hình riêng khi biên dịch mô phỏng. Mọi output build nằm dưới `test/wokwi/.pio/`. Model mô phỏng là **ESP32-C5 DevKitC-1** theo yêu cầu người dùng; đây là kiểm tra trên simulator, không phải nghiệm thu máy thật.

## Build mô phỏng

Từ thư mục `firmware/`:

```powershell
pio run --project-dir test/wokwi
```

Nếu `pio` không có trong PATH:

```powershell
& "$env:USERPROFILE/.platformio/penv/Scripts/platformio.exe" run --project-dir test/wokwi
```

Không upload bản này lên máy thật. Firmware của máy thật vẫn build bằng `pio run -e esp32c5` ở thư mục `firmware/`.

## Kết nối và chạy

| Thành phần | Giá trị |
| --- | --- |
| Web / MQTT WebSocket | `http://localhost:3000` / `ws://localhost:3000/mqtt` |
| MQTT nhìn từ Wokwi | `host.wokwi.internal:1883` |
| Tài khoản web và Wokwi | `user1` / `1` |
| Device ID | `cnc01` |
| Wi-Fi ảo | `Wokwi-GUEST`, không mật khẩu |
| Status | `cnc/cnc01/status` |
| Lệnh | `cnc/cnc01/control/...`, `cnc/cnc01/auto/...` |

Broker hiện có đã có đúng tài khoản user1 và quyền operator trong `WEBCNC/broker/users.json`. Không ghi đè tài khoản khác, không tạo broker phụ.

Nếu broker chưa chạy:

```powershell
node test/start-broker.cjs "C:/duong-dan/WEBCNC"
```

Trong IDE:

1. F1 → **Wokwi: Select Config File** → chọn **firmware/test/wokwi/wokwi.toml**.
2. F1 → **Wokwi: Start Simulator** và giữ tab mô phỏng hiển thị.
3. Web → tải lại trang → đăng nhập **user1 / 1**. Không bật chế độ mô phỏng riêng của giao diện web, vì chế độ đó không gửi MQTT.
4. Chờ thiết bị gửi status trực tiếp. Web sẽ cập nhật cảm biến, tọa độ và cho phép điều khiển.

Cấu hình cũ `firmware/test/wokwi.toml` cũng trỏ tới binary của dự án riêng để tương thích tab đã mở; sơ đồ chính được giữ tại `test/wokwi/diagram.json`.

Wokwi extension sử dụng Private IoT Gateway để truy cập broker local. Website Wokwi cần Private IoT Gateway; public gateway không tới được broker trên máy. Nếu chạy một máy CNC thật cùng broker, không dùng đồng thời cùng device ID `cnc01` với máy mô phỏng.

## Cảm biến và sơ đồ

Wokwi có DHT22 sẵn. Adapter của dự án mô phỏng đọc DHT22 rồi gửi `dht11`, `temperature`, `humidity` đúng định dạng web hiện có. Đây là nguồn nhiệt độ/độ ẩm mô phỏng cho kênh DHT11, không phải mô phỏng chính xác giao thức DHT11. Click cảm biến trong Wokwi để thay đổi nhiệt độ/độ ẩm; dữ liệu phải đi từ firmware qua broker trước khi xuất hiện trên web.

Adapter mô phỏng `include/wokwi_dht.h` đọc xung DHT22 qua GPIO, giới hạn mỗi xung ở 200 microsecond và 4096 vòng lặp, kiểm tra checksum và miền giá trị trước khi trả dữ liệu. Một lần lỗi sẽ trả NaN để firmware báo cảm biến không hợp lệ, không điền số đo giả. Mỗi cặp nhiệt độ/độ ẩm lấy từ cùng một khung dữ liệu. Firmware máy thật vẫn dùng thư viện ban đầu.

Sơ đồ chân: X STEP/DIR/EN GPIO4/5/23; Y STEP/DIR/EN GPIO24/0/1; servo GPIO8; LED GPIO6; LED hoạt động GPIO3; DHT GPIO9; LCD SDA/SCL GPIO10/7. UART dùng TX/RX. SCL đổi sang GPIO7 chỉ trong mô phỏng để tránh GPIO11 đang làm UART TX.

Lần thử C5 beta ghi nhận watchdog tại `DHT::expectPulse` với driver Adafruit và không đọc được DHT khi dùng DHTesp. Adapter GPIO có giới hạn thời gian được tách riêng để xử lý việc đọc cảm biến trên mô phỏng C5. Sau khi build lại, nếu Wokwi chưa tự nạp bản mới, chọn Restart Simulation. Xem [tình trạng hỗ trợ chip](https://docs.wokwi.com/guides/esp32) và kết quả thực tế trong báo cáo.

Logic analyzer xuất `test/.runtime/cnc-signals.vcd`. Serial RFC2217: cổng 4000; GDB của simulator: cổng 3333. Chạy Start Simulator bình thường để dùng web; chỉ chọn Wait for Debugger khi chủ động debug.

## LED và servo trên C5

Adapter `test/wokwi/src/main.cpp` chọn nguồn clock `LEDC_USE_RC_FAST_CLK` trước khi chạy setup CNC. Trên bản Wokwi C5 đã thử, nguồn XTAL mặc định tạo khung PWM 48 ms dù yêu cầu 50 Hz; nguồn RC_FAST cho khung khoảng 20,0224 ms và servo quay đúng khi nâng/hạ. Thay đổi này chỉ áp dụng bản mô phỏng.

LED trắng ở GPIO6 là đèn bật/tắt từ web; LED xanh ở GPIO3 là đèn hoạt động. LCD hiện `LED:ON` hoặc `LED:OFF`. Cần giữ mô phỏng chạy (đồng hồ tăng); Pause dừng xử lý lệnh và nếu kéo dài có thể làm MQTT hết keepalive. Sau Resume, chờ web nhận lại trạng thái trực tiếp rồi thao tác. Firmware hiện có tự nâng bút sau 15 giây không nhận lệnh; đây là hành vi vốn có, không phải lỗi servo.

Để kiểm tra đầu ra thực của mô phỏng, chạy bài web khi simulator đang mở:

```powershell
node test/check-web-actuators.cjs "C:/duong-dan/WEBCNC"
```

Bài này đăng nhập user1, xác nhận chế độ mô phỏng nội bộ của web đang tắt, rồi chạy hai chu kỳ bật LED/hạ bút và tắt LED/nâng bút. Sau khi bài hoàn tất, bấm **Stop the simulation** để Wokwi xuất VCD, rồi chạy:

```powershell
node test/check-actuator-signals.cjs
```

Logic analyzer D6 đo servo GPIO8; D7 đo LED GPIO6. Bài kiểm tra yêu cầu chu kỳ 50 Hz, xung tương ứng góc mặc định 80°/110° và cạnh bật rồi tắt LED sau giai đoạn khởi động. Nếu đã thay góc bút, truyền góc hạ và nâng sau đường dẫn VCD. Bấm **Start the simulation** sau khi đo để tiếp tục dùng web.

## Kiểm tra

```powershell
node test/check-simulation.cjs "C:/duong-dan/WEBCNC"
```

Mặc định chỉ kiểm tra đăng nhập và nhận dữ liệu cảm biến trực tiếp, không gửi chuyển động. Tùy chọn `--control` chạy bài thử jog, hiệu chỉnh, LED, servo, bản vẽ và dừng khi đã xác nhận thiết bị cần thử là Wokwi. Kiểm tra không yêu cầu thêm trường riêng vào firmware, không tạo telemetry giả khi thiết bị offline.

Chạy lần lượt các bài có `--control`, không thao tác từ một phiên điều khiển khác cùng lúc. Bài MQTT đặt hiệu chỉnh thử 100×100, sau đó về gốc, khôi phục hiệu chỉnh mặc định và tốc độ 300. Cài dependency trong `WEBCNC/mobile` để dùng MQTT.js và Playwright; bài web dùng Chrome đã cài trên máy.

Bài kiểm tra nhận dữ liệu yêu cầu luồng DHT liên tục ít nhất 35 giây uptime thiết bị và báo lỗi nếu reboot/offline. Để kiểm tra bằng thao tác web trong Chrome headless:

```powershell
node test/check-web.cjs "C:/duong-dan/WEBCNC" --control
```

Lệnh này đăng nhập user1, bấm các nút jog/LED/bút/home/dừng và chờ status phản hồi từ thiết bị; báo cáo và ảnh nằm trong `test/.runtime/`.

Xem [kết quả kiểm tra](WOKWI-VALIDATION.md).
