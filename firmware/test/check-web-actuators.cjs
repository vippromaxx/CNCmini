// Focused web -> broker -> Wokwi check. Also record/export VCD to verify outputs.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { mkdir, writeFile } = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');

async function main() {
  if (!process.argv[2]) throw new Error('Usage: node test/check-web-actuators.cjs <WEBCNC-directory>');
  const { chromium } = createRequire(path.resolve(process.argv[2], 'mobile/package.json'))('@playwright/test');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const checks = [];
  let controlled = false;
  try {
    await page.goto('http://127.0.0.1:3000');
    await page.locator('#username').fill('user1');
    await page.locator('#password').fill('1');
    await page.locator('#connectBtn').click();
    await page.waitForFunction(() => isEspConnected(), null, { timeout: 45000 });
    assert.equal(await page.evaluate(() => state.simulation), false);
    async function setState(led, pen) {
      for (const [key, expected, selector] of [['led', led, '#toggleLed'], ['pen', pen, '#togglePen']]) {
        if (await page.evaluate(({ key, expected }) => state.status[key] === expected, { key, expected })) continue;
        const before = await page.evaluate(() => state._lastStatusReceivedTime);
        controlled = true;
        await page.locator(selector).click();
        await page.waitForFunction(({ key, expected, before }) => state._lastStatusReceivedTime > before && state.status[key] === expected,
          { key, expected, before }, { timeout: 12000 });
      }
      const status = await page.evaluate(() => ({ led: state.status.led, pen: state.status.pen,
        penUp: state.status.penUp, penDown: state.status.penDown, up: state.status.up }));
      checks.push({ time: new Date().toISOString(), ...status });
      console.log(`PHASE ${led ? 'LED ON / PEN DOWN' : 'LED OFF / PEN UP'} ${JSON.stringify(status)}`);
    }
    await setState(false, 'up');
    for (let cycle = 0; cycle < 2; cycle++) {
      await setState(true, 'down');
      await delay(8000);
      await setState(false, 'up');
      await delay(8000);
    }
    const output = path.join(__dirname, '.runtime');
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'actuator-web-result.json'), JSON.stringify({ time: new Date().toISOString(), checks }, null, 2));
    console.log('PASS web commands acknowledged; verify servo/LED with the VCD checker and Wokwi view.');
  } finally {
    if (controlled) await page.locator('#persistentStop').click({ timeout: 2000 }).catch(() => {});
    await browser.close();
  }
}
main().catch(error => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
