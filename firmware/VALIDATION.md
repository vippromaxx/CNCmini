# Kiểm tra khi gộp dự án — 01/11/2026

Phạm vi: đưa mã firmware và Wokwi vào `firmware/` để push cùng web và Android trong repo GitHub CNC.

## Đạt

- `firmware/src/main.cpp` khớp byte với file đang làm việc ở dự án PlatformIO CNC gốc. Không thay logic điều khiển khi gộp.
- Mật khẩu và cấu hình Wi-Fi/MQTT riêng trong bản GitHub được thay bằng giá trị mẫu; kiểm tra nội dung các file mới không còn mật khẩu Wi-Fi/MQTT riêng. AP giữ nguyên mặc định đã công khai trong mã web để hướng dẫn cấu hình không bị lệch. Thư mục CNC gốc không bị sửa. File `include/secrets.h`, build, log và cache được gitignore.
- `npm run build` tại `mobile/`: thành công.
- `npm test` tại `mobile/`: 18/18 test đạt.
- `npm run test:browser`: đạt, gồm đăng nhập broker, telemetry trực tiếp, jog, hình tròn, ảnh/hủy chọn, hủy upload, vòng đời, 15 màn hình mobile, desktop và tài nguyên offline.
- `python test/test_motion_pulses.py`: đạt; kiểm tra 9.409 đoạn theo các hướng, đường tròn khép kín, dừng trước và giữa chuyển động.
- `pio run --project-dir firmware/test/wokwi` tại gốc repo: **SUCCESS**. Nguồn và các include tương đối hoạt động trong bố cục mới. RAM 195.888 byte; flash ứng dụng 1.324.545 byte. Có cảnh báo deprecated từ thư viện LiquidCrystal_I2C.
- Full image Wokwi: 1.429.008 byte, SHA-256 `b62002fbe0ea6a964ec1e63e27beca8480036d05a242a5cb3ff89c87a91d5b44`.
- Cú pháp năm script Node phục vụ Wokwi đạt.

## Test hiệu chỉnh còn lỗi có sẵn

`python test/test_calibration_measurements.py` chưa đạt ở hai tình huống:

1. `legacy limits retained without treating them as measured mm`
2. `setting origin invalidates previous measurement, including after reload`

Đã chạy lại cùng bài test tại thư mục PlatformIO CNC gốc và nhận đúng hai lỗi này, xác nhận chúng có trước khi gộp. Các trường hợp đo hành trình, tỷ lệ hai trục, đầu vào không hợp lệ và khôi phục hiệu chỉnh đã đo đều đạt. Lượt push này giữ nguyên logic firmware theo phạm vi yêu cầu; không bỏ test hoặc đổi kết quả mong đợi để làm xanh bộ kiểm tra.

## Phạm vi kiểm chứng

Kết quả chạy trực tiếp Wokwi trước khi gộp được ghi tại [test/WOKWI-VALIDATION.md](test/WOKWI-VALIDATION.md). Binary đã build lại trong bố cục repo mới; chưa chạy lại bản binary này trên simulator trong lượt push. Chưa nghiệm thu phần cứng CNC hoặc Android thật. Các mã hash binary trong báo cáo Wokwi trước đó thuộc bản build tại thư mục PlatformIO gốc.
