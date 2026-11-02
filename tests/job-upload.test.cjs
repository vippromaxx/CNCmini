const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '../web/script.js'), 'utf8');
function harness() {
  const sent = [];
  let acknowledge = true;
  const state = { status: { job: { s: 'idle' } }, uploadGeneration: 0, transport: { uploading: false }, client: { connected: true } };
  const context = vm.createContext({ state, setTimeout, clearTimeout, Date, Error, Number, Math, JSON,
    $: () => ({ value: 0 }), isEspConnected: () => state.client.connected,
    log() {}, invalidateUpload() { state.isUploadingJob = false; state.uploadGeneration++; },
    publish(topic, payload) {
      sent.push({ topic, payload });
      if (acknowledge) setTimeout(() => {
        const [,kind,action] = topic.split('/');
        if (action === 'begin') state.status = { job: { k: kind, s: 'load', n: 0 } };
        if (action === 'data') state.status = { job: { ...state.status.job, n: state.status.job.n + payload.split(';').length } };
        if (action === 'start') state.status = { job: { ...state.status.job, s: 'run' } };
      }, 1);
      return state.client.connected;
    }
  });
  const match = source.match(/^async function uploadJob\([^\n]*\) \{[\s\S]*?^\}/m);
  assert.ok(match, 'Shared uploader must wait for device acknowledgements');
  vm.runInContext(match[0], context);
  return { context, state, sent, noAck() { acknowledge = false; } };
}

test('shapes and images wait for all received operations before start, bounded packets', async () => {
  const h = harness();
  const ops = ['U', ...Array.from({length:8000-2},(_,i)=>`${i},${i}`), 'U'];
  assert.equal(await h.context.uploadJob('image', ops, 'test'), true);
  assert.equal(h.state.status.job.n, ops.length);
  const data = h.sent.filter(p=>p.topic.endsWith('/data'));
  assert(data.length > 1);
  assert(data.every(p=>Buffer.byteLength(p.payload) <= 1024));
  assert.deepEqual(data.flatMap(p=>p.payload.split(';')), ops);
  assert.equal(h.sent.at(-1).topic, 'auto/image/start');
  assert.equal(h.state.isUploadingJob, false);
});

test('no acknowledgement means no data or start; cancelling discards upload', async () => {
  const h = harness(); h.noAck();
  const pending = h.context.uploadJob('circle', ['U','1,1','D','2,2','U'], 'test');
  await new Promise(resolve=>setTimeout(resolve, 180));
  assert.deepEqual(h.sent.map(p=>p.topic), ['auto/circle/begin']);
  h.state.isUploadingJob=false; h.state.uploadGeneration++;
  assert.equal(await pending, false);
  assert.equal(h.sent.length, 1);
});

test('disconnect during upload never sends start after reconnect', async () => {
  const h = harness(); h.noAck();
  const pending = h.context.uploadJob('square', ['U','1,1','D','2,2','U'], 'test');
  h.state.client.connected=false;
  assert.equal(await pending, false);
  h.state.client.connected=true;
  await new Promise(resolve=>setTimeout(resolve, 30));
  assert.equal(h.sent.length, 1);
});

test('partial receipt cannot start drawing', async () => {
  const h = harness();
  const publish = h.context.publish;
  h.context.publish = (topic, payload) => {
    if (topic.endsWith('/data')) {
      h.noAck();
      h.state.status = { job: { k: 'image', s: 'load', n: 1 } };
      setTimeout(() => { h.state.uploadGeneration++; h.state.isUploadingJob = false; }, 100);
    }
    return publish(topic, payload);
  };
  assert.equal(await h.context.uploadJob('image', ['U','1,1','D','2,2','U'], 'test'), false);
  assert.equal(h.sent.some(p=>p.topic.endsWith('/start')), false);
});

test('both UI drawing handlers use the acknowledged uploader', async () => {
  for (const kind of ['square', 'circle', 'image']) {
    const h = harness();
    const calls = [];
    h.context.canStartJob = () => true;
    h.context.imgWs = { mode: 'outline' };
    h.context.getCircleGeometry = () => ({ diameter: 20 });
    h.context.shapeOps = () => ['U','1,1','D','2,2','U'];
    h.context.state.imagePaths = ['U','1,1','D','2,2','U'];
    h.context.$ = () => null;
    h.context.updateJobProgress = () => {};
    h.context.uploadJob = async (...args) => { calls.push(args); return true; };
    const name = kind === 'image' ? 'sendImageToESP' : 'runShape';
    vm.runInContext(source.match(new RegExp('^async function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}', 'm'))[0], h.context);
    await h.context[name](kind);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], kind);
    assert.equal(h.sent.length, 0, 'UI must not send an unchecked start separately');
  }
});
