/**
 * ═════════════════════════════════════════════════════════════════════════════════════════
 * HỆ THỐNG ĐIỀU KHIỂN & VẼ HÌNH/ẢNH MÁY CNC 2 TRỤC (ESP32 IoT CNC WEB APP)
 * ═════════════════════════════════════════════════════════════════════════════════════════
 * File: script.js
 * Giao thức: MQTT over WebSocket kết nối Broker Node.js & ESP32-C5 / ESP32 DevKit
 *
 * MỤC LỤC CÁC PHẦN:
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *  PHẦN 1: CẤU HÌNH HỆ THỐNG & TRẠNG THÁI TOÀN CỤC (GLOBAL STATE & CONFIG)
 *  PHẦN 2: KẾT NỐI BROKER MQTT & ĐIỀU PHỐI DỮ LIỆU (MQTT COMMUNICATION)
 *  PHẦN 3: THEO DÕI TRẠNG THÁI MÁY & TIẾN ĐỘ VẼ (STATUS & JOB MONITORING)
 *  PHẦN 4: HỦY LỆNH VẼ & DỪNG MÁY KHẨN CẤP AN TOÀN (EMERGENCY STOP & CANCEL)
 *  PHẦN 5: MÔ PHỎNG ẢO KHI ESP32 CHƯA KẾT NỐI (VIRTUAL SIMULATION ENGINE)
 *  PHẦN 6: ĐIỀU KHIỂN THỦ CÔNG & HIỆU CHUẨN (MANUAL CNC CONTROLS & CALIBRATION)
 *  PHẦN 7: BỘ PHÁT HÌNH HỌC TỰ ĐỘNG - SECTION 02 (AUTOMATIC SHAPE GENERATOR)
 *  PHẦN 8: XỬ LÝ ẢNH & TẠO ĐƯỜNG CHẠY DAO CNC - SECTION 03 (IMAGE PROCESSING & TOOLPATH)
 *  PHẦN 9: TƯƠNG TÁC KHÔNG GIAN LÀM VIỆC & CANVAS PREVIEW (WORKSPACE & PREVIEWS)
 *  PHẦN 10: ĐỒ THỊ TRỰC QUAN HÓA THỜI GIAN THỰC (ECHARTS & HTML5 CANVAS CHARTS)
 *  PHẦN 11: KHỞI CHẠY HỆ THỐNG (SYSTEM INITIALIZATION)
 * ═════════════════════════════════════════════════════════════════════════════════════════
 */

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 1: CẤU HÌNH HỆ THỐNG & TRẠNG THÁI TOÀN CỤC (GLOBAL STATE & CONFIG)
// ═════════════════════════════════════════════════════════════════════════════════════════

/** Tên định danh thiết bị máy CNC */
const DEVICE = 'cnc01';

/**
 * Trạng thái ứng dụng toàn cục (State Store)
 */
const state = {
  client: null,             // Đối tượng MQTT Client (Paho/MQTT.js)
  user: '',                 // Tên tài khoản MQTT Broker
  password: '',             // Mật khẩu MQTT Broker
  status: null,             // Gói JSON status mới nhất từ ESP32
  lock: '',                 // Trạng thái khóa phiên điều khiển
  positionHistory: [],      // Lịch sử tọa độ vẽ biểu đồ vị trí Canvas (60 điểm)
  dhtHistory: [],           // Lịch sử nhiệt độ/độ ẩm vẽ ECharts
  imagePaths: [],           // Danh sách chuỗi lệnh CNC sinh ra từ ảnh
  penDown: false,           // Trạng thái ngòi bút (true: hạ bút, false: nhấc bút)
  ledOn: false,             // Trạng thái đèn chiếu sáng LED (true: bật, false: tắt)
  logCount: 0,              // Số lượng log sự kiện đã ghi nhận
  isUploadingJob: false,    // Cờ đánh dấu đang nạp danh sách lệnh lên ESP32
  virtualJob: null,         // Tiến trình mô phỏng ảo đang chạy
  virtualX: 0,              // Tọa độ X ảo (khi chưa kết nối ESP32)
  virtualY: 0,              // Tọa độ Y ảo (khi chưa kết nối ESP32)
  virtualLimits: null,      // Giới hạn hành trình ảo
  _lastStatusReceivedTime: 0, // Thời điểm cuối nhận được status từ phần cứng ESP32
  _lastLogStatusTime: 0,    // Giới hạn tần suất in log status lên giao diện
  _lastRealMilestone: 0     // Mốc tiến độ vẽ thực tế đã log (0, 25, 50, 75, 100%)
};

/** Kích thước hệ tọa độ không gian làm việc ảo (500x500 đơn vị chuẩn) */
const V_SIZE = 500;
/** Tỷ lệ đường kính hình tròn so với giới hạn hành trình tương ứng */
const AUTO_CIRCLE_LIMIT_RATIO = 0.8;

/**
 * Cấu hình không gian xử lý ảnh & chuyển đổi đường chạy dao CNC
 */
const imgWs = {
  img: null,                // Đối tượng Image đã nạp từ người dùng
  imgW: 0,                  // Chiều rộng gốc của ảnh (px)
  imgH: 0,                  // Chiều cao gốc của ảnh (px)
  machineW: 230,            // Khổ bàn máy trục X thực tế (mm)
  machineH: 850,            // Khổ bàn máy trục Y thực tế (mm)
  x: 50,                    // Vị trí X của ảnh trong khung ảo (0..500)
  y: 50,                    // Vị trí Y của ảnh trong khung ảo (0..500)
  w: 400,                   // Chiều rộng ảnh trong khung ảo (0..500)
  h: 400,                   // Chiều cao ảnh trong khung ảo (0..500)
  mode: 'outline',          // Chế độ vẽ: 'outline' (vẽ viền) hoặc 'hatch' (tô màu nét ngang)
  outlineStyle: 'boundary', // Kiểu tách viền: 'boundary' (viền khối logo/chữ) hoặc 'canny' (viền mỏng 1-pixel)
  contrast: 0,              // Độ tương phản bổ sung (-100 đến +100)
  threshold: 128,           // Ngưỡng lọc trắng - đen nhị phân (15 đến 240)
  simplify: 1,              // Mức đơn giản hóa RDP đường viền (1 đến 10)
  minLen: 8,                // Độ dài nét tối thiểu để giữ chi tiết nhỏ (px)
  hatchSpacing: 3,          // Bước nét tô ngang liền kề (1 đến 20 mm)
  drawBorder: false,        // Tùy chọn: Vẽ thêm khung viền bao quanh chính bức ảnh
  isDragging: false,        // Cờ chuột đang kéo di chuyển ảnh
  dragStartX: 0,
  dragStartY: 0,
  imgStartX: 0,
  imgStartY: 0,
  processTimer: null,       // Timer debounce tránh xử lý ảnh liên tục khi kéo slider
  paths: [],                // Tập hợp đường vẽ dạng vector ảo [[{x, y}, ...], ...]
  cncOps: [],               // Danh sách lệnh chạy dao máy CNC thực tế
  bwCanvas: null            // Canvas lưu ảnh nhị phân Trắng - Đen xem trước tức thì
};

/**
 * Trợ thủ lấy phần tử DOM theo ID nhanh gọn
 * @param {string} id - ID của phần tử HTML
 * @returns {HTMLElement|null}
 */
const $ = id => document.getElementById(id);

/**
 * Sinh tên topic MQTT chuẩn hóa theo định dạng cnc/{DEVICE}/{rest}
 * @param {string} rest - Tên nhánh con của topic
 * @returns {string}
 */
const topic = rest => `cnc/${DEVICE}/${rest}`;

/**
 * Phân loại nhóm chức năng dựa trên tên topic để gắn nhãn nhật ký (log)
 * @param {string} rest - Đường dẫn topic con
 * @returns {string}
 */
function getSectionFromTopic(rest) {
  if (rest.startsWith('control/jog') || rest.startsWith('control/home')) return '01·ĐIỀU KHIỂN';
  if (rest.startsWith('control/pen') || rest.startsWith('control/led')) return '01·THIẾT BỊ';
  if (rest.startsWith('control/cal')) return '01·HIỆU CHUẨN';
  if (rest.startsWith('control/stop')) return '01·HỦY LỆNH';
  if (rest.startsWith('auto/square') || rest.startsWith('auto/circle')) return '02·VẼ HÌNH';
  if (rest.startsWith('auto/image')) return '03·VẼ ẢNH';
  return 'MQTT';
}

/**
 * Ghi nhật ký sự kiện vào khung console hiển thị trên Web UI
 * @param {string} message - Nội dung sự kiện
 * @param {string} section - Nhóm phân loại sự kiện
 */
function log(message, section = '') {
  state.logCount = (state.logCount || 0) + 1;
  const time = new Date().toLocaleTimeString('vi-VN');
  const tag = section ? `[${section}] ` : '';
  const line = `[${time}] ${tag}${message}`;
  const el = $('log');
  if (el) {
    if (!el.textContent || el.textContent.trim() === 'Chờ kết nối broker...') {
      el.textContent = line;
    } else {
      let content = `${el.textContent}\n${line}`;
      if (content.length > 20000) {
        content = content.slice(content.length - 18000);
      }
      el.textContent = content;
    }
    el.scrollTop = el.scrollHeight;
  } else {
    console.log(line);
  }
  if ($('logCount')) $('logCount').textContent = `${state.logCount} sự kiện`;
}

/**
 * Cập nhật trạng thái kết nối MQTT lên toàn bộ các badge giao diện
 * @param {string} label - Nhãn trạng thái hiển thị
 * @param {boolean} good - true: đã kết nối tốt, false: lỗi hoặc chưa kết nối
 */
function setConnection(label, good = false) {
  const element = $('connection');
  if (element) {
    element.textContent = label;
    element.className = `connection ${good ? 'ok' : label === 'Chưa kết nối' ? '' : 'bad'}`;
  }
  if ($('statusBadge')) $('statusBadge').textContent = label;
  if ($('liveState')) $('liveState').textContent = label;
  if ($('connectionState')) $('connectionState').textContent = label;
  if ($('connectionBadge')) {
    $('connectionBadge').textContent = good ? 'ĐÃ KẾT NỐI' : 'CHƯA KẾT NỐI';
    $('connectionBadge').className = `pill ${good ? 'pill-lime' : ''}`;
  }
  if ($('disconnect')) $('disconnect').style.display = good ? 'block' : 'none';
  if ($('connectBtn')) $('connectBtn').style.display = good ? 'none' : 'block';
}

/**
 * Gửi tin nhắn MQTT lên Broker kèm nhãn phân loại
 * @param {string} rest - Topic con
 * @param {string|number} payload - Nội dung dữ liệu gửi
 * @param {string} section - Nhóm phân loại log
 * @returns {boolean}
 */
function publish(rest, payload = '', section = '') {
  const fullTopic = topic(rest);
  const sec = section || getSectionFromTopic(rest);
  if (!state.client?.connected) {
    log(`Chưa kết nối broker. Không thể gửi [${fullTopic}]`, sec);
    return false;
  }
  const payloadStr = payload === '' ? '' : (String(payload).length > 80 ? ` · (${String(payload).length} bytes)` : ` · payload: ${payload}`);
  state.client.publish(fullTopic, String(payload), { qos: 1 }, error => {
    if (error) {
      log(`❌ Lỗi gửi ${fullTopic}: ${error.message}`, sec);
    } else {
      log(`📤 ${fullTopic}${payloadStr}`, sec);
    }
  });
  return true;
}

/**
 * Kiểm tra xem phần cứng ESP32 thực tế có đang hoạt động và gửi dữ liệu hay không
 * @returns {boolean}
 */
function isEspConnected() {
  if (!state.client?.connected) return false;
  if (!state.status) return false;
  if (state.status.state === 'offline') return false;
  // Nếu quá 25 giây không có status mới từ ESP32 thì coi như mất kết nối phần cứng
  if (Date.now() - (state._lastStatusReceivedTime || 0) > 25000) return false;
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 2: KẾT NỐI BROKER MQTT & ĐIỀU PHỐI DỮ LIỆU (MQTT COMMUNICATION)
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * Khởi tạo kết nối MQTT WebSocket với Broker Node.js
 * @param {Event} event - Sự kiện submit form đăng nhập
 */
function connect(event) {
  event.preventDefault();
  if (!window.mqtt) return log('Không tải được thư viện MQTT.', 'LỖI');
  if (state.client) state.client.end(true);

  state.user = $('username').value.trim();
  state.password = $('password').value;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.host || `${location.hostname || '127.0.0.1'}:3000`;
  const url = `${scheme}://${host}/mqtt`;

  setConnection('Đang kết nối...');
  log(`Đang kết nối broker: ${url} (User: ${state.user})...`, '01·KẾT NỐI');

  state.client = mqtt.connect(url, {
    clientId: `web-${Math.random().toString(16).slice(2)}`,
    username: state.user,
    password: state.password,
    reconnectPeriod: 2000,
    clean: true
  });

  // Khi kết nối thành công: đăng ký nhận các topic cốt lõi
  state.client.on('connect', () => {
    setConnection('Đã kết nối', true);
    log(`✅ Đã kết nối broker thành công (${url})`, '01·KẾT NỐI');
    log(`📥 Subscribed: ${topic('status')} & ${topic('lock')}`, '01·KẾT NỐI');
    state.client.subscribe([topic('status'), topic('lock'), 'sensor/temperature', 'sensor/humidity'], { qos: 1 });
  });

  // Xử lý các tin nhắn MQTT gửi đến trình duyệt
  state.client.on('message', (receivedTopic, payload) => {
    const value = payload.toString();

    // 1. Quản lý trạng thái khóa điều khiển máy
    if (receivedTopic.endsWith('/lock')) {
      state.lock = value;
      log(`📥 ${receivedTopic} -> ${value ? `Khóa bởi ${value}` : 'Đã mở khóa'}`, 'LOCK');
      return;
    }

    // 2. Dữ liệu cảm biến nhiệt độ riêng lẻ
    if (receivedTopic === 'sensor/temperature' || receivedTopic.endsWith('/temperature')) {
      const val = parseFloat(value);
      if (!isNaN(val)) {
        updateTempGauge(val);
        if ($('temperatureNote')) $('temperatureNote').textContent = 'sensor/temperature';
      }
    }

    // 3. Dữ liệu cảm biến độ ẩm riêng lẻ
    if (receivedTopic === 'sensor/humidity' || receivedTopic.endsWith('/humidity')) {
      const val = parseFloat(value);
      if (!isNaN(val)) {
        updateHumGauge(val);
        if ($('humidityNote')) $('humidityNote').textContent = 'sensor/humidity';
      }
    }

    // 4. Gói tin Status định kỳ tổng hợp từ ESP32
    if (receivedTopic.endsWith('/status')) {
      try {
        const data = JSON.parse(value);
        if (data.state !== 'offline') {
          state._lastStatusReceivedTime = Date.now();
          // Nếu đang chạy mô phỏng ảo mà máy thật phản hồi -> ngắt ngay chế độ ảo
          if (state.virtualJob) {
            clearInterval(state.virtualJob.intervalId);
            state.virtualJob = null;
            log('⚡ ESP32 thực tế đã phản hồi, kết thúc chế độ mô phỏng.', 'STATUS');
          }
        }
        renderStatus(data);

        // Hạn chế log status để tránh tràn khung nhật ký (tối đa 5s/lần)
        if (!state._lastLogStatusTime || Date.now() - state._lastLogStatusTime > 5000) {
          state._lastLogStatusTime = Date.now();
          log(`📥 ${receivedTopic} -> X: ${Math.round(data.x ?? 0)}mm, Y: ${Math.round(data.y ?? 0)}mm, Pen: ${data.pen ?? 'up'}`, 'STATUS');
        }
      } catch (_) {
        log(`Status không hợp lệ: ${value}`, 'LỖI');
      }
    }
  });

  state.client.on('error', error => {
    setConnection('Lỗi kết nối');
    log(`❌ Broker: ${error.message}`, 'LỖI');
  });

  state.client.on('close', () => {
    setConnection('Mất kết nối');
    log('⚠ Đã ngắt kết nối với broker', '01·KẾT NỐI');
  });
}

/**
 * Yêu cầu ESP32 xóa cấu hình WiFi cũ và khởi động lại vào AP cứu hộ "KimPang"
 */
function handleResetWifi() {
  if (!state.client?.connected) {
    alert('Vui lòng đăng nhập và kết nối Broker trước khi thực hiện đổi WiFi cho ESP32!');
    return;
  }
  const confirmed = confirm(
    'BẠN CÓ CHẮC CHẮN MUỐN CẤU HÌNH LẠI WIFI CHO ESP32?\n\n' +
    '1. ESP32 sẽ xóa thông tin WiFi cũ và khởi động lại.\n' +
    '2. Máy sẽ tự phát mạng WiFi cứu hộ "KimPang" (Mật khẩu: 88888888).\n' +
    '3. Bạn chỉ cần kết nối vào WiFi "KimPang" và mở trình duyệt http://192.168.4.1 để nhập mạng WiFi mới.\n\n' +
    'Bấm OK để tiến hành chuyển sang AP Mode.'
  );
  if (!confirmed) return;

  publish('control/wifi/reset', '1');
  log('⚠️ Đã gửi lệnh yêu cầu ESP32 chuyển sang chế độ phát WiFi cứu hộ KimPang...', '01·ĐIỀU KHIỂN');
  alert('Đã gửi lệnh thành công!\n\nESP32 đang khởi động lại vào chế độ phát WiFi:\n• Tên WiFi (SSID): KimPang\n• Mật khẩu: 88888888\n• Trang cài đặt: http://192.168.4.1');
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 3: THEO DÕI TRẠNG THÁI MÁY & TIẾN ĐỘ VẼ (STATUS & JOB MONITORING)
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * Tiếp nhận dữ liệu status JSON từ ESP32 và cập nhật toàn bộ thông số lên giao diện Web
 * @param {object} data - Dữ liệu status từ ESP32
 */
function renderStatus(data) {
  state.status = data;
  if ($('status')) $('status').textContent = JSON.stringify(data, null, 2);

  const x = Number(data.x ?? 0);
  const rawY = Number(data.y ?? 0);
  const y = Math.abs(rawY);
  const xMin = Number(data.range?.x?.[0] ?? 0);
  const xMax = Number(data.range?.x?.[1] ?? 230);
  let yMin = Number(data.range?.y?.[0] ?? 0);
  let yMax = Number(data.range?.y?.[1] ?? 850);
  if (yMin < 0 && yMax <= 0) {
    yMax = Math.abs(yMin - yMax) || 850;
    yMin = 0;
  }

  // Cập nhật mảng lịch sử tọa độ cho biểu đồ Canvas
  const xPercent = Math.max(0, Math.min(1, (x - xMin) / (xMax - xMin || 1)));
  const yPercent = Math.max(0, Math.min(1, (y - yMin) / (yMax - yMin || 1)));
  state.positionHistory.push({ xPercent, yPercent });
  if (state.positionHistory.length > 60) state.positionHistory.shift();

  // Hiển thị tọa độ X, Y
  $('axisXValue').textContent = `${Math.round(x)} mm`;
  $('axisYValue').textContent = `${Math.round(y)} mm`;
  const displayLimitX = (xMax > 20 && xMax <= 2000) ? `${Math.round(xMin)}..${Math.round(xMax)}` : 'Chưa chốt limit';
  const displayLimitY = (yMax > 20 && yMax <= 3000) ? `${Math.round(yMin)}..${Math.round(yMax)}` : 'Chưa chốt limit';
  if ($('motorXNote')) $('motorXNote').textContent = `${Math.round(x)} mm · Giới hạn: ${displayLimitX}`;
  if ($('motorYNote')) $('motorYNote').textContent = `${Math.round(y)} mm · Giới hạn: ${displayLimitY}`;

  // Cập nhật đồng hồ Gauge vị trí X, Y (ECharts) với thang đo an toàn
  const gaugeMaxX = (xMax > 20 && xMax <= 1000) ? xMax : 230;
  const gaugeMaxY = (yMax > 20 && yMax <= 2000) ? yMax : 850;
  if (typeof updateMotorXGauge === 'function') updateMotorXGauge(x, 0, gaugeMaxX);
  if (typeof updateMotorYGauge === 'function') updateMotorYGauge(y, 0, gaugeMaxY);

  // Đồng bộ thanh kéo tốc độ động cơ
  if (data.speed && $('speedSlider') && document.activeElement !== $('speedSlider')) {
    $('speedSlider').value = data.speed;
    if ($('speedValue')) $('speedValue').textContent = `${data.speed} bước/s`;
  }

  // Hiển thị thông số trên thanh điều khiển jog & căn chỉnh limit
  if ($('jogPosDisplay')) $('jogPosDisplay').textContent = `X: ${Math.round(x)} mm · Y: ${Math.round(y)} mm`;
  if ($('jogCalDisplay')) {
    if (data.calibrated || data.cal === 2) {
      $('jogCalDisplay').textContent = `Đã chốt limit: X[${Math.round(xMin)}..${Math.round(xMax)}], Y[${Math.round(yMin)}..${Math.round(yMax)}]`;
      $('jogCalDisplay').style.color = '#00b894';
    } else if (xMin <= -50000 || xMax >= 50000) {
      $('jogCalDisplay').textContent = 'Đã đặt gốc (0,0) — Hãy di chuyển đến biên rồi bấm "Đặt limit"';
      $('jogCalDisplay').style.color = '#fdcb6e';
    } else {
      $('jogCalDisplay').textContent = 'Chưa đặt gốc';
      $('jogCalDisplay').style.color = '#e17055';
    }
  }

  // Vẽ lại biểu đồ vị trí Canvas
  drawPositionChart();

  // Hiển thị thông số căn chỉnh hiệu chuẩn
  if ($('calLimitX')) $('calLimitX').textContent = `${Math.round(xMin)}..${Math.round(xMax)}`;
  if ($('calLimitY')) $('calLimitY').textContent = `${Math.round(yMin)}..${Math.round(yMax)}`;
  if ($('calScaleX')) $('calScaleX').textContent = Number(data.scale?.x ?? 1).toFixed(3);
  if ($('calScaleY')) $('calScaleY').textContent = Number(data.scale?.y ?? 1).toFixed(3);

  const calEl = $('calStatus');
  if (calEl) {
    if (data.calibrated || data.cal === 2) {
      calEl.innerHTML = `<strong>✅ Đã căn chỉnh & đồng bộ 2 trục</strong> — Tỉ lệ X: <b>${Number(data.scale?.x ?? 1).toFixed(3)}</b>, Y: <b>${Number(data.scale?.y ?? 1).toFixed(3)}</b>`;
      calEl.style.color = '#00b894';
      if ($('calBadge')) $('calBadge').textContent = 'ĐÃ ĐỒNG BỘ';
    } else {
      calEl.innerHTML = '<strong>⚠ Chưa căn chỉnh</strong> — Hãy đưa máy về gốc → Bấm <b>📍 Đặt gốc</b>, sau đó di chuyển kịch trục → Bấm <b>📏 Đặt limit</b>.';
      calEl.style.color = '#d63031';
      if ($('calBadge')) $('calBadge').textContent = 'CHƯA CĂN CHỈNH';
    }
  }

  // Cập nhật thông số nhiệt độ & độ ẩm DHT11
  const dht = data.dht11 && typeof data.dht11 === 'object' ? data.dht11 : data;
  const temperature = Number(dht.temperatureC ?? dht.temperature ?? data.temperature ?? data.temp);
  const humidity = Number(dht.humidity ?? data.humidity ?? data.hum ?? data.environment?.humidity);
  const dhtValid = data.dht11 === false || dht.valid === false || dht.ok === false
    ? false
    : Number.isFinite(temperature) && Number.isFinite(humidity);
  const dhtAge = Number(dht.age_s);
  const dhtFreshness = Number.isFinite(dhtAge) ? `DHT11 · ${dhtAge}s trước` : 'DHT11';

  if (dhtValid) {
    if ($('temperatureValue')) $('temperatureValue').textContent = `${temperature.toFixed(1)} °C`;
    if ($('temperatureNote')) $('temperatureNote').textContent = dhtFreshness;
    if ($('dhtChartTempValue')) $('dhtChartTempValue').textContent = `${temperature.toFixed(1)} °C`;
    if (typeof updateTempGauge === 'function') updateTempGauge(temperature);

    if ($('humidityValue')) $('humidityValue').textContent = `${humidity.toFixed(1)} %`;
    if ($('humidityNote')) $('humidityNote').textContent = dhtFreshness;
    if ($('dhtChartHumValue')) $('dhtChartHumValue').textContent = `${humidity.toFixed(1)} %`;
    if (typeof updateHumGauge === 'function') updateHumGauge(humidity);

    if (typeof updateDhtTrend === 'function') updateDhtTrend(temperature, humidity);
  } else {
    if ($('temperatureValue')) $('temperatureValue').textContent = '-- °C';
    if ($('temperatureNote')) $('temperatureNote').textContent = 'DHT11 chưa phản hồi';
    if ($('humidityValue')) $('humidityValue').textContent = '-- %';
    if ($('humidityNote')) $('humidityNote').textContent = 'DHT11 chưa phản hồi';
  }

  const position = `X ${x} · Y ${y}`;
  if ($('livePosition')) $('livePosition').textContent = position;
  if ($('positionBadge')) $('positionBadge').textContent = position;
  if ($('liveState')) $('liveState').textContent = data.state || data.job?.s || 'Đang hoạt động';
  if ($('statusBadge')) $('statusBadge').textContent = data.state || data.job?.s || 'Đang hoạt động';
  if ($('liveJob')) $('liveJob').textContent = data.job?.k ? `${data.job.k} · ${data.job.i ?? 0}/${data.job.n ?? 0}` : 'Không có';

  // Đồng bộ trạng thái bút và đèn LED từ firmware
  if (data.pen !== undefined) {
    state.penDown = data.pen === 'down';
    updateToggleButtons();
  }
  if (data.led !== undefined) {
    state.ledOn = !!data.led;
    updateToggleButtons();
  }

  // Đồng bộ góc servo đã lưu trên ESP32 Flash NVS về giao diện Web (nếu người dùng không đang gõ)
  if (data.penUp !== undefined && $('penUp') && document.activeElement !== $('penUp')) {
    $('penUp').value = data.penUp;
    localStorage.setItem('cnc_penUp', String(data.penUp));
  }
  if (data.penDown !== undefined && $('penDown') && document.activeElement !== $('penDown')) {
    $('penDown').value = data.penDown;
    localStorage.setItem('cnc_penDown', String(data.penDown));
  }

  // Cập nhật tiến độ vẽ bản vẽ đang thi hành
  if (data.job) {
    updateJobProgress(data.job);
  }
}

/**
 * Cập nhật thanh tiến độ % vẽ, số điểm hoàn thành và thông điệp hướng dẫn
 * @param {object} job - Thông tin tiến độ bản vẽ { s, i, n, k, isVirtual }
 */
function updateJobProgress(job) {
  if (!job) return;
  const status = job.s || 'idle';
  const total = Number(job.n) || 0;
  const current = Number(job.i) || 0;
  const kind = job.k || '';
  const isVirtual = Boolean(job.isVirtual);

  let percent = 0;
  if (total > 0) {
    percent = Math.min(100, Math.round((current / total) * 100));
  }
  if (status === 'done') percent = 100;

  const kindNames = {
    square: 'Hình vuông □',
    circle: 'Hình tròn ○',
    image: 'Vẽ từ ảnh'
  };
  const baseKind = kindNames[kind] || (kind ? `Bản vẽ ${kind}` : 'Chưa có bản vẽ');
  const kindLabel = isVirtual && kind ? `${baseKind} (Ảo)` : baseKind;

  function setBadge(badgeEl, s) {
    if (!badgeEl) return;
    badgeEl.className = 'progress-badge';
    if (s === 'run' || s === 'running') {
      badgeEl.classList.add('job-badge-running');
      badgeEl.textContent = isVirtual ? 'ĐANG VẼ (ẢO)' : 'ĐANG VẼ';
    } else if (s === 'done') {
      badgeEl.classList.add('job-badge-done');
      badgeEl.textContent = isVirtual ? 'HOÀN THÀNH (ẢO)' : 'HOÀN THÀNH';
    } else if (s === 'stop') {
      badgeEl.classList.add('job-badge-stopped');
      badgeEl.textContent = isVirtual ? 'ĐÃ HỦY (ẢO)' : 'ĐÃ HỦY';
    } else if (s === 'load') {
      badgeEl.classList.add('job-badge-loading');
      badgeEl.textContent = isVirtual ? 'ĐANG NẠP (ẢO)' : 'ĐANG NẠP';
    } else {
      badgeEl.textContent = 'SẴN SÀNG';
    }
  }

  // Cập nhật Section 02: Vẽ hình học tự động
  if ($('jobPercent')) $('jobPercent').textContent = percent;
  if ($('jobProgressBar')) $('jobProgressBar').style.width = `${percent}%`;
  if ($('jobKindName')) $('jobKindName').textContent = kindLabel;
  if ($('jobStepDetail')) $('jobStepDetail').textContent = `${current} / ${total} điểm`;
  setBadge($('jobStateBadge'), status);

  if ($('jobMessage')) {
    const prefix = isVirtual ? '[ẢO] ' : '';
    if (status === 'run' || status === 'running') {
      $('jobMessage').textContent = `${prefix}Đang vẽ ${baseKind}: ${current}/${total} điểm (${percent}%)...`;
    } else if (status === 'done') {
      $('jobMessage').textContent = `✅ ${prefix}Đã hoàn thành bản vẽ ${baseKind} (100%${isVirtual ? ' - Mô phỏng' : ''}). Tự động về gốc (0,0).`;
    } else if (status === 'stop') {
      $('jobMessage').textContent = `🛑 ${prefix}Đã hủy lệnh vẽ tại ${current}/${total} điểm (${percent}%). Đã nhấc bút an toàn.`;
    }
  }

  // Cập nhật Section 03: Vẽ từ ảnh
  if ($('imageJobPercent')) $('imageJobPercent').textContent = percent;
  if ($('imageJobProgressBar')) $('imageJobProgressBar').style.width = `${percent}%`;
  if ($('imageJobStepDetail')) $('imageJobStepDetail').textContent = `${current} / ${total} điểm`;
  setBadge($('imageJobBadge'), status);

  if ($('imageJobMessage')) {
    const prefix = isVirtual ? '[ẢO] ' : '';
    if (status === 'run' || status === 'running') {
      $('imageJobMessage').textContent = `${prefix}Đang vẽ: ${current}/${total} điểm (${percent}%)...`;
    } else if (status === 'done') {
      $('imageJobMessage').textContent = `✅ ${prefix}Đã hoàn thành đường vẽ từ ảnh (100%${isVirtual ? ' - Mô phỏng' : ''}). Tự động về gốc (0,0).`;
    } else if (status === 'stop') {
      $('imageJobMessage').textContent = `🛑 ${prefix}Đã hủy lệnh vẽ ảnh tại ${percent}%. Đã nhấc bút an toàn.`;
    }
  }

  // Log mốc tiến độ định kỳ (25%, 50%, 75%) cho máy thực tế
  if (!isVirtual && (status === 'run' || status === 'running')) {
    const milestone = Math.floor(percent / 25) * 25;
    if (milestone > (state._lastRealMilestone || 0) && milestone < 100) {
      state._lastRealMilestone = milestone;
      const sec = kind === 'image' ? '03·VẼ ẢNH' : '02·VẼ HÌNH';
      log(`[THỰC TẾ] Tiến độ ${milestone}%: Lệnh ${current}/${total} điểm · ESP32 đang vẽ`, sec);
    }
  }

  // Completion and return-to-origin are handled by the firmware job controller.
  if (!isVirtual && status === 'done' && state._lastRealMilestone !== 100) {
    state._lastRealMilestone = 100;
    const sec = kind === 'image' ? '03·VẼ ẢNH' : '02·VẼ HÌNH';
    log(`✅ [THỰC TẾ] ESP32 đã hoàn thành bản vẽ ${baseKind} (100%) - Đã yêu cầu về gốc (0,0).`, sec);
  }

  if (!isVirtual && status === 'stop') {
    state._lastRealMilestone = 0;
    const sec = kind === 'image' ? '03·VẼ ẢNH' : '02·VẼ HÌNH';
    log(`🛑 [THỰC TẾ] ESP32 đã hủy bản vẽ ${baseKind} tại ${percent}%`, sec);
  }

  if (status === 'idle') {
    state._lastRealMilestone = 0;
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 4: HỦY LỆNH VẼ & DỪNG MÁY KHẨN CẤP AN TOÀN (EMERGENCY STOP & CANCEL)
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * HỦY LỆNH VẼ TRIỆT ĐỂ (Cancel Job Guarantee):
 * Đảm bảo hủy hoàn toàn lệnh mà không cần nạp lại chip ESP32:
 * 1. Ngắt ngay lập tức mọi tiến trình gửi lệnh dở dang (isUploadingJob = false).
 * 2. Ngắt mô phỏng ảo nếu có.
 * 3. Gửi lệnh ngắt động cơ tức thì (control/stop).
 * 4. Gửi lệnh nhấc bút an toàn (control/pen/up).
 * 5. Xóa sạch bộ nhớ đệm lệnh vẽ trên ESP32 (auto/image/begin {"n":0} và auto/square/begin 0).
 * 6. Sau 40ms, tái gửi control/stop để xóa tan mọi xung đột race-condition.
 * 7. Cập nhật giao diện: badge 'ĐÃ HỦY', thông báo hủy rõ ràng, mở khóa lại nút gửi.
 * @param {string} source - Nguồn phát lệnh hủy
 */
function handleCancelJob(source = '01·HỦY LỆNH') {
  log('🛑 Đã bấm nút: HỦY LỆNH VẼ!', source);
  state.isUploadingJob = false; // Hủy upload dở dang ngay lập tức

  if (state.virtualJob) {
    stopVirtualJob();
  }

  if (state.client?.connected) {
    // 1. Dừng ngay tức thì động cơ nếu đang bước
    publish('control/stop', '', source);

    // 2. Nhấc bút lên góc nhấc an toàn ngay lập tức
    const upAngle = Number($('penUp')?.value) || 110;
    const downAngle = Number($('penDown')?.value) || 80;
    publish('control/pen/up', String(upAngle), source);

    // 3. Xóa sạch bộ nhớ lệnh trên ESP32: đưa số lệnh (n) về 0
    publish('auto/image/begin', JSON.stringify({ n: 0, up: upAngle, down: downAngle }), source);
    publish('auto/square/begin', '0', source);

    // 4. Gửi xác nhận lại stop sau 40ms để xóa tan mọi race-condition
    setTimeout(() => {
      if (state.client?.connected) {
        publish('control/stop', '', source);
      }
    }, 40);
  }

  // Cập nhật giao diện Web về trạng thái ĐÃ HỦY ngay lập tức
  updateJobProgress({
    s: 'stop',
    i: 0,
    n: 0,
    k: '',
    isVirtual: !isEspConnected()
  });

  const setBadgeCanceled = (badgeEl) => {
    if (!badgeEl) return;
    badgeEl.className = 'progress-badge job-badge-stopped';
    badgeEl.textContent = 'ĐÃ HỦY';
  };

  setBadgeCanceled($('jobStateBadge'));
  setBadgeCanceled($('imageJobBadge'));

  if ($('jobMessage')) {
    $('jobMessage').textContent = '🛑 Đã hủy lệnh vẽ. Động cơ đã dừng và đầu bút đã nhấc lên an toàn.';
  }
  if ($('imageJobMessage')) {
    $('imageJobMessage').textContent = '🛑 Đã hủy lệnh vẽ. Đã giải phóng bộ nhớ lệnh và nhấc bút an toàn.';
  }

  // Mở khóa lại nút gửi ảnh nếu có đường vẽ sẵn sàng
  if ($('sendImagePath') && state.imagePaths && state.imagePaths.length > 0) {
    $('sendImagePath').disabled = false;
  }
}

/**
 * Xử lý nút dừng máy khẩn cấp
 */
function handleStopMachine() {
  handleCancelJob('01·HỦY LỆNH');
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 5: MÔ PHỎNG ẢO KHI ESP32 CHƯA KẾT NỐI (VIRTUAL SIMULATION ENGINE)
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * Dừng tiến trình mô phỏng ảo nếu đang chạy
 */
function stopVirtualJob() {
  if (state.virtualJob?.intervalId) {
    clearInterval(state.virtualJob.intervalId);
  }
  if (state.virtualJob) {
    const kind = state.virtualJob.kind;
    const kindNames = { square: 'Hình vuông □', circle: 'Hình tròn ○', image: 'Vẽ từ ảnh' };
    const kindLabel = kindNames[kind] || kind;
    const percent = Math.min(100, Math.round((state.virtualJob.index / state.virtualJob.total) * 100));
    updateJobProgress({
      s: 'stop',
      i: state.virtualJob.index,
      n: state.virtualJob.total,
      k: kind,
      isVirtual: true
    });
    const sec = state.virtualJob.source === 'image' ? '03·VẼ ẢNH ẢO' : '02·VẼ ẢO';
    log(`🛑 [ẢO] Đã hủy bản vẽ mô phỏng: ${kindLabel} tại ${percent}% (ESP32 chưa kết nối)`, sec);
    state.virtualJob = null;
  }
}

/**
 * Khởi chạy mô phỏng nét vẽ ảo trên Web UI khi chưa có phần cứng ESP32
 * @param {Array<string>} ops - Danh sách lệnh vẽ "X,Y;Pen"
 * @param {string} kind - Loại hình vẽ ('square', 'circle', 'image')
 * @param {string} source - Nguồn gọi lệnh ('shape' hoặc 'image')
 */
function startVirtualJob(ops, kind, source = 'shape') {
  if (!ops || ops.length === 0) return;
  if (state.virtualJob) stopVirtualJob();

  const total = ops.length;
  const kindNames = { square: 'Hình vuông □', circle: 'Hình tròn ○', image: 'Vẽ từ ảnh' };
  const kindLabel = kindNames[kind] || kind;
  const sec = source === 'image' ? '03·VẼ ẢNH ẢO' : '02·VẼ ẢO';

  // Thời lượng diễn hoạt mô phỏng: từ 3.0s đến 6.5s tùy độ dài tập lệnh
  const targetDurationMs = Math.min(6500, Math.max(3000, total * 35));
  const tickMs = 40; // ~25 FPS
  const totalTicks = Math.max(1, Math.floor(targetDurationMs / tickMs));
  const stepPerTick = Math.max(1, Math.ceil(total / totalTicks));

  state.virtualJob = {
    ops,
    kind,
    source,
    total,
    index: 0,
    startTime: Date.now(),
    intervalId: null
  };

  updateJobProgress({
    s: 'run',
    i: 0,
    n: total,
    k: kind,
    isVirtual: true
  });
  log(`⚡ [ẢO] Bắt đầu vẽ tự động mô phỏng: ${kindLabel} (${total} điểm lệnh) [CHÚ THÍCH: ESP32 CHƯA KẾT NỐI]`, sec);

  let lastReportedMilestone = 0;

  state.virtualJob.intervalId = setInterval(() => {
    if (!state.virtualJob) return;

    state.virtualJob.index = Math.min(total, state.virtualJob.index + stepPerTick);
    const i = state.virtualJob.index;
    const currentOp = ops[Math.min(total - 1, i)];

    let x = state.virtualX ?? 0, y = state.virtualY ?? 0, pen = state.penDown ? 'down' : 'up';
    if (currentOp) {
      if (currentOp === 'U') {
        pen = 'up';
      } else if (currentOp === 'D') {
        pen = 'down';
      } else {
        const parts = currentOp.split(';');
        if (parts.length > 1) {
          pen = parts[1] === 'D' ? 'down' : 'up';
        }
        const coords = (parts[0] || '').split(',');
        if (coords.length >= 2) {
          x = Number(coords[0]) || 0;
          y = Number(coords[1]) || 0;
        }
      }
    }

    state.virtualX = x;
    state.virtualY = y;
    state.penDown = pen === 'down';

    // Cập nhật vị trí ảo lên giao diện
    if ($('jogPosDisplay')) $('jogPosDisplay').textContent = `X: ${Math.round(x)} mm · Y: ${Math.round(y)} mm (Ảo)`;
    if ($('axisXValue')) $('axisXValue').textContent = `${Math.round(x)} mm`;
    if ($('axisYValue')) $('axisYValue').textContent = `${Math.round(y)} mm`;
    if ($('motorXNote')) $('motorXNote').textContent = `${Math.round(x)} mm · Mô phỏng ảo`;

    const xMin = 0, xMax = 230, yMin = 0, yMax = 850;
    const posY = Math.abs(y);
    const xPercent = Math.max(0, Math.min(1, (x - xMin) / (xMax - xMin || 1)));
    const yPercent = Math.max(0, Math.min(1, (posY - yMin) / (yMax - yMin || 1)));
    state.positionHistory.push({ xPercent, yPercent });
    if (state.positionHistory.length > 60) state.positionHistory.shift();
    drawPositionChart();

    if (typeof updateMotorXGauge === 'function') updateMotorXGauge(x);
    if (typeof updateMotorYGauge === 'function') updateMotorYGauge(posY);

    const percent = Math.min(100, Math.round((i / total) * 100));

    updateJobProgress({
      s: i >= total ? 'done' : 'run',
      i,
      n: total,
      k: kind,
      isVirtual: true
    });

    const milestone = Math.floor(percent / 25) * 25;
    if (milestone > lastReportedMilestone && milestone < 100) {
      lastReportedMilestone = milestone;
      log(`[ẢO] Tiến độ ${milestone}%: Lệnh ${i}/${total} · X=${Math.round(x)}, Y=${Math.round(y)} · Bút: ${pen === 'down' ? 'HẠ ▼' : 'NHẤC ▲'}`, sec);
    }

    // Khi hoàn thành hết toàn bộ điểm lệnh ảo
    if (i >= total) {
      clearInterval(state.virtualJob.intervalId);
      state.virtualJob = null;
      state.penDown = false;
      state.virtualX = 0;
      state.virtualY = 0;
      if ($('jogPosDisplay')) $('jogPosDisplay').textContent = `X: 0 mm · Y: 0 mm (Ảo)`;
      if ($('axisXValue')) $('axisXValue').textContent = `0 mm`;
      if ($('axisYValue')) $('axisYValue').textContent = `0 mm`;
      if ($('motorXNote')) $('motorXNote').textContent = `0 mm · Đã về gốc (0,0)`;
      if ($('motorYNote')) $('motorYNote').textContent = `0 mm · Đã về gốc (0,0)`;
      if (typeof updateMotorXGauge === 'function') updateMotorXGauge(0);
      if (typeof updateMotorYGauge === 'function') updateMotorYGauge(0);
      updateToggleButtons();
      log(`✅ [ẢO] Đã hoàn thành bản vẽ: ${kindLabel} (100% - Tự động đưa đầu bút về gốc 0,0)`, sec);
    }
  }, tickMs);
}

/**
 * Mô phỏng điều khiển thủ công Jog và căn chỉnh Limit ảo khi chưa có phần cứng
 * @param {string} topicName - Tên lệnh điều khiển
 * @param {string|number} payload - Tham số gửi
 * @param {number} steps - Khoảng cách bước (mm)
 */
function simulateVirtualControl(topicName, payload, steps) {
  state.virtualX = state.virtualX ?? 0;
  state.virtualY = state.virtualY ?? 0;

  if (topicName === 'control/jog/x/right') {
    const nextX = state.virtualX + steps;
    if (state.virtualLimits && nextX > state.virtualLimits.xMax) {
      state.virtualX = state.virtualLimits.xMax;
      log(`[ẢO] 🛑 Chạm giới hạn tối đa X = ${state.virtualLimits.xMax} mm! Máy không vượt qua vị trí này.`, '01·ĐIỀU KHIỂN');
    } else {
      state.virtualX = nextX;
      log(`[ẢO] Trục X sang phải +${steps}mm -> X: ${state.virtualX} mm (ESP32 chưa kết nối)`, '01·ĐIỀU KHIỂN');
    }
  } else if (topicName === 'control/jog/x/left') {
    const nextX = state.virtualX - steps;
    if (state.virtualLimits && nextX < state.virtualLimits.xMin) {
      state.virtualX = state.virtualLimits.xMin;
      log(`[ẢO] 🛑 Chạm giới hạn tối thiểu X = ${state.virtualLimits.xMin} mm! Máy không vượt qua vị trí này.`, '01·ĐIỀU KHIỂN');
    } else {
      state.virtualX = nextX;
      log(`[ẢO] Trục X sang trái -${steps}mm -> X: ${state.virtualX} mm (ESP32 chưa kết nối)`, '01·ĐIỀU KHIỂN');
    }
  } else if (topicName === 'control/jog/y/up') {
    const nextY = state.virtualY + steps;
    if (state.virtualLimits && nextY > state.virtualLimits.yMax) {
      state.virtualY = state.virtualLimits.yMax;
      log(`[ẢO] 🛑 Chạm giới hạn tối đa Y = ${state.virtualLimits.yMax} mm! Máy không vượt qua vị trí này.`, '01·ĐIỀU KHIỂN');
    } else {
      state.virtualY = nextY;
      log(`[ẢO] Trục Y lên +${steps}mm -> Y: ${state.virtualY} mm (ESP32 chưa kết nối)`, '01·ĐIỀU KHIỂN');
    }
  } else if (topicName === 'control/jog/y/down') {
    const nextY = state.virtualY - steps;
    if (state.virtualLimits && nextY < state.virtualLimits.yMin) {
      state.virtualY = state.virtualLimits.yMin;
      log(`[ẢO] 🛑 Chạm giới hạn tối thiểu Y = ${state.virtualLimits.yMin} mm! Máy không vượt qua vị trí này.`, '01·ĐIỀU KHIỂN');
    } else {
      state.virtualY = nextY;
      log(`[ẢO] Trục Y xuống -${steps}mm -> Y: ${state.virtualY} mm (ESP32 chưa kết nối)`, '01·ĐIỀU KHIỂN');
    }
  } else if (topicName === 'control/home') {
    state.virtualX = 0;
    state.virtualY = 0;
    log('[ẢO] Trục về gốc tọa độ X: 0 mm · Y: 0 mm (ESP32 chưa kết nối)', '01·ĐIỀU KHIỂN');
  } else if (topicName === 'control/cal/origin') {
    state.virtualX = 0;
    state.virtualY = 0;
    state.virtualLimits = null;
    if ($('jogCalDisplay')) {
      $('jogCalDisplay').textContent = 'Đã đặt gốc (0,0) (Ảo)';
      $('jogCalDisplay').style.color = '#00b894';
    }
    log('[ẢO] Đã đặt gốc tọa độ (0,0) - Vị trí hiện tại là 0,0 (ESP32 chưa kết nối)', '01·HIỆU CHUẨN');
  } else if (topicName === 'control/cal/set') {
    state.virtualLimits = {
      xMin: state.virtualX < 0 ? state.virtualX : 0,
      xMax: state.virtualX > 0 ? state.virtualX : 230,
      yMin: state.virtualY < 0 ? state.virtualY : 0,
      yMax: state.virtualY > 0 ? state.virtualY : 850
    };
    if ($('jogCalDisplay')) {
      $('jogCalDisplay').textContent = `Đã chốt limit: X[0..${state.virtualLimits.xMax}], Y[${state.virtualLimits.yMin}..${state.virtualLimits.yMax}] (Ảo)`;
      $('jogCalDisplay').style.color = '#00b894';
    }
    log(`[ẢO] Đã chốt giới hạn hành trình: X=[${state.virtualLimits.xMin}..${state.virtualLimits.xMax}], Y=[${state.virtualLimits.yMin}..${state.virtualLimits.yMax}]. Dù điều khiển tiếp máy cũng sẽ KHÔNG vượt qua biên này!`, '01·HIỆU CHUẨN');
  }

  if ($('jogPosDisplay')) $('jogPosDisplay').textContent = `X: ${Math.round(state.virtualX)} mm · Y: ${Math.round(state.virtualY)} mm (Ảo)`;
  if ($('axisXValue')) $('axisXValue').textContent = `${Math.round(state.virtualX)} mm`;
  if ($('axisYValue')) $('axisYValue').textContent = `${Math.round(state.virtualY)} mm`;
  if ($('motorXNote')) $('motorXNote').textContent = `${Math.round(state.virtualX)} mm · Mô phỏng ảo`;
  if ($('motorYNote')) $('motorYNote').textContent = `${Math.round(state.virtualY)} mm · Mô phỏng ảo`;

  const xMin = 0, xMax = 230, yMin = 0, yMax = 850;
  const posY = Math.abs(state.virtualY);
  const xPercent = Math.max(0, Math.min(1, (state.virtualX - xMin) / (xMax - xMin || 1)));
  const yPercent = Math.max(0, Math.min(1, (posY - yMin) / (yMax - yMin || 1)));
  state.positionHistory.push({ xPercent, yPercent });
  if (state.positionHistory.length > 60) state.positionHistory.shift();
  drawPositionChart();

  if (typeof updateMotorXGauge === 'function') updateMotorXGauge(state.virtualX);
  if (typeof updateMotorYGauge === 'function') updateMotorYGauge(posY);
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 6: ĐIỀU KHIỂN THỦ CÔNG & HIỆU CHUẨN (MANUAL CNC CONTROLS & CALIBRATION)
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * Xử lý sự kiện bấm các nút điều khiển di chuyển Jog, Home, Đặt gốc và Chốt Limit
 * @param {HTMLElement} button - Phần tử nút bấm được click
 */
function sendControl(button) {
  const steps = Math.max(1, Number($('steps').value) || 10);
  const payload = button.dataset.payload ?? steps;
  const topicName = button.dataset.topic;

  // Nút Dừng khẩn cấp / Hủy lệnh
  if (topicName === 'control/stop') {
    handleCancelJob('01·HỦY LỆNH');
    return;
  }

  // Phản hồi giao diện tức thì khi bấm Đặt gốc / Đặt limit
  if (topicName === 'control/cal/origin') {
    if ($('jogCalDisplay')) {
      $('jogCalDisplay').textContent = '📍 Đã đặt gốc (0,0) — Đang đồng bộ máy...';
      $('jogCalDisplay').style.color = '#fdcb6e';
    }
  } else if (topicName === 'control/cal/set') {
    if ($('jogCalDisplay')) {
      $('jogCalDisplay').textContent = '📏 Đang chốt giới hạn limit...';
      $('jogCalDisplay').style.color = '#00b894';
    }
  }

  // Gửi lệnh qua MQTT nếu đã kết nối Broker
  if (state.client?.connected) {
    publish(topicName, payload);
  } else {
    // Chỉ khi chưa kết nối Broker mới chạy mô phỏng di chuyển ảo
    simulateVirtualControl(topicName, payload, steps);
  }
}

/**
 * Cập nhật trạng thái màu sắc và nhãn của nút Bút vẽ và Đèn chiếu sáng LED
 */
function updateToggleButtons() {
  const penBtn = $('togglePen');
  const ledBtn = $('toggleLed');
  if (penBtn) {
    penBtn.textContent = state.penDown ? '✏ Bút đang HẠ ▼' : '✏ Bút đang NHẤC ▲';
    penBtn.style.background = state.penDown ? 'rgba(168,255,83,0.35)' : '';
    penBtn.style.borderColor = state.penDown ? 'var(--lime)' : '';
  }
  if (ledBtn) {
    ledBtn.textContent = state.ledOn ? '💡 Đèn đang MỞ' : '💡 Đèn đang TẮT';
    ledBtn.style.background = state.ledOn ? 'rgba(255,169,77,0.35)' : '';
    ledBtn.style.borderColor = state.ledOn ? 'var(--orange)' : '';
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 7: BỘ PHÁT HÌNH HỌC TỰ ĐỘNG - SECTION 02 (AUTOMATIC SHAPE GENERATOR)
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * Thêm một điểm lệnh CNC vào tập lệnh hình học
 * @param {Array<string>} job - Mảng chứa danh sách lệnh
 * @param {number} x - Tọa độ X (mm)
 * @param {number} y - Tọa độ Y (mm)
 * @param {string} pen - Trạng thái bút: 'U' (nhấc) hoặc 'D' (hạ)
 */
function addLine(job, x, y, pen) {
  job.push(`${Math.round(x)},${Math.round(y)};${pen}`);
}

/**
 * Sinh tập lệnh vẽ các hình cơ bản (Hình vuông toàn bàn máy / Hình tròn elip)
 * @param {string} kind - Loại hình ('square' hoặc 'circle')
 * @returns {Array<string>}
 */
function shapeOps(kind) {
  const range = state.status?.range || { x: [0, 230], y: [0, 850] };
  const rawX0 = Number(range.x?.[0]) ?? 0;
  const rawX1 = Number(range.x?.[1]) ?? 230;
  const rawY0 = Number(range.y?.[0]) ?? 0;
  const rawY1 = Number(range.y?.[1]) ?? 850;

  const xMin = Math.min(rawX0, rawX1);
  const xMax = Math.max(rawX0, rawX1);
  const yMin = Math.min(rawY0, rawY1);
  const yMax = Math.max(rawY0, rawY1);

  const spanX = xMax - xMin;
  const spanY = yMax - yMin;

  const ops = [];

  if (kind === 'square') {
    // Đi hết toàn bộ giới hạn (limit) của cả 2 trục X và Y theo tỷ lệ bàn máy thực tế
    ops.push('U');
    ops.push(`${Math.round(xMin)},${Math.round(yMin)}`);
    ops.push('D');
    ops.push(`${Math.round(xMax)},${Math.round(yMin)}`);
    ops.push(`${Math.round(xMax)},${Math.round(yMax)}`);
    ops.push(`${Math.round(xMin)},${Math.round(yMax)}`);
    ops.push(`${Math.round(xMin)},${Math.round(yMin)}`);
    ops.push('U');
  } else {
    // Vẽ hình tròn hoàn hảo (tỷ lệ 1:1 theo cả hai trục X và Y, không bị méo elip)
    const cx = (xMin + xMax) / 2;
    const cy = (yMin + yMax) / 2;
    const inputDia = Number($('circleDiameter')?.value);
    const maxSafeDia = Math.min(spanX, spanY) * 0.9;
    const diameter = (inputDia > 5 && inputDia <= maxSafeDia)
      ? inputDia
      : Math.min(spanX, spanY) * AUTO_CIRCLE_LIMIT_RATIO;
    const r = diameter / 2;
    const rx = r;
    const ry = r; // Tuyệt đối cùng bán kính cho 2 trục để đảm bảo là hình tròn

    ops.push('U');
    ops.push(`${Math.round(cx + rx)},${Math.round(cy)}`);
    ops.push('D');
    const segments = 64;
    for (let i = 1; i <= segments; i += 1) {
      const angle = (i * Math.PI * 2) / segments;
      ops.push(`${Math.round(cx + rx * Math.cos(angle))},${Math.round(cy + ry * Math.sin(angle))}`);
    }
    ops.push('U');
  }

  return ops;
}

/**
 * Thực thi lệnh vẽ hình học tự động: truyền trọn vẹn toàn bộ bản vẽ sang ESP32 qua MQTT
 * @param {string} kind - Loại hình cần vẽ ('square' hoặc 'circle')
 */
async function runShape(kind) {
  const ops = shapeOps(kind);
  const up = Number($('penUp')?.value) || 110;
  const down = Number($('penDown')?.value) || 80;
  const range = state.status?.range || { x: [0, 230], y: [0, 850] };
  const spanX = Math.abs((range.x?.[1] ?? 230) - (range.x?.[0] ?? 0));
  const spanY = Math.abs((range.y?.[1] ?? 850) - (range.y?.[0] ?? 0));
  const inputDia = Number($('circleDiameter')?.value);
  const maxSafeDia = Math.min(spanX, spanY) * 0.9;
  const circleDiameter = Math.round((inputDia > 5 && inputDia <= maxSafeDia)
    ? inputDia
    : Math.min(spanX, spanY) * AUTO_CIRCLE_LIMIT_RATIO);
  const kindLabel = kind === 'square'
    ? `Khung limit 2 trục (${spanX}x${spanY}mm) ⬚`
    : `Hình tròn Ø${circleDiameter}mm (chuẩn 1:1) ⏺`;

  state.isUploadingJob = true;

  // Nếu Web đã kết nối Broker: luôn nạp toàn bộ bản vẽ sang ESP32 thực tế
  if (state.client?.connected) {
    publish(`auto/${kind}/begin`, JSON.stringify({ n: ops.length, up, down }), '02·VẼ HÌNH');
    await new Promise(resolve => setTimeout(resolve, 60));
    if (!state.isUploadingJob) return;
    publish(`auto/${kind}/data`, ops.join(';'), '02·VẼ HÌNH');
    await new Promise(resolve => setTimeout(resolve, 80));
    if (!state.isUploadingJob) return;
    publish(`auto/${kind}/start`, '', '02·VẼ HÌNH');
    log(`✅ Đã nạp toàn bộ bản vẽ ${kindLabel} sang ESP32. ESP32 bắt đầu tự động vẽ từ bộ nhớ!`, '02·VẼ HÌNH');

    // Cập nhật giao diện tiến độ thực tế cho ESP32
    if ($('jobPercent')) $('jobPercent').textContent = '0';
    if ($('jobProgressBar')) $('jobProgressBar').style.width = '0%';
    if ($('jobKindName')) $('jobKindName').textContent = kindLabel;
    if ($('jobStepDetail')) $('jobStepDetail').textContent = `0 / ${ops.length} điểm`;
    if ($('jobStateBadge')) {
      $('jobStateBadge').className = 'progress-badge job-badge-running';
      $('jobStateBadge').textContent = 'ĐANG VẼ';
    }
    if ($('jobMessage')) $('jobMessage').textContent = `Đã nạp ${ops.length} lệnh cho ${kindLabel}. ESP32 đang vẽ thực tế...`;
    log(`Đã gửi ${ops.length} lệnh cho ${kindLabel} đến ESP32 thực tế.`, '02·VẼ HÌNH');
  } else {
    // Khi chưa kết nối MQTT Broker (offline demo), chạy mô phỏng ảo kèm nhãn [ẢO]
    startVirtualJob(ops, kind, 'shape');
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 8: XỬ LÝ ẢNH & TẠO ĐƯỜNG CHẠY DAO CNC - SECTION 03 (IMAGE PROCESSING & TOOLPATH)
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * Lấy kích thước hành trình làm việc vật lý thực tế của máy CNC (mm)
 * @returns {{mW: number, mH: number}}
 */
function getMachineLimits() {
  const range = state.status?.range || { x: [0, 230], y: [0, 850] };
  const rawX0 = Number(range.x?.[0]) ?? 0;
  const rawX1 = Number(range.x?.[1]) ?? 230;
  const rawY0 = Number(range.y?.[0]) ?? 0;
  const rawY1 = Number(range.y?.[1]) ?? 850;
  const mW = Math.abs(rawX1 - rawX0) || 230;
  const mH = Math.abs(rawY1 - rawY0) || 850;
  imgWs.machineW = mW;
  imgWs.machineH = mH;
  return { mW, mH };
}

/**
 * Tính toán ma trận biến đổi tọa độ cho Canvas không gian làm việc hình vuông chuẩn
 * @param {HTMLCanvasElement} canvas
 * @returns {object}
 */
function getImageVirtualAspect() {
  const { mW, mH } = getMachineLimits();
  return (imgWs.imgW / (imgWs.imgH || 1)) * (mW / mH);
}

function getCanvasTransform(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.max(200, rect.width || 400);
  const ch = Math.max(200, rect.height || 480);

  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }

  const { mW, mH } = getMachineLimits();
  const range = state.status?.range || { x: [0, 230], y: [0, 850] };
  const xMin = Number(range.x?.[0] ?? 0);
  const xMax = Number(range.x?.[1] ?? 230);
  const yMin = Number(range.y?.[0] ?? 0);
  const yMax = Number(range.y?.[1] ?? 850);
  const xSpan = Math.abs(xMax - xMin) || mW;
  const ySpan = Math.abs(yMax - yMin) || mH;
  const padX = 40;
  const padY = 28;
  const availW = cw - padX * 2;
  const availH = ch - padY * 2;
  const machineAspect = xSpan / ySpan;
  let boxW = availW;
  let boxH = boxW / machineAspect;
  if (boxH > availH) {
    boxH = availH;
    boxW = boxH * machineAspect;
  }

  const originX = padX + (availW - boxW) / 2;
  const originY = padY + (availH - boxH) / 2;
  const viewSize = Math.min(availW, availH);
  const viewX = padX + (availW - viewSize) / 2;
  const viewY = padY + (availH - viewSize) / 2;

  return {
    cw, ch, dpr, boxW, boxH, boxSize: Math.min(boxW, boxH), originX, originY, mW, mH,
    xMin, xMax, yMin, yMax, xSpan, ySpan, viewSize, viewX, viewY,
    virtToPx: (vx, vy) => ({
      x: (canvas.id === 'workspaceCanvas' ? viewX : originX) + (vx / V_SIZE) * (canvas.id === 'workspaceCanvas' ? viewSize : boxW),
      y: (canvas.id === 'workspaceCanvas' ? viewY : originY) + ((V_SIZE - vy) / V_SIZE) * (canvas.id === 'workspaceCanvas' ? viewSize : boxH)
    }),
    pxToVirt: (px, py) => ({
      x: ((px - (canvas.id === 'workspaceCanvas' ? viewX : originX)) / (canvas.id === 'workspaceCanvas' ? viewSize : boxW)) * V_SIZE,
      y: V_SIZE - ((py - (canvas.id === 'workspaceCanvas' ? viewY : originY)) / (canvas.id === 'workspaceCanvas' ? viewSize : boxH)) * V_SIZE
    }),
    pxToRaster: (px, py) => ({
      x: ((px - viewX) / viewSize) * V_SIZE,
      y: ((py - viewY) / viewSize) * V_SIZE
    }),
    mmToPx: (xMm, yMm) => ({
      x: (canvas.id === 'workspaceCanvas' ? viewX : originX) + ((xMm - xMin) / xSpan) * (canvas.id === 'workspaceCanvas' ? viewSize : boxW),
      y: (canvas.id === 'workspaceCanvas' ? viewY : originY) + ((yMm - yMin) / ySpan) * (canvas.id === 'workspaceCanvas' ? viewSize : boxH)
    })
  };
}

/**
 * Chuyển đổi ảnh sang ảnh Trắng - Đen (B&W) nhị phân theo thanh trượt ngưỡng Threshold.
 * Vùng màu đen chính là nét máy CNC sẽ vẽ, nền màu trắng là giấy trắng.
 */
function updateBwCanvas() {
  if (!imgWs.img) return;
  if (!imgWs.bwCanvas) {
    imgWs.bwCanvas = document.createElement('canvas');
  }
  const w = imgWs.img.naturalWidth || imgWs.img.width || 400;
  const h = imgWs.img.naturalHeight || imgWs.img.height || 400;

  // Giới hạn kích thước preview để phản hồi cực nhanh (60 FPS khi kéo thanh trượt)
  const maxDim = 800;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));

  imgWs.bwCanvas.width = sw;
  imgWs.bwCanvas.height = sh;
  const ctx = imgWs.bwCanvas.getContext('2d');
  ctx.drawImage(imgWs.img, 0, 0, sw, sh);

  const imgData = ctx.getImageData(0, 0, sw, sh);
  const d = imgData.data;
  const thresh = imgWs.threshold;

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 50) {
      // Điểm trong suốt -> Nền giấy trắng
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = 255;
      continue;
    }
    const gray = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
    if (gray < thresh) {
      // Vùng nét vẽ máy CNC: màu đen tuyền (#121218)
      d[i] = 18;
      d[i + 1] = 18;
      d[i + 2] = 24;
      d[i + 3] = 255;
    } else {
      // Nền giấy: màu trắng tinh (#ffffff)
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

/**
 * Trì hoãn xử lý ảnh (Debounce) để giao diện mượt mà khi người dùng kéo thanh trượt
 * @param {number} delay - Thời gian chờ (ms)
 */
function scheduleProcess(delay = 100) {
  if (imgWs.processTimer) clearTimeout(imgWs.processTimer);
  imgWs.processTimer = setTimeout(() => {
    processImageAndGeneratePaths();
  }, delay);
}

/**
 * Hàm trung tâm: Xử lý ảnh raster & sinh danh sách đường chạy dao CNC
 * Hoạt động trong không gian chuẩn 500x500 đơn vị ảo
 */
function processImageAndGeneratePaths() {
  if (!imgWs.img) return;

  const { mW, mH } = getMachineLimits();

  // Canvas xử lý raster: 500x500 đơn vị ảo chuẩn
  const offW = V_SIZE;
  const offH = V_SIZE;
  const offCanvas = document.createElement('canvas');
  offCanvas.width = offW;
  offCanvas.height = offH;
  const offCtx = offCanvas.getContext('2d');

  // Lót nền trắng tinh (nền không vẽ)
  offCtx.fillStyle = '#ffffff';
  offCtx.fillRect(0, 0, offW, offH);

  // imgWs.y vẫn lưu vị trí theo khung kéo ảnh; rasterTop là vị trí ảnh trên
  // canvas từ trên xuống. Các điểm path sau đó giữ nguyên gốc trên trái,
  // đúng với gốc vật lý của máy.
  const rasterTop = V_SIZE - imgWs.y - imgWs.h;
  offCtx.drawImage(imgWs.img, imgWs.x, rasterTop, imgWs.w, imgWs.h);

  // Đọc dữ liệu điểm ảnh pixel
  const imgData = offCtx.getImageData(0, 0, offW, offH);
  const data = imgData.data;

  // Chuyển sang ảnh thang độ xám (Grayscale) kèm điều chỉnh độ tương phản
  const gray = new Uint8Array(offW * offH);
  const contrast = imgWs.contrast; // -100 đến 100
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let i = 0; i < gray.length; i++) {
    const off = i * 4;
    if (data[off + 3] < 50) {
      gray[i] = 255;
      continue;
    }
    let l = Math.round(data[off] * 0.299 + data[off + 1] * 0.587 + data[off + 2] * 0.114);
    if (contrast !== 0) {
      l = Math.min(255, Math.max(0, Math.round(factor * (l - 128) + 128)));
    }
    gray[i] = l;
  }

  let paths = [];

  if (imgWs.mode === 'outline') {
    // ════ CHẾ ĐỘ 1: VẼ ĐƯỜNG VIỀN SẠCH – KHÔNG NÉT VỤN ════
    let rawContours = [];
    if (imgWs.outlineStyle === 'canny') {
      // Kiểu 1B: Canny Edge với Non-Maximum Suppression (Làm mỏng viền thành 1-pixel)
      const lowThresh = Math.max(10, Math.round(imgWs.threshold * 0.4));
      const highThresh = imgWs.threshold;
      const cannyMap = cannyEdges(gray, offW, offH, lowThresh, highThresh);
      rawContours = traceBinaryContours(cannyMap, offW, offH, imgWs.minLen || 8);
    } else {
      // Kiểu 1A: Tách biên hình khối / Logo / Chữ (Boundary Tracing)
      const bin = new Uint8Array(offW * offH);
      const thresh = imgWs.threshold;
      for (let i = 0; i < gray.length; i++) {
        bin[i] = gray[i] < thresh ? 1 : 0;
      }
      rawContours = traceBinaryContours(bin, offW, offH, imgWs.minLen || 8);
    }

    // Đơn giản hóa đường viền bằng thuật toán RDP (Giảm bớt điểm dư thừa)
    paths = rawContours.map(c => simplifyContour(c, imgWs.simplify || 1));
    // Tối ưu thứ tự vẽ (Nearest Neighbor) để bút không bay qua lại lung tung
    paths = optimizePathOrder(paths);
  } else {
    // ════ CHẾ ĐỘ 2: TÔ MÀU (Nét ngang liền kề với bước cách tùy chọn) ════
    const spacingPx = Math.max(3, Math.round(imgWs.hatchSpacing * (V_SIZE / mW)));
    const thresh = imgWs.threshold;

    let rowIdx = 0;
    for (let y = 0; y < offH; y += spacingPx) {
      const segments = [];
      let inSegment = false;
      let startX = 0;

      for (let x = 0; x < offW; x++) {
        const isDark = gray[y * offW + x] < thresh;
        if (isDark && !inSegment) {
          inSegment = true;
          startX = x;
        } else if (!isDark && inSegment) {
          inSegment = false;
          if (x - startX >= 3) {
            segments.push({ x1: startX, x2: x - 1, y });
          }
        }
      }
      if (inSegment && (offW - 1 - startX >= 3)) {
        segments.push({ x1: startX, x2: offW - 1, y });
      }

      // Zigzag boustrophedon tối ưu chuyển động liên tục của bút
      if (rowIdx % 2 === 1) {
        segments.reverse();
        segments.forEach(seg => {
          paths.push([{ x: seg.x2, y: seg.y }, { x: seg.x1, y: seg.y }]);
        });
      } else {
        segments.forEach(seg => {
          paths.push([{ x: seg.x1, y: seg.y }, { x: seg.x2, y: seg.y }]);
        });
      }
      rowIdx++;
    }
  }

  // Lọc các nét quá ngắn và giới hạn tọa độ trong khung ảo 0..500
  paths = paths
    .filter(p => p.length >= 2)
    .map(p => p.map(pt => ({
      x: Math.min(V_SIZE, Math.max(0, Math.round(pt.x))),
      y: Math.min(V_SIZE, Math.max(0, Math.round(pt.y)))
    })));

  // Thêm viền khung hình chữ nhật bao quanh chính bức ảnh nếu người dùng bật
  if (imgWs.drawBorder) {
    const bx = Math.min(V_SIZE, Math.max(0, Math.round(imgWs.x)));
    const by = Math.min(V_SIZE, Math.max(0, Math.round(V_SIZE - imgWs.y - imgWs.h)));
    const bw = Math.min(V_SIZE - bx, Math.max(10, Math.round(imgWs.w)));
    const bh = Math.min(V_SIZE - by, Math.max(10, Math.round(imgWs.h)));
    const frameBorder = [
      { x: bx, y: by },
      { x: bx + bw, y: by },
      { x: bx + bw, y: by + bh },
      { x: bx, y: by + bh },
      { x: bx, y: by } // Khép kín khung viền
    ];
    paths.push(frameBorder);
  }

  imgWs.paths = paths;

  const range = state.status?.range || { x: [0, 230], y: [0, 850] };
  const xMin = Number(range.x?.[0] ?? 0);
  const yMin = Number(range.y?.[0] ?? 0);
  const xSpan = Math.abs(Number(range.x?.[1] ?? 230) - xMin) || mW;
  const ySpan = Math.abs(Number(range.y?.[1] ?? 850) - yMin) || mH;
  // Giữ tỉ lệ co giãn chuẩn 1:1 (Isotropic) để hình vẽ/ảnh giữ nguyên hình tròn, không bị kéo dãn thành elip
  const uniformScale = Math.min(xSpan, ySpan) / V_SIZE;
  const offsetX = xMin + (xSpan - V_SIZE * uniformScale) / 2;
  const offsetY = yMin + (ySpan - V_SIZE * uniformScale) / 2;
  const cncOps = [];
  cncOps.push('U');
  let totalPts = 0;

  for (const p of paths) {
    if (p.length < 2) continue;
    const startX = Math.round(offsetX + p[0].x * uniformScale);
    const startY = Math.round(offsetY + p[0].y * uniformScale);
    cncOps.push(`${startX},${startY}`);
    cncOps.push('D');
    for (let i = 1; i < p.length; i++) {
      const ptX = Math.round(offsetX + p[i].x * uniformScale);
      const ptY = Math.round(offsetY + p[i].y * uniformScale);
      cncOps.push(`${ptX},${ptY}`);
      totalPts++;
    }
    cncOps.push('U');
  }
  // Firmware sẽ tự đưa máy về (0,0) sau khi xử lý lệnh cuối cùng.
  // Không chèn thêm điểm 0,0 vào job để tránh chạy về gốc hai lần.
  cncOps.push('U');

  imgWs.cncOps = cncOps;
  state.imagePaths = cncOps;

  // Cập nhật thống kê chi tiết trên giao diện Web
  const countEl = $('pathPointCount');
  if (countEl) {
    const labelMode = imgWs.mode === 'outline'
      ? (imgWs.outlineStyle === 'canny' ? 'viền canny' : 'viền khối')
      : 'nét tô';
    countEl.textContent = `${paths.length} ${labelMode} · ${totalPts} điểm · ${cncOps.length} lệnh`;
  }

  const warnBadge = $('pathWarnBadge');
  if (warnBadge) {
    warnBadge.style.display = cncOps.length > 3000 ? 'inline-block' : 'none';
  }

  const sendBtn = $('sendImagePath');
  if (sendBtn) {
    sendBtn.disabled = cncOps.length < 3;
  }
  const msgEl = $('imageJobMessage');
  if (msgEl) {
    const modeName = imgWs.mode === 'outline'
      ? (imgWs.outlineStyle === 'canny' ? 'Viền Canny chi tiết' : 'Viền khối Logo/Chữ')
      : `Tô màu (bước ${imgWs.hatchSpacing}mm)`;
    msgEl.textContent = `Đã tạo ${paths.length} đường [${modeName}] – ${totalPts} điểm. Sẵn sàng gửi đến ESP32.`;
  }

  renderWorkspace();
  renderPathPreview();
}

/**
 * Trích xuất đường viền liên tục dày 1-pixel từ ảnh nhị phân (Topological Boundary Tracing)
 * Đảm bảo viền sắc nét, không bị vòng lặp vụn
 * @param {Uint8Array} bin - Mảng nhị phân (1: nét, 0: nền)
 * @param {number} width - Chiều rộng ảnh
 * @param {number} height - Chiều cao ảnh
 * @param {number} minLength - Độ dài tối thiểu của đường viền
 * @returns {Array<Array<{x: number, y: number}>>}
 */
function traceBinaryContours(bin, width, height, minLength = 8) {
  // Bước 1: Trích xuất mặt nạ biên 1-pixel
  const bdry = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (bin[row + x] === 1) {
        if (
          x === 0 || x === width - 1 || y === 0 || y === height - 1 ||
          bin[row + x - 1] === 0 || bin[row + x + 1] === 0 ||
          bin[row - width + x] === 0 || bin[row + width + x] === 0
        ) {
          bdry[row + x] = 1;
        }
      }
    }
  }

  // Bước 2: Dò tìm và xâu chuỗi các đường viền liên tục theo 8 hướng
  const visited = new Uint8Array(width * height);
  const contours = [];

  const DX = [1, 1, 0, -1, -1, -1, 0, 1];
  const DY = [0, 1, 1, 1, 0, -1, -1, -1];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const startIdx = y * width + x;
      if (bdry[startIdx] !== 1 || visited[startIdx]) continue;

      const contour = [{ x, y }];
      visited[startIdx] = 1;
      let cx = x, cy = y;
      let steps = 0;
      const maxSteps = width * height;

      while (steps < maxSteps) {
        let foundNext = false;
        let bestNx = -1, bestNy = -1;

        for (let d = 0; d < 8; d++) {
          const nx = cx + DX[d];
          const ny = cy + DY[d];
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = ny * width + nx;
            if (bdry[nIdx] === 1 && !visited[nIdx]) {
              bestNx = nx;
              bestNy = ny;
              foundNext = true;
              break;
            }
          }
        }

        if (foundNext) {
          visited[bestNy * width + bestNx] = 1;
          contour.push({ x: bestNx, y: bestNy });
          cx = bestNx;
          cy = bestNy;
          steps++;
        } else {
          // Khép kín chu trình nếu điểm kết thúc gần điểm bắt đầu
          if (contour.length > 3 && Math.hypot(cx - x, cy - y) <= 3) {
            contour.push({ x, y });
          }
          break;
        }
      }

      if (contour.length >= minLength) {
        contours.push(contour);
      }
    }
  }
  return contours;
}

/**
 * Thuật toán phát hiện cạnh Canny kết hợp Non-Maximum Suppression (NMS)
 * Đảm bảo viền nét mảnh chính xác 1-pixel
 * @param {Uint8Array} gray - Mảng ảnh xám
 * @param {number} width - Chiều rộng
 * @param {number} height - Chiều cao
 * @param {number} lowThresh - Ngưỡng dưới
 * @param {number} highThresh - Ngưỡng trên
 * @returns {Uint8Array}
 */
function cannyEdges(gray, width, height, lowThresh = 40, highThresh = 100) {
  // 1. Làm mịn ảnh bằng Gaussian Blur
  const blurred = gaussianBlur(gray, width, height);

  // 2. Tính Gradient Sobel (Gx, Gy và Magnitude)
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const mag = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p00 = blurred[(y - 1) * width + (x - 1)];
      const p01 = blurred[(y - 1) * width + x];
      const p02 = blurred[(y - 1) * width + (x + 1)];
      const p10 = blurred[y * width + (x - 1)];
      const p12 = blurred[y * width + (x + 1)];
      const p20 = blurred[(y + 1) * width + (x - 1)];
      const p21 = blurred[(y + 1) * width + x];
      const p22 = blurred[(y + 1) * width + (x + 1)];

      const xGrad = -p00 + p02 - 2 * p10 + 2 * p12 - p20 + p22;
      const yGrad = -p00 - 2 * p01 - p02 + p20 + 2 * p21 + p22;

      gx[y * width + x] = xGrad;
      gy[y * width + x] = yGrad;
      mag[y * width + x] = Math.hypot(xGrad, yGrad);
    }
  }

  // 3. Non-Maximum Suppression (Làm mỏng cạnh thành đúng 1-pixel)
  const nms = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const m = mag[y * width + x];
      if (m < lowThresh) continue;

      const angle = Math.atan2(gy[y * width + x], gx[y * width + x]) * (180 / Math.PI);
      const absAngle = angle < 0 ? angle + 180 : angle;

      let m1 = 0, m2 = 0;
      if ((absAngle >= 0 && absAngle < 22.5) || (absAngle >= 157.5 && absAngle <= 180)) {
        m1 = mag[y * width + (x - 1)];
        m2 = mag[y * width + (x + 1)];
      } else if (absAngle >= 22.5 && absAngle < 67.5) {
        m1 = mag[(y - 1) * width + (x + 1)];
        m2 = mag[(y + 1) * width + (x - 1)];
      } else if (absAngle >= 67.5 && absAngle < 112.5) {
        m1 = mag[(y - 1) * width + x];
        m2 = mag[(y + 1) * width + x];
      } else {
        m1 = mag[(y - 1) * width + (x - 1)];
        m2 = mag[(y + 1) * width + (x + 1)];
      }

      if (m >= m1 && m >= m2) {
        nms[y * width + x] = m >= highThresh ? 2 : 1;
      }
    }
  }

  // 4. Lọc trễ Hysteresis
  const result = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (nms[y * width + x] === 2) {
        result[y * width + x] = 1;
      } else if (nms[y * width + x] === 1) {
        let hasStrong = false;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (nms[(y + dy) * width + (x + dx)] === 2) {
              hasStrong = true;
              break;
            }
          }
          if (hasStrong) break;
        }
        if (hasStrong) result[y * width + x] = 1;
      }
    }
  }
  return result;
}

/**
 * Lọc mịn ảnh 3x3 Gaussian Blur để triệt tiêu nhiễu hạt
 * @param {Uint8Array} gray - Mảng ảnh xám
 * @param {number} width - Chiều rộng
 * @param {number} height - Chiều cao
 * @returns {Uint8Array}
 */
function gaussianBlur(gray, width, height) {
  const out = new Uint8Array(width * height);
  const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const sum = 16;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let val = 0;
      let ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          val += gray[(y + dy) * width + (x + dx)] * kernel[ki++];
        }
      }
      out[y * width + x] = Math.round(val / sum);
    }
  }
  return out;
}

/**
 * Đơn giản hóa đường viền điểm bằng thuật toán Ramer-Douglas-Peucker (RDP)
 * @param {Array<{x: number, y: number}>} points - Mảng các điểm gốc
 * @param {number} epsilon - Sai số dung sai khoảng cách
 * @returns {Array<{x: number, y: number}>}
 */
function simplifyContour(points, epsilon = 1) {
  if (points.length <= 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointLineDistance(points[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = simplifyContour(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyContour(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

/**
 * Tính khoảng cách vuông góc từ một điểm p tới đoạn thẳng nối a và b
 * @param {{x: number, y: number}} p
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {number}
 */
function pointLineDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Tối ưu hóa thứ tự vẽ giữa các đường (Thuật toán Nearest-Neighbor TSP)
 * Giảm thiểu quãng đường nhấc bút di chuyển không tải
 * @param {Array<Array<{x: number, y: number}>>} paths
 * @returns {Array<Array<{x: number, y: number}>>}
 */
function optimizePathOrder(paths) {
  if (paths.length <= 1) return paths;
  const remaining = [...paths];
  const ordered = [remaining.shift()];

  while (remaining.length > 0) {
    const lastPath = ordered[ordered.length - 1];
    const lastPt = lastPath[lastPath.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    let shouldReverse = false;

    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      const dStart = Math.hypot(p[0].x - lastPt.x, p[0].y - lastPt.y);
      const dEnd = Math.hypot(p[p.length - 1].x - lastPt.x, p[p.length - 1].y - lastPt.y);

      if (dStart < bestDist) {
        bestDist = dStart;
        bestIdx = i;
        shouldReverse = false;
      }
      if (dEnd < bestDist) {
        bestDist = dEnd;
        bestIdx = i;
        shouldReverse = true;
      }
    }

    const nextPath = remaining.splice(bestIdx, 1)[0];
    if (shouldReverse) nextPath.reverse();
    ordered.push(nextPath);
  }
  return ordered;
}

/**
 * Xử lý nạp file ảnh người dùng tải lên, căn vừa vào khung vuông làm việc
 * @param {File} file - Tệp ảnh người dùng chọn
 */
function handleImageFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      imgWs.img = img;
      imgWs.imgW = img.width;
      imgWs.imgH = img.height;

      // Căn ảnh vừa vặn vào khung vuông 500x500 đơn vị ảo
      const targetSize = 440; // 500 - 30*2 lề
      const imgAspect = img.width / img.height;

      let fw, fh;
      if (imgAspect >= 1) {
        fw = targetSize;
        fh = Math.round(targetSize / imgAspect);
      } else {
        fh = targetSize;
        fw = Math.round(targetSize * imgAspect);
      }

      imgWs.w = fw;
      imgWs.h = fh;
      imgWs.x = Math.round((V_SIZE - fw) / 2);
      imgWs.y = Math.round((V_SIZE - fh) / 2);

      updateScaleDisplay();
      updateBwCanvas();
      processImageAndGeneratePaths();
      log(`Đã nạp ảnh "${file.name}" (${img.width}×${img.height}px) vào khung vuông.`, '03·VẼ ẢNH');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/**
 * Gửi toàn bộ danh sách lệnh vẽ từ ảnh tới ESP32 qua giao thức MQTT
 */
async function sendImageToESP() {
  const ops = state.imagePaths;
  if (!ops || ops.length < 3) return log('Chưa có đường vẽ. Hãy chọn ảnh trước.', '03·VẼ ẢNH');

  if (ops.length > 8000) {
    alert(`Bản vẽ hiện tại có ${ops.length} lệnh (quá nhiều cho bộ nhớ ESP32).\nVui lòng tăng "Đơn giản hóa" hoặc "Lọc nhiễu" để giảm số điểm trước khi gửi!`);
    return;
  }

  const up = Number($('penUp')?.value) || 110;
  const down = Number($('penDown')?.value) || 80;
  const modeLabel = imgWs.mode === 'outline'
    ? (imgWs.outlineStyle === 'canny' ? 'viền Canny' : 'viền khối')
    : `tô màu (${imgWs.hatchSpacing}mm)`;

  state.isUploadingJob = true;

  if (state.client?.connected) {
    log(`Đang nạp toàn bộ bản vẽ (${ops.length} lệnh) sang ESP32...`, '03·VẼ ẢNH');
    publish('auto/image/begin', JSON.stringify({ n: ops.length, up, down }), '03·VẼ ẢNH');
    await new Promise(resolve => setTimeout(resolve, 80));

    // Với bộ đệm MQTT 32KB trên ESP32, nạp toàn bộ bản vẽ:
    // Nếu dưới 2500 lệnh: gửi trọn vẹn trong 1 gói duy nhất!
    // Nếu lớn hơn 2500 lệnh: chia khối lớn 2000 lệnh/gói
    const CHUNK_SIZE = 200;
    for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
      if (!state.isUploadingJob) {
        log('🛑 Đã hủy quá trình gửi lệnh do bấm Dừng máy.', '03·VẼ ẢNH');
        return;
      }
      const chunk = ops.slice(i, i + CHUNK_SIZE).join(';');
      publish('auto/image/data', chunk, '03·VẼ ẢNH');
      if (i + CHUNK_SIZE < ops.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    await new Promise(resolve => setTimeout(resolve, 120));
    if (!state.isUploadingJob) return;
    publish('auto/image/start', '', '03·VẼ ẢNH');
    log(`✅ Đã nạp xong toàn bộ ${ops.length} lệnh sang ESP32. ESP32 bắt đầu tự động vẽ từ bộ nhớ!`, '03·VẼ ẢNH');

    // Cập nhật giao diện tiến độ thực tế cho ESP32
    if ($('imageJobPercent')) $('imageJobPercent').textContent = '0';
    if ($('imageJobProgressBar')) $('imageJobProgressBar').style.width = '0%';
    if ($('imageJobStepDetail')) $('imageJobStepDetail').textContent = `0 / ${ops.length} lệnh`;
    if ($('imageJobBadge')) {
      $('imageJobBadge').className = 'progress-badge job-badge-running';
      $('imageJobBadge').textContent = 'ĐANG VẼ';
    }
    if ($('imageJobMessage')) $('imageJobMessage').textContent = `Đã nạp toàn bộ ${ops.length} lệnh [${modeLabel}] đến ESP32. ESP32 đang tự động vẽ từ bộ nhớ...`;
    log(`Đã nạp toàn bộ ${ops.length} lệnh vẽ từ ảnh [${modeLabel}] đến ESP32 thực tế.`, '03·VẼ ẢNH');
  } else {
    // Khi chưa kết nối MQTT Broker (offline demo), chạy mô phỏng ảo
    startVirtualJob(ops, 'image', 'image');
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 9: TƯƠNG TÁC KHÔNG GIAN LÀM VIỆC & CANVAS PREVIEW (WORKSPACE & PREVIEWS)
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * Vẽ không gian làm việc tương tác (Workspace Canvas): Khung bàn máy vuông, lưới, thước mm,
 * ảnh nhị phân Trắng - Đen, hộp bao (bounding box) và 4 chấm kéo chỉnh kích cỡ.
 */
function renderWorkspace() {
  const canvas = $('workspaceCanvas');
  if (!canvas) return;
  const t = getCanvasTransform(canvas);
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(t.dpr, t.dpr);
  ctx.clearRect(0, 0, t.cw, t.ch);

  // Nền ngoài bàn máy
  ctx.fillStyle = '#12131c';
  ctx.fillRect(0, 0, t.cw, t.ch);

  // Khung bàn máy hình vuông
  const mRect = {
    x: t.viewX,
    y: t.viewY,
    w: t.viewSize,
    h: t.viewSize
  };

  ctx.fillStyle = '#1a1c28';
  ctx.fillRect(mRect.x, mRect.y, mRect.w, mRect.h);

  // Lưới tọa độ 5x5 bên trong bàn máy
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const gx = mRect.x + (i / 5) * mRect.w;
    const gy = mRect.y + (i / 5) * mRect.h;
    ctx.beginPath(); ctx.moveTo(gx, mRect.y); ctx.lineTo(gx, mRect.y + mRect.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mRect.x, gy); ctx.lineTo(mRect.x + mRect.w, gy); ctx.stroke();
  }

  // Khung viền bàn máy
  ctx.strokeStyle = 'rgba(168, 255, 83, 0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(mRect.x, mRect.y, mRect.w, mRect.h);

  // Thước đo mm trục X (0..230mm)
  ctx.fillStyle = '#8b8f9e';
  ctx.font = '9px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const xTicks = [50, 100, 150, 200, t.mW];
  xTicks.forEach(mmX => {
    const pt = t.mmToPx(mmX, 0);
    ctx.fillText(`${mmX}`, pt.x, mRect.y - 4);
    ctx.beginPath();
    ctx.moveTo(pt.x, mRect.y - 3);
    ctx.lineTo(pt.x, mRect.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.stroke();
  });

  // Thước đo mm trục Y (0..850mm)
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const yTicks = [100, 200, 300, 400, 500, 600, 700, 800, t.yMax ?? t.mH].filter(
    (value, index, values) => Number.isFinite(value) && values.indexOf(value) === index);
  yTicks.forEach(mmY => {
    const pt = t.mmToPx(0, mmY);
    ctx.fillText(`${mmY}`, mRect.x - 6, pt.y);
    ctx.beginPath();
    ctx.moveTo(mRect.x - 3, pt.y);
    ctx.lineTo(mRect.x, pt.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.stroke();
  });

  // Điểm gốc tọa độ (0,0)
  ctx.fillStyle = '#a8ff53';
  ctx.beginPath();
  ctx.arc(mRect.x, mRect.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '700 9px Consolas, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('(0,0)', mRect.x - 4, mRect.y - 3);

    // Hiển thị lớp ảnh người dùng (nếu có)
  if (imgWs.img) {
    const imgLeft = t.viewX + (imgWs.x / V_SIZE) * t.viewSize;
    const imgTop = t.viewY + ((V_SIZE - imgWs.y - imgWs.h) / V_SIZE) * t.viewSize;
    const imgPw = (imgWs.w / V_SIZE) * t.viewSize;
    const imgPh = (imgWs.h / V_SIZE) * t.viewSize;

    // Vẽ trực tiếp ảnh Trắng - Đen nhị phân để người dùng xem trước độ tương phản
    ctx.save();
    if (imgWs.bwCanvas) {
      ctx.drawImage(imgWs.bwCanvas, imgLeft, imgTop, imgPw, imgPh);
    } else {
      ctx.drawImage(imgWs.img, imgLeft, imgTop, imgPw, imgPh);
    }
    ctx.restore();

    // Khung bao quanh ảnh (nét đứt)
    ctx.strokeStyle = '#6c5ce7';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(imgLeft, imgTop, imgPw, imgPh);
    ctx.setLineDash([]);

    // 4 chấm kéo chỉnh tỷ lệ ở 4 góc
    const corners = [
      { id: 'tl', x: imgLeft, y: imgTop },
      { id: 'tr', x: imgLeft + imgPw, y: imgTop },
      { id: 'br', x: imgLeft + imgPw, y: imgTop + imgPh },
      { id: 'bl', x: imgLeft, y: imgTop + imgPh }
    ];
    corners.forEach(c => {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 7.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#6c5ce7';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#6c5ce7';
      ctx.fill();
    });

    // Nhãn hướng dẫn thao tác
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(mRect.x + mRect.w - 185, mRect.y + 6, 178, 18);
    ctx.fillStyle = '#a8ff53';
    ctx.font = '500 10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔍 Kéo 4 góc · Cuộn chuột để zoom', mRect.x + mRect.w - 10, mRect.y + 15);

    // Thẻ thông tin kích thước mm của ảnh
    ctx.fillStyle = 'rgba(108, 92, 231, 0.9)';
    ctx.fillRect(imgLeft, imgTop - 18, Math.min(imgPw, 185), 16);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const mmW = Math.round((imgWs.w / V_SIZE) * t.mW);
    const mmH = Math.round((imgWs.h / V_SIZE) * t.mH);
    const mmX = Math.round((imgWs.x / V_SIZE) * t.mW);
    const mmY = Math.round(((V_SIZE - imgWs.y - imgWs.h) / V_SIZE) * t.mH);
    ctx.fillText(`${mmW}×${mmH}mm (X:${mmX}, Y:${mmY})`, imgLeft + 4, imgTop - 10);
  } else {
    // Trạng thái chờ nạp ảnh
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = '600 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🖼️ Chưa có ảnh · Hãy tải ảnh lên để bắt đầu', mRect.x + mRect.w / 2, mRect.y + mRect.h / 2);
  }

  ctx.restore();
}

/**
 * Vẽ mô phỏng đường chạy dao CNC trên Path Canvas:
 * - Nét Pen DOWN: Màu xanh neon (#a8ff53) cho viền hoặc màu cyan (#81ecec) cho tô màu.
 * - Nét Pen UP di chuyển nhanh: Nét đứt màu cam (#ffa94d).
 */
function renderPathPreview() {
  const canvas = $('pathCanvas');
  if (!canvas) return;
  const t = getCanvasTransform(canvas);
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(t.dpr, t.dpr);
  ctx.clearRect(0, 0, t.cw, t.ch);

  // Nền ngoài
  ctx.fillStyle = '#12131c';
  ctx.fillRect(0, 0, t.cw, t.ch);

  // Chỉ phóng to phần xem trước theo cùng khung vuông với ảnh gốc.
  // imgWs.paths và cncOps vẫn dùng hệ tọa độ 500x500 và giới hạn máy như cũ.
  const mRect = {
    x: t.viewX,
    y: t.viewY,
    w: t.viewSize,
    h: t.viewSize
  };
  const pathVirtToPx = (vx, vy) => ({
    x: t.viewX + (vx / V_SIZE) * t.viewSize,
    y: t.viewY + (vy / V_SIZE) * t.viewSize
  });

  // Khung bàn máy
  ctx.fillStyle = '#171822';
  ctx.fillRect(mRect.x, mRect.y, mRect.w, mRect.h);
  ctx.strokeStyle = 'rgba(168, 255, 83, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(mRect.x, mRect.y, mRect.w, mRect.h);

  // Lưới tọa độ
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const gx = mRect.x + (i / 5) * mRect.w;
    const gy = mRect.y + (i / 5) * mRect.h;
    ctx.beginPath(); ctx.moveTo(gx, mRect.y); ctx.lineTo(gx, mRect.y + mRect.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mRect.x, gy); ctx.lineTo(mRect.x + mRect.w, gy); ctx.stroke();
  }

  const paths = imgWs.paths;
  if (!paths || paths.length === 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '600 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Đường chạy CNC sẽ hiển thị tại đây', mRect.x + mRect.w / 2, mRect.y + mRect.h / 2);
    ctx.restore();
    return;
  }

  // Vẽ các đường di chuyển nhanh (Pen UP) bằng nét đứt màu cam
  ctx.strokeStyle = 'rgba(255, 169, 77, 0.35)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([3, 3]);
  let lastEnd = { x: 0, y: 0 };
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (p.length === 0) continue;
    const pStart = pathVirtToPx(p[0].x, p[0].y);
    const pLast = pathVirtToPx(lastEnd.x, lastEnd.y);
    ctx.beginPath();
    ctx.moveTo(pLast.x, pLast.y);
    ctx.lineTo(pStart.x, pStart.y);
    ctx.stroke();
    lastEnd = p[p.length - 1];
  }
  ctx.setLineDash([]);

  // Vẽ các đường chạy dao hạ bút (Pen DOWN)
  const pathColor = imgWs.mode === 'hatch' ? '#81ecec' : '#a8ff53';
  ctx.strokeStyle = pathColor;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (p.length < 2) continue;
    ctx.beginPath();
    const p0 = pathVirtToPx(p[0].x, p[0].y);
    ctx.moveTo(p0.x, p0.y);
    for (let j = 1; j < p.length; j++) {
      const pj = pathVirtToPx(p[j].x, p[j].y);
      ctx.lineTo(pj.x, pj.y);
    }
    ctx.stroke();
  }

  // Đánh dấu điểm gốc (0,0)
  const originPt = pathVirtToPx(0, 0);
  ctx.fillStyle = '#a8ff53';
  ctx.beginPath();
  ctx.arc(originPt.x, originPt.y, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Cập nhật hiển thị % tỷ lệ và kích thước mm của ảnh lên giao diện
 */
function updateScaleDisplay() {
  const pct = Math.round((imgWs.w / V_SIZE) * 100);
  if ($('imgScaleSlider')) $('imgScaleSlider').value = pct;
  if ($('imgScaleOut')) $('imgScaleOut').textContent = `${pct}%`;
  if ($('wsScaleInfo')) {
    const t = getCanvasTransform($('workspaceCanvas') || { getBoundingClientRect: () => ({ width: 400, height: 400 }) });
    const mmW = Math.round((imgWs.w / V_SIZE) * (t.mW || 230));
    const mmH = Math.round((imgWs.h / V_SIZE) * (t.mH || 850));
    $('wsScaleInfo').textContent = `${pct}% (${mmW}×${mmH}mm)`;
  }
}

/**
 * Phóng to / thu nhỏ ảnh theo hệ số factor quanh điểm neo (anchor)
 * @param {number} factor - Hệ số phóng đại (ví dụ 1.1 hoặc 0.9)
 * @param {{x: number, y: number}|null} anchorVirt - Điểm neo trong hệ tọa độ ảo
 */
function zoomBy(factor, anchorVirt = null) {
  if (!imgWs.img) return;
  const currentW = imgWs.w;
  const aspect = imgWs.imgH / (imgWs.imgW || 1);
  const minW = 20;
  const maxW = V_SIZE * 3.5;
  const newW = Math.max(minW, Math.min(maxW, Math.round(currentW * factor)));
  const newH = Math.round(newW * aspect);

  if (anchorVirt) {
    const ratioX = (anchorVirt.x - imgWs.x) / (imgWs.w || 1);
    const ratioY = (anchorVirt.y - imgWs.y) / (imgWs.h || 1);
    imgWs.x = Math.round(anchorVirt.x - ratioX * newW);
    imgWs.y = Math.round(anchorVirt.y - ratioY * newH);
  } else {
    const cx = imgWs.x + imgWs.w / 2;
    const cy = imgWs.y + imgWs.h / 2;
    imgWs.x = Math.round(cx - newW / 2);
    imgWs.y = Math.round(cy - newH / 2);
  }
  imgWs.w = newW;
  imgWs.h = newH;
  updateScaleDisplay();
  renderWorkspace();
  scheduleProcess(80);
}

/**
 * Đặt tỷ lệ ảnh chính xác theo % kích thước bàn máy (10% - 300%)
 * @param {number|string} pct - Tỷ lệ phần trăm
 */
function zoomToPercent(pct) {
  if (!imgWs.img) return;
  const safePct = Math.max(10, Math.min(300, Number(pct) || 100));
  const newW = Math.round((safePct / 100) * V_SIZE);
  const aspect = imgWs.imgH / (imgWs.imgW || 1);
  const newH = Math.round(newW * aspect);
  const cx = imgWs.x + imgWs.w / 2;
  const cy = imgWs.y + imgWs.h / 2;
  imgWs.w = newW;
  imgWs.h = newH;
  imgWs.x = Math.round(cx - newW / 2);
  imgWs.y = Math.round(cy - newH / 2);
  updateScaleDisplay();
  renderWorkspace();
  scheduleProcess(80);
}

/**
 * Căn vừa ảnh vào toàn bộ khung bàn máy
 */
function fitWorkspace() {
  if (!imgWs.img) return;
  const targetSize = 420;
  const imgAspect = imgWs.imgW / (imgWs.imgH || 1);
  if (imgAspect >= 1) {
    imgWs.w = targetSize;
    imgWs.h = Math.round(targetSize / imgAspect);
  } else {
    imgWs.h = targetSize;
    imgWs.w = Math.round(targetSize * imgAspect);
  }
  imgWs.x = Math.round((V_SIZE - imgWs.w) / 2);
  imgWs.y = Math.round((V_SIZE - imgWs.h) / 2);
  updateScaleDisplay();
  renderWorkspace();
  scheduleProcess(80);
}

/**
 * Di chuyển ảnh về chính giữa trung tâm bàn máy
 */
function centerWorkspace() {
  if (!imgWs.img) return;
  imgWs.x = Math.round((V_SIZE - imgWs.w) / 2);
  imgWs.y = Math.round((V_SIZE - imgWs.h) / 2);
  renderWorkspace();
  scheduleProcess(80);
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 10: ĐỒ THỊ TRỰC QUAN HÓA THỜI GIAN THỰC (ECHARTS & HTML5 CANVAS CHARTS)
// ═════════════════════════════════════════════════════════════════════════════════════════

let motorXGaugeChart = null;
let motorYGaugeChart = null;
let tempGaugeChart = null;
let humGaugeChart = null;
let dhtTrendChart = null;

const TREND_POINTS_COUNT = 24;
const FIXED_TIME_SLOTS = Array.from({ length: TREND_POINTS_COUNT }, (_, i) => {
  const diff = TREND_POINTS_COUNT - 1 - i;
  return diff === 0 ? 'Hiện tại' : `-${diff * 2}s`;
});

// Khởi tạo trước mảng dữ liệu lịch sử để biểu đồ ổn định ngay khi load trang
state.positionHistory = Array.from({ length: 60 }, () => ({ xPercent: 0, yPercent: 0 }));
state.dhtHistory = Array.from({ length: TREND_POINTS_COUNT }, () => ({ temp: 28, hum: 65 }));

/**
 * Vẽ biểu đồ vị trí động cơ X & Y thời gian thực trên HTML5 Canvas
 */
function drawPositionChart() {
  const canvas = $('positionChart');
  if (!canvas) return;
  const width = Math.max(260, canvas.clientWidth || 320);
  const height = 230;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);

  const left = 32;
  const right = 12;
  const top = 14;
  const bottom = 24;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  ctx.font = '10px Consolas, monospace';
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#e2dfd6';
  ctx.fillStyle = '#666';

  for (let i = 0; i <= 4; i += 1) {
    const y = top + plotHeight * i / 4;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke();
    ctx.fillText(`${100 - i * 25}%`, 2, y + 3);
  }

  if (!state.positionHistory.length) {
    ctx.fillStyle = '#777';
    ctx.fillText('Chờ dữ liệu vị trí từ ESP32...', left + 8, top + plotHeight / 2);
    return;
  }

  const maxSlots = 60;
  const points = state.positionHistory;
  const xPoint = (point, index) => left + (index / Math.max(1, maxSlots - 1)) * plotWidth;
  const drawLine = (key, color) => {
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = xPoint(point, index);
      const y = top + (1 - (point[key] ?? 0)) * plotHeight;
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  };
  drawLine('xPercent', '#6c5ce7');
  drawLine('yPercent', '#ffa94d');
}

/**
 * Tạo cấu hình đồng hồ Gauge dạng cung tròn bán nguyệt cho ECharts
 * @param {object} cfg - Thông số cấu hình gauge
 * @returns {object}
 */
function createGaugeOption(cfg) {
  const { min, max, unit, splitNumber, color, colorThin, value } = cfg;
  return {
    series: [
      {
        type: 'gauge',
        center: ['50%', '64%'],
        startAngle: 200,
        endAngle: -20,
        min: min,
        max: max,
        splitNumber: splitNumber || 5,
        itemStyle: {
          color: color || '#FFAB91'
        },
        progress: {
          show: true,
          width: 18
        },
        pointer: {
          show: false
        },
        axisLine: {
          lineStyle: {
            width: 18,
            color: [[1, 'rgba(0,0,0,0.06)']]
          }
        },
        axisTick: {
          distance: -26,
          splitNumber: 4,
          lineStyle: {
            width: 1.5,
            color: '#aaa'
          }
        },
        splitLine: {
          distance: -30,
          length: 8,
          lineStyle: {
            width: 2,
            color: '#888'
          }
        },
        axisLabel: {
          distance: -14,
          color: '#666',
          fontSize: 10,
          fontFamily: "'Inter', system-ui, sans-serif"
        },
        anchor: {
          show: false
        },
        title: {
          show: false
        },
        detail: {
          valueAnimation: true,
          width: '60%',
          lineHeight: 28,
          borderRadius: 8,
          offsetCenter: [0, '-10%'],
          fontSize: 24,
          fontWeight: '900',
          fontFamily: "'Space Grotesk', 'Inter', sans-serif",
          formatter: `{value} ${unit}`,
          color: 'inherit'
        },
        data: [
          {
            value: value ?? 0
          }
        ]
      },
      {
        type: 'gauge',
        center: ['50%', '64%'],
        startAngle: 200,
        endAngle: -20,
        min: min,
        max: max,
        itemStyle: {
          color: colorThin || color || '#FD7347'
        },
        progress: {
          show: true,
          width: 5
        },
        pointer: {
          show: false
        },
        axisLine: {
          show: false
        },
        axisTick: {
          show: false
        },
        splitLine: {
          show: false
        },
        axisLabel: {
          show: false
        },
        detail: {
          show: false
        },
        data: [
          {
            value: value ?? 0
          }
        ]
      }
    ]
  };
}

/**
 * Khởi tạo toàn bộ các đồ thị trực quan hóa ECharts và Canvas
 */
function initAllVisuals() {
  if (typeof echarts === 'undefined') return;

  // 1. Đồng hồ Gauge Motor X (0..230mm)
  const mxDom = $('motorXGaugeContainer');
  if (mxDom && !motorXGaugeChart) {
    motorXGaugeChart = echarts.init(mxDom, null, { renderer: 'canvas', useDirtyRect: false });
    motorXGaugeChart.setOption(createGaugeOption({
      min: 0,
      max: 230,
      unit: 'mm',
      splitNumber: 5,
      color: '#6c5ce7',
      colorThin: '#a29bfe',
      value: 0
    }));
  }

  // 2. Đồng hồ Gauge Motor Y (0..850mm)
  const myDom = $('motorYGaugeContainer');
  if (myDom && !motorYGaugeChart) {
    motorYGaugeChart = echarts.init(myDom, null, { renderer: 'canvas', useDirtyRect: false });
    motorYGaugeChart.setOption(createGaugeOption({
      min: 0,
      max: 850,
      unit: 'mm',
      splitNumber: 5,
      color: '#0984e3',
      colorThin: '#74b9ff',
      value: 0
    }));
  }

  // 3. Đồng hồ Gauge Nhiệt độ DHT11 (0..60°C)
  const tempDom = $('tempGaugeContainer');
  if (tempDom && !tempGaugeChart) {
    tempGaugeChart = echarts.init(tempDom, null, { renderer: 'canvas', useDirtyRect: false });
    tempGaugeChart.setOption(createGaugeOption({
      min: 0,
      max: 60,
      unit: '°C',
      splitNumber: 6,
      color: '#ff7675',
      colorThin: '#FD7347',
      value: 28.5
    }));
  }

  // 4. Đồng hồ Gauge Độ ẩm DHT11 (0..100%)
  const humDom = $('humGaugeContainer');
  if (humDom && !humGaugeChart) {
    humGaugeChart = echarts.init(humDom, null, { renderer: 'canvas', useDirtyRect: false });
    humGaugeChart.setOption(createGaugeOption({
      min: 0,
      max: 100,
      unit: '%',
      splitNumber: 5,
      color: '#74b9ff',
      colorThin: '#0984e3',
      value: 65.0
    }));
  }

  // 5. Biểu đồ đường xu hướng DHT11 cố định (Nhiệt độ & Độ ẩm)
  const dhtDom = $('dhtChartContainer');
  if (dhtDom && !dhtTrendChart) {
    dhtTrendChart = echarts.init(dhtDom, null, { renderer: 'canvas', useDirtyRect: false });
    dhtTrendChart.setOption({
      animation: false,
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        textStyle: { color: '#2d3436', fontSize: 12 },
        borderColor: 'rgba(0,0,0,0.08)'
      },
      grid: {
        top: 28,
        right: 48,
        bottom: 24,
        left: 48,
        containLabel: false
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: FIXED_TIME_SLOTS,
        axisLine: { lineStyle: { color: 'rgba(0,0,0,0.1)' } },
        axisTick: { show: false },
        axisLabel: { color: '#888', fontSize: 10 }
      },
      yAxis: [
        {
          type: 'value',
          name: '°C',
          nameTextStyle: { color: '#ff7675', fontSize: 11, fontWeight: 'bold' },
          min: 0,
          max: 60,
          splitNumber: 6,
          axisLabel: { color: '#ff7675', fontSize: 10 },
          splitLine: { lineStyle: { color: 'rgba(0,0,0,0.04)' } }
        },
        {
          type: 'value',
          name: '%',
          nameTextStyle: { color: '#74b9ff', fontSize: 11, fontWeight: 'bold' },
          min: 0,
          max: 100,
          splitNumber: 5,
          axisLabel: { color: '#74b9ff', fontSize: 10 },
          splitLine: { show: false }
        }
      ],
      series: [
        {
          name: 'Nhiệt độ',
          type: 'line',
          yAxisIndex: 0,
          showSymbol: false,
          smooth: 0.3,
          lineStyle: { color: '#ff7675', width: 2.5 },
          itemStyle: { color: '#ff7675' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(255, 118, 117, 0.25)' },
              { offset: 1, color: 'rgba(255, 118, 117, 0.00)' }
            ])
          },
          data: state.dhtHistory.map(p => p.temp)
        },
        {
          name: 'Độ ẩm',
          type: 'line',
          yAxisIndex: 1,
          showSymbol: false,
          smooth: 0.3,
          lineStyle: { color: '#74b9ff', width: 2.5 },
          itemStyle: { color: '#74b9ff' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(116, 185, 255, 0.25)' },
              { offset: 1, color: 'rgba(116, 185, 255, 0.00)' }
            ])
          },
          data: state.dhtHistory.map(p => p.hum)
        }
      ]
    });
  }

  // Khởi vẽ biểu đồ vị trí Canvas và khung bàn máy
  drawPositionChart();
  renderWorkspace();
  renderPathPreview();

  // Tự động co giãn khi cửa sổ trình duyệt thay đổi kích thước
  window.addEventListener('resize', () => {
    motorXGaugeChart?.resize();
    motorYGaugeChart?.resize();
    tempGaugeChart?.resize();
    humGaugeChart?.resize();
    dhtTrendChart?.resize();
    drawPositionChart();
    renderWorkspace();
    renderPathPreview();
  });
}

/**
 * Cập nhật giá trị hiển thị trên đồng hồ Gauge Motor X
 */
function updateMotorXGauge(val, min = 0, max = 230) {
  if (!motorXGaugeChart) return;
  const num = Number(val);
  if (!Number.isFinite(num)) return;
  const rounded = Math.round(num);
  const targetMax = Math.min(1000, Math.max(50, Math.round(max)));
  motorXGaugeChart.setOption({
    series: [
      { min: 0, max: targetMax, data: [{ value: rounded }] },
      { min: 0, max: targetMax, data: [{ value: rounded }] }
    ]
  });
}

/**
 * Cập nhật giá trị hiển thị trên đồng hồ Gauge Motor Y
 */
function updateMotorYGauge(val, min = 0, max = 850) {
  if (!motorYGaugeChart) return;
  const num = Number(val);
  if (!Number.isFinite(num)) return;
  const rounded = Math.round(num);
  const targetMax = Math.min(2000, Math.max(50, Math.round(max)));
  motorYGaugeChart.setOption({
    series: [
      { min: 0, max: targetMax, data: [{ value: rounded }] },
      { min: 0, max: targetMax, data: [{ value: rounded }] }
    ]
  });
}

/**
 * Cập nhật giá trị hiển thị trên đồng hồ Gauge Nhiệt độ
 */
function updateTempGauge(val) {
  if (!tempGaugeChart) return;
  const num = Number(val);
  if (!Number.isFinite(num)) return;
  const rounded = Number(num.toFixed(1));
  tempGaugeChart.setOption({
    series: [
      { data: [{ value: rounded }] },
      { data: [{ value: rounded }] }
    ]
  });
}

/**
 * Cập nhật giá trị hiển thị trên đồng hồ Gauge Độ ẩm
 */
function updateHumGauge(val) {
  if (!humGaugeChart) return;
  const num = Number(val);
  if (!Number.isFinite(num)) return;
  const rounded = Number(num.toFixed(1));
  humGaugeChart.setOption({
    series: [
      { data: [{ value: rounded }] },
      { data: [{ value: rounded }] }
    ]
  });
}

/**
 * Thêm điểm dữ liệu mới vào biểu đồ xu hướng DHT11
 */
function updateDhtTrend(temp, hum) {
  const t = Number(Number(temp || 0).toFixed(1));
  const h = Number(Number(hum || 0).toFixed(1));
  state.dhtHistory.push({ temp: t, hum: h });
  if (state.dhtHistory.length > TREND_POINTS_COUNT) {
    state.dhtHistory.shift();
  }
  if (dhtTrendChart) {
    dhtTrendChart.setOption({
      series: [
        { data: state.dhtHistory.map(p => p.temp) },
        { data: state.dhtHistory.map(p => p.hum) }
      ]
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PHẦN 11: ĐĂNG KÝ SỰ KIỆN TƯƠNG TÁC & KHỞI CHẠY (EVENT BINDINGS & INIT)
// ═════════════════════════════════════════════════════════════════════════════════════════

// 1. Đăng ký sự kiện các nút điều khiển thủ công [data-topic]
document.querySelectorAll('[data-topic]').forEach(button => {
  button.addEventListener('click', () => sendControl(button));
});

// 2. Kết nối / Ngắt kết nối MQTT
$('connectForm')?.addEventListener('submit', connect);
$('disconnect')?.addEventListener('click', () => {
  state.client?.end(true);
  state.client = null;
  setConnection('Chưa kết nối');
  log('Đã ngắt kết nối.');
});

// 3. Chọn bước di chuyển Jog (10, 50, 100 mm)
document.querySelectorAll('.step-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.step-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    if ($('steps')) $('steps').value = pill.dataset.step;
    if ($('activeStepDisplay')) $('activeStepDisplay').textContent = pill.dataset.step;
    log(`Đã chọn bước di chuyển: ${pill.dataset.step}`);
  });
});

// 4. Bật/Tắt Nhấc & Hạ bút vẽ (gửi ngay góc được chỉ định trong ô nhập)
$('togglePen')?.addEventListener('click', () => {
  state.penDown = !state.penDown;
  const upAngle = Number($('penUp')?.value) || 110;
  const downAngle = Number($('penDown')?.value) || 80;
  const targetAngle = state.penDown ? downAngle : upAngle;
  if (state.client?.connected) {
    publish(state.penDown ? 'control/pen/down' : 'control/pen/up', String(targetAngle), '01·THIẾT BỊ');
  } else {
    log(`[ẢO] Trạng thái bút: ${state.penDown ? `HẠ BÚT ▼ (${downAngle}°)` : `NHẤC BÚT ▲ (${upAngle}°)`} (Chưa kết nối broker)`, '01·THIẾT BỊ');
  }
  updateToggleButtons();
});

// Chỉnh xong góc trong ô nhập: lưu vào localStorage và gửi ngay sang ESP32 để lưu vĩnh viễn vào Flash NVS
$('penUp')?.addEventListener('change', (e) => {
  const upAngle = Number(e.target.value) || 110;
  localStorage.setItem('cnc_penUp', String(upAngle));
  if (state.client?.connected) {
    if (!state.penDown) {
      publish('control/pen/up', String(upAngle), '01·THIẾT BỊ');
    } else {
      publish('control/pen/config', JSON.stringify({ up: upAngle }), '01·THIẾT BỊ');
    }
    log(`Đã lưu góc nhấc bút mới: ${upAngle}° (Lưu vào Flash NVS)`, '01·THIẾT BỊ');
  }
});
$('penDown')?.addEventListener('change', (e) => {
  const downAngle = Number(e.target.value) || 80;
  localStorage.setItem('cnc_penDown', String(downAngle));
  if (state.client?.connected) {
    if (state.penDown) {
      publish('control/pen/down', String(downAngle), '01·THIẾT BỊ');
    } else {
      publish('control/pen/config', JSON.stringify({ down: downAngle }), '01·THIẾT BỊ');
    }
    log(`Đã lưu góc hạ bút mới: ${downAngle}° (Lưu vào Flash NVS)`, '01·THIẾT BỊ');
  }
});

// Khôi phục góc xoay servo đã lưu từ lần trước trên trình duyệt (localStorage)
const savedPenUp = localStorage.getItem('cnc_penUp');
if (savedPenUp && $('penUp')) $('penUp').value = savedPenUp;
const savedPenDown = localStorage.getItem('cnc_penDown');
if (savedPenDown && $('penDown')) $('penDown').value = savedPenDown;

// 5. Bật/Tắt Đèn chiếu sáng LED
$('toggleLed')?.addEventListener('click', () => {
  state.ledOn = !state.ledOn;
  if (state.client?.connected) {
    publish('control/led', state.ledOn ? '1' : '0');
  } else {
    log(`[ẢO] Đèn LED: ${state.ledOn ? 'BẬT SÁNG 💡' : 'TẮT'} (Chưa kết nối broker)`, '01·THIẾT BỊ');
  }
  updateToggleButtons();
});

// 6. Nút chuyển sang chế độ phát WiFi cứu hộ KimPang
if ($('resetWifiBtn')) $('resetWifiBtn').addEventListener('click', handleResetWifi);
if ($('quickResetWifiBtn')) $('quickResetWifiBtn').addEventListener('click', handleResetWifi);

// 7. Thanh trượt cài đặt tốc độ động cơ
if ($('speedSlider')) {
  $('speedSlider').addEventListener('input', (e) => {
    const val = e.target.value;
    if ($('speedValue')) $('speedValue').textContent = `${val} bước/s`;
  });
  $('speedSlider').addEventListener('change', (e) => {
    const val = e.target.value;
    if (state.client?.connected) {
      publish('control/speed', val.toString(), '01·TỐC ĐỘ');
      log(`Đã gửi thiết lập tốc độ động cơ: ${val} bước/giây`, '01·ĐIỀU KHIỂN');
    }
  });
}

// 8. Các nút vẽ hình học cơ bản (Section 02)
$('square')?.addEventListener('click', () => runShape('square'));
$('circle')?.addEventListener('click', () => runShape('circle'));
if ($('cancelShapeJobBtn')) {
  $('cancelShapeJobBtn').addEventListener('click', () => handleCancelJob('02·HỦY LỆNH'));
}

// 9. Nạp ảnh & Kéo thả ảnh (Section 03)
const fileInput = $('drawImage');
if (fileInput) {
  fileInput.addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) {
      handleImageFile(e.target.files[0]);
    }
  });
}

const dropZone = $('fileDropZone');
if (dropZone) {
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, e => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, e => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drag-over');
    });
  });
  dropZone.addEventListener('drop', e => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files[0]) {
      handleImageFile(dt.files[0]);
    }
  });
}

// 10. Chuyển tab chế độ vẽ (Viền Outline vs Tô màu Hatch Fill)
const modeTabs = document.querySelectorAll('.img-mode-tab');
modeTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    modeTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    imgWs.mode = tab.dataset.mode;
    const hatchCtrl = $('hatchSpacingCtrl');
    if (hatchCtrl) {
      hatchCtrl.style.display = imgWs.mode === 'hatch' ? 'flex' : 'none';
    }
    const outlineRow = $('outlineStyleRow');
    if (outlineRow) {
      outlineRow.style.display = imgWs.mode === 'outline' ? 'flex' : 'none';
    }
    const minLenCtrl = $('minLenCtrl');
    if (minLenCtrl) {
      minLenCtrl.style.display = imgWs.mode === 'outline' ? 'flex' : 'none';
    }
    if (imgWs.img) {
      processImageAndGeneratePaths();
    }
  });
});

// 11. Chọn kiểu viền: Viền khối Boundary vs Viền Canny
const styleBtns = document.querySelectorAll('.outline-style-btn');
styleBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    styleBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    imgWs.outlineStyle = btn.dataset.style || 'boundary';
    if (imgWs.img) {
      processImageAndGeneratePaths();
    }
  });
});

// 12. Thanh trượt Độ tương phản & Ngưỡng nhị phân Trắng - Đen
if ($('contrastSlider')) {
  $('contrastSlider').addEventListener('input', e => {
    imgWs.contrast = Number(e.target.value) || 0;
    if ($('contrastOut')) $('contrastOut').textContent = imgWs.contrast > 0 ? `+${imgWs.contrast}` : `${imgWs.contrast}`;
    renderWorkspace();
    scheduleProcess(80);
  });
}

if ($('threshold')) {
  $('threshold').addEventListener('input', e => {
    imgWs.threshold = Number(e.target.value) || 128;
    const pct = Math.round((imgWs.threshold / 255) * 100);
    if ($('threshOut')) $('threshOut').textContent = `${pct}%`;
    updateBwCanvas();
    renderWorkspace();
    scheduleProcess(60);
  });
}

// 13. Tùy chọn Bật / Tắt vẽ thêm khung viền bao quanh ảnh
if ($('drawImgBorderCheck')) {
  $('drawImgBorderCheck').addEventListener('change', e => {
    imgWs.drawBorder = Boolean(e.target.checked);
    const statusEl = $('borderStatusText');
    if (statusEl) {
      statusEl.textContent = imgWs.drawBorder ? 'Đã bật' : 'Tắt';
      statusEl.style.color = imgWs.drawBorder ? '#6c5ce7' : '#888';
    }
    if (imgWs.img) {
      processImageAndGeneratePaths();
    }
  });
}

// 14. Các thanh trượt tinh chỉnh: Đơn giản hóa, Lọc nhiễu, Bước tô nét
if ($('simplify')) {
  $('simplify').addEventListener('input', e => {
    imgWs.simplify = Number(e.target.value) || 1;
    if ($('simplifyOut')) $('simplifyOut').textContent = imgWs.simplify;
    scheduleProcess(80);
  });
}

if ($('minLenSlider')) {
  $('minLenSlider').addEventListener('input', e => {
    imgWs.minLen = Number(e.target.value) || 8;
    if ($('minLenOut')) $('minLenOut').textContent = `${imgWs.minLen} px`;
    scheduleProcess(80);
  });
}

if ($('hatchSpacing')) {
  $('hatchSpacing').addEventListener('input', e => {
    imgWs.hatchSpacing = Number(e.target.value) || 3;
    if ($('hatchSpacingOut')) $('hatchSpacingOut').textContent = `${imgWs.hatchSpacing} mm`;
    scheduleProcess(80);
  });
}

// 15. Nút điều khiển Zoom và Căn chỉnh nhanh
if ($('imgScaleSlider')) {
  $('imgScaleSlider').addEventListener('input', e => {
    zoomToPercent(e.target.value);
  });
}

if ($('scaleMinusBtn')) $('scaleMinusBtn').addEventListener('click', () => zoomBy(0.9));
if ($('scalePlusBtn')) $('scalePlusBtn').addEventListener('click', () => zoomBy(1.1));
if ($('scaleFitBtn')) $('scaleFitBtn').addEventListener('click', fitWorkspace);
if ($('scale100Btn')) $('scale100Btn').addEventListener('click', () => zoomToPercent(100));

if ($('wsZoomIn')) $('wsZoomIn').addEventListener('click', () => zoomBy(1.15));
if ($('wsZoomOut')) $('wsZoomOut').addEventListener('click', () => zoomBy(0.85));
if ($('wsFitBtn')) $('wsFitBtn').addEventListener('click', fitWorkspace);
if ($('wsCenterBtn')) $('wsCenterBtn').addEventListener('click', centerWorkspace);
if ($('wsResetBtn')) $('wsResetBtn').addEventListener('click', () => zoomToPercent(100));

// 16. Nút Gửi ảnh lên ESP32 & Hủy lệnh vẽ ảnh
if ($('sendImagePath')) {
  $('sendImagePath').addEventListener('click', sendImageToESP);
}
if ($('cancelImageJobBtn')) {
  $('cancelImageJobBtn').addEventListener('click', () => handleCancelJob('03·HỦY LỆNH'));
}
if ($('stopImageJobBtn')) {
  $('stopImageJobBtn').addEventListener('click', () => handleCancelJob('03·HỦY LỆNH'));
}

// 17. Nút Xóa lịch sử nhật ký (Clear log)
if ($('clearLogBtn')) {
  $('clearLogBtn').addEventListener('click', () => {
    if ($('log')) $('log').textContent = '';
    state.logCount = 0;
    if ($('logCount')) $('logCount').textContent = '0 sự kiện';
  });
}

// 18. Tương tác chuột & cảm ứng trên Canvas bàn máy (Workspace Canvas)
const wsCanvas = $('workspaceCanvas');
if (wsCanvas) {
  let resizeCorner = null;
  let resizeStartRect = null;
  let pinchStartDist = 0;
  let pinchStartW = 0;

  // Xác định xem con trỏ có đang chạm vào 1 trong 4 góc kéo hay không
  function viewUnitsFromPixels(dxPx, dyPx) {
    const t = getCanvasTransform(wsCanvas);
    const unit = (wsCanvas.id === 'workspaceCanvas' ? t.viewSize : t.boxSize) || t.boxSize || 1;
    return {
      dx: (dxPx / unit) * V_SIZE,
      dy: -(dyPx / unit) * V_SIZE
    };
  }

  function getCornerAtPos(clientX, clientY) {
    if (!imgWs.img) return null;
    const t = getCanvasTransform(wsCanvas);
    const rect = wsCanvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    const imgLeft = t.viewX + (imgWs.x / V_SIZE) * t.viewSize;
    const imgTop = t.viewY + ((V_SIZE - imgWs.y - imgWs.h) / V_SIZE) * t.viewSize;
    const imgPw = (imgWs.w / V_SIZE) * t.viewSize;
    const imgPh = (imgWs.h / V_SIZE) * t.viewSize;

    const corners = [
      { id: 'tl', x: imgLeft, y: imgTop, cursor: 'nwse-resize' },
      { id: 'tr', x: imgLeft + imgPw, y: imgTop, cursor: 'nesw-resize' },
      { id: 'br', x: imgLeft + imgPw, y: imgTop + imgPh, cursor: 'nwse-resize' },
      { id: 'bl', x: imgLeft, y: imgTop + imgPh, cursor: 'nesw-resize' }
    ];

    const hitRadius = 18;
    for (const c of corners) {
      if (Math.hypot(px - c.x, py - c.y) <= hitRadius) {
        return c;
      }
    }
    return null;
  }

  // Kiểm tra chuột có nằm trong vùng thân ảnh hay không
  function isMouseOverImage(clientX, clientY) {
    if (!imgWs.img) return false;
    const t = getCanvasTransform(wsCanvas);
    const rect = wsCanvas.getBoundingClientRect();
    const virt = t.pxToVirt(clientX - rect.left, clientY - rect.top);
    return (
      virt.x >= imgWs.x &&
      virt.x <= imgWs.x + imgWs.w &&
      virt.y >= imgWs.y &&
      virt.y <= imgWs.y + imgWs.h
    );
  }

  function startInteraction(clientX, clientY) {
    if (!imgWs.img) return;
    const corner = getCornerAtPos(clientX, clientY);
    if (corner) {
      resizeCorner = corner.id;
      imgWs.isDragging = false;
      imgWs.dragStartX = clientX;
      imgWs.dragStartY = clientY;
      resizeStartRect = { x: imgWs.x, y: imgWs.y, w: imgWs.w, h: imgWs.h };
      wsCanvas.style.cursor = corner.cursor;
      return;
    }

    if (isMouseOverImage(clientX, clientY)) {
      resizeCorner = null;
      imgWs.isDragging = true;
      imgWs.dragStartX = clientX;
      imgWs.dragStartY = clientY;
      imgWs.imgStartX = imgWs.x;
      imgWs.imgStartY = imgWs.y;
      wsCanvas.style.cursor = 'grabbing';
    }
  }

  function moveInteraction(clientX, clientY) {
    if (!imgWs.img) return;

    // Kéo 4 góc để phóng to/thu nhỏ ảnh
    if (resizeCorner && resizeStartRect) {
      const dxPx = clientX - imgWs.dragStartX;
      const dyPx = clientY - imgWs.dragStartY;
      const { dx: dxVirt, dy: dyVirt } = viewUnitsFromPixels(dxPx, dyPx);
      const aspect = imgWs.imgH / (imgWs.imgW || 1);

      let deltaW = 0;
      if (resizeCorner === 'br') {
        deltaW = Math.abs(dxVirt) >= Math.abs(dyVirt) ? dxVirt : (-dyVirt / aspect);
      } else if (resizeCorner === 'tr') {
        deltaW = Math.abs(dxVirt) >= Math.abs(dyVirt) ? dxVirt : (dyVirt / aspect);
      } else if (resizeCorner === 'bl') {
        deltaW = Math.abs(dxVirt) >= Math.abs(dyVirt) ? -dxVirt : (-dyVirt / aspect);
      } else if (resizeCorner === 'tl') {
        deltaW = Math.abs(dxVirt) >= Math.abs(dyVirt) ? -dxVirt : (dyVirt / aspect);
      }

      const minW = 25;
      const maxW = V_SIZE * 3.5;
      const newW = Math.max(minW, Math.min(maxW, resizeStartRect.w + deltaW));
      const newH = Math.round(newW * aspect);

      let newX = resizeStartRect.x;
      let newY = resizeStartRect.y;

      if (resizeCorner === 'br') {
        newX = resizeStartRect.x;
        newY = resizeStartRect.y;
      } else if (resizeCorner === 'tr') {
        newX = resizeStartRect.x;
        newY = resizeStartRect.y + resizeStartRect.h - newH;
      } else if (resizeCorner === 'bl') {
        newX = resizeStartRect.x + resizeStartRect.w - newW;
        newY = resizeStartRect.y;
      } else if (resizeCorner === 'tl') {
        newX = resizeStartRect.x + resizeStartRect.w - newW;
        newY = resizeStartRect.y + resizeStartRect.h - newH;
      }

      imgWs.w = Math.round(newW);
      imgWs.h = Math.round(newH);
      imgWs.x = Math.round(newX);
      imgWs.y = Math.round(newY);

      updateScaleDisplay();
      renderWorkspace();
      scheduleProcess(80);
      return;
    }

    // Kéo di chuyển vị trí của ảnh trên bàn máy
    if (imgWs.isDragging) {
      const { dx, dy } = viewUnitsFromPixels(
        clientX - imgWs.dragStartX,
        clientY - imgWs.dragStartY
      );
      imgWs.x = Math.round(imgWs.imgStartX + dx);
      imgWs.y = Math.round(imgWs.imgStartY + dy);
      renderWorkspace();
      scheduleProcess(90);
      return;
    }

    // Cập nhật con trỏ chuột khi hover
    const corner = getCornerAtPos(clientX, clientY);
    if (corner) {
      wsCanvas.style.cursor = corner.cursor;
    } else if (isMouseOverImage(clientX, clientY)) {
      wsCanvas.style.cursor = 'grab';
    } else {
      wsCanvas.style.cursor = 'default';
    }
  }

  function endInteraction() {
    if (resizeCorner || imgWs.isDragging) {
      resizeCorner = null;
      resizeStartRect = null;
      imgWs.isDragging = false;
      wsCanvas.style.cursor = 'default';
      processImageAndGeneratePaths();
    }
  }

  // Sự kiện chuột máy tính
  wsCanvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    startInteraction(e.clientX, e.clientY);
  });
  wsCanvas.addEventListener('mousemove', e => {
    moveInteraction(e.clientX, e.clientY);
  });
  wsCanvas.addEventListener('mouseup', endInteraction);
  wsCanvas.addEventListener('mouseleave', endInteraction);

  // Nhấp đúp chuột để chuyển đổi giữa Fit và 100%
  wsCanvas.addEventListener('dblclick', () => {
    if (!imgWs.img) return;
    const isFit = Math.abs(imgWs.w - 440) < 20 || Math.abs(imgWs.h - 440) < 20;
    if (isFit) {
      zoomToPercent(100);
    } else {
      fitWorkspace();
    }
  });

  // Sự kiện cảm ứng chạm (Touch / Mobile / Tablet)
  wsCanvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      startInteraction(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    } else if (e.touches.length === 2 && imgWs.img) {
      pinchStartDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartW = imgWs.w;
      e.preventDefault();
    }
  }, { passive: false });

  wsCanvas.addEventListener('touchmove', e => {
    if (e.touches.length === 1) {
      moveInteraction(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    } else if (e.touches.length === 2 && imgWs.img && pinchStartDist > 0) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = currentDist / pinchStartDist;
      const aspect = imgWs.imgH / (imgWs.imgW || 1);
      const newW = Math.max(25, Math.min(V_SIZE * 3.5, Math.round(pinchStartW * ratio)));
      const newH = Math.round(newW * aspect);

      const cx = imgWs.x + imgWs.w / 2;
      const cy = imgWs.y + imgWs.h / 2;
      imgWs.w = newW;
      imgWs.h = newH;
      imgWs.x = Math.round(cx - newW / 2);
      imgWs.y = Math.round(cy - newH / 2);

      updateScaleDisplay();
      renderWorkspace();
      scheduleProcess(90);
      e.preventDefault();
    }
  }, { passive: false });

  wsCanvas.addEventListener('touchend', () => {
    pinchStartDist = 0;
    endInteraction();
  });

  // Cuộn con lăn chuột để zoom quanh vị trí con trỏ
  wsCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (!imgWs.img) return;

    const t = getCanvasTransform(wsCanvas);
    const rect = wsCanvas.getBoundingClientRect();
    const mouseVirt = t.pxToVirt(e.clientX - rect.left, e.clientY - rect.top);

    const zoom = e.deltaY < 0 ? 1.09 : 0.915;
    zoomBy(zoom, mouseVirt);
  }, { passive: false });

  // Phím tắt bàn phím: +, -, 0
  window.addEventListener('keydown', e => {
    if (!imgWs.img) return;
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (e.key === '+' || e.key === '=') {
      zoomBy(1.1);
      e.preventDefault();
    } else if (e.key === '-' || e.key === '_') {
      zoomBy(0.9);
      e.preventDefault();
    } else if (e.key === '0') {
      fitWorkspace();
      e.preventDefault();
    }
  });
}

// 19. Tự động khởi chạy hệ thống đồ thị & không gian khi trang tải xong
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAllVisuals);
} else {
  initAllVisuals();
}
