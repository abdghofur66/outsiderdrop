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
    return res.end(JSON.stringify({ mode: 'local', room: 'LOKAL', url: MAIN_URL, save: lo, saveDir: lo ? SAVE_DIR : '' }));
  }
  if (url.pathname.startsWith('/save/')) return handleSave(req, res, url);
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
const SAVE_DIR = process.env.SAVE_DIR || path.join(os.homedir(), 'Downloads', 'OutsiderDrop');
const saves = new Map();
const isLoopback = req => /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '');
const clean = s => String(s || '').replace(/[\\:*?"<>|]/g, '_').split('/').filter(x => x && x !== '.' && x !== '..').join(path.sep);
function handleSave(req, res, url) {
  const done = (code, msg) => { res.writeHead(code, { 'Content-Type': 'text/plain' }); res.end(msg || ''); };
  if (req.method !== 'POST' || !isLoopback(req)) return done(403);
  const op = url.pathname.slice(6), id = url.searchParams.get('id');
  if (op === 'open') {
    const dir = path.join(SAVE_DIR, clean(url.searchParams.get('path')));
    fs.mkdirSync(dir, { recursive: true });
    const name = clean(url.searchParams.get('name')).replace(/[\\/]/g, '_') || 'file';
    const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
    let file = path.join(dir, name);
    for (let i = 1; fs.existsSync(file); i++) file = path.join(dir, `${base} (${i})${ext}`);
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
  console.log('\n  Biarkan jendela ini terbuka selama dipakai. Tutup untuk berhenti.\n');
  openBrowser(`http://localhost:${port}`);
});
server.listen(port, '0.0.0.0');
