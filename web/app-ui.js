/* Mobile layout is composed from the existing controls, not a second UI implementation. */
(() => {
  const main = document.querySelector('main');
  const auth = document.querySelector('.auth-panel');
  const telemetry = document.querySelector('.telemetry-panel');
  const authAnchor = document.createComment('desktop connection panel');
  const telemetryAnchor = document.createComment('desktop telemetry panel');
  auth.before(authAnchor);
  telemetry.before(telemetryAnchor);
  const settings = document.createElement('section');
  settings.id = 'settings';
  settings.className = 'section';
  settings.innerHTML = '<div class="section-heading"><h2>Cài đặt kết nối</h2></div>';
  main.insertBefore(settings, document.querySelector('footer'));
  settings.append(auth);
  const monitoring = document.createElement('section');
  monitoring.id = 'monitoring';
  monitoring.className = 'section';
  monitoring.innerHTML = '<div class="section-heading"><h2>Giám sát máy</h2></div>';
  monitoring.append(telemetry, $('systemLog'));
  main.insertBefore(monitoring, settings);

  $('connectForm').insertAdjacentHTML('afterbegin', `
    <label>IP / hostname máy broker<input id="brokerHost" placeholder="Ví dụ: 192.168.1.10" autocapitalize="none" spellcheck="false" autocomplete="off"></label>
    <label>Cổng web<input id="brokerPort" type="number" min="1" max="65535" value="3000" inputmode="numeric"></label>
    <p class="muted connection-help">Cùng Wi-Fi với máy broker. Trên trình duyệt, để trống IP để dùng máy chủ hiện tại.</p>`);
  $('brokerHost').required = document.documentElement.classList.contains('native-app');
  const device = document.querySelector('.auth-meta-item strong');
  if (device) device.dataset.deviceId = '';
  settings.insertAdjacentHTML('beforeend', `
    <article class="panel app-options">
      <h3>Chế độ sử dụng</h3>
      <label class="simulation-option"><input id="simulationMode" type="checkbox"> Mô phỏng · không điều khiển máy thật</label>
      <p>Rời app sẽ ngừng gửi lệnh và yêu cầu dừng công việc của phiên này. Mở lại chỉ đồng bộ trạng thái; không tự chạy tiếp.</p>
      <p>Nếu mất mạng hoặc app bị đóng đột ngột, chưa thể bảo đảm máy đã dừng. Luôn kiểm tra phản hồi từ ESP32.</p>
      <button id="openEspConfig" class="button button-light" type="button">Mở cấu hình Wi-Fi ESP32</button>
      <p class="muted">Sau khi chuyển ESP32 sang AP Mode, kết nối Wi-Fi KimPang rồi mở 192.168.4.1. Cấu hình xong, trở về Wi-Fi của broker.</p>
    </article>`);
  try {
    const saved = JSON.parse(localStorage.getItem('minicnc.connection') || '{}');
    $('brokerHost').value = saved.host || '';
    $('brokerPort').value = saved.port || '3000';
    $('username').value = saved.username || '';
  } catch (_) { /* A corrupt local preference must not prevent launch. */ }

  const pages = [
    ['controls', 'Điều khiển'], ['sketch', 'Vẽ hình'], ['imageDraw', 'Vẽ ảnh'],
    ['monitoring', 'Giám sát'], ['settings', 'Cài đặt']
  ];
  const nav = document.createElement('nav');
  nav.className = 'app-navigation';
  nav.setAttribute('aria-label', 'Chức năng MiniCNC');
  for (const [id, title] of pages) {
    $(id).classList.add('app-page');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.page = id;
    button.textContent = title;
    button.addEventListener('click', () => selectPage(id));
    nav.append(button);
  }
  document.body.append(nav);
  const stop = document.createElement('aside');
  stop.className = 'app-stop-bar';
  stop.innerHTML = '<span id="stopState" role="status" aria-live="polite">Chờ kết nối máy</span><button id="persistentStop" type="button">DỪNG MÁY</button>';
  document.body.append(stop);
  $('persistentStop').addEventListener('click', () => handleCancelJob());

  let currentPage = 'controls';
  function selectPage(id) {
    currentPage = id;
    pages.forEach(([page]) => $(page).classList.toggle('is-active', page === id));
    nav.querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-current', button.dataset.page === id ? 'page' : 'false');
    });
    if (document.body.classList.contains('mobile-layout')) window.scrollTo({ top: 0, behavior: 'instant' });
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      renderWorkspace();
    });
  }
  const mobile = matchMedia('(max-width: 760px)');
  function layout() {
    const compact = mobile.matches || document.documentElement.classList.contains('native-app');
    document.body.classList.toggle('mobile-layout', compact);
    if (compact) {
      settings.querySelector('.section-heading').after(auth);
      monitoring.querySelector('.section-heading').after(telemetry);
    } else {
      authAnchor.after(auth);
      telemetryAnchor.after(telemetry);
    }
  }
  mobile.addEventListener('change', layout);
  layout();
  selectPage($('brokerHost').required && !$('brokerHost').value ? 'settings' : 'controls');

  $('simulationMode').addEventListener('change', event => {
    state.transport?.disconnect();
    state.client = null;
    invalidateUpload();
    state.status = null;
    state.simulation = event.target.checked;
    document.body.classList.toggle('simulation-mode', state.simulation);
    setConnection(state.simulation ? 'MÔ PHỎNG · không phải máy thật' : 'Chưa kết nối');
    showStopState(state.simulation ? 'MÔ PHỎNG · không gửi lệnh đến máy' : 'Chờ kết nối máy');
  });
  $('connectForm').addEventListener('submit', () => document.body.classList.remove('simulation-mode'));
  $('openEspConfig').addEventListener('click', async () => {
    window.MiniCncUI.suspend();
    try {
      if (window.MiniCncNative) await window.MiniCncNative.openConfig();
      else window.open('http://192.168.4.1', '_blank', 'noopener,noreferrer');
    } catch (_) { alert('Kết nối Wi-Fi ESP32 rồi mở http://192.168.4.1 bằng trình duyệt.'); }
  });
  window.MiniCncUI = {
    suspend() { state.transport?.suspend(); invalidateUpload(); },
    resume() { state.transport?.resume(); },
    back() {
      if (currentPage !== 'controls') { selectPage('controls'); return true; }
      return false;
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) window.MiniCncUI.suspend();
    else window.MiniCncUI.resume();
  });
  window.addEventListener('pagehide', () => window.MiniCncUI.suspend());
  $('workspaceCanvas')?.addEventListener('touchcancel', () => { imgWs.isDragging = false; });
})();
