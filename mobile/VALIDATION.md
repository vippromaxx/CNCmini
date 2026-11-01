# Kiểm chứng MiniCNC Android

Ngày: 01/11/2026 (Asia/Saigon).

## Đã thực hiện

- `npm test`: 18/18 test đạt. Bao gồm hình tròn, chốt limit trực tiếp đúng firmware hiện tại, chặn hiệu chỉnh khi máy chạy/nạp, cấu hình broker, sai đăng nhập, retained status, telemetry hết hạn/offline, mất kết nối, quyền sở hữu phiên, hủy upload, xác nhận dừng và timeout.
- `npm run test:browser`: chạy Chrome với một bản sao broker Aedes của dự án trên cổng loopback tạm thời. Thiết bị MQTT giả lập nhận jog, bản vẽ hình tròn và ảnh; kiểm tra hủy upload, rời app/tiếp tục, chọn/hủy ảnh, cắt socket thật giữa upload rồi reconnect không phát lại lệnh, và chế độ mô phỏng không phát lệnh.
- Kiểm tra 15 màn hình: năm mục ở 390×844, 375×667 và 844×390. Không tràn ngang, không có exception JavaScript. Đã mở ảnh chụp để kiểm tra trực quan và sửa hiệu ứng chuyển trang gây nội dung mờ lúc đổi tab.
- Kiểm tra web gốc ở 1440×1000, đăng nhập theo origin hiện tại, giữ panel kết nối/giám sát ở bố cục desktop. Người xem rời trang không gửi stop.
- Bản web đóng gói không phát yêu cầu ra Internet cho script/font; vẫn nạp và xử lý ảnh khi không có Internet. Không lưu mật khẩu vào cấu hình localStorage.
- `npm audit --omit=dev`: không có cảnh báo cho dependency production tại thời điểm kiểm tra. Full audit có 4 cảnh báo mức moderate trong chuỗi công cụ build `@capacitor/cli → rimraf → glob/minimatch`; chúng không nằm trong JavaScript đóng gói. Không hạ Capacitor xuống v4 theo đề xuất tự động của audit.
- Đọc broker thật tại localhost:3000/1883: thiết bị `cnc01` chỉ có retained status `offline`, không nhận telemetry trực tiếp trong 8 giây. Không gửi lệnh điều khiển tới broker thật.

## APK / Android native

- `npm run apk`: **BUILD SUCCESSFUL**; đã chạy `assembleDebug lintDebug` với JDK 21, Gradle 8.14.3, platform 36 và build-tools 35.0.0.
- Lint của app: **0 errors, 19 warnings**. Cảnh báo gồm tài nguyên/icon mẫu không dùng, gợi ý nâng phiên bản Gradle/dependency, thứ tự manifest, backup rules và điều kiện SDK dư thừa. Không thêm baseline hoặc tắt kiểm tra để đạt kết quả. Thư viện Capacitor có baseline riêng do nhà cung cấp phát hành.
- Chữ ký APK đã xác minh bằng `apksigner verify --verbose`: hợp lệ, scheme v2, một signer; phù hợp minSdk 24.
- APK: `artifacts/MiniCNC-debug.apk`, **5.694.860 byte**. Application ID `vn.minicnc.controller`, versionName `1.0.0`, minSdk 24, targetSdk 36; nhãn `MiniCNC`.
- SHA-256: `c543ab1f795fa0d8f6ff74ed19258d5cd563742229a842e3dd129977166eb88c` (có tệp `.sha256` đi kèm).
- Đã mở cấu trúc APK: các tệp điều khiển/kết nối/giao diện chung khớp byte với nguồn `web/`; có font cục bộ; không chứa `users.json` hay mật khẩu tài khoản thử.
- Browser test cũng đã chạy với origin giao diện `localhost` gọi broker tại `127.0.0.1`, kiểm tra luồng HTTP/CORS và WebSocket khác origin.
- `adb devices -l`: danh sách thiết bị trống. Chưa cài APK lên điện thoại hay emulator.
- Báo cáo Lint đầy đủ: `android/app/build/reports/lint-results-debug.html`.

## Chưa nghiệm thu phần cứng

Không tìm thấy điện thoại Android/ADB hay ESP32 serial đang gắn vào máy; ESP32 qua broker đang offline. Vì vậy chưa xác nhận trên thiết bị thật:

- Cài/mở APK, bàn phím, vùng an toàn Android và nút Back hệ thống.
- Trình chọn ảnh Android, hủy chọn, cảm ứng kéo/pinch và xoay điện thoại.
- Chuyển app, khóa màn hình, Android đóng tiến trình, mất/kết nối lại Wi-Fi.
- Độ dịch chuyển cơ khí, góc servo, hiệu chuẩn, vẽ thật và phản hồi dừng trong lúc động cơ chạy.

Các test browser/MQTT giả lập không được coi là nghiệm thu Android hoặc CNC thật. Giới hạn dừng khi mất mạng và thiếu watchdog được ghi trong README.
