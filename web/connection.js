/* Shared browser/Android transport. Every reconnect starts with an empty session. */
(function (root) {
  'use strict';
  function endpoint(host, port, page) {
    if (!host) {
      if (!page?.host) throw new Error('Nhập IP máy chạy broker.');
      return `${page.protocol === 'https:' ? 'https' : 'http'}://${page.host}`;
    }
    host = host.trim();
    if (!/^[a-zA-Z0-9.-]+$/.test(host)) throw new Error('Chỉ nhập IP hoặc hostname, không kèm đường dẫn.');
    const number = Number(port || 3000);
    if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error('Cổng phải từ 1 đến 65535.');
    return `http://${host}:${number}`;
  }

  class Connection {
    constructor({ mqtt, fetch, page, onState = () => {}, onMessage = () => {}, onInvalidate = () => {}, onStop = () => {}, now = Date.now }) {
      Object.assign(this, { mqtt, fetch, page, onState, onMessage, onInvalidate, onStop, now });
      this.client = null;
      this.device = 'cnc01';
      this.active = true;
      this.owned = false;
      this.uploading = false;
      this.lastStatus = 0;
      this.status = null;
      this.lock = '';
      this.generation = 0;
      this.stopping = false;
      this.checked = false;
    }

    async connect(config) {
      this.disconnect();
      this.active = true;
      this.config = { ...config };
      const generation = this.generation;
      this.onState('Đang kiểm tra broker...');
      try {
        this.baseUrl = endpoint(config.host, config.port, this.page);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        let response;
        try { response = await this.fetch(`${this.baseUrl}/healthz`, { cache: 'no-store', signal: controller.signal }); }
        finally { clearTimeout(timeout); }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const health = await response.json();
        if (!health.ok || typeof health.device !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(health.device)) throw new Error('Địa chỉ này không phải broker MiniCNC.');
        if (generation !== this.generation || !this.active) return false;
        this.device = health.device;
        this.checked = true;
        this.open();
        return true;
      } catch (error) {
        if (generation === this.generation) this.onState(`Không kết nối được: ${error.message}`);
        return false;
      }
    }

    open() {
      if (!this.active || !this.config || !this.checked) return;
      this.lastStatus = 0;
      this.status = null;
      this.lock = '';
      const client = this.mqtt.connect(this.baseUrl.replace(/^http/, 'ws') + '/mqtt', {
        clientId: `minicnc-${Math.random().toString(16).slice(2)}-${this.now()}`,
        username: this.config.username,
        password: this.config.password,
        reconnectPeriod: 0,
        connectTimeout: 6000,
        clean: true,
        queueQoSZero: false,
        resubscribe: false
      });
      this.client = client;
      let denied = false;
      client.on('connect', () => {
        if (client !== this.client) return;
        this.onState('Đã kết nối broker · chờ ESP32', true);
        client.subscribe([this.topic('status'), this.topic('lock'), 'sensor/temperature', 'sensor/humidity'], { qos: 1 });
        clearInterval(this.freshnessTimer);
        this.freshnessTimer = setInterval(() => {
          if (this.lastStatus && !this.ready()) {
            this.invalidate();
            this.lastStatus = 0;
            this.onState('ESP32 không phản hồi · đã khóa điều khiển', true);
          }
        }, 1000);
      });
      client.on('message', (topic, payload, packet = {}) => {
        if (client !== this.client) return;
        const value = payload.toString();
        if (topic === this.topic('lock')) {
          this.lock = value;
          if (value && value !== this.config.username) this.invalidate();
        }
        if (topic === this.topic('status')) {
          try {
            const data = JSON.parse(value);
            if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.state !== 'string') return;
            // Retained data is a snapshot, never proof that a physical machine is online.
            if (!packet.retain) {
              this.status = data;
              this.lastStatus = data.state === 'offline' ? 0 : this.now();
              if (data.state === 'offline') {
                this.invalidate();
                this.onState('ESP32 offline · đã khóa điều khiển', true);
              } else {
                this.onState('Đã kết nối · ESP32 trực tuyến', true);
                if (this.stopping && data.job?.s === 'stop') {
                  this.stopping = false;
                  clearTimeout(this.stopTimer);
                  this.onStop('Đã dừng theo phản hồi ESP32');
                }
                if (!this.uploading && !['run', 'load'].includes(data.job?.s) && data.pen !== 'down') this.owned = false;
              }
            }
          } catch (_) { return; }
        }
        this.onMessage(topic, value, packet);
      });
      client.on('error', error => {
        if (client !== this.client) return;
        denied = [4, 5, 134, 135].includes(error.code) || /authoriz|password|credential/i.test(error.message);
        this.onState(denied ? 'Sai tài khoản hoặc không đủ quyền' : `Lỗi MQTT: ${error.message}`);
        client.end(true);
      });
      client.on('close', () => {
        if (client !== this.client) return;
        this.client = null;
        clearInterval(this.freshnessTimer);
        this.lastStatus = 0;
        this.invalidate();
        if (this.stopping) this.stopUnconfirmed();
        if (!denied) this.onState('Mất kết nối · không tự chạy lại');
        if (this.active && this.config && !denied) this.retry = setTimeout(() => this.open(), 2000);
      });
    }

    topic(rest) { return `cnc/${this.device}/${rest}`; }
    ready() { return !!(this.client?.connected && this.active && this.lastStatus && this.now() - this.lastStatus < 25000 && this.status?.state !== 'offline'); }
    invalidate() {
      this.owned = false;
      this.uploading = false;
      this.onInvalidate();
    }
    publish(rest, payload = '') {
      const stop = rest === 'control/stop';
      if (!this.client?.connected || (!stop && (!this.ready() || this.stopping))) return false;
      if (!stop && this.lock && this.lock !== this.config.username) return false;
      // QoS 0 + no offline queue: commands are never replayed on reconnect.
      this.client.publish(this.topic(rest), String(payload), { qos: 0, retain: false }, error => {
        if (error) { this.invalidate(); this.onState(`Không gửi được lệnh: ${error.message}`); }
      });
      if (!stop && /^(control|auto)\//.test(rest)) this.owned = true;
      return true;
    }
    stop() {
      this.onInvalidate();
      this.uploading = false;
      this.stopping = true;
      this.onStop('Đang yêu cầu dừng');
      clearTimeout(this.stopTimer);
      if (!this.publish('control/stop')) { this.stopUnconfirmed(); return false; }
      this.stopTimer = setTimeout(() => this.stopUnconfirmed(), 3500);
      return true;
    }
    stopUnconfirmed() {
      clearTimeout(this.stopTimer);
      this.stopping = false;
      this.onStop('Chưa xác nhận được máy đã dừng');
    }
    suspend() {
      if (this.owned) this.stop();
      this.active = false;
      this.invalidate();
      this.lastStatus = 0;
      clearTimeout(this.retry);
      this.onState('Đã rời phiên điều khiển · chờ đồng bộ');
    }
    resume() {
      if (this.active) return;
      this.active = true;
      this.lastStatus = 0;
      if (!this.client && this.config) {
        if (this.checked) this.open();
        else void this.connect(this.config);
      }
      else this.onState('Đã kết nối broker · chờ dữ liệu mới', !!this.client?.connected);
    }
    disconnect() {
      if (this.owned) this.stop();
      ++this.generation;
      clearTimeout(this.retry);
      clearTimeout(this.stopTimer);
      clearInterval(this.freshnessTimer);
      const client = this.client;
      this.client = null;
      if (client) client.end(true);
      if (this.stopping) this.stopUnconfirmed();
      this.config = null;
      this.checked = false;
      this.active = false;
      this.lastStatus = 0;
      this.invalidate();
    }
  }
  const api = { endpoint, Connection };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MiniCncConnection = api;
})(typeof window === 'undefined' ? globalThis : window);
