#!/usr/bin/env node
// focus.test.mjs — the launcher's stdio proxy (focus-emulation.mjs) without Chrome: it must stay a
// transparent pipe (every line, in order, byte for byte) and call begin/end exactly once per tool call.
// The real click on a background tab is tests/focus-e2e.mjs (needs Chrome).
// No dependencies: mini-runner. Usage: node tests/focus.test.mjs

import { PassThrough } from 'node:stream';

const { proxyStdio, focusEmulator } = await import('../scripts/focus-emulation.mjs');

let pass = 0; let fail = 0;
function ok(desc, cond) {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}\n`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function harness({ beginMs = 0 } = {}) {
  const s = { clientIn: new PassThrough(), clientOut: new PassThrough(), serverIn: new PassThrough(), serverOut: new PassThrough() };
  const log = [];
  const toServer = []; const toClient = [];
  s.serverIn.on('data', (d) => { for (const l of String(d).split('\n').filter(Boolean)) { toServer.push(l); log.push(`server<-${l}`); } });
  s.clientOut.on('data', (d) => { for (const l of String(d).split('\n').filter(Boolean)) toClient.push(l); });
  const emulator = {
    async begin() { log.push('begin'); await sleep(beginMs); },
    end(name, args, result) { log.push(`end:${name}:${JSON.stringify(args)}:${JSON.stringify(result)}`); },
  };
  proxyStdio({ ...s, emulator });
  return { ...s, log, toServer, toClient };
}
const msg = (o) => JSON.stringify(o) + '\n';

console.log('proxyStdio');
{
  const h = harness();
  const call = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'browser_click', arguments: { target: 'e3' } } });
  h.clientIn.write(call + '\n');
  await sleep(20);
  ok('begin runs BEFORE the tools/call reaches the MCP', h.log[0] === 'begin' && h.log[1] === `server<-${call}`);
  ok('the request line reaches the MCP byte for byte', h.toServer[0] === call);
  const resp = JSON.stringify({ jsonrpc: '2.0', id: 7, result: { content: [{ type: 'text', text: 'ok' }] } });
  h.serverOut.write(resp + '\n');
  await sleep(20);
  ok('the response reaches the client byte for byte', h.toClient[0] === resp);
  ok('end gets the tool name, its arguments and the result', h.log.includes(`end:browser_click:{"target":"e3"}:{"content":[{"type":"text","text":"ok"}]}`));
}
{
  const h = harness({ beginMs: 80 });
  h.clientIn.write(msg({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser_snapshot', arguments: {} } }));
  h.clientIn.write(msg({ jsonrpc: '2.0', method: 'notifications/progress', params: {} }));
  h.clientIn.write('not json at all\r\n');
  await sleep(150);
  ok('order kept: a message right after a held tools/call does not overtake it',
    JSON.parse(h.toServer[0]).id === 1 && /notifications\/progress/.test(h.toServer[1]));
  ok('a non-JSON line is forwarded untouched (\\r kept)', h.toServer[2] === 'not json at all\r');
}
{
  const h = harness();
  h.clientIn.write(msg({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'browser_click', arguments: {} } }));
  await sleep(10);
  // A server→client REQUEST may reuse the id: it has a method, it is not the answer.
  h.serverOut.write(msg({ jsonrpc: '2.0', id: 3, method: 'roots/list' }));
  await sleep(10);
  ok('a server request with the same id does not end the call', !h.log.some((l) => l.startsWith('end:')));
  h.clientIn.write(msg({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 3 } }));
  await sleep(10);
  h.serverOut.write(msg({ jsonrpc: '2.0', id: 3, result: {} }));
  await sleep(10);
  ok('a cancelled call ends once (the late response does not end it again)', h.log.filter((l) => l.startsWith('end:')).length === 1);
}
{
  const h = harness();
  h.clientIn.write(msg({ jsonrpc: '2.0', id: 9, method: 'tools/list' }));
  await sleep(10);
  h.serverOut.write(msg({ jsonrpc: '2.0', id: 9, result: { tools: [] } }));
  await sleep(10);
  ok('only tools/call is watched (tools/list: no begin/end)', !h.log.includes('begin') && !h.log.some((l) => l.startsWith('end:')));
  let ended = false; h.serverIn.on('end', () => { ended = true; }); h.serverIn.resume();
  h.clientIn.end();
  await sleep(20);
  ok('client EOF closes the MCP stdin', ended);
}

console.log('focusEmulator without a browser');
{
  const e = focusEmulator({ port: 9, budgetMs: 200 });   // nothing listens on port 9
  const t0 = Date.now();
  let threw = false;
  try { await e.begin(); } catch { threw = true; }
  const ms = Date.now() - t0;
  ok(`begin never throws and stays within its budget (${ms} ms)`, !threw && ms < 400);
  e.end('browser_navigate', { url: 'https://example.com/' }, null);
  ok('nothing held', e.held === 0);
  e.close();
}

console.log(`\n${pass} ok, ${fail} failures`);
process.exit(fail ? 1 : 0);
