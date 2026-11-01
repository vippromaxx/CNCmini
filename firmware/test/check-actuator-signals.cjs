// Check actual Wokwi logic-analyzer signals, not MQTT state variables.
// D6 = servo GPIO8, D7 = user LED GPIO6. Stop Wokwi to export the VCD first.
const fs = require('node:fs');
const path = require('node:path');
const file = process.argv[2] || path.join(__dirname, '.runtime/cnc-signals.vcd');
const down = Number(process.argv[3] || 80);
const up = Number(process.argv[4] || 110);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const channels = new Map(), events = new Map();
let timestamp = 0, unitUs;
for (const line of lines) {
  const timescale = line.match(/^\$timescale\s+(\d+)\s*(ns|us|ms|s)\s+\$end/);
  if (timescale) unitUs = Number(timescale[1]) * { ns: 0.001, us: 1, ms: 1000, s: 1e6 }[timescale[2]];
  if (line.startsWith('$var')) {
    const [, , , symbol, name] = line.split(/\s+/);
    channels.set(symbol, name); events.set(name, []);
  } else if (line.startsWith('#')) timestamp = Number(line.slice(1));
  else if (/^[01]/.test(line) && channels.has(line.slice(1))) {
    events.get(channels.get(line.slice(1))).push([timestamp, Number(line[0])]);
  }
}
if (!Number.isFinite(unitUs) || !events.has('D6') || !events.has('D7')) {
  throw new Error('Expected Wokwi VCD timescale, servo D6 and LED D7');
}
const servo = events.get('D6'), led = events.get('D7');
const rises = servo.filter(([, level]) => level === 1).map(([time]) => time);
const periods = rises.slice(1).map((time, i) => (time - rises[i]) * unitUs);
const high = servo.slice(1).flatMap(([time, level], i) =>
  servo[i][1] === 1 && level === 0 ? [(time - servo[i][0]) * unitUs] : []);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? null;
const pulseFor = angle => 500 + Math.floor(angle * 1900 / 180);
const failures = [];
if (periods.length < 10 || periods.filter(v => Math.abs(v - 20000) <= 200).length < periods.length * 0.95) {
  failures.push('Servo must output 50 Hz / 20000 us periods');
}
for (const angle of [down, up]) {
  if (high.filter(v => Math.abs(v - pulseFor(angle)) <= 10).length < 3) {
    failures.push(`Missing servo pulse for ${angle} degrees (about ${pulseFor(angle)} us)`);
  }
}
// Ignore boot pin levels: the C5 starts high before setup configures GPIO6 low.
const commandedLed = led.filter(([time]) => time * unitUs >= 2e6);
if (!commandedLed.some(([, level], i) => level === 1 && commandedLed.slice(i + 1).some(([, later]) => later === 0))) {
  failures.push('LED D7 must turn on and then off');
}
const widths = new Map();
for (const width of high) {
  const key = width.toFixed(1); widths.set(key, (widths.get(key) || 0) + 1);
}
console.log(JSON.stringify({
  passed: failures.length === 0, file, periodUs: median(periods),
  pulseWidthsUs: [...widths].sort((a, b) => b[1] - a[1]).slice(0, 6),
  ledTransitions: led.map(([time, level]) => ({ seconds: time * unitUs / 1e6, level })), failures
}, null, 2));
process.exitCode = failures.length ? 1 : 0;
