// Visual/telemetry integration check on a static fixture: never connects to the CNC broker.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = path.join(root, 'mobile/test-results/gauges');
await mkdir(artifacts, { recursive: true });
const web = path.join(root, 'web');
const server = createServer(async (request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname;
  const file = path.resolve(web, `.${name === '/' ? '/index.html' : name}`);
  if (!file.startsWith(web + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[path.extname(file)] || 'application/octet-stream');
    response.end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [], sockets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);
  await page.waitForSelector('.gauge-canvas svg');
  assert.equal(await page.locator('.gauge-canvas svg').count(), 4);
  assert.deepEqual(await page.locator('[data-value]').allTextContents(), ['--', '--', '--', '--']);
  assert.equal(await page.evaluate(() => state.dhtHistory.every(p => p.temp === null && p.hum === null)), true);
  await page.locator('.dht-chart-card').screenshot({ path: path.join(artifacts, 'trend-empty.png') });
  const sample = { x: 84, y: 512, range: { x: [0, 230], y: [0, 850] }, dht11: { valid: true, temperatureC: 28.5, humidity: 65, age_s: 0 }, job: { s: 'idle' } };
  await page.evaluate(data => renderStatus(data), sample);
  assert.deepEqual(await page.locator('[data-value]').allTextContents(), ['84', '512', '28,5', '65,0']);
  assert.match(await page.locator('#tempGaugeContainer').getAttribute('aria-label'), /28,5 °C/);
  await page.locator('.gauges-quad-grid').screenshot({ path: path.join(artifacts, 'desktop.png') });

  // Firmware-provided ranges remain accurate, including short calibrated travel.
  await page.evaluate(() => updateMotorXGauge(20, 0, 40));
  assert.match(await page.locator('#motorXGaugeContainer').getAttribute('aria-label'), /0 đến 40 mm/);
  assert.equal(await page.locator('[data-needle]').getAttribute('transform'), 'rotate(270 130 101)');
  await page.evaluate(() => updateMotorYGauge(900, 0, 850));
  assert.equal(await page.locator('#motorYGaugeContainer [data-value]').textContent(), '900');
  assert.equal(await page.locator('.gauge-card-y [data-gauge-range]').textContent(), 'Ngoài thang đo');
  assert.equal(await page.locator('.gauge-segment.is-filled').count(), 32);

  await page.evaluate(data => renderStatus({ ...data, dht11: { valid: false } }), sample);
  assert.equal(await page.locator('#tempGaugeContainer [data-value]').textContent(), '--');
  assert.equal(await page.locator('#humGaugeContainer [data-value]').textContent(), '--');
  assert.equal(await page.locator('#dhtChartTempValue').textContent(), '-- °C');
  assert.equal(await page.locator('#dhtChartHumValue').textContent(), '-- %');
  assert.deepEqual(await page.evaluate(() => state.dhtHistory.at(-1)), { temp: null, hum: null });
  for (const invalid of [null, '', 'bad']) {
    await page.evaluate(value => { updateTempGauge(value); updateHumGauge(value); }, invalid);
    assert.equal(await page.locator('#humGaugeContainer [data-value]').textContent(), '--');
  }
  await page.evaluate(() => { updateTempGauge(0); updateHumGauge(0); });
  assert.equal(await page.locator('#humGaugeContainer [data-value]').textContent(), '0,0');
  await page.evaluate(() => updateHumGauge(100));
  assert.equal(await page.locator('#humGaugeContainer [data-value]').textContent(), '100,0');
  assert.equal(await page.locator('[data-humidity]').getAttribute('stroke-dasharray'), '100 100');
  await page.evaluate(() => { updateTempGauge(-10); updateHumGauge(120); });
  assert.equal(await page.locator('[data-heat]').getAttribute('d'), 'M64 187 V175');
  assert.equal(await page.locator('#tempGaugeContainer [data-value]').textContent(), '-10,0');
  assert.equal(await page.locator('#humGaugeContainer [data-value]').textContent(), '120,0');
  assert.equal(await page.locator('[data-humidity]').getAttribute('stroke-dasharray'), '100 100');
  await page.evaluate(() => updateDhtTrend(0, 0));
  assert.deepEqual(await page.evaluate(() => state.dhtHistory.at(-1)), { temp: 0, hum: 0 });
  for (const invalid of [null, '', 'bad', ' ', false]) {
    await page.evaluate(value => updateDhtTrend(value, value), invalid);
    assert.deepEqual(await page.evaluate(() => state.dhtHistory.at(-1)), { temp: null, hum: null });
  }
  // Representative history exists only in this test fixture, never in the application.
  await page.evaluate(() => {
    for (let i = 0; i < 24; i++) updateDhtTrend(26 + Math.sin(i / 3) * 3 + i / 8, 60 + Math.cos(i / 4) * 8);
  });
  await page.evaluate(data => renderStatus(data), sample);
  const options = await page.evaluate(() => {
    const option = dhtTrendChart.getOption();
    return { grids: option.grid.length, axes: option.series.map(s => s.yAxisIndex), data: option.series.map(s => s.data.at(-1)), count: state.dhtHistory.length };
  });
  assert.deepEqual(options, { grids: 2, axes: [0, 1], data: [28.5, 65], count: 24 });
  await page.locator('.telemetry-panel').screenshot({ path: path.join(artifacts, 'telemetry-desktop.png'), style: '.topbar, .app-stop-bar { visibility: hidden !important; }' });

  for (const [name, width, height] of [['mobile', 375, 812], ['tablet', 768, 1024], ['landscape', 844, 390]]) {
    await page.setViewportSize({ width, height });
    if (width <= 760) await page.locator('[data-page="monitoring"]').click();
    await page.locator('.gauges-quad-grid').scrollIntoViewIfNeeded();
    const bounds = await page.locator('.gauge-card').evaluateAll(cards => cards.map(card => {
      const rect = card.getBoundingClientRect();
      const svg = card.querySelector('.gauge-canvas > svg').getBoundingClientRect();
      const footer = card.querySelector('.gauge-footer').getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: svg.height, overlapsFooter: svg.bottom > footer.top, overflow: card.scrollWidth > card.clientWidth };
    }));
    for (const card of bounds) {
      assert.ok(card.left >= 0 && card.right <= width && card.width >= 235 && card.height > 0, JSON.stringify({ name, card }));
      assert.equal(card.overflow, false);
      assert.equal(card.overlapsFooter, false);
    }
    await page.locator('.gauges-quad-grid').screenshot({ path: path.join(artifacts, `${name}.png`), style: '.topbar, .app-stop-bar, .app-navigation { visibility: hidden !important; }' });
    await page.locator('.dht-chart-card').scrollIntoViewIfNeeded();
    const chartBounds = await page.locator('.dht-chart-card').evaluate(card => {
      const rect = card.getBoundingClientRect();
      const chart = echarts.getInstanceByDom(document.getElementById('dhtChartContainer'));
      return { left: rect.left, right: rect.right, overflow: card.scrollWidth > card.clientWidth, chartWidth: chart.getWidth() };
    });
    assert.ok(chartBounds.left >= 0 && chartBounds.right <= width && chartBounds.chartWidth > 0, JSON.stringify(chartBounds));
    await page.locator('.dht-chart-card').screenshot({ path: path.join(artifacts, `trend-${name}.png`), style: '.topbar, .app-stop-bar, .app-navigation { visibility: hidden !important; }' });
    assert.equal(chartBounds.overflow, false, JSON.stringify({ name, ...chartBounds }));
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(sockets, []);
  console.log('PASS: 4 styles, real renderStatus path, missing/invalid/zero data, calibration ranges, overflow, desktop/mobile/tablet/landscape. No broker connection.');
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
