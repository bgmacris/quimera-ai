#!/usr/bin/env node
// ws-server.test.mjs — the relay's WebSocket server (scripts/ws-server.mjs), no Chrome needed.
// Who may connect (token, Origin, Host), framing (sizes, fragments, masking, ping, close, maxPayload), and a
// real client: Node's built-in WebSocket. Playwright against the relay is covered by the relay tests.
// No dependencies: mini-runner. Usage: node tests/ws-server.test.mjs

import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';

const { startWsServer, newToken } = await import('../scripts/ws-server.mjs');

let pass = 0; let fail = 0;
function ok(desc, cond) {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}\n`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A client frame: always masked unless told otherwise.
function cframe(opcode, payload, { fin = true, masked = true } = {}) {
  const len = payload.length;
  const head = Buffer.alloc(len < 126 ? 2 : len < 65536 ? 4 : 10);
  head[0] = (fin ? 0x80 : 0) | opcode;
  if (len < 126) head[1] = len; else if (len < 65536) { head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  if (!masked) return Buffer.concat([head, payload]);
  head[1] |= 0x80;
  const mask = randomBytes(4); const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
  return Buffer.concat([head, mask, body]);
}

// Raw handshake → { status, sock, frames: [{op, payload}], closed }.
function raw(port, path, headers = {}) {
  return new Promise((resolve) => {
    const sock = connect(port, '127.0.0.1');
    const st = { status: 0, sock, frames: [], closed: false };
    let buf = Buffer.alloc(0); let upgraded = false;
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!upgraded) {
        const end = buf.indexOf('\r\n\r\n'); if (end < 0) return;
        st.status = Number(buf.subarray(0, end).toString().split(' ')[1]);
        buf = buf.subarray(end + 4); upgraded = true; resolve(st);
      }
      while (buf.length >= 2) {
        let len = buf[1] & 0x7f; let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        st.frames.push({ op: buf[0] & 0x0f, payload: buf.subarray(off, off + len) });
        buf = buf.subarray(off + len);
      }
    });
    sock.on('close', () => { st.closed = true; resolve(st); });
    sock.on('error', () => {});
    const h = { Host: `127.0.0.1:${port}`, Upgrade: 'websocket', Connection: 'Upgrade',
      'Sec-WebSocket-Key': randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13', ...headers };
    sock.write(`GET ${path} HTTP/1.1\r\n${Object.entries(h).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
  });
}
const waitFor = async (pred, ms = 2000) => { const t = Date.now(); while (!pred() && Date.now() - t < ms) await sleep(10); return pred(); };

const token = newToken();
const srv = await startWsServer({ token, maxPayload: 4 * 1024 * 1024 });
const paths = [];
srv.on('connection', (conn, path) => {
  paths.push(path);
  conn.on('message', (m) => conn.send(typeof m === 'string' ? `echo:${m}` : m));   // text echo, binary as is
});
const P = srv.port;

console.log('who may connect');
ok('token + path → 101, path handed over', (await raw(P, `/${token}/agent/main`)).status === 101 && paths.at(-1) === '/agent/main');
ok('wrong token → 404', (await raw(P, `/nope${token}/agent/main`)).status === 404);
ok('token as a prefix of a longer segment → 404', (await raw(P, `/${token}x/agent`)).status === 404);
ok('Origin header (a web page) → 403', (await raw(P, `/${token}/a`, { Origin: 'https://evil.example' })).status === 403);
ok('Origin: null → 403', (await raw(P, `/${token}/a`, { Origin: 'null' })).status === 403);
ok('foreign Host (DNS rebinding) → 403', (await raw(P, `/${token}/a`, { Host: `evil.example:${P}` })).status === 403);
ok('localhost Host → 101', (await raw(P, `/${token}/a`, { Host: `localhost:${P}` })).status === 101);
ok('wrong version → 400', (await raw(P, `/${token}/a`, { 'Sec-WebSocket-Version': '8' })).status === 400);
ok('no key → 400', (await raw(P, `/${token}/a`, { 'Sec-WebSocket-Key': null })).status === 400);
let threw = false; try { await startWsServer({ token: 'short' }); } catch { threw = true; }
ok('a short token is refused', threw);

console.log('framing');
for (const n of [5, 200, 70_000]) {
  const c = await raw(P, `/${token}/f`); const s = 'x'.repeat(n);
  c.sock.write(cframe(0x1, Buffer.from(s)));
  ok(`text of ${n} bytes echoed`, await waitFor(() => c.frames.some((f) => f.op === 1 && f.payload.toString() === `echo:${s}`)));
  c.sock.destroy();
}
{
  const c = await raw(P, `/${token}/f`);
  c.sock.write(Buffer.concat([cframe(0x1, Buffer.from('ab'), { fin: false }), cframe(0x9, Buffer.from('p')), cframe(0x0, Buffer.from('cd'), { fin: false }), cframe(0x0, Buffer.from('é'))]));
  ok('fragmented text with a ping in between → one message', await waitFor(() => c.frames.some((f) => f.op === 1 && f.payload.toString() === 'echo:abcdé')));
  ok('ping answered with pong, same payload', c.frames.some((f) => f.op === 0xa && f.payload.toString() === 'p'));
  const before = c.frames.length;
  const half = cframe(0x1, Buffer.from('split-across-writes')); c.sock.write(half.subarray(0, 3)); await sleep(30); c.sock.write(half.subarray(3));
  ok('a frame split across TCP writes', await waitFor(() => c.frames.slice(before).some((f) => f.payload.toString() === 'echo:split-across-writes')));
  c.sock.destroy();
}
{
  const c = await raw(P, `/${token}/f`); const bin = randomBytes(1000);
  c.sock.write(cframe(0x2, bin));
  ok('binary echoed as binary', await waitFor(() => c.frames.some((f) => f.op === 2 && f.payload.equals(bin))));
  c.sock.destroy();
}
{
  const c = await raw(P, `/${token}/f`);
  c.sock.write(cframe(0x1, Buffer.from('hi'), { masked: false }));
  ok('unmasked client frame → close 1002', await waitFor(() => c.frames.some((f) => f.op === 8 && f.payload.readUInt16BE(0) === 1002)));
}
{
  const c = await raw(P, `/${token}/f`);
  c.sock.write(cframe(0x1, Buffer.alloc(5 * 1024 * 1024, 97)));
  ok('over maxPayload → close 1009', await waitFor(() => c.frames.some((f) => f.op === 8 && f.payload.readUInt16BE(0) === 1009)));
}
{
  const c = await raw(P, `/${token}/f`);
  const h = Buffer.from([0x81, 0xff, 0, 0, 0, 1, 0, 0, 0, 0]);   // 64-bit length of 4 GB, no body yet
  c.sock.write(h);
  ok('a declared 4 GB frame is refused before buffering it', await waitFor(() => c.frames.some((f) => f.op === 8 && f.payload.readUInt16BE(0) === 1009)));
}
{
  const c = await raw(P, `/${token}/f`);
  c.sock.write(cframe(0x0, Buffer.from('orphan')));
  ok('continuation without a start → close 1002', await waitFor(() => c.frames.some((f) => f.op === 8 && f.payload.readUInt16BE(0) === 1002)));
}
{
  const c = await raw(P, `/${token}/f`); const p = Buffer.alloc(2); p.writeUInt16BE(1000);
  c.sock.write(cframe(0x8, p));
  ok('client close → close frame back, socket closed', await waitFor(() => c.closed) && c.frames.some((f) => f.op === 8));
}

console.log('real client (Node WebSocket)');
{
  const big = 'y'.repeat(3 * 1024 * 1024);
  const ws = new WebSocket(`ws://127.0.0.1:${P}/${token}/agent/sub-1`);
  const got = [];
  ws.onmessage = (e) => got.push(e.data);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.send('hello'); ws.send(big);
  ok('Node WebSocket: small + 3 MB round trip (server→client 64-bit length)', await waitFor(() => got.length === 2, 5000) && got[0] === 'echo:hello' && got[1] === `echo:${big}`);
  ok('path decoded for the relay', paths.at(-1) === '/agent/sub-1');
  const closed = new Promise((r) => { ws.onclose = (e) => r(e.code); });
  ws.close(1000);
  ok('Node WebSocket: clean close', (await closed) === 1000);
}
{
  const ws = new WebSocket(`ws://127.0.0.1:${P}/${token}/x`);
  await new Promise((r) => { ws.onopen = r; });
  const closed = new Promise((r) => { ws.onclose = (e) => r(e.code); });
  srv.close();
  ok('server close drops open connections', [1001, 1005, 1006].includes(await closed));
}

console.log(`\nresult: ${pass} ok, ${fail} failures`);
process.exit(fail ? 1 : 0);
