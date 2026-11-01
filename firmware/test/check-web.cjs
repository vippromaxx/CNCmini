// Run against Wokwi on the existing broker. --control opts into UI motion checks.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { mkdir, writeFile } = require('node:fs/promises');

async function main() {
  if (!process.argv[2]) throw new Error('Usage: node test/check-web.cjs <WEBCNC-directory> [--control]');
  const { chromium } = createRequire(path.resolve(process.argv[2], 'mobile/package.json'))('@playwright/test');
  const runControls = process.argv.includes('--control');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const checks = [];
  let page, controlsStarted = false;
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto('http://127.0.0.1:3000');
    assert.equal(await page.locator('#brokerHost, #brokerPort').count(), 0);
    await page.locator('#username').fill('user1');
    await page.locator('#password').fill('1');
    await page.locator('#connectBtn').click();
    await page.waitForFunction(() => isEspConnected() && state.status?.dht11, null, { timeout: 45000 });
    assert.equal(await page.evaluate(() => state.simulation), false);
    checks.push({ check: 'Web user1 receives device telemetry', ...await page.evaluate(() => ({
      temperature: $('temperatureValue').textContent, humidity: $('humidityValue').textContent,
      broker: state.transport.baseUrl, device: state.transport.device
    })) });
    async function clickAndConfirm(selector, expected, name) {
      const before = await page.evaluate(() => state._lastStatusReceivedTime);
      await page.locator(selector).click();
      await page.waitForFunction(({ before, expected }) => state._lastStatusReceivedTime > before &&
        Object.entries(expected).every(([key, value]) => state.status[key] === value), { before, expected }, { timeout: 20000 });
      checks.push({ check: name, ...expected });
      console.log(`PASS ${name}`);
    }
    if (runControls) {
      controlsStarted = true;
      await clickAndConfirm('[data-topic="control/home"]', { x: 0, y: 0, pen: 'up' }, 'Web home');
      await page.locator('.step-pill[data-step="10"]').click();
      await clickAndConfirm('[data-topic="control/jog/x/right"]', { x: 10, y: 0 }, 'Web jog X');
      await clickAndConfirm('[data-topic="control/jog/y/up"]', { x: 10, y: 10 }, 'Web jog Y');
      const led = await page.evaluate(() => Boolean(state.status.led));
      await clickAndConfirm('#toggleLed', { led: !led }, 'Web LED toggle');
      await clickAndConfirm('#toggleLed', { led }, 'Web LED restore');
      await clickAndConfirm('#togglePen', { pen: 'down' }, 'Web pen down');
      await clickAndConfirm('#togglePen', { pen: 'up' }, 'Web pen up');
      await clickAndConfirm('[data-topic="control/home"]', { x: 0, y: 0, pen: 'up' }, 'Web return home');
      await page.locator('#persistentStop').click();
      await page.waitForFunction(() => $('stopState').textContent.includes('Đã dừng theo'), null, { timeout: 15000 });
      checks.push({ check: 'Web stop acknowledged by device' });
    }
    const output = path.join(__dirname, '.runtime');
    await mkdir(output, { recursive: true });
    // The page animates sections as they enter the viewport. Capture the actual
    // controls after scrolling there, instead of blank offscreen animation areas.
    await page.locator('#controls').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#controls')).opacity === '1');
    await page.locator('#controls').screenshot({ path: path.join(output, 'web-user1-wokwi.png'), animations: 'disabled' });
    await writeFile(path.join(output, runControls ? 'web-result.json' : 'web-telemetry-result.json'), JSON.stringify({ time: new Date().toISOString(), checks }, null, 2));
    console.log(JSON.stringify({ passed: true, checks }, null, 2));
  } finally {
    if (controlsStarted && page) await page.locator('#persistentStop').click({ timeout: 2000 }).catch(() => {});
    await browser.close();
  }
}
main().catch(error => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
