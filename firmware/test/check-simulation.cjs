// Existing firmware protocol; read-only by default, --control explicitly runs motion checks.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');

async function main() {
  if (!process.argv[2]) throw new Error('Usage: node test/check-simulation.cjs <WEBCNC-directory> [--control]');
  const runControls = process.argv.includes('--control');
  const health = await (await fetch('http://127.0.0.1:3000/healthz', {
    signal: AbortSignal.timeout(3000)
  })).json();
  assert.equal(health.device, 'cnc01', 'Expected the existing cnc01 broker');
  const mqtt = createRequire(path.resolve(process.argv[2], 'mobile', 'package.json'))('mqtt');
  const client = mqtt.connect('mqtt://127.0.0.1:1883', {
    username: 'user1', password: '1',
    reconnectPeriod: 0, clean: true, queueQoSZero: false, connectTimeout: 5000
  });
  const waiters = new Set();
  const checks = [];
  let latest, ownsSession = false;
  function waitStatus(predicate, label, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve: status => {
        clearTimeout(timer); waiters.delete(waiter); resolve(status);
      }, reject: error => {
        clearTimeout(timer); waiters.delete(waiter); reject(error);
      } };
      const timer = setTimeout(() => waiter.reject(new Error(`${label}: no matching live ESP32 status. Start Wokwi in VS Code and keep its tab visible.`)), timeout);
      waiters.add(waiter);
    });
  }
  client.on('message', (topic, payload, packet) => {
    if (topic !== 'cnc/cnc01/status' || packet.retain) return;
    try { latest = JSON.parse(payload.toString()); } catch { return; }
    for (const waiter of [...waiters]) if (waiter.predicate(latest)) waiter.resolve(latest);
  });
  const failWaiters = error => { for (const waiter of [...waiters]) waiter.reject(error); };
  client.on('error', failWaiters);
  client.on('close', () => failWaiters(new Error('Simulation broker disconnected')));
  async function command(rest, body, predicate, label, timeout) {
    assert(client.connected, 'Broker disconnected; commands are never queued');
    assert(runControls, 'Motion checks require --control');
    const response = waitStatus(predicate, label, timeout);
    response.catch(() => {});
    ownsSession = true;
    await client.publishAsync(`cnc/cnc01/${rest}`, String(body), { qos: 0, retain: false });
    const status = await response;
    checks.push({ check: label, x: status.x, y: status.y, job: status.job?.s });
    console.log(`PASS ${label}`);
    return status;
  }
  try {
    await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('error', reject); });
    const live = waitStatus(s => s.state !== 'offline' && Number.isFinite(s.up), 'Device telemetry / MQTT', 45000);
    live.catch(() => {});
    await client.subscribeAsync('cnc/cnc01/status');
    await live;
    console.log('PASS user1 received live cnc01 telemetry');
    if (!runControls) {
      const sensor = latest.dht11 && Number.isFinite(latest.temperature) && Number.isFinite(latest.humidity)
        ? latest
        : await waitStatus(s => s.dht11 && Number.isFinite(s.temperature) && Number.isFinite(s.humidity), 'DHT telemetry');
      console.log(JSON.stringify({ temperature: sensor.temperature, humidity: sensor.humidity, x: sensor.x, y: sensor.y }));
      let previousUp = sensor.up;
      const startedUp = sensor.up;
      const startedAt = Date.now();
      let samples = 0;
      await waitStatus(s => {
        if (s.state === 'offline' || (Number.isFinite(s.up) && s.up < previousUp)) {
          failWaiters(new Error('Device disconnected or rebooted during DHT stability check'));
          return false;
        }
        if (Number.isFinite(s.up)) previousUp = s.up;
        if (!s.dht11 || !Number.isFinite(s.temperature) || !Number.isFinite(s.humidity)) {
          failWaiters(new Error('DHT reading became invalid during stability check'));
          return false;
        }
        samples++;
        return samples >= 8 && s.up - startedUp >= 35;
      }, 'Stable DHT telemetry without reboot', 120000);
      await mkdir(path.join(__dirname, '.runtime'), { recursive: true });
      await writeFile(path.join(__dirname, '.runtime', 'stability-result.json'), JSON.stringify({
        time: new Date().toISOString(), passed: true, samples, deviceSeconds: previousUp - startedUp,
        wallSeconds: (Date.now() - startedAt) / 1000,
        temperature: latest.temperature, humidity: latest.humidity
      }, null, 2));
      console.log(`PASS stable DHT stream: ${samples} samples, ${previousUp - startedUp}s device uptime`);
      console.log('PASS receive-only check; no commands sent. This confirms MQTT delivery, not physical device identity.');
      return;
    }
    await command('control/stop', '1', s => s.job?.s === 'stop' && s.pen === 'up', 'Stop acknowledged');
    await command('control/cal/origin', '1', s => s.calibrated && s.x === 0 && s.y === 0, 'Set origin');
    await command('control/home', '1', s => s.x === 0 && s.y === 0 && s.pen === 'up', 'Clear stop with explicit home');
    await command('control/jog/x/right', '100', s => s.x === 100, 'Jog X');
    await command('control/jog/y/up', '100', s => s.y === 100, 'Jog Y');
    await command('control/cal/set', '{}', s => s.calibrated && s.range.x[1] === 100 && s.range.y[1] === 100, 'Set simulated travel limits');
    await command('control/home', '1', s => s.x === 0 && s.y === 0 && s.pen === 'up', 'Return to origin');
    await command('control/led', '1', s => s.led === true, 'LED on');
    await command('control/pen/down', '80', s => s.pen === 'down', 'Pen down');
    await command('control/pen/up', '110', s => s.pen === 'up', 'Pen up');
    await command('auto/square/begin', '{}', s => s.job?.s === 'load', 'Begin square');
    await command('auto/square/data', 'U;0,0;D;40,0;40,40;0,40;0,0;U;', s => s.job?.n === 8, 'Load square path');
    await command('auto/square/start', '1', s => s.job?.s === 'done' && s.x === 0 && s.y === 0 && s.pen === 'up', 'Square finished', 30000);
    await command('control/speed', '80', s => s.speed === 80, 'Set slow speed');
    await command('auto/image/begin', '{}', s => s.job?.s === 'load', 'Begin interruptible path');
    await command('auto/image/data', 'D;100,100;0,0;100,100;0,0;U;', s => s.job?.n === 6, 'Load interruptible path');
    await command('auto/image/start', '1', s => s.job?.s === 'run', 'Path running');
    await command('control/stop', '1', s => s.job?.s === 'stop' && s.pen === 'up', 'Stop running path');
    const afterStop = await waitStatus(s => s.job?.s === 'stop', 'Stopped position');
    const stillStopped = await waitStatus(s => s.job?.s === 'stop', 'No automatic resume');
    assert.equal(stillStopped.physical.x, afterStop.physical.x);
    assert.equal(stillStopped.physical.y, afterStop.physical.y);
    await command('control/home', '1', s => s.x === 0 && s.y === 0, 'Home after stop');
    await command('control/cal/origin', '1', s => s.calibrated && s.x === 0 && s.y === 0 && s.scale.x === 1 && s.scale.y === 1, 'Restore default simulator calibration');
    await command('control/led', '0', s => s.led === false, 'LED off');
    await command('control/speed', '300', s => s.speed === 300, 'Restore speed');
    assert(latest.dht11 && Number.isFinite(latest.temperature) && Number.isFinite(latest.humidity), 'Wokwi DHT sensor must report temperature and humidity');
    checks.push({ check: 'DHT telemetry', temperature: latest.temperature, humidity: latest.humidity });
    await mkdir(path.join(__dirname, '.runtime'), { recursive: true });
    await writeFile(path.join(__dirname, '.runtime', 'simulation-result.json'), JSON.stringify({
      simulatedOnly: true, time: new Date().toISOString(), checks
    }, null, 2));
    console.log('PASS all simulated firmware checks. This is not physical CNC validation.');
  } finally {
    if (ownsSession && client.connected) await client.publishAsync('cnc/cnc01/control/stop', '1', { qos: 0, retain: false }).catch(() => {});
    failWaiters(new Error('Test ended'));
    await client.endAsync(true);
  }
}
main().catch(error => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
