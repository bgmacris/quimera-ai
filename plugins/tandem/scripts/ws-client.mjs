// ws-client.mjs — minimal WebSocket client (RFC 6455) for ws:// on loopback, no deps, NO permessage-deflate.
//
// Why not Node's built-in WebSocket: it always offers permessage-deflate (Chrome accepts it), and Node 24.16
// closes the whole connection (1006) on a compressed message over ~4 MB — a full-page screenshot, a PDF body.
// Measured 2026-11-09 with Chrome 157: 3 MB ok, 4.5 MB closed; Node 26.8.1 took 32 MB. There is no option to
// turn the extension off (a Sec-WebSocket-Extensions header is ignored: measured). Over loopback compression
// buys nothing, so this client never offers it and Chrome sends plain frames.
//
// The framing is ws-server.mjs's Conn, client side. API: the subset of the WHATWG WebSocket tandem uses —
//   const ws = new WsClient(url, { maxPayload });
//   ws.onopen / onmessage({ data }) / onclose({ code }) / onerror({ message }), or addEventListener(...)
//   ws.send(text)  ws.close()  ws.readyState (0 connecting, 1 open, 2 closing, 3 closed)
// Messages arrive as strings (text frames; CDP sends nothing else) or Buffers (binary).

import { createHash, randomBytes } from 'node:crypto';
import { connect as netConnect } from 'node:net';
import { Conn, DEFAULT_MAX_PAYLOAD } from './ws-server.mjs';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_HEAD = 16 * 1024;

export class WsClient {
  constructor(url, { maxPayload = DEFAULT_MAX_PAYLOAD } = {}) {
    this.readyState = 0; this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
    this.listeners = new Map(); this.conn = null;
    let u;
    try { u = new URL(url); } catch { queueMicrotask(() => this.#fail(`invalid url: ${url}`)); return; }
    if (u.protocol !== 'ws:') { queueMicrotask(() => this.#fail(`only ws:// is supported: ${url}`)); return; }
    const key = randomBytes(16).toString('base64');
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    const socket = this.socket = netConnect({ host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) || 80 });
    let head = Buffer.alloc(0);
    const onData = (d) => {
      head = Buffer.concat([head, d]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) { if (head.length > MAX_HEAD) this.#fail('handshake: response head too large'); return; }
      socket.off('data', onData);
      const lines = head.subarray(0, end).toString('latin1').split('\r\n');
      const status = lines.shift();
      const h = {};
      for (const l of lines) { const i = l.indexOf(':'); if (i > 0) h[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); }
      if (!/^HTTP\/1\.1 101\b/.test(status)) return this.#fail(`handshake: ${status}`);
      if (h['sec-websocket-accept'] !== accept) return this.#fail('handshake: bad Sec-WebSocket-Accept');
      if (h['sec-websocket-extensions']) return this.#fail(`handshake: extension not offered: ${h['sec-websocket-extensions']}`);
      const conn = this.conn = new Conn(socket, maxPayload, { client: true });
      conn.on('message', (data) => this.#emit('message', { data }));
      conn.on('close', () => { this.readyState = 3; this.#emit('close', { code: conn.code ?? 1006, reason: '' }); });
      this.readyState = 1;
      this.#emit('open', {});
      const rest = head.subarray(end + 4);
      if (rest.length && this.readyState === 1) socket.emit('data', rest);
    };
    socket.on('data', onData);
    socket.once('connect', () => {
      socket.write(`GET ${u.pathname || '/'}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n`
        + `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    socket.on('error', (e) => { if (!this.conn) this.#fail(e.message); });
    socket.on('close', () => { if (!this.conn) this.#fail('connection closed during the handshake'); });
  }

  #fail(message) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    try { this.socket?.destroy(); } catch {}
    this.#emit('error', { message });
    this.#emit('close', { code: 1006, reason: message });
  }

  #emit(type, ev) {
    const e = { type, target: this, ...ev };
    try { this[`on${type}`]?.(e); } catch (err) { queueMicrotask(() => { throw err; }); }
    for (const fn of this.listeners.get(type) || []) { try { fn(e); } catch (err) { queueMicrotask(() => { throw err; }); } }
  }

  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener(type, fn) { const l = this.listeners.get(type); if (l) this.listeners.set(type, l.filter((x) => x !== fn)); }

  // As the WHATWG one: sending while connecting throws, after close it is dropped.
  send(data) {
    if (this.readyState === 0) throw new Error('WebSocket is not open yet');
    this.conn?.send(data);
  }

  close(code = 1000) {
    if (this.conn) this.conn.close(code);
    else this.#fail('closed before open');
  }
}
