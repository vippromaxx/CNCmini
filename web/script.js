const DEVICE = 'cnc01';
const state = { client: null, user: '', password: '', status: null, lock: '', positionHistory: [] };
const $ = id => document.getElementById(id);
const topic = rest => `cnc/${DEVICE}/${rest}`;

function log(message) {
  const line = `[${new Date().toLocaleTimeString('vi-VN')}] ${message}`;
  $('log').textContent = `${line}\n${$('log').textContent}`.slice(0, 12000);
}

function setConnection(label, good = false) {
  const element = $('connection');
  element.textContent = label;
  element.className = `connection ${good ? 'ok' : label === 'Chưa kết nối' ? '' : 'bad'}`;
  $('statusBadge').textContent = label;
  $('liveState').textContent = label;
}

function publish(rest, payload = '') {
  if (!state.client?.connected) {
    log('Chưa kết nối broker. Hãy đăng nhập trước.');
    return false;
  }
  state.client.publish(topic(rest), String(payload), { qos: 1 }, error => {
    if (error) log(`Lỗi gửi lệnh: ${error.message}`);
    else log(`Đã gửi: ${rest}${payload === '' ? '' : ` · ${payload}`}`);
  });
  return true;
}

function drawPositionChart() {
  const canvas = $('positionChart');
  if (!canvas) return;
  const width = Math.max(260, canvas.clientWidth || 320);
  const height = 220;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  const left = 30;
  const right = 8;
  const top = 12;
  const bottom = 25;
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
  const points = state.positionHistory;
  const xPoint = (point, index) => left + (index / Math.max(1, points.length - 1)) * plotWidth;
  const drawLine = (key, color) => {
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = xPoint(point, index);
      const y = top + (1 - point[key]) * plotHeight;
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  };
  drawLine('xPercent', '#4032e5');
  drawLine('yPercent', '#ff9c2a');
}

window.addEventListener('resize', drawPositionChart);

function renderStatus(data) {
  state.status = data;
  $('status').textContent = JSON.stringify(data, null, 2);
  const x = Number(data.x ?? 0);
  const y = Number(data.y ?? 0);
  const xMin = Number(data.range?.x?.[0] ?? 0);
  const xMax = Number(data.range?.x?.[1] ?? 230);
  const yMin = Number(data.range?.y?.[0] ?? -850);
  const yMax = Number(data.range?.y?.[1] ?? 0);
  const xPercent = Math.max(0, Math.min(1, (x - xMin) / (xMax - xMin || 1)));
  const yPercent = Math.max(0, Math.min(1, (y - yMin) / (yMax - yMin || 1)));
  state.positionHistory.push({ xPercent, yPercent });
  if (state.positionHistory.length > 60) state.positionHistory.shift();
  $('axisXValue').textContent = `${Math.round(x)} mm`;
  $('axisYValue').textContent = `${Math.round(y)} mm`;
  drawPositionChart();
  $('calLimitX').textContent = `${Math.round(xMin)}..${Math.round(xMax)}`;
  $('calLimitY').textContent = `${Math.round(yMin)}..${Math.round(yMax)}`;
  $('calScaleX').textContent = Number(data.scale?.x ?? 1).toFixed(3);
  $('calScaleY').textContent = Number(data.scale?.y ?? 1).toFixed(3);
  // Firmware versions currently publish flat temperature/humidity fields;
  // newer versions may group them under dht11. Accept both shapes.
  const dht = data.dht11 && typeof data.dht11 === 'object' ? data.dht11 : data;
  const temperature = Number(dht.temperatureC ?? dht.temperature ?? data.temperature ?? data.temp);
  const humidity = Number(dht.humidity ?? data.humidity ?? data.hum ?? data.environment?.humidity);
  const dhtValid = data.dht11 === false || dht.valid === false || dht.ok === false
    ? false
    : Number.isFinite(temperature) && Number.isFinite(humidity);
  const dhtAge = Number(dht.age_s);
  const dhtFreshness = Number.isFinite(dhtAge) ? `DHT11 · ${dhtAge}s trước` : 'DHT11';
  if (dhtValid) {
    $('temperatureValue').textContent = `${temperature.toFixed(1)} °C`;
    $('temperatureNote').textContent = dhtFreshness;
  } else {
    $('temperatureValue').textContent = '-- °C';
    $('temperatureNote').textContent = 'DHT11 chưa phản hồi';
  }
  if (dhtValid) {
    $('humidityValue').textContent = `${humidity.toFixed(1)} %`;
    $('humidityNote').textContent = dhtFreshness;
  } else {
    $('humidityValue').textContent = '-- %';
    $('humidityNote').textContent = 'DHT11 chưa phản hồi';
  }
  const position = `X ${x} · Y ${y}`;
  $('livePosition').textContent = position;
  $('positionBadge').textContent = position;
  $('liveState').textContent = data.state || data.job?.s || 'Đang hoạt động';
  $('statusBadge').textContent = data.state || data.job?.s || 'Đang hoạt động';
  $('liveJob').textContent = data.job?.k ? `${data.job.k} · ${data.job.i ?? 0}/${data.job.n ?? 0}` : 'Không có';
}

function connect(event) {
  event.preventDefault();
  if (!window.mqtt) return log('Không tải được thư viện MQTT.');
  if (state.client) state.client.end(true);
  state.user = $('username').value.trim();
  state.password = $('password').value;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.host || `${location.hostname || '127.0.0.1'}:3000`;
  const url = `${scheme}://${host}/mqtt`;
  setConnection('Đang kết nối...');
  state.client = mqtt.connect(url, {
    clientId: `web-${Math.random().toString(16).slice(2)}`,
    username: state.user,
    password: state.password,
    reconnectPeriod: 2000,
    clean: true
  });
  state.client.on('connect', () => {
    setConnection('Đã kết nối', true);
    log(`Đã kết nối broker: ${url}`);
    state.client.subscribe([topic('status'), topic('lock')], { qos: 1 });
  });
  state.client.on('message', (receivedTopic, payload) => {
    const value = payload.toString();
    if (receivedTopic.endsWith('/lock')) {
      state.lock = value;
      log(value ? `Máy đang được giữ bởi ${value}` : 'Máy đã được mở khóa');
      return;
    }
    try { renderStatus(JSON.parse(value)); }
    catch (_) { log(`Status không hợp lệ: ${value}`); }
  });
  state.client.on('error', error => { setConnection('Lỗi kết nối'); log(`Broker: ${error.message}`); });
  state.client.on('close', () => setConnection('Mất kết nối'));
}

function sendControl(button) {
  const steps = Math.max(1, Number($('steps').value) || 10);
  const payload = button.dataset.payload ?? steps;
  publish(button.dataset.topic, payload);
}

function addLine(job, x, y, pen) { job.push(`${Math.round(x)},${Math.round(y)};${pen}`); }

function shapeOps(kind) {
  const range = state.status?.range || { x: [0, 230], y: [-850, 0] };
  const x0 = Number(range.x?.[0]) || 0;
  const x1 = Number(range.x?.[1]) || 230;
  const y0 = Number(range.y?.[0]) || -850;
  const y1 = Number(range.y?.[1]) || 0;
  const size = Math.min(x1 - x0, y1 - y0) * (Number($('scale').value) / 100);
  const cx = x0 + size / 2;
  const cy = y1 - size / 2;
  const ops = [];
  addLine(ops, cx, cy, 'U');
  addLine(ops, 0, 0, 'U');
  if (kind === 'square') {
    addLine(ops, x0, y1, 'D');
    addLine(ops, x0 + size, y1, 'D');
    addLine(ops, x0 + size, y1 - size, 'D');
    addLine(ops, x0, y1 - size, 'D');
    addLine(ops, x0, y1, 'D');
  } else {
    for (let i = 0; i <= 64; i += 1) {
      const angle = i * Math.PI * 2 / 64;
      addLine(ops, cx + size / 2 * Math.cos(angle), cy + size / 2 * Math.sin(angle), 'D');
    }
  }
  addLine(ops, cx, cy, 'U');
  addLine(ops, 0, 0, 'U');
  return ops;
}

async function runShape(kind) {
  if (!state.client?.connected) return log('Chưa kết nối broker. Hãy đăng nhập trước.');
  const ops = shapeOps(kind);
  const up = Number($('penUp').value) || 110;
  const down = Number($('penDown').value) || 45;
  publish(`auto/${kind}/begin`, JSON.stringify({ n: ops.length, up, down }));
  for (let i = 0; i < ops.length; i += 250) {
    publish(`auto/${kind}/data`, ops.slice(i, i + 250).join(';'));
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  publish(`auto/${kind}/start`);
  $('jobMessage').textContent = `Đã nạp ${ops.length} lệnh cho ${kind === 'square' ? 'hình vuông' : 'hình tròn'}.`;
}

document.querySelectorAll('[data-topic]').forEach(button => button.addEventListener('click', () => sendControl(button)));
$('connectForm').addEventListener('submit', connect);
$('disconnect').addEventListener('click', () => {
  state.client?.end(true);
  state.client = null;
  setConnection('Chưa kết nối');
  log('Đã ngắt kết nối.');
});
$('sendSpeed').addEventListener('click', () => publish('control/speed', Math.max(1, Number($('speed').value) || 500)));
$('scale').addEventListener('input', () => { $('scaleOut').value = `${$('scale').value}%`; });
$('square').addEventListener('click', () => runShape('square'));
$('circle').addEventListener('click', () => runShape('circle'));
$('image').addEventListener('change', () => {
  const file = $('image').files[0];
  if (!file) {
    $('imagePreviewWrap').hidden = true;
    return;
  }
  const previousUrl = $('imagePreview').dataset.url;
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  const url = URL.createObjectURL(file);
  $('imagePreview').src = url;
  $('imagePreview').dataset.url = url;
  $('imagePreviewName').textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
  $('imagePreviewWrap').hidden = false;
});
$('upload').addEventListener('click', async () => {
  const file = $('image').files[0];
  if (!file) return log('Chưa chọn ảnh.');
  try {
    const auth = btoa(unescape(encodeURIComponent(`${state.user}:${state.password}`)));
    const response = await fetch('/api/images', {
      method: 'POST',
      headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name), Authorization: `Basic ${auth}` },
      body: file
    });
    log(response.ok ? 'Đã lưu ảnh vào broker.' : `Lỗi lưu ảnh: ${await response.text()}`);
  } catch (error) {
    log(`Lỗi upload: ${error.message}`);
  }
});

drawPositionChart();
