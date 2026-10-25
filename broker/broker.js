const { Aedes } = require('aedes');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { WebSocketServer, createWebSocketStream } = require('ws');

const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'web');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const USERS_FILE = path.join(__dirname, 'users.json');
const EXAMPLE_USERS_FILE = path.join(__dirname, 'users.json.example');
const MQTT_PORT = Number(process.env.MQTT_PORT || 1883);
const WEB_PORT = Number(process.env.WEB_PORT || 3000);
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';
const DEVICE_ID = process.env.DEVICE_ID || 'cnc01';

function getLanAddress() {
  const addresses = Object.values(os.networkInterfaces())
    .flatMap(items => items || [])
    .filter(item => item.family === 'IPv4' && !item.internal)
    .map(item => item.address);
  return addresses.find(ip => ip.startsWith('192.168.')) ||
    addresses.find(ip => ip.startsWith('10.')) ||
    addresses.find(ip => /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) ||
    addresses[0] || '127.0.0.1';
}

const PUBLIC_WEB_URL = process.env.WEB_PUBLIC_URL || `http://${getLanAddress()}:${WEB_PORT}`;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.copyFileSync(EXAMPLE_USERS_FILE, USERS_FILE);

function loadUsers() {
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return {
      users: data.users || {},
      admins: new Set(data.admins || []),
      operators: new Set(data.operators || [])
    };
  } catch (error) {
    console.error('[AUTH] Cannot read users.json:', error.message);
    return { users: {}, admins: new Set(), operators: new Set() };
  }
}

let credentials = loadUsers();
const broker = new Aedes();
const mqttServer = net.createServer(broker.handle);
let dbPool = null;
let dbRetryTimer = null;
let lock = null;

function isAdmin(client) {
  return Boolean(client && credentials.admins.has(client.user));
}

function isOperator(client) {
  return isAdmin(client) || Boolean(client && credentials.operators.has(client.user));
}

function topicFor(rest) {
  return `cnc/${DEVICE_ID}/${rest}`;
}

function restTopic(topic) {
  const prefix = `cnc/${DEVICE_ID}/`;
  return topic.startsWith(prefix) ? topic.slice(prefix.length) : null;
}

function isControlTopic(rest) {
  return /^(control|auto)\//.test(rest || '');
}

function isAdminOnly(rest) {
  return /^(control\/(jog|speed|home|pen|cal)\/)/.test(rest || '') ||
    /^(control\/(jog|speed|home|pen|cal))$/.test(rest || '');
}

function isJobTopic(rest) {
  return /^(auto\/[^/]+\/(begin|data|start)|control\/stop)$/.test(rest || '');
}

function publishLock() {
  broker.publish({
    topic: topicFor('lock'),
    payload: Buffer.from(lock ? lock.user : ''),
    qos: 1,
    retain: true
  });
}

function releaseLock(reason) {
  if (!lock) return;
  console.log(`[LOCK] released (${reason || 'done'}) from ${lock.user}`);
  lock = null;
  publishLock();
}

function takeLock(client) {
  if (isAdmin(client)) return true;
  if (lock && (lock.user !== client.user || lock.clientId !== client.id)) return false;
  lock = { user: client.user, clientId: client.id, started: Date.now(), sawJob: false };
  publishLock();
  return true;
}

function logCommand(client, packet, allowed) {
  const rest = restTopic(packet.topic);
  if (!rest || !isControlTopic(rest)) return;
  const payload = rest.endsWith('/data') ? `(${packet.payload.length} bytes)` : packet.payload.toString('utf8').slice(0, 4096);
  dbInsert('INSERT INTO commands (username, client_id, device, topic, payload, allowed) VALUES (?, ?, ?, ?, ?, ?)',
    [client?.user || '', client?.id || '', DEVICE_ID, rest, payload, allowed ? 1 : 0]);
}

async function initDb() {
  if (dbPool) return;
  let mysql;
  try { mysql = require('mysql2/promise'); } catch (error) {
    console.warn('[DB] mysql2 is not installed; broker continues without MariaDB.');
    return;
  }
  const cfg = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || ''
  };
  try {
    const admin = await mysql.createConnection(cfg);
    await admin.query('CREATE DATABASE IF NOT EXISTS `minicnc` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await admin.end();
    dbPool = mysql.createPool({ ...cfg, database: process.env.DB_NAME || 'minicnc', waitForConnections: true, connectionLimit: 4 });
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS commands (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), username VARCHAR(128) NOT NULL, client_id VARCHAR(256) NOT NULL, device VARCHAR(64) NOT NULL, topic VARCHAR(255) NOT NULL, payload TEXT NOT NULL, allowed TINYINT(1) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS images (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), username VARCHAR(128) NOT NULL, original_name VARCHAR(255) NOT NULL, mime VARCHAR(128) NOT NULL, size_bytes BIGINT UNSIGNED NOT NULL, sha256 CHAR(64) NOT NULL, file_path VARCHAR(512) NOT NULL, INDEX (sha256))`,
      `CREATE TABLE IF NOT EXISTS status_log (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), device VARCHAR(64) NOT NULL, payload TEXT NOT NULL, INDEX (created_at))`
    ]) await dbPool.query(sql);
    console.log('[DB] MariaDB connected');
  } catch (error) {
    dbPool = null;
    console.warn('[DB] MariaDB unavailable:', error.message);
    if (!dbRetryTimer) dbRetryTimer = setTimeout(() => { dbRetryTimer = null; initDb(); }, 30000);
  }
}

function dbInsert(sql, params) {
  if (!dbPool) return;
  dbPool.execute(sql, params).catch(error => console.warn('[DB] insert:', error.message));
}

broker.authenticate = (client, username, password, callback) => {
  credentials = loadUsers();
  const name = username ? username.toString() : '';
  const pass = password ? password.toString() : '';
  if (credentials.users[name] && credentials.users[name] === pass) {
    client.user = name;
    callback(null, true);
  } else callback(null, false);
};

broker.authorizePublish = (client, packet, callback) => {
  const rest = restTopic(packet.topic);
  if (!rest) return callback(new Error('topic must be under device prefix'));
  if (isAdminOnly(rest) && !isOperator(client)) {
    logCommand(client, packet, false);
    console.warn(`[AUTH] blocked ${client.user || client.id} -> ${packet.topic}`);
    return callback(new Error('admin required'));
  }
  if (isJobTopic(rest) && lock && !isAdmin(client) && lock.user !== client.user) {
    logCommand(client, packet, false);
    return callback(new Error('machine is locked'));
  }
  if (rest.match(/^auto\/[^/]+\/begin$/) && !takeLock(client)) {
    logCommand(client, packet, false);
    return callback(new Error('machine is locked'));
  }
  logCommand(client, packet, true);
  callback(null);
};

broker.authorizeSubscribe = (client, subscription, callback) => {
  if ((subscription.topic.includes('#') || subscription.topic.includes('+')) && !isAdmin(client)) {
    console.warn(`[AUTH] blocked wildcard subscription ${client.user || client.id}: ${subscription.topic}`);
    return callback(null, null);
  }
  callback(null, subscription);
};

broker.on('clientReady', client => console.log(`[MQTT] + ${client.user || '?'} ${client.id}`));
broker.on('clientDisconnect', client => console.log(`[MQTT] - ${client.user || '?'} ${client.id}`));
broker.on('clientError', (client, error) => console.warn(`[MQTT] client error ${client?.id || '?'}: ${error.message}`));
broker.on('connectionError', (client, error) => console.warn(`[MQTT] connection error ${client?.id || '?'}: ${error.message}`));
broker.on('publish', (packet, client) => {
  if (!packet.topic.startsWith(`cnc/${DEVICE_ID}/status`)) return;
  const payload = packet.payload.toString('utf8');
  dbInsert('INSERT INTO status_log (device, payload) VALUES (?, ?)', [DEVICE_ID, payload]);
  try {
    const status = JSON.parse(payload);
    if (lock && status.job && ['done', 'stop', 'error', 'idle'].includes(status.job.s)) releaseLock(status.job.s);
    if (lock && status.job && ['load', 'run'].includes(status.job.s)) lock.sawJob = true;
  } catch (_) { /* status may be a Last Will or partial payload */ }
});

function basicAuth(req) {
  const raw = req.headers.authorization || '';
  if (!raw.startsWith('Basic ')) return null;
  try {
    const [user, pass] = Buffer.from(raw.slice(6), 'base64').toString('utf8').split(':');
    credentials = loadUsers();
    return credentials.users[user] === pass ? { user, pass } : null;
  } catch (_) { return null; }
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function staticFile(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(WEB_DIR, relative);
  if (!file.startsWith(path.resolve(WEB_DIR) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found');
  const ext = path.extname(file).toLowerCase();
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
  send(res, 200, fs.readFileSync(file), types[ext] || 'application/octet-stream');
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size <= limit) chunks.push(chunk); else reject(new Error('payload too large')); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (url.pathname === '/api/images' && req.method === 'POST') {
    const auth = basicAuth(req);
    if (!auth) return send(res, 401, JSON.stringify({ error: 'login required' }), 'application/json');
    try {
      const body = await readBody(req, 15 * 1024 * 1024);
      const mime = req.headers['content-type'] || 'application/octet-stream';
      if (!mime.startsWith('image/')) return send(res, 415, JSON.stringify({ error: 'image required' }), 'application/json');
      const sha = crypto.createHash('sha256').update(body).digest('hex');
      const original = String(req.headers['x-file-name'] || 'upload.bin').slice(0, 255).replace(/[\\/:*?"<>|]/g, '_');
      const ext = path.extname(original) || '.bin';
      const stored = path.join(UPLOAD_DIR, `${sha}${ext}`);
      if (!fs.existsSync(stored)) fs.writeFileSync(stored, body);
      dbInsert('INSERT INTO images (username, original_name, mime, size_bytes, sha256, file_path) VALUES (?, ?, ?, ?, ?, ?)', [auth.user, original, mime, body.length, sha, stored]);
      return send(res, 200, JSON.stringify({ ok: true, file: path.basename(stored), db: Boolean(dbPool) }), 'application/json');
    } catch (error) { return send(res, 400, JSON.stringify({ error: error.message }), 'application/json'); }
  }
  if (url.pathname === '/healthz') return send(res, 200, JSON.stringify({ ok: true, device: DEVICE_ID, lock }), 'application/json');
  return staticFile(req, res);
});

const wss = new WebSocketServer({ noServer: true });
httpServer.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname !== '/mqtt') return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => {
    const stream = createWebSocketStream(ws);
    broker.handle(stream, req);
  });
});

function listenServer(server, port) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, BIND_HOST);
  });
}

function closeServer(server) {
  return new Promise(resolve => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}

function closeBroker() {
  return new Promise(resolve => broker.close(resolve));
}

async function start() {
  try {
    await broker.listen();
    await listenServer(mqttServer, MQTT_PORT);
    console.log(`[MQTT] TCP listening on ${BIND_HOST}:${MQTT_PORT}`);
    await listenServer(httpServer, WEB_PORT);
    console.log('[BROKER] Broker đang hoạt động');
    console.log(`[WEB] Mở web: ${PUBLIC_WEB_URL}`);
    await initDb();
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.error(`[BROKER] Broker đang hoạt động; cổng ${error.port || '1883/3000'} đang được sử dụng.`);
      console.error(`[WEB] Mở web: ${PUBLIC_WEB_URL}`);
    } else {
      console.error('[BROKER] Không thể khởi động:', error);
    }
    await closeServer(mqttServer);
    await closeServer(httpServer);
    await closeBroker();
    process.exit(1);
  }
}

start().catch(error => {
  console.error('[BROKER] Cannot start:', error);
  process.exitCode = 1;
});

setInterval(() => {
  if (lock && !lock.sawJob && Date.now() - lock.started > 15000) releaseLock('timeout');
}, 1000);

process.on('SIGINT', async () => { await broker.close(); process.exit(0); });
