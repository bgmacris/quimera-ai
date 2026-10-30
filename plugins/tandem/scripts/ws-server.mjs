// ws-server.mjs — minimal WebSocket server (RFC 6455), no deps: Node 22+ has a WebSocket CLIENT built in,
// not a server, and tandem ships without node_modules. Just what the CDP relay (cdp-relay.mjs) needs:
// text/binary messages (fragmented or not, up to maxPayload), ping/pong, close. No extensions
// (permessage-deflate is never negotiated), no subprotocols.
//
// The relay hands out control of the browser, so who may connect is the point:
//   - loopback only (127.0.0.1);
//   - the path must carry the secret token (`/<token>/…`): another local process can't guess it;
//   - any request with an Origin header is refused: CDP clients (Playwright, the ws library) send none, and a
//     web page CAN open a WebSocket to localhost (no CORS for WebSockets) — Chrome guards its own CDP the same
//     way (--remote-allow-origins);
//   - Host must be 127.0.0.1:<port> or localhost:<port> (DNS rebinding).
//
// API (the subset of the `ws` library the relay uses):
//   const srv = await startWsServer({ token, maxPayload });  srv.port, srv.close()
//   srv.on('connection', (conn, path) => …)   path = what follows `/<token>`, e.g. '/agent/main'
//   conn.on('message', (text) => …)  conn.on('close', () => …)  conn.send(text)  conn.close()  conn.readyState (1 open)

import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const DEFAULT_MAX_PAYLOAD = 256 * 1024 * 1024;   // a full-page screenshot in base64 is tens of MB

export const newToken = () => randomBytes(18).toString('base64url');

function frame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;   // FIN + opcode; server frames are never masked
  if (len < 126) head[1] = len;
  else if (len < 65536) { head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}

class Conn extends EventEmitter {
  constructor(socket, maxPayload) {
    super();
    this.socket = socket; this.maxPayload = maxPayload; this.readyState = 1;
    this.buf = Buffer.alloc(0); this.parts = []; this.partsLen = 0; this.partsOp = 0;
    socket.setNoDelay(true);
    socket.on('data', (d) => { this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d; this.parse(); });
    socket.on('close', () => this.closed());
    socket.on('error', () => this.closed());
  }
  send(data) {
    if (this.readyState !== 1) return;
    const text = typeof data === 'string';
    this.socket.write(frame(text ? 0x1 : 0x2, text ? Buffer.from(data) : data));
  }
  close(code = 1000) {
    if (this.readyState !== 1) return;
    this.readyState = 2;
    const p = Buffer.alloc(2); p.writeUInt16BE(code);
    this.socket.end(frame(0x8, p));
    // The peer closes its side after our close frame; if it doesn't, don't keep the socket around.
    setTimeout(() => this.closed(), 1000).unref();
  }
  closed() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.socket.destroy();
    this.emit('close');
  }
  fail(code) { this.close(code); }
  parse() {
    while (this.readyState === 1) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0; const op = b[0] & 0x0f;
      if (b[0] & 0x70) return this.fail(1002);            // RSV bits: no extension was negotiated
      if (!(b[1] & 0x80)) return this.fail(1002);         // client frames MUST be masked
      let len = b[1] & 0x7f; let off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(this.maxPayload)) return this.fail(1009);
        len = Number(big); off = 10;
      }
      if (len > this.maxPayload) return this.fail(1009);
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op >= 0x8) {                                     // control frames: unfragmented, ≤ 125 bytes
        if (!fin || len > 125) return this.fail(1002);
        if (op === 0x8) { this.close(payload.length >= 2 ? payload.readUInt16BE(0) : 1000); return; }
        if (op === 0x9) { this.socket.write(frame(0xa, payload)); continue; }
        if (op === 0xa) continue;
        return this.fail(1002);
      }
      if (op === 0x0) { if (!this.partsOp) return this.fail(1002); }
      else if (op === 0x1 || op === 0x2) { if (this.partsOp) return this.fail(1002); this.partsOp = op; }
      else return this.fail(1002);
      this.parts.push(payload); this.partsLen += payload.length;
      if (this.partsLen > this.maxPayload) return this.fail(1009);
      if (!fin) continue;
      const msg = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts, this.partsLen);
      const wasText = this.partsOp === 0x1;
      this.parts = []; this.partsLen = 0; this.partsOp = 0;
      this.emit('message', wasText ? msg.toString('utf8') : msg);
    }
  }
}

export async function startWsServer({ token, maxPayload = DEFAULT_MAX_PAYLOAD } = {}) {
  if (!token || token.length < 16) throw new Error('ws-server: a secret token (≥ 16 chars) is required');
  const ev = new EventEmitter();
  const conns = new Set();
  const http = createServer((req, res) => { res.writeHead(426, { connection: 'close' }); res.end(); });
  let port = 0;
  const refuse = (socket, status) => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); };
  http.on('upgrade', (req, socket, head) => {
    const prefix = `/${token}`;
    const url = req.url || '';
    const host = String(req.headers.host || '').toLowerCase();
    if (req.headers.origin !== undefined) return refuse(socket, '403 Forbidden');
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return refuse(socket, '403 Forbidden');
    if (url !== prefix && !url.startsWith(`${prefix}/`)) return refuse(socket, '404 Not Found');
    const key = req.headers['sec-websocket-key'];
    if (String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') return refuse(socket, '400 Bad Request');
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const conn = new Conn(socket, maxPayload);
    conns.add(conn); conn.on('close', () => conns.delete(conn));
    ev.emit('connection', conn, url.slice(prefix.length) || '/');
    if (head?.length) socket.emit('data', head);
  });
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve); });
  port = http.address().port;
  return Object.assign(ev, {
    port,
    close() { for (const c of conns) c.closed(); http.close(); },
  });
}
