// Run: node mobile/tests/hatch-spacing.mjs. Static web fixture, no MQTT or CNC access.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../', import.meta.url));
const web = path.join(root, 'web');
const artifacts = path.join(root, 'mobile/test-results/hatch-spacing');
await mkdir(artifacts, { recursive: true });
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
  assert.equal(await page.locator('#hatchSpacingCtrl').isVisible(), false);
  await page.locator('[data-mode=hatch]').click();
  assert.equal(await page.locator('#hatchSpacingCtrl').isVisible(), true);
  assert.equal(await page.locator('#hatchSpacingOut').textContent(), '3 mm');
  // Changing the setting before selecting a file must also work.
  await page.locator('#hatchSpacing').focus();
  await page.keyboard.press('Home');
  for (let i = 1; i < 5; i++) await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#hatchSpacingOut').textContent(), '5 mm');
  const black = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="black"/></svg>');
  await page.locator('#drawImage').setInputFiles({ name: 'fill.svg', mimeType: 'image/svg+xml', buffer: black });
  await page.waitForFunction(() => imgWs.img !== null && imgWs.paths.length > 0);

  // A known solid fixture lets us measure every preview and CNC row, not just counts.
  for (const [width, height] of [[230, 850], [850, 230], [100, 100]]) {
    for (const step of [1, 3, 5, 20]) {
      const result = await page.evaluate(({ width, height, step }) => {
        state.status = { range: { x: [0, width], y: [0, height] } };
        Object.assign(imgWs, { x: 0, y: 0, w: 500, h: 500 });
        const slider = document.getElementById('hatchSpacing');
        slider.value = step;
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        return new Promise(resolve => setTimeout(() => resolve({
          previewRows: imgWs.paths.map(p => p[0].y / V_SIZE * height),
          machineRows: state.imagePaths.filter(op => op.includes(',')).map(op => Number(op.split(',')[1])),
          displayed: document.getElementById('hatchSpacingOut').textContent
        }), 150));
      }, { width, height, step });
      assert.equal(result.displayed, `${step} mm`);
      assert.equal(result.previewRows.length, Math.ceil(height / step));
      result.previewRows.forEach((y, i) => assert.ok(Math.abs(y - i * step) < 1e-8));
      assert.deepEqual([...new Set(result.machineRows)], result.previewRows.map(Math.round));
    }
  }
  await page.locator('[data-mode=outline]').click();
  assert.equal(await page.locator('#hatchSpacingCtrl').isVisible(), false);
  const outline = await page.evaluate(() => [...state.imagePaths]);
  await page.locator('[data-mode=hatch]').click();
  assert.equal(await page.locator('#hatchSpacing').inputValue(), '20');
  await page.locator('[data-mode=outline]').click();
  assert.deepEqual(await page.evaluate(() => state.imagePaths), outline);
  await page.locator('[data-mode=hatch]').click();

  // Intercept only the upload boundary: clicking Send in the debounce window must
  // pass the new generated path, without opening any broker connection.
  const sent = await page.evaluate(async () => {
    state.status = { range: { x: [0, 230], y: [0, 850] } };
    canStartJob = () => true;
    state.client = { connected: true };
    let uploaded;
    uploadJob = async (kind, ops) => { uploaded = [...ops]; return false; };
    const slider = document.getElementById('hatchSpacing');
    slider.value = 3;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await sendImageToESP();
    state.client = null;
    return { uploaded, preview: state.imagePaths, timer: imgWs.processTimer };
  });
  assert.equal(sent.timer, null);
  assert.deepEqual(sent.uploaded, sent.preview);
  const rows = [...new Set(sent.uploaded.filter(op => op.includes(',')).map(op => Number(op.split(',')[1])))];
  assert.equal(rows.length, Math.ceil(850 / 3));
  rows.forEach((y, i) => assert.equal(y, i * 3));

  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 375, 812]]) {
    await page.setViewportSize({ width, height });
    if (name === 'mobile') await page.locator('[data-page=imageDraw]').click();
    await page.locator('#hatchSpacingCtrl').scrollIntoViewIfNeeded();
    const box = await page.locator('#hatchSpacing').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width && box.height >= 48);
    await page.locator('#imgControlsGrid').screenshot({ path: path.join(artifacts, `${name}.png`), style: '.topbar, .app-stop-bar, .app-navigation { visibility: hidden !important; }' });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(sockets, []);
  console.log('PASS: step control 1–20 mm, default/preserved values, exact Y spacing in preview and CNC operations for 3 bed sizes, unchanged outline, immediate Send, desktop/mobile layout.');
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
