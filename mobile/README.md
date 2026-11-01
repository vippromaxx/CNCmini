# MiniCNC Android

Ứng dụng Android chứa sẵn giao diện MiniCNC, dùng chung nguồn `../web/`. Điện thoại kết nối MQTT qua WebSocket tới broker Node.js trong mạng LAN; broker chuyển lệnh tới ESP32. Máy chạy broker phải bật khi điều khiển. Không cần Internet để mở giao diện, xem trước ảnh hoặc mô phỏng.

## Cài đặt và sử dụng

1. Chạy broker theo README ở thư mục gốc. Điện thoại, broker và ESP32 dùng chung mạng LAN.
2. Cài `artifacts/MiniCNC-debug.apk` trên điện thoại Android 7/API 24 trở lên, với Android System WebView được cập nhật.
3. Vào **Cài đặt**, nhập IP máy broker, cổng web (mặc định `3000`) và tài khoản broker. Không nhập `localhost`, IP ESP32 hay cổng TCP `1883` trên điện thoại.
4. Bấm **Kết nối broker** và chờ thông báo **ESP32 trực tuyến**. Chỉ kết nối broker chưa đủ để gửi lệnh chuyển động.
5. Dùng năm mục **Điều khiển / Vẽ hình / Vẽ ảnh / Giám sát / Cài đặt**. Nút **DỪNG MÁY** luôn nằm trên thanh điều hướng.

IP, cổng và tên tài khoản được nhớ trên thiết bị; mật khẩu chỉ giữ trong bộ nhớ của phiên. Không có tài khoản broker mặc định trong APK. APK debug dùng nội bộ, không phải bản phát hành Google Play.

Chế độ **Mô phỏng** phải bật rõ trong Cài đặt và sẽ ngắt kết nối máy thật. Hủy chọn ảnh giữ nguyên ảnh trước đó. Hỗ trợ PNG/JPEG và các định dạng ảnh WebView đọc được; giới hạn tệp 15 MB, đường vẽ tối đa 8000 lệnh theo logic web hiện có.

Đổi Wi-Fi ESP32: dùng nút AP Mode, kết nối Wi-Fi của ESP32, rồi bấm **Mở cấu hình Wi-Fi ESP32**. Trang `http://192.168.4.1` mở bằng trình duyệt hệ thống. Cấu hình xong phải trở lại mạng của broker.

## Build tái lập trên Windows

Toolchain: Node 22+, JDK 21, Android SDK platform 36/build-tools 35.0.0, Gradle Wrapper 8.14.3. Capacitor và plugin v8 được khóa bằng `package-lock.json`; minSdk 24, targetSdk 36. Android Studio là tùy chọn khi dùng dòng lệnh; có thể mở thư mục `android/` bằng Android Studio 2025.2.1 trở lên.

```powershell
cd mobile
npm ci

# Nếu máy chưa có SDK/JDK: tải toolchain cục bộ, không thay biến môi trường toàn máy.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-tools.ps1
# Hoặc dùng JDK 21 sẵn có:
# powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-tools.ps1 -JavaHome 'C:\path\to\jdk21'

npm test
npm run apk
```

Script setup tải từ Google/Adoptium, kiểm tra checksum và chấp nhận giấy phép SDK để cài toolchain đã chọn. Nếu đã chuẩn bị toolchain riêng, đặt `JAVA_HOME` và `ANDROID_HOME`; không cần chạy setup. Các đường dẫn cục bộ được lưu trong `.tools/toolchain.json` (không đưa vào Git).

`npm run apk` build nguồn web, đồng bộ Capacitor, chạy `assembleDebug lintDebug`, rồi sao chép APK và in SHA-256. File bàn giao: `artifacts/MiniCNC-debug.apk`. Các lần build debug trên cùng máy dùng cùng debug keystore. Không phát tán keystore; cài APK từ máy build khác có thể cần gỡ bản debug cũ.

Các lệnh riêng:

```powershell
npm run build          # web/ -> www/, nhúng font và adapter Android
npm run sync           # build + đồng bộ native project
npm run test:browser   # cần Google Chrome và broker/node_modules (npm ci trong ../broker)
```

Thư mục `www/`, tài nguyên web trong Android, SDK/JDK tải về, APK và kết quả chạy test là đầu ra build, không phải bản nguồn thứ hai. Chỉnh logic CNC trong `../web/`, rồi build APK mới. Build dùng danh sách tệp được phép; không sao chép `broker/users.json`, firmware dump hay trang cấu hình có thông tin thiết bị vào APK.

## Giao thức và hành vi phiên

- Đọc `/healthz` để kiểm tra broker và lấy device ID. Giao tiếp `ws://<host>:<port>/mqtt`; giữ nguyên topic `cnc/<device>/...`, payload, database và phân quyền phía broker.
- Android dùng origin nội bộ `http://localhost` và cho phép HTTP/WS trong LAN. Chỉ trang nội bộ được tải trong WebView; liên kết HTTP(S) bên ngoài mở trình duyệt hệ thống.
- Lệnh gửi QoS 0, `retain:false`, không lưu hàng đợi offline. Mỗi reconnect dùng MQTT client mới và clean session. Đây là lựa chọn để tránh phát lại lệnh chuyển động; không bảo đảm giao lệnh nếu mạng đứt.
- Không dùng retained status làm bằng chứng thiết bị đang online. Sau reconnect phải nhận telemetry trực tiếp; quá 25 giây không có dữ liệu thì khóa gửi lệnh và hủy upload.
- Khi rời app: hủy upload/mô phỏng, gửi stop nếu phiên này đã điều khiển và kết nối còn hoạt động. Người chỉ giám sát không tự dừng công việc người khác. Trở lại chỉ đồng bộ trạng thái, không tiếp tục upload hay bản vẽ cũ.
- **Đang yêu cầu dừng** chỉ chuyển thành **Đã dừng theo phản hồi ESP32** khi nhận status trực tiếp với `job.s=stop`. Không nhận được phản hồi trong 3,5 giây thì báo **Chưa xác nhận được**.
- Khóa broker hiện công bố username, chưa có mã công việc/phiên trong telemetry. App không suy diễn quyền sở hữu từ username; chỉ ghi nhận các lệnh chính nó gửi. Cơ chế này không thay thế khóa đa người vận hành ở firmware.
- Mất mạng, Android đóng tiến trình, hoặc một lệnh không tới thiết bị vẫn có thể khiến máy chạy tiếp. Bản này không sửa firmware để thêm watchdog. Phải kiểm tra máy thực tế khi chưa xác nhận được dừng.

Test hiệu chỉnh cũ đã lỗi do đòi `getCalibrationPayload` và hai ô nhập X/Y đã bị bỏ khỏi giao diện trước thay đổi Android. Firmware hiện có `setCalibrationLimitDirect()` nhận payload rỗng. Bộ test được sửa để kiểm tra đường thực tế này, chặn hiệu chỉnh trong `run/load` và giữ kiểm tra hình tròn đều theo mm. Không thay đổi firmware để khôi phục luồng nhập số đo cũ.

## Kiểm chứng

Xem `VALIDATION.md` để phân biệt các kiểm tra đã chạy với nghiệm thu điện thoại/CNC thật. Browser test khởi chạy một bản sao **broker sản xuất** trên cổng loopback tạm thời, dùng tài khoản thử và thiết bị MQTT giả lập. Không gửi lệnh tới CNC thật, không đọc tài khoản đang dùng, không thay firewall.

Kết quả chi tiết và ảnh chụp tự động ở `test-results/`. Khi dùng lần đầu với máy thật, thử lần lượt kết nối, jog ngắn, nâng/hạ bút, chốt limit, hình tròn, ảnh nhỏ, dừng, khóa màn hình, mất Wi-Fi và kết nối lại; kiểm tra không có lệnh tự chạy lại.
