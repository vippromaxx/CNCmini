// Reuse/start the existing WEBCNC broker. Do not create a second users database.
const { spawn } = require('node:child_process');
const { mkdir, readFile, access } = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');

async function checkPort(port, host) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  await new Promise(resolve => server.close(resolve));
}

async function main() {
  if (!process.argv[2]) throw new Error('Usage: node test/start-broker.cjs <WEBCNC-directory>');
  const webProject = path.resolve(process.argv[2]);
  await access(path.join(webProject, 'broker', 'node_modules', 'aedes'));
  await access(path.join(webProject, 'web', 'index.html'));
  const accounts = JSON.parse(await readFile(path.join(webProject, 'broker', 'users.json'), 'utf8'));
  if (accounts.users?.user1 !== '1' || ![...(accounts.operators || []), ...(accounts.admins || [])].includes('user1')) {
    throw new Error('WEBCNC/broker/users.json must contain user1 / 1 with operator rights. Other accounts are preserved.');
  }
  await mkdir(path.join(__dirname, '.runtime'), { recursive: true });
  let health;
  try {
    const response = await fetch('http://127.0.0.1:3000/healthz', { signal: AbortSignal.timeout(2500) });
    if (response.ok) health = await response.json();
  } catch { /* If no broker is running, check both ports before starting it. */ }
  if (health) {
    if (!health.ok || health.device !== 'cnc01') throw new Error('Port 3000 is not the expected cnc01 broker.');
    console.log('Using running WEBCNC broker: http://127.0.0.1:3000 | MQTT 1883 | device cnc01');
    console.log('Web and Wokwi login: user1 / 1. No additional broker was started.');
    return;
  }
  await checkPort(1883, '0.0.0.0');
  await checkPort(3000, '0.0.0.0');
  const child = spawn(process.execPath, [path.join(webProject, 'broker', 'broker.js')], {
    cwd: path.join(webProject, 'broker'),
    env: { ...process.env, BIND_HOST: '0.0.0.0', MQTT_PORT: '1883', WEB_PORT: '3000', DEVICE_ID: 'cnc01' },
    windowsHide: true, stdio: 'inherit'
  });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code || 0; });
  process.once('SIGINT', () => child.kill());
  process.once('SIGTERM', () => child.kill());
  process.once('exit', () => child.kill());
  console.log('WEBCNC: http://127.0.0.1:3000 | MQTT 1883 | device cnc01');
  console.log('Web and Wokwi login: user1 / 1. Ctrl+C stops the broker started by this script.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
