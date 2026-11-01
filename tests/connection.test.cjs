const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Connection, endpoint } = require('../web/connection');

function setup(t, health = { ok: true, device: 'lab02' }) {
  const clients = [], states = [], stops = [];
  let time = 1000, invalidations = 0;
  const connection = new Connection({
    mqtt: { connect(url, options) {
      const client = new EventEmitter();
      Object.assign(client, { url, options, connected: true, sent: [], subscribe() {},
        publish(topic, payload, options, cb) { this.sent.push({ topic, payload, options }); cb?.(); },
        end() { this.connected = false; this.emit('close'); }
      });
      clients.push(client); return client;
    } },
    fetch: async () => ({ ok: true, json: async () => health }),
    page: { host: 'desktop:3000', protocol: 'http:' }, now: () => time,
    onState: message => states.push(message), onStop: message => stops.push(message),
    onInvalidate: () => invalidations++
  });
  t.after(() => connection.disconnect());
  const start = async () => {
    await connection.connect({ host: '192.168.1.2', port: '3000', username: 'operator', password: 'test-only' });
    clients.at(-1)?.emit('connect');
  };
  const status = (job = 'idle', retain = false) => clients.at(-1).emit('message', connection.topic('status'), JSON.stringify({ state: 'idle', pen: 'up', job: { s: job } }), { retain });
  return { connection, clients, states, stops, start, status, tick: n => time += n, invalidations: () => invalidations };
}

test('endpoint uses browser origin, explicit LAN host, and rejects paths/bad ports', () => {
  assert.equal(endpoint('', 3000, { protocol: 'https:', host: 'lab.example' }), 'https://lab.example');
  assert.equal(endpoint('192.168.1.10', 3000), 'http://192.168.1.10:3000');
  for (const host of ['http://192.168.1.1', 'host/path', 'x@host']) assert.throws(() => endpoint(host, 3000));
  assert.throws(() => endpoint('', 3000));
  assert.throws(() => endpoint('host', 65536));
});

test('broker alone and retained telemetry never enable commands; live status does', async t => {
  const h = setup(t); await h.start();
  assert.equal(h.connection.device, 'lab02');
  assert.equal(h.connection.publish('control/home'), false);
  h.status('idle', true);
  assert.equal(h.connection.ready(), false);
  h.status();
  assert.equal(h.connection.publish('control/home'), true);
  assert.equal(h.clients[0].sent[0].topic, 'cnc/lab02/control/home');
  h.tick(25001);
  assert.equal(h.connection.publish('control/jog/x/right', 10), false);
});

test('invalid health response prevents opening MQTT', async t => {
  const h = setup(t, { ok: true, device: 'bad/#' }); await h.start();
  assert.equal(h.clients.length, 0);
  assert.match(h.states.at(-1), /Không kết nối/);
});

test('bad credentials end session without automatic authentication retry', async t => {
  const h = setup(t); await h.start();
  h.clients[0].emit('error', Object.assign(new Error('Not authorized'), { code: 5 }));
  assert.equal(h.connection.client, null);
  assert.equal(h.connection.retry, undefined);
  assert.match(h.states.at(-1), /Sai tài khoản/);
});

test('loss discards upload ownership; reconnect has no commands and requires fresh status', async t => {
  const h = setup(t); await h.start(); h.status();
  h.connection.uploading = true;
  h.connection.publish('auto/image/begin', '{"n":200}');
  h.clients[0].end();
  assert.equal(h.connection.uploading, false);
  clearTimeout(h.connection.retry); h.connection.open(); h.clients[1].emit('connect');
  assert.equal(h.connection.publish('auto/image/start'), false);
  h.status();
  assert.deepEqual(h.clients[1].sent, []);
  assert.equal(h.clients[1].options.reconnectPeriod, 0);
  assert.equal(h.clients[1].options.queueQoSZero, false);
  assert.equal(h.clients[0].sent[0].options.qos, 0);
});

test('viewer leaving does not stop machine; controller leaving sends one stop and invalidates upload', async t => {
  const h = setup(t); await h.start(); h.status();
  h.connection.suspend(); assert.equal(h.clients[0].sent.length, 0);
  h.connection.resume(); h.status();
  h.connection.publish('auto/image/begin', '{"n":20}');
  h.connection.uploading = true;
  h.connection.suspend(); h.connection.suspend();
  assert.deepEqual(h.clients[0].sent.map(p => p.topic), ['cnc/lab02/auto/image/begin', 'cnc/lab02/control/stop']);
  assert.equal(h.connection.uploading, false);
  assert.equal(h.connection.publish('auto/image/data', '1,1'), false);
});

test('stop success requires a fresh stop response; retained snapshots and PUB callbacks are insufficient', async t => {
  const h = setup(t); await h.start(); h.status();
  h.connection.stop(); assert.equal(h.stops.at(-1), 'Đang yêu cầu dừng');
  h.status('stop', true); assert.equal(h.stops.at(-1), 'Đang yêu cầu dừng');
  h.status('stop'); assert.equal(h.stops.at(-1), 'Đã dừng theo phản hồi ESP32');
  h.connection.stop(); h.clients[0].end();
  assert.equal(h.stops.at(-1), 'Chưa xác nhận được máy đã dừng');
});

test('another account lock prevents sending and revokes local ownership', async t => {
  const h = setup(t); await h.start(); h.status();
  h.connection.publish('control/pen/down', 80);
  h.clients[0].emit('message', h.connection.topic('lock'), 'other-user');
  assert.equal(h.connection.owned, false);
  assert.equal(h.connection.publish('auto/circle/begin', '{}'), false);
  h.connection.suspend();
  assert.equal(h.clients[0].sent.length, 1);
});

test('offline LWT revokes readiness and aborts upload immediately', async t => {
  const h = setup(t); await h.start(); h.status();
  h.connection.uploading = true;
  h.clients[0].emit('message', h.connection.topic('status'), '{"state":"offline"}');
  assert.equal(h.connection.ready(), false);
  assert.equal(h.connection.uploading, false);
  assert.equal(h.connection.publish('auto/image/start'), false);
});

test('disconnect during health check cannot create a late MQTT session', async t => {
  const h = setup(t);
  let resolve;
  h.connection.fetch = () => new Promise(done => { resolve = done; });
  const pending = h.connection.connect({ host: 'localhost', username: 'operator', password: 'test-only' });
  h.connection.disconnect();
  resolve({ ok: true, json: async () => ({ ok: true, device: 'qa01' }) });
  assert.equal(await pending, false);
  assert.equal(h.clients.length, 0);
});

test('stop timeout does not manufacture successful hardware feedback', async t => {
  const h = setup(t); await h.start(); h.status();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.connection.stop();
  t.mock.timers.tick(3501);
  assert.equal(h.stops.at(-1), 'Chưa xác nhận được máy đã dừng');
  assert.equal(h.connection.stopping, false);
});

test('returning during health check revalidates instead of creating duplicate MQTT clients', async t => {
  const h = setup(t);
  const responses = [];
  h.connection.fetch = () => new Promise(resolve => responses.push(resolve));
  const first = h.connection.connect({ host: 'localhost', username: 'operator', password: 'test-only' });
  h.connection.suspend();
  h.connection.resume();
  assert.equal(h.clients.length, 0);
  assert.equal(responses.length, 2);
  const health = { ok: true, json: async () => ({ ok: true, device: 'qa01' }) };
  responses[0](health); await first;
  assert.equal(h.clients.length, 0);
  responses[1](health);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.clients.length, 1);
  assert.equal(h.connection.device, 'qa01');
});
