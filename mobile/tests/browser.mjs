import { chromium } from '@playwright/test';
import mqtt from 'mqtt';
import { spawn } from 'node:child_process';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const results = path.join(root, 'test-results');
const fixture = path.join(results, `broker-${Date.now()}`);
await mkdir(path.join(fixture, 'broker'), { recursive: true });
await writeFile(path.join(fixture, 'package.json'), '{"type":"commonjs"}');
await cp(path.join(root, '../broker/broker.js'), path.join(fixture, 'broker/broker.js'));
await cp(path.join(root, 'www'), path.join(fixture, 'web'), { recursive: true });
await writeFile(path.join(fixture, 'broker/users.json'), JSON.stringify({ users: { tester: 'fixture-only', device: 'fixture-only', viewer: 'fixture-only' }, operators: ['tester'], admins: [] }));
async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
const webPort = await port(), mqttPort = await port();
const child = spawn(process.execPath, [path.join(fixture, 'broker/broker.js')], {
  env: { ...process.env, NODE_PATH: path.join(root, '../broker/node_modules'), BIND_HOST: '127.0.0.1', WEB_PORT: String(webPort), MQTT_PORT: String(mqttPort), DEVICE_ID: 'qa01', DB_PORT: '1' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
child.stdout.on('data', chunk => { serverLog += chunk; });
child.stderr.on('data', chunk => { serverLog += chunk; });
const url = `http://127.0.0.1:${webPort}`;
const appUrl = `http://localhost:${webPort}`; // Separate origin, like a packaged WebView calling a LAN broker.
let browser, device, timer;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${url}/healthz`)).ok) break; } catch (_) {}
    if (child.exitCode !== null) throw new Error(`Fixture broker exited: ${serverLog}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await (await fetch(`${url}/healthz`)).json()).device, 'qa01');
  device = mqtt.connect(`mqtt://127.0.0.1:${mqttPort}`, { username: 'device', password: 'fixture-only', reconnectPeriod: 0 });
  await new Promise((resolve, reject) => { device.once('connect', resolve); device.once('error', reject); });
  const commands = [];
  await device.subscribeAsync(['cnc/qa01/control/jog/x/right', 'cnc/qa01/control/stop', 'cnc/qa01/auto/circle/begin', 'cnc/qa01/auto/circle/data', 'cnc/qa01/auto/circle/start', 'cnc/qa01/auto/image/begin', 'cnc/qa01/auto/image/data', 'cnc/qa01/auto/image/start']);
  let job = 'idle', kind = '';
  const telemetry = () => ({ state: job === 'run' ? 'running' : 'idle', x: 0, y: 0, pen: 'up', calibrated: true, measuredCalibration: true, calibrationVersion: 3, range: { x: [0, 40], y: [0, 50] }, scale: { x: 1, y: 1 }, job: { s: job, k: kind, n: 100, i: 0 }, temperature: 28, humidity: 65 });
  device.on('message', (topic, payload) => {
    commands.push({ topic, payload: payload.toString() });
    if (topic.endsWith('/begin')) { job = 'load'; kind = topic.split('/')[3]; }
    if (topic.endsWith('/start')) job = 'run';
    if (topic.endsWith('/stop')) job = 'stop';
    device.publish('cnc/qa01/status', JSON.stringify(telemetry()));
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
  const page = await context.newPage();
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    if (!route.request().url().startsWith(url) && !route.request().url().startsWith(appUrl) && !route.request().url().startsWith('data:')) {
      external.push(route.request().url()); return route.abort();
    }
    return route.continue();
  });
  await page.goto(appUrl);
  await page.locator('#brokerHost').fill('127.0.0.1');
  await page.locator('#brokerPort').fill(String(webPort));
  await page.locator('#username').fill('tester');
  await page.locator('#password').fill('wrong-fixture-password');
  await page.locator('#connectBtn').click();
  await page.waitForFunction(() => document.getElementById('connection').textContent.includes('Sai tài khoản'));
  await page.locator('#password').fill('fixture-only');
  await page.locator('#connectBtn').click();
  await page.waitForFunction(() => state.client?.connected);
  // A connected broker without live ESP32 must not accept motion.
  await page.locator('[data-page=controls]').click();
  await page.locator('[data-topic="control/jog/x/right"]').click();
  assert.equal(commands.length, 0);
  timer = setInterval(() => device.publish('cnc/qa01/status', JSON.stringify(telemetry())), 300);
  await page.waitForFunction(() => isEspConnected());
  await page.locator('[data-topic="control/jog/x/right"]').click();
  await page.waitForTimeout(150);
  assert.equal(commands.at(-1).topic, 'cnc/qa01/control/jog/x/right');
  await page.locator('[data-page=sketch]').click();
  await page.locator('#circle').click();
  await page.waitForFunction(() => state.status?.job?.s === 'run');
  await page.evaluate(() => window.MiniCncUI.suspend());
  await page.waitForFunction(() => document.getElementById('stopState').textContent.includes('Đã dừng theo'));
  assert.ok(commands.some(command => command.topic === 'cnc/qa01/control/stop'));
  const count = commands.length;
  await page.evaluate(() => window.MiniCncUI.resume());
  await page.waitForTimeout(500);
  assert.equal(commands.length, count, 'Foregrounding cannot restart a job');
  await page.locator('[data-page=imageDraw]').click();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="white"/><rect x="20" y="20" width="40" height="40" fill="black"/></svg>');
  await page.locator('input[type=file]').setInputFiles({ name: 'square.svg', mimeType: 'image/svg+xml', buffer: svg });
  await page.waitForFunction(() => imgWs.img !== null && state.imagePaths.length > 2);
  const points = await page.evaluate(() => state.imagePaths.length);
  const originalPath = await page.evaluate(() => [...state.imagePaths]);
  await page.locator('input[type=file]').setInputFiles([]);
  assert.equal(await page.evaluate(() => state.imagePaths.length), points, 'Cancelling picker preserves the image');
  // Cancelling upload must prevent any remaining chunk/start from reaching the real broker.
  await page.evaluate(() => { state.imagePaths = ['U', ...Array(600).fill('1,1'), 'D', '2,2', 'U']; });
  await page.locator('#sendImagePath').click();
  await page.waitForFunction(() => state.isUploadingJob);
  await page.locator('#persistentStop').click();
  await page.waitForTimeout(600);
  assert.equal(commands.filter(command => command.topic.endsWith('auto/image/start')).length, 0);
  assert.equal(await page.evaluate(() => state.isUploadingJob), false);
  // Successful image job uses exactly the generated path, then stops on explicit request.
  await page.waitForFunction(() => state.status?.job?.s === 'stop');
  await page.evaluate(ops => { state.imagePaths = ops; }, originalPath);
  await page.locator('#sendImagePath').click();
  await page.waitForFunction(() => state.status?.job?.s === 'run');
  assert.equal(commands.filter(command => command.topic.endsWith('auto/image/start')).length, 1);
  assert.ok(commands.some(command => command.topic.endsWith('auto/image/data') && command.payload === originalPath.join(';')));
  await page.locator('#persistentStop').click();
  await page.waitForFunction(() => state.status?.job?.s === 'stop');
  const startsBeforeLoss = commands.filter(command => command.topic.endsWith('/start')).length;
  const oldClientId = await page.evaluate(() => state.transport.client.options.clientId);
  await page.evaluate(() => { state.imagePaths = ['U', ...Array(600).fill('1,1'), 'D', '2,2', 'U']; });
  await page.locator('#sendImagePath').click();
  await page.evaluate(() => state.transport.client.stream.destroy());
  await page.waitForFunction(oldId => state.transport.client?.connected && state.transport.client.options.clientId !== oldId && isEspConnected(), oldClientId);
  await page.waitForTimeout(200);
  assert.equal(commands.filter(command => command.topic.endsWith('/start')).length, startsBeforeLoss, 'A real socket reconnect cannot replay the aborted job');
  assert.equal(await page.evaluate(() => state.isUploadingJob), false);
  await page.locator('#persistentStop').click();
  await page.waitForFunction(() => state.status?.job?.s === 'stop');
  // An explicit offline simulation cannot publish to the fixture broker.
  await page.locator('[data-page=settings]').click();
  await page.locator('#simulationMode').check();
  const simulationCount = commands.length;
  await page.locator('[data-page=controls]').click();
  await page.locator('[data-topic="control/jog/x/right"]').click();
  assert.equal(await page.evaluate(() => state.virtualX), 10);
  assert.equal(commands.length, simulationCount);
  await page.locator('[data-page=settings]').click();
  await page.locator('#simulationMode').uncheck();
  for (const [name, width, height] of [['phone', 390, 844], ['small-phone', 375, 667], ['landscape', 844, 390]]) {
    await page.setViewportSize({ width, height });
    for (const id of ['controls', 'sketch', 'imageDraw', 'monitoring', 'settings']) {
      await page.locator(`[data-page=${id}]`).click();
      await page.waitForTimeout(80);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}/${id} overflow`);
      await page.screenshot({ path: path.join(results, `${name}-${id}.png`), fullPage: true });
    }
  }
  const prefs = await page.evaluate(() => localStorage.getItem('minicnc.connection'));
  assert.ok(!prefs.includes('password') && !prefs.includes('fixture-only'));
  assert.deepEqual(external, [], 'APK must not request external fonts/scripts');
  assert.deepEqual(errors, [], 'No JavaScript exceptions');
  // Desktop uses the original web files and keeps all sections accessible.
  await cp(path.join(root, '../web'), path.join(fixture, 'web'), { recursive: true });
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const desktopErrors = [];
  desktop.on('pageerror', error => desktopErrors.push(error.message));
  await desktop.goto(url);
  await desktop.locator('#brokerHost').fill('');
  await desktop.locator('#username').fill('viewer');
  await desktop.locator('#password').fill('fixture-only');
  await desktop.locator('#connectBtn').click();
  await desktop.waitForFunction(() => isEspConnected());
  assert.equal(await desktop.locator('#controls').isVisible(), true);
  assert.equal(await desktop.locator('#imageDraw').isVisible(), true);
  const beforeViewerExit = commands.filter(command => command.topic.endsWith('/stop')).length;
  await desktop.evaluate(() => window.MiniCncUI.suspend());
  await desktop.waitForTimeout(200);
  assert.equal(commands.filter(command => command.topic.endsWith('/stop')).length, beforeViewerExit);
  await desktop.screenshot({ path: path.join(results, 'desktop.png'), fullPage: true });
  assert.deepEqual(desktopErrors, []);
  await writeFile(path.join(results, 'browser-result.json'), JSON.stringify({ passed: true, commands: commands.length, imagePoints: points, externalRequests: external, errors, viewports: ['390x844', '375x667', '844x390', '1440x1000'], broker: 'isolated copy of production Aedes broker', device: 'MQTT emulator; no physical CNC used' }, null, 2));
  console.log('PASS: real broker auth, live telemetry gate, jog, circle, suspend/stop, image/cancel, upload cancellation, 15 mobile views, desktop, offline assets.');
} finally {
  clearInterval(timer);
  if (device) await device.endAsync(true);
  await browser?.close();
  child.kill();
}
