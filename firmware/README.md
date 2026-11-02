# Firmware MiniCNC — ESP32-C5

Firmware điều khiển máy vẽ hai trục X/Y qua Wi-Fi và MQTT, dùng driver STEP/DIR, servo nâng/hạ bút, DHT11, LCD 1602 I2C và hai LED. Dự án PlatformIO nằm đầy đủ trong thư mục này; không cần bản sao tại `Documents/PlatformIO/Projects/CNC` trên máy tác giả.

**Các lệnh bên dưới chạy tại thư mục `firmware/`**, trừ khi ghi rõ vị trí khác. Hướng dẫn triển khai cả hệ thống nằm trong [README tổng](../README.md).

## Mục lục

- [Chức năng và cấu trúc](#chức-năng-và-cấu-trúc)
- [Đấu dây máy thật](#đấu-dây-máy-thật)
- [Build và nạp firmware](#build-và-nạp-firmware)
- [Cấu hình Wi-Fi và MQTT](#cấu-hình-wi-fi-và-mqtt)
- [Tham số cơ khí và hiệu chỉnh](#tham-số-cơ-khí-và-hiệu-chỉnh)
- [Nhận và thực thi bản vẽ](#nhận-và-thực-thi-bản-vẽ)
- [Mô phỏng Wokwi](#mô-phỏng-wokwi)
- [Kiểm thử](#kiểm-thử)
- [Xử lý sự cố](#xử-lý-sự-cố)
- [File cục bộ và tài liệu liên quan](#file-cục-bộ-và-tài-liệu-liên-quan)

## Chức năng và cấu trúc

- Điều khiển hai động cơ bước bằng nội suy Bresenham, có tăng/giảm tốc và giới hạn hành trình phần mềm.
- Jog từng trục, đặt gốc, đặt limit, quy đổi tọa độ sang số xung và trở về gốc đã đặt.
- Điều khiển servo bằng PWM 50 Hz; lưu góc nhấc/hạ bút vào NVS.
- Nhận bản vẽ `square`, `circle`, `image` qua MQTT, lưu trong RAM rồi thực thi.
- Gửi trạng thái máy, tiến độ, tọa độ, nhiệt độ/độ ẩm và nhiệt độ chip lên broker.
- Hiển thị thông tin trên LCD, bật/tắt LED chiếu sáng và nháy LED hoạt động khi nhận lệnh.
- Portal cấu hình mạng qua AP; ưu tiên cấu hình NVS, tự mở portal nếu kết nối lúc khởi động thất bại.
- Trong vòng lặp hoạt động bình thường, tự nhấc bút và ngắt lực motor sau khoảng 15 giây không hoạt động khi không chạy job. Đây không phải watchdog phần cứng khi mất mạng.

| File/thư mục | Vai trò |
| --- | --- |
| [platformio.ini](platformio.ini) | Board, platform, thư viện, cổng nạp và build flags của máy thật |
| [src/main.cpp](src/main.cpp) | Logic chuyển động, job, NVS, Wi-Fi/MQTT và ngoại vi |
| [include/config.h](include/config.h) | GPIO, device ID và thông số mặc định |
| [include/config_ap.h](include/config_ap.h) | Tên/mật khẩu AP, IP portal |
| [include/config_html.h](include/config_html.h) | Giao diện portal nhúng trong firmware |
| [include/secrets.h.example](include/secrets.h.example) | Mẫu mặc định mạng cục bộ |
| `test/test_*.py` | Kiểm tra các hàm firmware trên máy tính với phần cứng giả lập |
| [test/wokwi/](test/wokwi/) | Project mô phỏng riêng, dùng lại logic CNC qua đường dẫn tương đối |

Firmware hiện không đọc G-code, không điều khiển spindle/laser và không có công tắc hành trình hoặc encoder. Vị trí `physicalX/physicalY` là số xung đã phát, không phải số đo vị trí cơ khí.

## Đấu dây máy thật

### Bảng tín hiệu

Bảng dưới đây theo `include/config.h`; GPIO là tên tín hiệu, không phải thứ tự chân trên header.

| Ngoại vi | Tín hiệu | GPIO ESP32-C5 |
| --- | --- | --- |
| Driver X | STEP | 4 |
| Driver X | DIR | 5 |
| Driver X | ENABLE | 23 |
| Driver Y | STEP | 24 |
| Driver Y | DIR | 0 |
| Driver Y | ENABLE | 1 |
| Servo bút | Signal/PWM | 8 |
| DHT11 | DATA | 9 |
| LED chiếu sáng | Đầu ra qua điện trở hạn dòng | 6 |
| LED hoạt động | Đầu ra qua điện trở hạn dòng | 3 |
| LCD 1602 I2C | SDA | 10 |
| LCD 1602 I2C | SCL | `TX` — GPIO11 trên DevKitC-1 |
| Tất cả ngoại vi | Mass chung | GND |

ENABLE dùng mức **LOW để bật**, HIGH để ngắt lực motor. LCD được dò ở địa chỉ `0x27`, sau đó thử `0x3F` nếu chưa thấy thiết bị.

**Máy thật dùng LCD SCL = TX/GPIO11; Wokwi dùng GPIO7.** Không dùng GPIO11 đồng thời làm LCD SCL và UART TX. Cấu hình máy thật bật USB CDC; sử dụng cổng USB của chip cho Serial khi đấu LCD theo mặc định. Đối chiếu nhãn header với [pinout DevKitC-1 của Espressif](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32c5/esp32-c5-devkitc-1/user_guide.html).

### Nguồn và kết nối ngoại vi

- Với **A4988**, nối STEP/DIR/ENABLE theo bảng; VDD logic 3,3 V, GND chung; RESET/SLEEP giữ mức HIGH theo sơ đồ module; hai cặp ngõ ra nối vào hai cuộn motor. VMOT dùng nguồn motor riêng, đặt tụ lọc và chỉnh giới hạn dòng theo tài liệu driver.
- Giữ cấu hình vi bước cố định sau hiệu chỉnh. Nếu thay A4988 bằng DRV8825 hoặc driver STEP/DIR khác, đối chiếu pinout và nguồn của driver đó.
- Servo dùng nguồn đủ dòng theo loại servo, signal vào GPIO8 và mass chung. Không cấp nguồn motor/servo từ GPIO.
- DATA của DHT11 cần mức logic phù hợp ESP32; kiểm tra điện trở kéo lên của module hoặc thêm theo datasheet nếu dùng cảm biến rời.
- LCD/backpack I2C chạy 5 V có thể kéo SDA/SCL lên 5 V; dùng chuyển mức phù hợp giữa bus và ESP32 3,3 V.
- Mỗi LED tín hiệu cần điện trở hạn dòng; đèn công suất phải có tầng điều khiển riêng.

Xem [bảng đấu A4988, sơ đồ nguồn và danh sách linh kiện](../README.md#4-phần-cứng-và-cách-đấu-dây) trước khi cấp điện. Ngắt nguồn trước khi sửa dây hoặc cắm/rút motor. Sơ đồ Wokwi chỉ xác nhận kết nối mô phỏng, không xác nhận nguồn và dòng trên máy thật.

## Build và nạp firmware

### Toolchain

| Thiết lập | Giá trị hiện tại |
| --- | --- |
| Environment | `esp32c5` |
| Board | `esp32-c5-devkitc-1` |
| Framework | Arduino |
| Platform | pioarduino `platform-espressif32.zip`, nhánh phát hành `stable` |
| Partition | `min_spiffs.csv` |
| Serial | 115200 baud |
| Cổng nạp mặc định | COM8, cần thay theo máy |
| MQTT packet buffer | 4096 byte |
| USB | `ARDUINO_USB_MODE=1`, `ARDUINO_USB_CDC_ON_BOOT=1` |

Cài PlatformIO Core hoặc extension PlatformIO trong VS Code. PlatformIO tự tải các dependency khai báo trong `platformio.ini`: PubSubClient, ArduinoJson, DHT sensor library, Adafruit Unified Sensor và LiquidCrystal_I2C. Lần cài/build đầu cần Internet; URL `stable` chưa khóa một phiên bản toolchain cố định.

```powershell
# Build, chưa ghi vào thiết bị
pio run -e esp32c5

# Xem cổng đang có
pio device list
```

Khi đã nối đúng mạch và chọn đúng cổng:

```powershell
pio run -e esp32c5 -t upload --upload-port COM8
pio device monitor --port COM8 --baud 115200
```

Thay COM8 bằng cổng thực tế. Thoát Serial Monitor bằng `Ctrl+C` trước lần upload tiếp theo nếu cổng bị chiếm. Nếu `pio` chưa có trong PATH trên Windows, dùng executable cục bộ:

```powershell
& "$env:USERPROFILE/.platformio/penv/Scripts/platformio.exe" run -e esp32c5
```

Output nằm trong `.pio/build/esp32c5/`. Dùng lệnh upload của PlatformIO để nạp theo cấu hình dự án; không lấy binary Wokwi nạp lên máy thật.

## Cấu hình Wi-Fi và MQTT

### Chuẩn bị broker

Triển khai broker theo [README tổng](../README.md#5-chạy-broker-và-web) trước khi cấu hình ESP32. ESP32 dùng **MQTT TCP**, mặc định cổng **1883**. Cổng web **3000** dành cho dashboard/WebSocket.

Nhập IP LAN/hostname máy broker vào firmware, không nhập `localhost`, URL có `http://`, đường dẫn `/mqtt` hoặc IP portal `192.168.4.1`. Username/password phải tồn tại trong `broker/users.json`. Device ID mặc định `cnc01` phải khớp `DEVICE_ID` phía broker.

### Portal AP

1. Khởi động ESP32. Khi chưa nối được mạng điều khiển, thiết bị phát AP **KimPang**, mật khẩu **12345678** theo mặc định trong source.
2. Kết nối vào AP, bật nhận IP tự động/DHCP và chọn giữ kết nối nếu máy báo không có Internet.
3. Mở `http://192.168.4.1` bằng trình duyệt.
4. Nhập tên/mật khẩu Wi-Fi, địa chỉ broker, cổng MQTT và tài khoản MQTT.
5. Lưu; ESP32 khởi động lại. Đưa điện thoại/laptop trở về mạng broker rồi mở dashboard.
6. Chờ log `[NETWORK] WiFi and MQTT ready` hoặc thông báo **ESP32 trực tuyến** trên web.

| Tình huống lúc khởi động | Hành vi |
| --- | --- |
| Wi-Fi và MQTT đều kết nối được | Vào chế độ điều khiển |
| Wi-Fi thất bại | Sau khoảng 15 giây chuyển sang AP |
| Broker không phản hồi | Thử trong cửa sổ khoảng 30 giây rồi chuyển sang AP |
| Broker từ chối username/password | Chuyển sang AP ngay khi nhận mã từ chối |
| Host trống/cổng 0 hoặc thiếu bộ đệm job | Không vào điều khiển, mở AP |
| Đã yêu cầu AP bằng `control/wifi/reset` | Buộc mở AP dù Wi-Fi cũ vẫn dùng được |

Cửa sổ MQTT không bảo đảm thời gian tuyệt đối nếu còn chờ phân giải DNS. Sau khi đã vào chế độ điều khiển, mất mạng dùng nhánh reconnect; không áp dụng lại luồng tự chuyển AP lúc boot.

### Đổi mạng khi máy đang online

Bấm **Đổi WiFi / Cài đặt lại WiFi (AP Mode)** trên web và xác nhận. Firmware dừng job, nhấc bút, ngắt lực motor, lưu cờ `forceConfig` rồi khởi động lại vào AP. Mất nguồn trước khi lưu cấu hình mới vẫn giữ thiết bị ở AP trong lần boot sau.

Portal điền sẵn phần cấu hình không bí mật. **Nhập lại mật khẩu Wi-Fi khi lưu**: trường trống có nghĩa là mạng mở. Lưu thành công xóa cờ ép AP và thử kết nối bằng thông tin mới. Hướng dẫn/kiểm chứng chi tiết: [test/NETWORK-CONFIG.md](test/NETWORK-CONFIG.md).

### Mặc định biên dịch qua `secrets.h`

Tùy chọn, khi muốn đặt cấu hình mặc định cục bộ:

```powershell
Copy-Item include/secrets.h.example include/secrets.h
```

Điền `WIFI_SSID`, `WIFI_PASSWORD`, `MQTT_HOST`, `MQTT_PORT`, `MQTT_USER`, `MQTT_PASSWORD` trong file mới. Có thể thêm `WIFI_AP_SSID` và `WIFI_AP_PASSWORD` để đổi AP; khi đó tên/mật khẩu hướng dẫn mặc định trên web không tự đổi theo.

**NVS được ưu tiên hơn giá trị biên dịch.** `config.h`/`secrets.h` chỉ cung cấp mặc định cho khóa mạng chưa có trong NVS. Build/nạp lại với mặc định mới không tự đổi mạng đã lưu; dùng portal để cập nhật cấu hình đang sử dụng. `include/secrets.h` đã được gitignore.

## Tham số cơ khí và hiệu chỉnh

| Tham số | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `DEFAULT_SPEED` | 300 | Bước/giây |
| `MAX_SAFE_SPEED` | 800 | Trần trong firmware, không bảo đảm mọi cơ khí đều chạy ổn ở mức này |
| `DEFAULT_X_LIMIT`, `DEFAULT_Y_LIMIT` | 230, 850 | Limit logic dự phòng, không phải chiều dài mm đã đo |
| `INVERT_X_DIR`, `INVERT_Y_DIR` | `true`, `true` | Đảo mức DIR theo hướng chạy |
| `DEFAULT_PEN_UP_ANGLE` | 110° | Góc nhấc bút khi chưa lưu góc riêng |
| `DEFAULT_PEN_DOWN_ANGLE` | 80° | Góc hạ bút khi chưa lưu góc riêng |
| `PEN_UP_DELAY_MS`, `PEN_DOWN_DELAY_MS` | 250 ms | Chờ cơ cấu khi đổi góc/trạng thái |
| `JOB_MAX_OPS` | 12000 | Dung lượng job trong firmware thật |

### Gốc và limit trực tiếp

1. Nhấc bút, chọn tốc độ thấp/bước jog nhỏ, xác nhận chiều hai trục.
2. Đưa đầu bút tới vị trí gốc mong muốn rồi bấm **Đặt gốc**.
3. Jog hai trục đến điểm giới hạn nằm trong hành trình cơ khí, bấm **Đặt limit**.
4. Thử **GỐC** trước khi vẽ khung toàn bàn.

Đặt gốc đặt bộ đếm vị trí về 0, khôi phục limit dự phòng và scale bằng 1. Đặt limit trực tiếp nhận payload rỗng, lấy số xung hiện tại làm giới hạn và cũng đặt scale bằng 1; trục chưa dịch chuyển dùng limit dự phòng. Khi scale bằng 1, một đơn vị tọa độ tương ứng một xung, chưa chứng minh đó là một mm dù giao diện có nhãn mm.

**GỐC là soft-home**, chạy tới tọa độ `(0,0)` đã biết trong phần mềm. Không có cảm biến để tự tìm vị trí gốc sau mất điện, mất bước hoặc trục bị di chuyển bằng tay.

### Hiệu chỉnh bằng số đo thực

Firmware còn nhận JSON trên `cnc/cnc01/control/cal/set` hoặc `control/cal/sync`:

```json
{"travelX": 40, "travelY": 50}
```

Thay 40/50 bằng số đo thực của bạn. Sau khi đặt gốc, jog cả hai trục tới điểm đo, đo khoảng dịch chuyển bằng thước và gửi bằng MQTT client với quyền operator/admin, `retain: false`. Giao diện web hiện không có ô nhập hai số đo này.

Firmware tính số xung/mm độc lập cho từng trục; số đo phải trong 1–10000 mm, cả hai trục phải có dịch chuyển. Limit được làm tròn vào trong vùng đã đo vì giao thức tọa độ dùng số nguyên. Không bấm lại Đặt gốc/Đặt limit trực tiếp sau đó nếu muốn giữ hệ số vừa tính; hai thao tác này đặt scale về 1.

Hiệu chỉnh và góc servo được lưu vào NVS, nhưng vị trí cơ khí không có phản hồi độc lập. Cờ `measuredCalibration` hiện cũng được bật trong luồng đặt trực tiếp, vì vậy không dùng riêng cờ này để khẳng định kích thước đã được đo bằng thước. Hai tình huống test liên quan còn lỗi được ghi ở mục Kiểm thử.

## Nhận và thực thi bản vẽ

Web tạo đường chạy; ESP32 nhận các lệnh qua prefix **`cnc/<DEVICE_ID>/`**:

| Topic | Chức năng |
| --- | --- |
| `auto/<kind>/begin` | JSON gồm số lệnh dự kiến `n`, góc `up`/`down`; xóa job cũ và vào `load` |
| `auto/<kind>/data` | Lệnh phân cách bằng `;`: `U` nhấc bút, `D` hạ bút, `x,y` tới tọa độ nguyên |
| `auto/<kind>/start` | Chạy dữ liệu đã nạp khi có ít nhất một lệnh |
| `control/stop` | Dừng job và nhấc bút |
| `status` | Vị trí, cảm biến, hiệu chỉnh và `job.s/i/n/k` |

`<kind>` là `square`, `circle` hoặc `image`. Firmware không tự xác nhận `n` trong begin đã khớp số lệnh trước start; web phải đợi status xác nhận từng gói và toàn bộ job. Web hiện gửi gói data tối đa 1024 byte, tối đa 8000 lệnh, dù firmware thật có sức chứa 12000.

Luồng trạng thái: `idle → load → run → done`, hoặc `stop` khi dừng. Khi hoàn thành, máy nhấc bút và về gốc. Job nằm trong RAM, không có chức năng khôi phục bản vẽ sau mất nguồn.

Firmware đặt chu kỳ status khoảng 300 ms khi chạy, 2000 ms khi nghỉ; thời gian thực còn phụ thuộc đoạn chuyển động. **Mất Wi-Fi/MQTT không tự dừng job đã nạp.** Nút dừng qua mạng chỉ có tác dụng khi lệnh tới ESP32; cần kiểm tra phản hồi và máy thực tế. Các topic điều khiển, payload và quyền chi tiết nằm ở [giao thức trong README tổng](../README.md#11-giao-thức-mqtt-và-http).

## Mô phỏng Wokwi

Project riêng ở `test/wokwi/` dùng lại logic firmware; giữ cả thư mục `firmware/` khi checkout.

| Thành phần | Máy thật | Wokwi |
| --- | --- | --- |
| Environment | `esp32c5` | `wokwi` |
| Wi-Fi | Portal/NVS hoặc mặc định cục bộ | `Wokwi-GUEST`, không mật khẩu |
| Broker mặc định | Cấu hình IP LAN | `host.wokwi.internal:1883` |
| Tài khoản mẫu | Tài khoản đã tạo tại broker | `user1 / 1` |
| LCD SCL | TX/GPIO11 | GPIO7 |
| Cảm biến | DHT11 | DHT22 qua adapter GPIO |
| Servo | Thiết lập LEDC trong firmware | Adapter chọn clock `LEDC_USE_RC_FAST_CLK` |
| Bộ đệm job | 12000 lệnh | 8000 lệnh |

Chuẩn bị dependency broker và tài khoản demo `user1 / 1` có quyền operator như hướng dẫn hệ thống, rồi:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/build-wokwi.ps1
node test/start-broker.cjs ..
```

Script build giữ output environment thường khi chuyển giữa các bản mô phỏng kiểm thử. Lệnh tương đương khi `pio` có trong PATH:

```powershell
pio run --project-dir test/wokwi -e wokwi --disable-auto-clean -j 4
```

Trong IDE chọn **Wokwi: Select Config File → firmware/test/wokwi/wokwi.toml** nếu mở cả repo, hoặc **test/wokwi/wokwi.toml** nếu mở riêng firmware, rồi **Start Simulator**. Cấu hình trỏ tới `.pio/build/wokwi/firmware.factory.bin` và `firmware.elf` bên trong project mô phỏng.

Mở `http://localhost:3000`, đăng nhập `user1 / 1`, giữ **Mô phỏng trong giao diện web tắt** để nút gửi MQTT tới Wokwi. Cần gateway Wokwi có thể truy cập broker local. Không chạy máy thật và mô phỏng cùng `cnc01` trên một broker; chúng nhận cùng topic lệnh.

Environment `wokwi-test` dùng MQTT cổng 1884, dành cho kiểm thử tách biệt; không phải binary được `test/wokwi/wokwi.toml` mặc định sử dụng. Chi tiết sơ đồ/adapter: [test/WOKWI.md](test/WOKWI.md).

## Kiểm thử

### Test trên máy tính, không kết nối CNC

Cần Python và trình biên dịch `g++` trong PATH:

```powershell
python -m unittest discover -s test -p 'test_*.py'
```

Hoặc chạy từng bài:

```powershell
python test/test_motion_pulses.py
python test/test_calibration_measurements.py
python test/test_network_config.py
python test/test_job_buffer.py
python test/test_startup_network.py
```

| Bài | Phạm vi | Kết quả chạy ngày 02/11/2026 |
| --- | --- | --- |
| `test_motion_pulses.py` | 9409 đoạn, các hướng/trục, đường tròn và dừng giữa chuyển động | Đạt |
| `test_calibration_measurements.py` | Số đo mm, hệ số độc lập, NVS và cờ hiệu chỉnh | Còn hai tình huống không đạt |
| `test_network_config.py` | NVS, đổi Wi-Fi/broker, ép AP và dừng trước reboot | Đạt |
| `test_job_buffer.py` | 12000 lệnh, parser, tràn dung lượng, giải phóng và cấp phát lỗi | Đạt |
| `test_startup_network.py` | Wi-Fi/MQTT lúc boot, từ chối tài khoản, timeout và thiếu bộ đệm | Đạt |

Tổng cộng **4/5 bài đạt**. Hai tình huống còn lỗi trong bài hiệu chỉnh:

1. Limit từ cấu hình cũ vẫn bị đánh dấu là đã đo mm.
2. Đặt gốc không xóa cờ đã đo theo kỳ vọng của test, kể cả sau khi nạp lại NVS.

Các lỗi này đã được ghi trong [VALIDATION.md](VALIDATION.md) và tái hiện trong lượt kiểm tra ngày 02/11/2026; không phải kết quả nghiệm thu toàn bộ firmware đạt.

### Kiểm tra Wokwi đang chạy

Cần cài dependency trong `../mobile` và có broker/Wokwi đúng cấu hình. Chỉ đọc telemetry:

```powershell
node test/check-simulation.cjs ..
```

Các lệnh sau **gửi điều khiển**; chỉ chạy khi đã xác định thiết bị nhận là simulator, không có CNC thật cùng topic:

```powershell
node test/check-simulation.cjs .. --control
node test/check-web-actuators.cjs ..
```

Bài actuators bật/tắt LED và nâng/hạ servo. Chạy tuần tự, không thao tác từ phiên điều khiển khác cùng lúc. Sau khi dừng simulator để xuất VCD:

```powershell
node test/check-actuator-signals.cjs
```

Log/VCD nằm ở `test/.runtime/`. Báo cáo các lượt mô phỏng trước: [test/WOKWI-VALIDATION.md](test/WOKWI-VALIDATION.md). Đợt hoàn thiện README không nạp thiết bị, không chạy chuyển động CNC thật và không chạy lại Wokwi; test host không xác nhận nguồn, điện áp hoặc độ chính xác cơ khí.

## Xử lý sự cố

| Hiện tượng | Kiểm tra |
| --- | --- |
| Không tìm thấy `pio` | Dùng executable trong `.platformio/penv/Scripts/` hoặc terminal PlatformIO |
| Upload lỗi/cổng bận | Chọn cổng từ `pio device list`, đóng Serial Monitor/phần mềm giữ cổng |
| Không thấy log Serial | Đúng cổng USB CDC, baud 115200; không dùng TX/GPIO11 cho UART khi chân này đang nối LCD |
| Boot xong phát KimPang | Xem Wi-Fi, địa chỉ MQTT, cổng 1883, tài khoản broker; đây là cơ chế quay về portal khi chưa vào được điều khiển |
| KimPang không nhận IP | DHCP tự động, quên mạng rồi nối lại; dùng firmware có bản sửa giải phóng bộ đệm khi vào AP |
| Sửa `secrets.h` nhưng vẫn nối mạng cũ | NVS đang ưu tiên; đổi qua portal |
| Broker online nhưng không điều khiển được | Chờ telemetry ESP32, kiểm device ID và quyền operator/admin |
| Jog không chạy sau dừng | `control/stop` giữ cờ dừng; khi đã kiểm tra vùng chạy, lệnh GỐC xóa cờ và đưa máy về gốc phần mềm |
| Motor rung/ngược/sai kích thước | Kiểm cặp cuộn, nguồn, giới hạn dòng, vi bước, cờ đảo DIR và hiệu chỉnh đo thực |
| LCD trắng/không có chữ | Nguồn, tương phản, chuyển mức I2C, địa chỉ, SCL thật GPIO11 khác Wokwi GPIO7 |
| Servo tự nhấc sau một lúc | Có cơ chế nhấc bút khi nghỉ khoảng 15 giây; nếu kèm reboot, kiểm nguồn và log |
| Wokwi báo thiếu firmware | Build environment `wokwi`, chọn đúng file cấu hình và đường dẫn output mô phỏng |

## File cục bộ và tài liệu liên quan

Không đưa `include/secrets.h`, `.pio/`, `test/.runtime/`, `test/.tools/`, cache Python, flash/NVS backup và log có thông tin riêng lên Git. `.gitignore` chỉ áp dụng cho file chưa được track; kiểm tra danh sách stage trước khi tự publish.

- [README tổng: triển khai, database, Android và chuẩn bị GitHub](../README.md)
- [Đổi Wi-Fi/broker và kiểm chứng portal](test/NETWORK-CONFIG.md)
- [Hướng dẫn Wokwi](test/WOKWI.md)
- [Báo cáo kiểm chứng khi gộp firmware](VALIDATION.md)
- [Báo cáo kiểm chứng Wokwi](test/WOKWI-VALIDATION.md)
