// Run: node --test tests/auto-circle.test.cjs (no broker or device access).
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../web/script.js'), 'utf8');
const ratio = source.match(/^const AUTO_CIRCLE_LIMIT_RATIO\s*=\s*[^;]+;/m);
assert.ok(ratio, 'Circle size setting must exist');
const functions = ['getCircleGeometry', 'shapeOps'].map(name => {
  const match = source.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `Cannot find actual ${name} implementation`);
  return match[0];
});

function generator(status) {
  const context = vm.createContext({ state: { status } });
  vm.runInContext([ratio[0], ...functions].join('\n'), context);
  return context;
}

const defaultRange = { x: [0, 230], y: [0, 850] };

test('circle has equal mm radii regardless of each axis pulses/mm', () => {
  for (const scale of [{ x: 1, y: 1 }, { x: 2, y: 4 }, { x: 4, y: 2 }, { x: 2.75, y: 13 }]) {
    const geometry = generator({ range: defaultRange, scale }).getCircleGeometry();
    assert.equal(geometry.rx, 92, `X radius with ${JSON.stringify(scale)}`);
    assert.equal(geometry.ry, 92, `Y radius with ${JSON.stringify(scale)}`);
    assert.equal(geometry.diameter, 184, '80% of the shorter travel, in mm');
  }
});

test('circle commands preserve radius, closure and limits after pulse conversion', () => {
  const fixtures = [
    { range: defaultRange, scale: { x: 2, y: 4 }, center: [115, 425], radius: 92 },
    { range: { x: [-230, 0], y: [-850, 0] }, scale: { x: 4, y: 2 }, center: [-115, -425], radius: 92 },
    { range: { x: [330, 100], y: [350, -500] }, scale: { x: 2.75, y: 13 }, center: [215, -75], radius: 92 },
    { range: { x: [0, 850], y: [0, 230] }, scale: { x: 2, y: 4 }, center: [425, 115], radius: 92 }
  ];
  for (const { range, scale, center, radius } of fixtures) {
    const ops = Array.from(generator({ range, scale }).shapeOps('circle'));
    assert.equal(ops[0], 'U');
    assert.equal(ops[2], 'D');
    assert.equal(ops.at(-1), 'U');
    const points = ops.filter(op => op !== 'U' && op !== 'D').map(op => op.split(',').map(Number));
    assert.deepEqual(points[0], points.at(-1), 'Circle must close with the pen down');
    // Firmware rounds signed logical coordinates * pulses/mm to the nearest pulse.
    const pulseRound = value => Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
    const tolerance = Math.SQRT1_2 + Math.hypot(0.5 / scale.x, 0.5 / scale.y) + 1e-9;
    for (const [x, y] of points) {
      assert.ok(Number.isInteger(x) && Number.isInteger(y), 'Keep firmware integer command compatibility');
      assert.ok(x >= Math.min(...range.x) && x <= Math.max(...range.x));
      assert.ok(y >= Math.min(...range.y) && y <= Math.max(...range.y));
      const actualX = pulseRound(x * scale.x) / scale.x;
      const actualY = pulseRound(y * scale.y) / scale.y;
      const error = Math.abs(Math.hypot(actualX - center[0], actualY - center[1]) - radius);
      assert.ok(error <= tolerance, `Circle radial error ${error} at ${x},${y}`);
    }
    const xs = points.map(p => p[0]);
    const ys = points.map(p => p[1]);
    assert.equal(Math.max(...xs) - Math.min(...xs), 2 * radius);
    assert.equal(Math.max(...ys) - Math.min(...ys), 2 * radius);
  }
});

test('offline circle uses default travel and square still follows all four limits', () => {
  const offline = generator(undefined).getCircleGeometry();
  assert.equal(offline.rx, 92);
  assert.equal(offline.ry, 92);
  const ops = Array.from(generator({
    range: { x: [330, 100], y: [350, -500] }, scale: { x: 2, y: 4 }
  }).shapeOps('square'));
  assert.deepEqual(ops, ['U', '100,-500', 'D', '330,-500', '330,350', '100,350', '100,-500', 'U']);
});
