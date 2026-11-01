// Exercise the real web control handlers with an isolated transport and small DOM stubs.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '../web/script.js'), 'utf8');
const names = ['showCalibrationMessage', 'sendControl',
  'getCircleGeometry', 'shapeOps', 'runShape'];
const code = names.map(name => {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, name);
  return match[0];
}).join('\n');

function setup(status = { calibrationVersion: 3, measuredCalibration: false, job: { s: 'done' } }) {
  const nodes = new Map();
  for (const id of ['steps', 'calTravelX', 'calTravelY', 'calibrationMessage', 'jogCalDisplay']) {
    nodes.set(id, { value: id === 'steps' ? '10' : '', dataset: {}, style: {}, textContent: '',
      attrs: {}, setAttribute(name, value) { this.attrs[name] = value; }, focus() { this.focused = true; } });
  }
  const sent = [];
  const context = vm.createContext({
    state: { client: { connected: true }, status, uploadGeneration: 0 },
    isEspConnected: () => true, canStartJob: () => true,
    invalidateUpload() { throw new Error('Unexpected upload cancellation'); },
    $: id => nodes.get(id), publish: (topic, payload) => { sent.push({ topic, payload }); return true; },
    log() {}, setTimeout: callback => callback(),
    startVirtualJob() { throw new Error('Unexpected virtual job'); }
  });
  vm.runInContext('const AUTO_CIRCLE_LIMIT_RATIO = 0.8;\n' + code, context);
  return { context, nodes, sent };
}
const setLimit = { dataset: { topic: 'control/cal/set', payload: '' } };

test('direct limit sends the empty payload supported by current firmware', () => {
  const { context, sent } = setup();
  context.sendControl(setLimit);
  assert.deepEqual(sent, [{ topic: 'control/cal/set', payload: '' }]);
});

test('origin and limit are blocked during loading and running jobs', () => {
  for (const job of ['run', 'load']) {
    for (const topic of ['control/cal/set', 'control/cal/origin']) {
      const { context, nodes, sent } = setup({ job: { s: job } });
      context.sendControl({ dataset: { topic, payload: '' } });
      assert.equal(sent.length, 0);
      assert.equal(nodes.get('calibrationMessage').dataset.error, 'true');
    }
  }
});

test('direct calibration circle publishes equal mm diameters', async () => {
  const { context, sent } = setup({ calibrationVersion: 3, measuredCalibration: true,
    range: { x: [0, 40], y: [0, 50] }, scale: { x: 6.25, y: 17 }, job: { s: 'done' } });
  await context.runShape('circle');
  assert.deepEqual(sent.map(p => p.topic), ['auto/circle/begin', 'auto/circle/data', 'auto/circle/start']);
  const points = sent[1].payload.split(';').filter(p => p.includes(',')).map(p => p.split(',').map(Number));
  for (const axis of [0, 1]) {
    const values = points.map(p => p[axis]);
    assert.equal(Math.max(...values) - Math.min(...values), 32);
  }
});
