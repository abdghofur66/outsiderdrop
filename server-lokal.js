#!/usr/bin/env node
// OutsiderDrop - Server Lokal (tanpa internet, tanpa npm install)
// Jalankan: node server-lokal.js   (opsional: PORT=9000 node server-lokal.js)
// Bisa di laptop (Windows/Mac/Linux) atau HP Android via Termux.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

// ---------- Static files ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    const lo = isLoopback(req);
    return res.end(JSON.stringify({ mode: 'local', room: 'LOKAL', url: MAIN_URL, save: lo, saveDir: lo ? SAVE_DIR : '', canChoose: lo, pipe: true }));
  }
  if (url.pathname.startsWith('/pipe/')) return handlePipe(req, res, url);
  if (url.pathname.startsWith('/save/')) return handleSave(req, res, url);
  if (url.pathname === '/open') return handleOpen(req, res, url);
  if (url.pathname === '/choose-folder') return chooseFolder(req, res);
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) {
      return fs.readFile(path.join(ROOT, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); return res.end('Tidak ditemukan'); }
        res.writeHead(200, { 'Content-Type': TYPES['.html'] }); res.end(d2);
      });
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- Minimal WebSocket (text frames saja, cukup untuk signaling) ----------
let MAIN_URL = '';

// ---------- Simpan langsung ke disk laptop host (hanya untuk browser di laptop host) ----------
const { execFile, execFileSync } = require('child_process');
const SETTINGS = path.join(os.homedir(), '.outsiderdrop.json');
function readSettings() { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; } }
// Lokasi folder Downloads yang sebenarnya (ikut bila sudah dipindah ke drive lain)
function downloadsDir() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
        '/v', '{374DE290-123F-4565-9164-39C4925E467B}'], { encoding: 'utf8', windowsHide: true });
      const m = out.match(/REG_(?:EXPAND_)?SZ\s+(.+)/);
      if (m) {
        const d = m[1].trim().replace(/%([^%]+)%/g, (_, k) => process.env[k] || process.env[k.toUpperCase()] || '');
        if (d && fs.existsSync(d)) return d;
      }
    } else if (process.platform === 'linux') {
      const d = execFileSync('xdg-user-dir', ['DOWNLOAD'], { encoding: 'utf8' }).trim();
      if (d && d !== os.homedir() && fs.existsSync(d)) return d;
    }
  } catch {}
  return path.join(os.homedir(), 'Downloads');
}
let SAVE_DIR = process.env.SAVE_DIR || readSettings().saveDir || path.join(downloadsDir(), 'OutsiderDrop');

// Dialog "Ganti folder" bawaan sistem (hanya dari browser di laptop host)
function chooseFolder(req, res) {
  const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj || {})); };
  if (req.method !== 'POST' || !isLoopback(req)) return reply(403);
  req.resume();
  let cmd, args;
  if (process.platform === 'win32') {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; ` +
      `$f.Description = 'Pilih folder untuk menyimpan file masuk OutsiderDrop'; $f.ShowNewFolderButton = $true; ` +
      `$f.SelectedPath = '${SAVE_DIR.replace(/'/g, "''")}'; $w = New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; ` +
      `if ($f.ShowDialog($w) -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $f.SelectedPath }`;
    cmd = 'powershell.exe'; args = ['-NoProfile', '-STA', '-Command', ps];
  } else if (process.platform === 'darwin') {
    cmd = 'osascript'; args = ['-e', 'POSIX path of (choose folder with prompt "Pilih folder untuk file masuk OutsiderDrop")'];
  } else {
    cmd = 'zenity'; args = ['--file-selection', '--directory', '--title=Pilih folder untuk file masuk OutsiderDrop'];
  }
  execFile(cmd, args, { encoding: 'utf8', windowsHide: false }, (err, out) => {
    const dir = (out || '').trim().replace(/[\\/]$/, '');
    if (err || !dir) return reply(200, { saveDir: SAVE_DIR, changed: false });
    SAVE_DIR = dir;
    try { fs.writeFileSync(SETTINGS, JSON.stringify({ ...readSettings(), saveDir: dir }, null, 2)); } catch {}
    console.log('  File masuk sekarang disimpan ke: ' + dir);
    reply(200, { saveDir: dir, changed: true });
  });
}
const saves = new Map();
const savedFiles = new Map(); // id -> path file yang sudah selesai
const isLoopback = req => /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '');
const clean = s => String(s || '').replace(/[\\:*?"<>|]/g, '_').split('/').filter(x => x && x !== '.' && x !== '..').join(path.sep);
// Buka file / folder hasil terima di laptop host (hanya dari browser di laptop ini)
function handleOpen(req, res, url) {
  const done = code => { res.writeHead(code); res.end(); };
  if (req.method !== 'POST' || !isLoopback(req)) return done(403);
  req.resume();
  const file = savedFiles.get(url.searchParams.get('id'));
  if (!file || !fs.existsSync(file)) return done(404);
  const folder = url.searchParams.get('what') === 'folder';
  if (process.platform === 'win32') {
    if (folder) execFile('explorer.exe', ['/select,', file], () => {});
    else execFile('explorer.exe', [file], () => {});
  } else if (process.platform === 'darwin') {
    execFile('open', folder ? ['-R', file] : [file], () => {});
  } else {
    execFile('xdg-open', [folder ? path.dirname(file) : file], () => {});
  }
  done(200);
}

function uniqueFile(sub, rawName) {
  const dir = path.join(SAVE_DIR, clean(sub));
  fs.mkdirSync(dir, { recursive: true });
  const name = clean(rawName).replace(/[\\/]/g, '_') || 'file';
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  let file = path.join(dir, name);
  for (let i = 1; fs.existsSync(file); i++) file = path.join(dir, `${base} (${i})${ext}`);
  return file;
}

// ---------- Transfer cepat lewat host (HTTP streaming) ----------
// Pengirim: POST /pipe/<id>?to=<penerima> berisi file utuh.
// Penerima: GET /pipe/<id> (diteruskan langsung), atau POST /pipe/<id>/save bila penerima = browser di host (ditulis ke disk).
const pipes = new Map();
const clients = new Map(); // id perangkat -> klien websocket (untuk kabar progres)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };
function handlePipe(req, res, url) {
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...CORS, 'Access-Control-Max-Age': '86400' }); return res.end(); }
  const m = url.pathname.match(/^\/pipe\/([A-Za-z0-9]{6,32})(\/save)?$/);
  const fail = code => { if (!res.headersSent) res.writeHead(code, CORS); res.end(); };
  if (!m) return fail(404);
  const id = m[1];
  let pp = pipes.get(id);
  if (!pp) { pp = { id }; pipes.set(id, pp); setTimeout(() => { if (pipes.get(id) === pp && !pp.started) { pipes.delete(id); pp.src && pp.src.res.writeHead(408, CORS) && pp.src.res.end(); pp.dst && pp.dst.res.writeHead(408, CORS) && pp.dst.res.end(); } }, 60000); }
  if (req.method === 'POST' && !m[2]) {
    pp.src = { req, res, len: Number(req.headers['content-length']) || 0 }; pp.to = url.searchParams.get('to') || '';
  } else if (req.method === 'GET') {
    pp.dst = { res };
  } else if (req.method === 'POST' && m[2]) {
    if (!isLoopback(req)) return fail(403);
    req.resume();
    pp.dst = { res, save: true, sub: url.searchParams.get('path'), name: url.searchParams.get('name') };
  } else return fail(405);
  connectPipe(pp);
}
function connectPipe(pp) {
  if (!pp.src || !pp.dst || pp.started) return;
  pp.started = true;
  const { req, res: srcRes, len } = pp.src;
  const dst = pp.dst;
  let got = 0, done = false, lastTick = 0;
  const finish = ok => {
    if (done) return; done = true; pipes.delete(pp.id);
    if (!srcRes.headersSent) srcRes.writeHead(ok ? 200 : 500, CORS);
    srcRes.end();
  };
  const tick = () => {
    const now = Date.now(); if (now - lastTick < 250 && got < len) return; lastTick = now;
    const c = clients.get(pp.to); if (c) sendWS(c.sock, JSON.stringify({ type: 'pipe', id: pp.id, got }));
  };
  if (dst.save) {
    let file;
    try { file = uniqueFile(dst.sub, dst.name); } catch { dst.res.writeHead(500, CORS); dst.res.end(); req.destroy(); return finish(false); }
    const out = fs.createWriteStream(file, { highWaterMark: 4 << 20 });
    req.on('data', c => { got += c.length; tick(); });
    req.pipe(out);
    out.on('finish', () => {
      const ok = got === len;
      if (ok) savedFiles.set(pp.id, file); else fs.unlink(file, () => {});
      dst.res.writeHead(ok ? 200 : 500, { 'Content-Type': 'application/json', ...CORS }); dst.res.end(JSON.stringify({ file }));
      finish(ok);
    });
    req.on('aborted', () => { out.destroy(); fs.unlink(file, () => {}); if (!dst.res.headersSent) { dst.res.writeHead(499, CORS); dst.res.end(); } finish(false); });
  } else {
    dst.res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': len, 'Cache-Control': 'no-store', ...CORS });
    req.on('data', c => { got += c.length; });
    req.pipe(dst.res);
    req.on('end', () => finish(got === len));
    req.on('aborted', () => { dst.res.destroy(); finish(false); });
    dst.res.on('close', () => { if (!done && got < len) { req.destroy(); finish(false); } });
  }
}

function handleSave(req, res, url) {
  const done = (code, msg) => { res.writeHead(code, { 'Content-Type': 'text/plain' }); res.end(msg || ''); };
  if (req.method !== 'POST' || !isLoopback(req)) return done(403);
  const op = url.pathname.slice(6), id = url.searchParams.get('id');
  if (op === 'open') {
    const file = uniqueFile(url.searchParams.get('path'), url.searchParams.get('name'));
    saves.set(id, { file, fd: fs.openSync(file, 'w') });
    req.resume(); return req.on('end', () => done(200));
  }
  const sv = saves.get(id); if (!sv) return done(404);
  if (op === 'append') {
    req.on('data', c => fs.writeSync(sv.fd, c));
    return req.on('end', () => done(200));
  }
  req.resume();
  fs.closeSync(sv.fd); saves.delete(id);
  if (op === 'abort') try { fs.unlinkSync(sv.file); } catch {}
  else savedFiles.set(id, sv.file);
  done(200);
}
const rooms = new Map(); // code -> Set(client)

function sendWS(sock, data, op = 0x81) {
  if (sock.destroyed) return true;
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return sock.write(Buffer.concat([head, payload]));
}

server.on('upgrade', (req, sock) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/ws\/([A-Z0-9]{4,12})$/i);
  const key = req.headers['sec-websocket-key'];
  if (!m || !key) return sock.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);

  const code = m[1].toUpperCase();
  if (!rooms.has(code)) rooms.set(code, new Set());
  const room = rooms.get(code);
  const me = {
    sock,
    id: crypto.randomBytes(4).toString('hex'),
    name: (url.searchParams.get('name') || 'Perangkat').slice(0, 40),
    os: (url.searchParams.get('os') || '').slice(0, 20)
  };
  const info = c => ({ id: c.id, name: c.name, os: c.os });
  sendWS(sock, JSON.stringify({ type: 'welcome', id: me.id, peers: [...room].map(info) }));
  for (const c of room) sendWS(c.sock, JSON.stringify({ type: 'join', peer: info(me) }));
  room.add(me);
  clients.set(me.id, me);
  console.log(`+ ${me.name} masuk (${room.size} perangkat)`);

  let buf = Buffer.alloc(0), frag = [], fragOp = 1;
  sock.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let data = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = buf.subarray(off, off + 4);
        data = Buffer.from(data);
        for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      }
      buf = buf.subarray(need);
      if (op === 0x8) return sock.end();
      if (op === 0x9) { sock.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); continue; }
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        if (op) fragOp = op;
        frag.push(data);
        if (fin) {
          const full = Buffer.concat(frag); frag = [];
          if (fragOp === 0x2) relayBinary(full); else handle(full.toString());
        }
      }
    }
  });

  // Kirim lewat host: 8 byte pertama = id tujuan, diganti id pengirim
  function relayBinary(full) {
    if (full.length < 8) return;
    const to = full.subarray(0, 8).toString();
    for (const c of room) if (c.id === to) {
      const ok = sendWS(c.sock, Buffer.concat([Buffer.from(me.id), full.subarray(8)]), 0x82);
      if (!ok) { sock.pause(); const go = () => sock.resume(); c.sock.once('drain', go); c.sock.once('close', go); }
    }
  }

  function handle(raw) {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'ping') return sendWS(sock, '{"type":"pong"}');
    if (!msg.to) return;
    for (const c of room) if (c.id === msg.to) sendWS(c.sock, JSON.stringify({ ...msg, from: me.id }));
  }

  const bye = () => {
    if (!room.has(me)) return;
    room.delete(me);
    clients.delete(me.id);
    for (const c of room) sendWS(c.sock, JSON.stringify({ type: 'leave', id: me.id }));
    if (!room.size) rooms.delete(code);
    console.log(`- ${me.name} keluar (${room.size} perangkat)`);
  };
  sock.on('close', bye);
  sock.on('error', bye);
});

function pickIP(ips) {
  // utamakan alamat hotspot/WiFi umum
  return ips.find(i => /^192\.168\./.test(i)) || ips.find(i => /^10\./.test(i)) || ips.find(i => /^172\.(1[6-9]|2\d|3[01])\./.test(i)) || ips[0];
}
function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  const { exec } = require('child_process');
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
let port = PORT;
server.on('error', err => {
  if (err.code === 'EADDRINUSE' && port < PORT + 20) { port++; return server.listen(port, '0.0.0.0'); }
  console.error('Server gagal berjalan:', err.message);
  if (process.platform === 'win32') setTimeout(() => process.exit(1), 60000);
});
server.on('listening', () => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  const main = ips.length ? `http://${pickIP(ips)}:${port}` : `http://localhost:${port}`;
  MAIN_URL = main;
  console.log('\n  OutsiderDrop - Mode Lokal aktif (tanpa internet)\n');
  console.log('  Pindai QR ini dari HP/laptop lain di WiFi/hotspot yang sama:\n');
  try { require('qrcode-terminal').generate(main, { small: true }, q => console.log(q.replace(/^/gm, '  '))); } catch {}
  console.log('  Atau buka alamat:');
  (ips.length ? ips : ['127.0.0.1']).forEach(ip => console.log(`    http://${ip}:${port}`));
  console.log('\n  File masuk disimpan ke: ' + SAVE_DIR);
  console.log('\n  Biarkan jendela ini terbuka selama dipakai. Tutup untuk berhenti.\n');
  openBrowser(`http://localhost:${port}`);
});
server.listen(port, '0.0.0.0');
