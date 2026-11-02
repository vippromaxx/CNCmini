# Đổi Wi-Fi hoặc broker khi ESP32 đang online

Áp dụng cho firmware mạch thật. Cần nạp bản firmware mới trước khi dùng luồng này.

## Thao tác

1. Đăng nhập web nối với broker hiện tại, bấm **Đổi WiFi** hoặc **Cài đặt lại WiFi (AP Mode)**.
2. Xác nhận. Firmware dừng công việc, nâng bút, ngắt lực motor rồi khởi động lại vào AP cấu hình.
3. Kết nối Wi-Fi **KimPang**, mật khẩu mặc định **12345678**, mở `http://192.168.4.1`. Nếu thiết bị nhớ mật khẩu cũ, chọn Quên mạng trước. Nếu đã tùy chỉnh AP, dùng thông tin riêng đã đặt. Giữ IP tự động/DHCP; chọn tiếp tục kết nối nếu điện thoại báo mạng không có Internet.
4. Nhập Wi-Fi, mật khẩu Wi-Fi, địa chỉ broker, cổng MQTT (thường 1883), tài khoản và mật khẩu MQTT. Khi chỉ đổi broker, giữ tên Wi-Fi và nhập lại mật khẩu Wi-Fi; trường mật khẩu trống có nghĩa là mạng mở.
5. Lưu. ESP32 khởi động lại bằng cấu hình mới. Đưa điện thoại/laptop về mạng của broker. Nếu chuyển máy broker, mở web của máy đó (thường `http://IP:3000`) hoặc đổi IP trong app Android.

## Hành vi đã sửa

- `config.h` chỉ cung cấp mặc định cho khóa chưa có trong NVS; không ghi đè cấu hình đã lưu sau mỗi lần khởi động.
- Lệnh `control/wifi/reset` lưu cờ NVS `forceConfig`, buộc vào AP ngay cả khi Wi-Fi cũ vẫn hoạt động. Giữ giá trị cũ để điền sẵn phần không bí mật của biểu mẫu.
- Mất nguồn trước khi lưu: lần khởi động sau vẫn vào AP. Lưu cấu hình hợp lệ sẽ xóa cờ này.
- Trong lúc chờ reboot, không tiếp tục bản vẽ hoặc xử lý thêm lệnh MQTT.
- Lúc khởi động hoặc khởi động lại sau khi lưu, chỉ vào chế độ điều khiển khi cả Wi-Fi và MQTT đã kết nối thành công. Wi-Fi không vào được trong khoảng 15 giây thì mở AP. MQTT có cửa sổ thử lại khoảng 30 giây, TCP connect giới hạn 2 giây/lần, chờ MQTT giới hạn 3 giây/lần; nếu dùng hostname, thời gian phân giải DNS phụ thuộc thư viện mạng. Broker từ chối tài khoản/mật khẩu thì quay về AP ngay, không chờ hết cửa sổ thử lại.
- Địa chỉ broker trống, cổng bằng 0 hoặc không đủ bộ đệm cũng không được vào chế độ điều khiển. Khi quay về AP, đóng kết nối MQTT/TCP, giải phóng bộ đệm lệnh vẽ và giữ các giá trị cấu hình để sửa. Cờ `forceConfig` vẫn có thể buộc mở AP theo yêu cầu từ web.
- Cơ chế quay về AP này áp dụng ở bước khởi động. Nếu đã vào chế độ điều khiển rồi mới mất Wi-Fi/broker, firmware tiếp tục dùng cơ chế reconnect hiện có.
- Giữ topic MQTT, tham số cơ khí, hiệu chỉnh, LED, DHT và góc servo.

## Lỗi KimPang không nhận IP

Bộ đệm tĩnh `JobOp job[12000]` giữ 144.000 byte RAM cả trong chế độ AP. Trên mạch thật chỉ còn khoảng 20 KB heap sau khởi tạo portal; khi máy khách kết nối đã ghi nhận cấp phát 786 byte thất bại. Windows xác thực WPA2 thành công nhưng không nhận IP và không mở được trang cấu hình. Đổi mật khẩu hoặc chỉ giảm băng thông xuống 20 MHz không khắc phục được.

Firmware nay cấp phát bộ đệm đủ 12.000 lệnh trước khi khởi tạo kết nối điều khiển và giải phóng trước khi mở AP. Nếu không cấp phát được, máy vào trang cấu hình thay vì nhận lệnh với bộ đệm rỗng. Không giảm sức chứa lệnh vẽ. Trong AP, heap sau khởi tạo portal tăng lên khoảng 165 KB và máy khách nhận được IP.

Giữ WPA2/CCMP và mật khẩu mặc định `12345678` theo yêu cầu người dùng. Đã đưa băng thông mạch về 40 MHz như trước chẩn đoán; mã nguồn không ép đổi băng thông. Đã bỏ heartbeat và hook cấp phát tạm. Giữ log sự kiện kết nối/nhận IP/ngắt kết nối và kiểm tra lỗi khởi tạo AP; không in mật khẩu.

## Kiểm tra ngày 01/11/2026

- `python test/test_network_config.py`: 10/10 tình huống NVS, đổi mạng và dừng trước reboot đạt. Test gọi hàm thực trong firmware với NVS/Wi-Fi giả lập.
- `python test/test_startup_network.py`: 12/12 tình huống gọi trực tiếp `setup`, `connectWiFi`, `connectMqtt` và luồng chờ kết nối thực của firmware. Bao gồm cả hai kết nối thành công, Wi-Fi sai, MQTT từ chối đăng nhập, broker không phản hồi, broker trống/cổng 0, phục hồi trong thời gian chờ, ép AP, rớt Wi-Fi khi đang nối MQTT, thiếu bộ đệm và tràn bộ đếm thời gian.
- `python test/test_job_buffer.py`: parser, đủ 12.000 lệnh, chặn vượt dung lượng, giải phóng bộ đệm, cấp phát thất bại và cấp phát lại đều đạt.
- `python test/test_motion_pulses.py`: đạt, gồm 9.409 đoạn, đường tròn và dừng giữa chuyển động.
- `pio run -e esp32c5 -t upload --upload-port COM8`: build/nạp ESP32-C5 thật thành công, hash dữ liệu ghi được xác minh.
- Thử thật với laptop Windows: trước sửa không nhận IP; sau sửa nhận `192.168.4.2`, `GET /` trả HTTP 200, `GET /api/status` trả HTTP 200 với các trường cấu hình dự kiến. Kiểm tra lại ở 40 MHz ban đầu vẫn đạt. Laptop được đưa lại về mạng trước bài thử.
- Người dùng đã xác nhận điện thoại kết nối KimPang và mở được trang cấu hình sau bản sửa RAM.
- Kiểm tra bổ sung trên ESP32-C5 thật: cấu hình broker cũ không phản hồi, sau khoảng 30 giây tự phát lại AP; `GET /` và `/api/status` đều HTTP 200. Lưu thử mật khẩu MQTT sai qua `POST /save`, mạch nhận mã từ chối 5 và mở AP ngay. Sau đó lưu lại tài khoản/mật khẩu ban đầu với địa chỉ broker đang chạy trên laptop `192.168.1.15:1883`, mạch kết nối thành công cả Wi-Fi và MQTT (`[NETWORK] WiFi and MQTT ready`); IP ESP32 là `192.168.1.14`. Laptop được đưa về mạng trước bài thử. Mật khẩu MQTT dùng để thử lỗi đã được thay lại bằng giá trị đúng.
- Chưa nghiệm thu lại với nguồn riêng, chưa thử sai mật khẩu Wi-Fi trên phần cứng trong phiên bổ sung; trường hợp này đã kiểm tra trên host. Chưa chạy chuyển động CNC thật trong phiên này. Không kiểm tra Wokwi theo yêu cầu người dùng.

USB Serial/JTAG trên COM8 dùng 115200 baud. Bản sao lưu flash và log ở `test/.runtime/` bị Git bỏ qua; bản sao lưu có cấu hình riêng, không đưa lên repository. Kiểm tra web trước đó: 18/18 test và kiểm tra trình duyệt đạt; sau đổi mật khẩu đã build lại web đóng gói và kiểm tra cú pháp JavaScript.

## Build / nạp

Từ thư mục dự án firmware:

```powershell
pio run -e esp32c5
pio run -e esp32c5 -t upload --upload-port COM8
```

Chỉ upload khi đã nối đúng mạch; thay COM8 bằng cổng thực tế nếu khác. Không cần sửa `config.h` mỗi lần đổi Wi-Fi/broker sau khi đã nạp bản sửa.
