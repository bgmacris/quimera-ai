#!/usr/bin/env node
// focus.test.mjs — the launcher's stdio proxy (focus-emulation.mjs) without Chrome: it must stay a
// transparent pipe (every line, in order, byte for byte) and call begin/end exactly once per tool call.
// The real click on a background tab is tests/focus-e2e.mjs (needs Chrome).
// No dependencies: mini-runner. Usage: node tests/focus.test.mjs

import { PassThrough } from 'node:stream';

const { proxyStdio, focusEmulator, combine } = await import('../scripts/focus-emulation.mjs');

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

console.log('proxy notes (pdf-capture.mjs adds "PDF captured" to a result)');
{
  const s = { clientIn: new PassThrough(), clientOut: new PassThrough(), serverIn: new PassThrough(), serverOut: new PassThrough() };
  const toClient = [];
  s.clientOut.on('data', (d) => { for (const l of String(d).split('\n').filter(Boolean)) toClient.push(l); });
  s.serverIn.resume();
  let notes = ['### tandem: PDF captured'];
  const emulator = combine(
    { async begin() {}, end() {} },
    { async begin() {}, end() {}, notes: () => notes.splice(0) },
  );
  proxyStdio({ ...s, emulator });
  s.clientIn.write(msg({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser_click', arguments: {} } }));
  s.clientIn.write(msg({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'browser_snapshot', arguments: {} } }));
  await sleep(20);
  s.serverOut.write(msg({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } }));
  const plain = JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'ok2' }] } });
  s.serverOut.write(plain + '\n');
  await sleep(20);
  const r1 = JSON.parse(toClient[0]).result.content;
  ok('a result with notes gets them appended as text blocks', r1.length === 2 && r1[1].type === 'text' && r1[1].text.startsWith('### tandem: PDF captured'));
  ok('a result without notes still passes byte for byte', toClient[1] === plain);
}

console.log('proxy probe (asks the MCP which tab is the agent\'s; the answer never reaches the client)');
{
  const s = { clientIn: new PassThrough(), clientOut: new PassThrough(), serverIn: new PassThrough(), serverOut: new PassThrough() };
  const toClient = []; const toServer = [];
  s.clientOut.on('data', (d) => { for (const l of String(d).split('\n').filter(Boolean)) toClient.push(l); });
  s.serverIn.on('data', (d) => { for (const l of String(d).split('\n').filter(Boolean)) toServer.push(JSON.parse(l)); });
  let locate; let located;
  const emulator = { useLocator(fn) { locate = fn; }, async begin() { located = await locate('http://a.example/old'); }, end() {} };
  proxyStdio({ ...s, emulator });
  s.clientIn.write(msg({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'browser_evaluate', arguments: {} } }));
  await sleep(20);
  const probe = toServer[0];
  ok('the probe goes to the MCP first: browser_tabs list, its own id', probe?.id === 'tandem-probe-1' && probe.params?.name === 'browser_tabs' && probe.params?.arguments?.action === 'list');
  s.serverOut.write(msg({ jsonrpc: '2.0', id: probe.id, result: { content: [{ type: 'text', text: '### Result\n- 0: [](http://a.example/x)\n- 1: (current) [t](blob:http://a.example/1234)' }] } }));
  await sleep(20);
  ok('…then the agent\'s call; the probe answer is not forwarded', toServer[1]?.id === 5 && toClient.length === 0);
  ok('the locator returns the (current) tab, blob: included', located === 'blob:http://a.example/1234');
  s.serverOut.write(msg({ jsonrpc: '2.0', id: 5, result: { content: [{ type: 'text', text: '### Result\n1' }] } }));
  await sleep(20);
  const r = JSON.parse(toClient[0]).result.content;
  ok('the tab moved: the agent\'s result gets the ### Page the probe swallowed', r.at(-1)?.text === '### Page\n- Page URL: blob:http://a.example/1234');
}

console.log('pdf-capture.mjs');
{
  const { isPdfResponse, pdfFileName, pdfCapturer } = await import('../scripts/pdf-capture.mjs');
  const H = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
  ok('200 application/pdf → captured', isPdfResponse({ responseStatusCode: 200, responseHeaders: H({ 'Content-Type': 'application/pdf' }) }));
  ok('attachment named .pdf, octet-stream → captured', isPdfResponse({ responseStatusCode: 200, responseHeaders: H({ 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="factura.pdf"' }) }));
  ok('html, a .csv attachment, a 404 PDF, a redirect → not', ![
    { responseStatusCode: 200, responseHeaders: H({ 'content-type': 'text/html' }) },
    { responseStatusCode: 200, responseHeaders: H({ 'content-disposition': 'attachment; filename="x.csv"' }) },
    { responseStatusCode: 404, responseHeaders: H({ 'content-type': 'application/pdf' }) },
    { responseStatusCode: 302, responseHeaders: H({ location: '/x.pdf' }) },
  ].some(isPdfResponse));
  const at = new Date('2026-10-30T12:00:00Z');
  ok('file name from Content-Disposition', pdfFileName('https://sede.example/gen', H({ 'content-disposition': 'attachment; filename="Modelo 303.pdf"' }), at) === '2026-10-30T12-00-00-sede.example-Modelo_303.pdf');
  const trav = pdfFileName('https://www.boe.es/pdfs/..%2F..%2Fetc%2Fpasswd', [], at);
  ok('file name from the URL, never a path (one component, fixed prefix)', !/[\\/]/.test(trav) && trav.startsWith('2026-10-30T12-00-00-www.boe.es-') && trav.endsWith('.pdf'));
  ok('file name from the URL path', pdfFileName('https://www.boe.es/pdfs/BOE-A-2022-10757.pdf', [], at) === '2026-10-30T12-00-00-www.boe.es-BOE-A-2022-10757.pdf');
  ok('no name at all → document', pdfFileName('https://x.example/', [], at) === '2026-10-30T12-00-00-x.example-document.pdf');
  const cap = pdfCapturer({ port: 9, budgetMs: 100, outDir: '/nonexistent' });
  const res = (url) => ({ content: [{ type: 'text', text: `### Page\n- Page URL: ${url}` }] });
  const n1 = cap.notes('browser_snapshot', {}, res('https://x.example/a.pdf'));
  ok('a .pdf tab not captured → how to get it (tandem-pdf --url), once', n1.length === 1 && n1[0].includes("tandem-pdf --url 'https://x.example/a.pdf'") && cap.notes('browser_snapshot', {}, res('https://x.example/a.pdf')).length === 0);
  ok('an html tab → no note', cap.notes('browser_snapshot', {}, res('https://x.example/a')).length === 0);
  cap.close();
}

console.log(`\n${pass} ok, ${fail} failures`);
process.exit(fail ? 1 : 0);
