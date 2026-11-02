# Kết quả dự án Wokwi riêng — 01/11/2026 (Asia/Saigon)

## Đã xác nhận

- Người dùng chọn tách Wokwi thành dự án riêng, giữ nguyên firmware CNC.
- `git diff --exit-code -- src/main.cpp include/config.h platformio.ini` đạt: firmware và cấu hình build máy thật khớp bản trước tác vụ. Đã bỏ các sửa đổi nguồn, nhãn Wokwi trên web và file `include/config_wokwi.h` của cách làm trước.
- Dự án riêng: `test/wokwi/`, đọc lại logic CNC gốc; adapter cảm biến và thông số mạng chỉ nằm trong dự án này.
- `pio run --project-dir test/wokwi`: **SUCCESS** lúc 12:57, Arduino 3.3.12, pioarduino 55.3.312, ESP32-C5. RAM 195.888 byte; flash ứng dụng 1.324.545 byte. Full image `test/wokwi/.pio/build/wokwi/firmware.factory.bin`: **1.429.008 byte**, SHA-256 `c89ecbc9b4959df803ed83bc23a6a184acce194407ccff69409e5f9814e38671`.
- Adapter hiện tại là `test/wokwi/include/wokwi_dht.h`: đọc GPIO trực tiếp, giới hạn thời gian/vòng lặp, kiểm tra checksum DHT22. Kiểm tra ELF xác nhận không còn `DHT::expectPulse` hoặc DHTesp trong binary.
- Đã kiểm tra binary chứa `Wokwi-GUEST`, `host.wokwi.internal`, `user1`, không chứa các mật khẩu Wi-Fi/MQTT riêng của firmware máy thật.
- Wokwi CLI lint sơ đồ mới: không có lỗi/cảnh báo; một thông báo info về model ESP32-C5 beta chưa được tài liệu hóa đầy đủ trong registry.
- Broker hiện có trên 1883/3000 được sử dụng trực tiếp. Tài khoản user1 / 1 có quyền operator sẵn; không thay đổi users.json hoặc database.
- Web trình duyệt không còn hai ô IP/cổng, chỉ dùng username/password và tự lấy địa chỉ broker từ trang đang mở. APK vẫn có cấu hình LAN riêng.
- Kiểm tra Chrome trên `http://127.0.0.1:3000`: **user1 / 1 đăng nhập thành công**, transport connected=true, device=cnc01. Đã xem ảnh chụp form để xác minh không còn ô IP/cổng.
- `npm run build`, **18/18 Node test**, `npm run test:browser` đều đạt. Browser test kiểm tra thêm web không hiện trường dành cho APK và bỏ qua địa chỉ broker cũ trong localStorage. Các kiểm tra chuyển động của browser dùng thiết bị MQTT giả lập trong broker cô lập, không phải nghiệm thu Wokwi.
- Kiểm tra cú pháp ba script Node và `git diff --check` đạt.

## Lỗi đã quan sát trên Wokwi

- Bản adapter Adafruit trước đó đã nhận trực tiếp 28°C / 65% qua broker, có một lượt ổn định 36 giây uptime (16 mẫu), nhưng cũng gặp interrupt watchdog. Giải mã ELF xác định stack nằm trong `DHT::read` / `DHT::expectPulse` / `digitalRead`.
- Bản thử DHTesp build đạt nhưng thực tế vẫn báo `Khong doc duoc DHT11 GPIO9`, không đạt kiểm tra cảm biến. Log đồng thời có `Connection reset by peer`; người dùng thấy LCD đổi trạng thái liên tục. Chưa đủ bằng chứng kết luận mọi lần mất MQTT đều do reset CPU.
- Bản hiện tại tiếp tục dùng C5 theo yêu cầu người dùng. Các lần thử chuyển model không được tính là nghiệm thu.

## Kiểm chứng trực tiếp bản adapter GPIO trên C5

- Người dùng mở lại `test/wokwi/wokwi.toml` và xác nhận chạy C5. Kiểm tra bằng MQTT, Chrome headless và serial/debug của simulator, qua broker WEBCNC thật trên máy; không phát telemetry giả.
- **DHT ổn định: PASS** lúc 12:16: 20 mẫu trong 36 giây uptime, 35,82 giây thực, không có mẫu lỗi, offline hoặc uptime giảm trong cửa sổ này. Dữ liệu ban đầu 28°C / 65%, sau thao tác trên cảm biến đã nhận 28°C / 89%, rồi 48,6°C / 89%.
- **Web user1 / 1: PASS** lúc 12:20: nhận DHT; home; jog X đến 10, Y đến 10; bật/tắt LED; hạ/nâng bút; về gốc; bấm Dừng máy và chờ thông báo “Đã dừng theo phản hồi ESP32”. Chế độ mô phỏng nội bộ của web tắt. Ảnh khu vực điều khiển và đồng hồ cảm biến đã được xem lại.
- **MQTT điều khiển C5: PASS** lúc 12:21: đặt gốc, jog X/Y 100, chốt limit 100×100, home, LED, bút, nạp/vẽ hoàn tất hình vuông 8 lệnh, nạp đường vẽ ảnh 6 lệnh, nhận trạng thái chạy, dừng giữa chừng, kiểm tra tọa độ xung không đổi ở hai status sau dừng, home và khôi phục tốc độ 300.
- Một lượt MQTT trước đó timeout ở jog X; chưa xác định nguyên nhân từ log. Lượt web và lượt MQTT đầy đủ tiếp theo đạt. Không dùng lượt lỗi làm bằng chứng nghiệm thu.
- Sau kiểm thử đã gửi đặt gốc tại (0,0), xác nhận limit mặc định **230×850**, tỷ lệ 1:1; LED tắt, bút nâng. Script `--control` cũng đã bổ sung bước khôi phục hiệu chỉnh mặc định.
- Bằng chứng cục bộ trong thư mục được gitignore `test/.runtime/`: `stability-result.json`, `simulation-result.json`, `web-result.json`, `web-telemetry-result.json`, `web-user1-wokwi.png`.

## Giới hạn

- Các lượt 12:16–12:21 chỉ kiểm tra phản hồi firmware; lúc đó công cụ điều khiển IDE chưa kết nối được. Lượt kiểm tra LED/servo bổ sung bên dưới đã dùng trực tiếp giao diện Wokwi và tín hiệu GPIO. Chưa xác minh trực quan chuyển động hai motor trong lượt bổ sung này. Các cửa sổ ổn định đã đo không thay thế kiểm thử độ bền dài hạn.
- Chưa nghiệm thu phần cứng CNC hoặc điện thoại Android thật trong tác vụ này. Chưa thử mất Wi-Fi giữa bản vẽ trên phần cứng.
- DHT22 của Wokwi đại diện dữ liệu nhiệt độ/độ ẩm cho kênh DHT11 của web, không mô phỏng chính xác giao thức DHT11.

## Sửa và kiểm chứng LED/servo từ web

- Đã tái hiện servo nhận trạng thái MQTT nhưng không quay đúng. VCD bản trước sửa cho chu kỳ **48.000 µs**, xung nâng **3.984,4 µs**, hạ **3.222,7 µs**. `check-actuator-signals.cjs` báo FAIL với bản này. Thử nguồn PLL cũng không đạt (chu kỳ 80.000 µs).
- Chỉ đổi nguồn clock LEDC sang **RC_FAST** trong adapter mô phỏng. Không sửa `src/main.cpp`, `include/config.h`, `platformio.ini` máy thật hoặc giao diện web trong lượt sửa LED/servo.
- `check-web-actuators.cjs`: **PASS** trên web thật `http://127.0.0.1:3000`, đăng nhập user1 / 1, mô phỏng nội bộ web tắt. Hai chu kỳ LED bật/bút hạ và LED tắt/bút nâng đều nhận phản hồi trực tiếp từ Wokwi. Quan sát giao diện Wokwi thấy cánh servo đổi góc và LCD đổi `LED:ON/OFF` theo thao tác.
- `check-actuator-signals.cjs`: **PASS** trên VCD xuất từ logic analyzer Wokwi sau lượt web. D6 có chu kỳ trung vị **20.022,4 µs** (~49,94 Hz), xung hạ **1.344,3 µs** và nâng **1.662,0 µs**. D7 đổi **0→1→0→1→0**, các cạnh theo lệnh ở uptime 296,184; 306,636; 317,102; 327,534 giây. Bài kiểm tra bỏ qua mức chân lúc boot để không nhầm với lệnh bật/tắt.
- Khi bắt đầu chẩn đoán, simulator đang Pause. Sau Resume và chờ MQTT kết nối lại, GPIO LED đáp ứng lệnh. Không cần thay logic LED. LED trắng GPIO6 là đèn điều khiển; LED xanh GPIO3 chỉ báo hoạt động.
- Sau khi nạp lại bản sửa, kiểm tra DHT **PASS lúc 13:06**: 17 mẫu trong 36 giây uptime (35,957 giây thực), **40,1°C / 67%**, không có mẫu lỗi/offline hoặc uptime giảm trong cửa sổ kiểm tra.
- Bằng chứng cục bộ: `test/.runtime/actuators-before.vcd`, `actuators-after.vcd`, `actuator-signals-result.json`, `actuator-web-result.json`, `stability-result.json`. Đã chạy lại simulator sau khi xuất tín hiệu; trạng thái cuối LED tắt, bút nâng.

Lệnh và thao tác chạy: [WOKWI.md](WOKWI.md).

## Khôi phục cấu hình chạy ngày 01/11/2026 (buổi tối)

- Đã tái hiện lỗi mở simulator: `test/wokwi.toml` cần environment `wokwi`, nhưng chỉ còn artifact của `wokwi-test`. Tab TOML chưa lưu trong IDE còn trỏ sai tới `.pio/build/esp32c5`, gây thêm xung đột `The content of the file is newer`.
- Đã build lại environment `wokwi`, kiểm tra `.bin` và `.elf` tồn tại từ cả hai file TOML, nạp lại nội dung đúng trong IDE và chạy `CNC/test/wokwi.toml`. Log simulator đã xác nhận `WiFi and MQTT ready`, MQTT `host.wokwi.internal:1883`.
- Thêm `test/build-wokwi.ps1` để build đúng environment, giữ output khi đổi environment và kiểm tra artifact; không tự ghi TOML hay upload mạch thật.
- **Lỗi reset chưa được giải quyết hoàn toàn:** đã tái hiện `block_locate_free tlsf/tlsf.c:569` cả lúc khởi động/kết nối và khi gửi ảnh 526 lệnh. Bản mô phỏng giới hạn hàng đợi 8000 lệnh (đúng giới hạn web), tiết kiệm 48 KB nhưng vẫn ghi nhận reset; không kết luận nguyên nhân chỉ là thiếu RAM. GDB sau đó ghi nhận heap DRAM lớn còn khoảng 60040 byte. Thử đối chiếu SDK cũ chưa hoàn tất và không được áp dụng vào cấu hình thường.
- Web đã có kiểm thử chờ phản hồi đủ số lệnh, chia gói không quá 1024 byte, hủy gửi và không tự phát lại sau mất kết nối. Chưa nghiệm thu đầy đủ hình tròn/hình ảnh trên bản C5 hiện tại.
- Log cục bộ: `test/.runtime/restore-wokwi-build.log`, `restored-wokwi-boot.log`, `drawing-current-serial.log`; bản TOML chưa lưu trước khi khôi phục được giữ ở `wokwi-unsaved-before-restore.toml` cùng thư mục. Không sửa hoặc nạp firmware mạch thật trong lượt này.
