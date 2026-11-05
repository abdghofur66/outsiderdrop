// OutsiderDrop: signaling server (Cloudflare Worker + Durable Object).
// File & pesan TIDAK lewat server ini; hanya pertukaran SDP/ICE untuk WebRTC.
export class Room {
  constructor(state) { this.state = state; }

  async fetch(req) {
    const url = new URL(req.url);
    const all = this.state.getWebSockets();
    if (all.length >= 12) return new Response('Ruang penuh', { status: 429 });

    const { 0: client, 1: server } = new WebSocketPair();
    const id = crypto.randomUUID().slice(0, 8);
    const name = (url.searchParams.get('name') || 'Perangkat').slice(0, 40);
    const os = (url.searchParams.get('os') || '').slice(0, 20);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ id, name, os });

    const peers = all.map(w => w.deserializeAttachment()).filter(Boolean);
    server.send(JSON.stringify({ type: 'welcome', id, peers }));
    this.broadcast({ type: 'join', peer: { id, name, os } }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'ping') return ws.send('{"type":"pong"}');
    const from = ws.deserializeAttachment()?.id;
    if (!m.to || !from) return;
    for (const w of this.state.getWebSockets()) {
      if (w.deserializeAttachment()?.id === m.to) w.send(JSON.stringify({ ...m, from }));
    }
  }

  webSocketClose(ws) { this.leave(ws); }
  webSocketError(ws) { this.leave(ws); }

  leave(ws) {
    const a = ws.deserializeAttachment();
    if (a) this.broadcast({ type: 'leave', id: a.id }, ws);
    try { ws.close(); } catch {}
  }

  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const w of this.state.getWebSockets()) if (w !== except) { try { w.send(s); } catch {} }
  }
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const m = u.pathname.match(/^\/ws\/([A-Z0-9]{4,12})$/i);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Butuh WebSocket', { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(m[1].toUpperCase())).fetch(req);
    }
    if (u.pathname === '/turn') return turn(env);
    return env.ASSETS.fetch(req);
  }
};

// Kredensial TURN Cloudflare (opsional). Isi secret TURN_KEY_ID & TURN_KEY_API_TOKEN.
async function turn(env) {
  const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return new Response('{}', { status: 404, headers: h });
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 86400 })
  });
  if (!r.ok) return new Response('{}', { status: 502, headers: h });
  return new Response(await r.text(), { headers: h });
}
