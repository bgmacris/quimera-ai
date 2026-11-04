#!/usr/bin/env node
// adopt-e2e.mjs — phase 4 through the REAL launcher (multi-session): the human hands a tab over with
// browser_tab_adopt (R05 §16). Only the human's tab in view can be taken; closing it gives it back.
//   A1 tools/list has browser_tab_adopt
//   A2 agent A takes the human's tab in view: it lists it, it is its current tab, it reads it
//   A3 agent B can't take it (it is A's now) and finds no tab of the human in view
//   A4 A closes it → NOT closed: back to the human, A no longer lists it
//   A5 a hidden tab of the human can't be taken, even named by url
//   A6 a page that fakes visibilityState/hasFocus in its own JS can't make itself "in view" (isolated world)
//   A7 two of the human's windows in view: no url → nothing taken, both listed; url → that one
//   A8 B's browser_close (with CDP it only disconnects Playwright: measured) gives the adopted tab back;
//      B's own tab stays open, as in 0.9.x
// Needs a DISPOSABLE Chrome on TANDEM_CDP_PORT (tests/e2e.sh): it starts by closing every tab but one.
// Usage: node tests/adopt-e2e.mjs   (exit 0 = green)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { connect, browserWsUrl } from '../scripts/cdp.mjs';
import { cdpPort, dataDir } from '../scripts/paths.mjs';
import { tabOwners } from '../scripts/tab-owners.mjs';

const PORT = cdpPort(); const DATA = process.env.TANDEM_DATA_DIR || dataDir();
if (PORT === 9222 || !process.env.TANDEM_DATA_DIR) { console.error('adopt-e2e: refuses to run on port 9222 or without a TANDEM_DATA_DIR (it closes tabs)'); process.exit(2); }
const launcher = fileURLToPath(new URL('../scripts/mcp-launch.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; let fail = 0;
const ok = (desc, cond, extra = '') => {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}${extra ? ` — ${extra}` : ''}\n`); if (process.env.GITHUB_ACTIONS) process.stdout.write(`::error title=adopt-e2e::${desc}\n`); }
};

const SPOOF = `<script>Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'visible' });
Object.defineProperty(document, 'visibilityState', { get: () => 'visible' }); Document.prototype.hasFocus = () => true; document.hasFocus = () => true;</script>`;
const site = createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<title>t${req.url}</title>${req.url.startsWith('/spoof') ? SPOOF : ''}<h1>page ${req.url}</h1>`);
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const U = (p) => `http://127.0.0.1:${site.address().port}${p}`;

// The human, over plain CDP.
const cdp = await connect(await browserWsUrl());
const pages = async () => (await cdp.call('Target.getTargets')).targetInfos.filter((t) => t.type === 'page');
const human = async (path, opts = {}) => { const { targetId } = await cdp.call('Target.createTarget', { url: U(path), ...opts }); await sleep(600); return targetId; };
// Clean slate: one blank tab left (the human's first window).
const all = await pages();
for (const t of all.slice(1)) await cdp.call('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
await sleep(500);

const p = spawn(process.execPath, [launcher], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = ''; const waiters = new Map(); let id = 0;
const send = (m) => p.stdin.write(JSON.stringify(m) + '\n');
p.stdout.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(l); } catch { continue; }
    if (m.method === 'roots/list') { send({ jsonrpc: '2.0', id: m.id, result: { roots: [] } }); continue; }
    if (m.id !== undefined && !m.method) { waiters.get(m.id)?.(m); waiters.delete(m.id); }
  }
});
const rpc = (method, params, ms = 90000) => new Promise((res) => {
  const n = ++id; const t = setTimeout(() => res({ timeout: true }), ms);
  waiters.set(n, (m) => { clearTimeout(t); res(m); }); send({ jsonrpc: '2.0', id: n, method, params });
});
const call = async (agent, name, args = {}) => { const r = await rpc('tools/call', { name, arguments: { ...args, agent } }); return { r, t: (r.result?.content || []).map((c) => c.text || '').join('\n'), err: !!r.timeout || !!r.error || !!r.result?.isError }; };
const tabsOf = async (agent) => [...(await call(agent, 'browser_tabs', { action: 'list' })).t.matchAll(/^- (\d+): .*?\((\S+?)\)\s*$/gm)].map((m) => ({ i: +m[1], url: m[2] }));
const A = 'a0e815c57e8d30939'; const B = 'ac1b5e98441c8d67c';
const reg = tabOwners(DATA);

try {
  console.log('phase 4 — the human hands a tab over (browser_tab_adopt)');
  await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: { roots: {} }, clientInfo: { name: 'adopt-e2e', version: '0' } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const tools = (await rpc('tools/list', {})).result?.tools || [];
  ok('A1 tools/list has browser_tab_adopt', tools.some((t) => t.name === 'browser_tab_adopt'));
  // An agent whose FIRST browser call is the adoption (the MCP asks roots/list on its first call): it hung 30 s and failed.
  const h0 = await human('/h0');
  const t0 = Date.now();
  const first = await call('af1rst0000000000a', 'browser_tab_adopt');
  ok('A1b adopting as an agent\'s first browser call works, without hanging', !first.err && first.t.includes(U('/h0')) && Date.now() - t0 < 10_000, `${Date.now() - t0} ms: ${first.t.slice(0, 200)}`);
  await cdp.call('Target.closeTarget', { targetId: h0 }); await sleep(300);
  await call(A, 'browser_navigate', { url: U('/a-own') });
  await call(B, 'browser_navigate', { url: U('/b-own') });

  const h1 = await human('/h1');   // the human's window: h1 in front
  const got = await call(A, 'browser_tab_adopt');
  const la = await tabsOf(A);
  ok('A2 A takes the human\'s tab in view', !got.err && got.t.includes(U('/h1')), got.t.slice(0, 300));
  ok('A2 …lists it, as its current tab', la.some((t) => t.url === U('/h1')) && /\(current\)[^\n]*\/h1/.test((await call(A, 'browser_tabs', { action: 'list' })).t), JSON.stringify(la));
  ok('A2 …and reads it', (await call(A, 'browser_snapshot')).t.includes('page /h1'));
  ok('A2 the registry says it is A\'s now', reg.lookup(h1)?.agent === A);

  const b1 = await call(B, 'browser_tab_adopt');
  ok('A3 B can\'t take it: no tab of the human in view', b1.err && /no tab of the human is in view/.test(b1.t), b1.t.slice(0, 200));
  ok('A3 …and B does not see it', !(await tabsOf(B)).some((t) => t.url === U('/h1')));

  const idx = (await tabsOf(A)).find((t) => t.url === U('/h1'))?.i;
  const closed = await call(A, 'browser_tabs', { action: 'close', index: idx });
  await sleep(500);
  ok('A4 A closes it: the call succeeds', !closed.err, closed.t.slice(0, 200));
  ok('A4 …but it is NOT closed in Chrome', (await pages()).some((t) => t.targetId === h1));
  ok('A4 …it is the human\'s again, and A no longer lists it', reg.classify(h1) === 'human' && !(await tabsOf(A)).some((t) => t.url === U('/h1')));

  await human('/h2'); await human('/h3');   // h3 in front, h2 behind it
  const hid = await call(B, 'browser_tab_adopt', { url: '/h2' });
  ok('A5 a hidden tab of the human can\'t be taken, even by url', hid.err && /not in view/.test(hid.t), hid.t.slice(0, 200));

  const sp = await human('/spoof'); await human('/h5');   // the spoofing page goes behind h5
  const { sessionId: ss } = await cdp.call('Target.attachToTarget', { targetId: sp, flatten: true });
  const faked = (await cdp.call('Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true }, ss)).result?.value;
  await cdp.call('Target.detachFromTarget', { sessionId: ss });
  const spoof = await call(B, 'browser_tab_adopt', { url: '/spoof' });
  ok(`A6 a page faking "visible" in its own JS (main world says ${faked}) is still not in view`, faked === 'visible' && spoof.err && /not in view/.test(spoof.t), spoof.t.slice(0, 200));

  const h6 = await human('/h6', { newWindow: true });   // a second window of the human, in view
  const amb = await call(B, 'browser_tab_adopt');
  ok('A7 two of the human\'s windows in view, no url → nothing taken, both listed', amb.err && amb.t.includes(U('/h5')) && amb.t.includes(U('/h6')) && !(await tabsOf(B)).some((t) => t.url === U('/h6')), amb.t.slice(0, 300));
  const pick = await call(B, 'browser_tab_adopt', { url: '/h6' });
  ok('A7 …url picks one of them', !pick.err && (await tabsOf(B)).some((t) => t.url === U('/h6')), pick.t.slice(0, 200));

  const bc = await call(B, 'browser_close');
  await sleep(800);
  const left = await pages();
  ok('A8 B\'s browser_close: the adopted tab is given back, not closed', !bc.err && left.some((t) => t.targetId === h6) && reg.classify(h6) === 'human', bc.t.slice(0, 200));
  const again = await tabsOf(B);   // B's MCP reconnects on its next call
  ok('A8 …B, back, sees its own tab again but not the human\'s', again.some((t) => t.url === U('/b-own')) && !again.some((t) => t.url === U('/h6')), JSON.stringify(again));
} catch (e) {
  ok(`no exception: ${e.stack}`, false);
} finally {
  p.kill(); cdp.close(); site.close();
  console.log(`adopt-e2e: ${pass} ok, ${fail} failures`);
  setTimeout(() => process.exit(fail ? 1 : 0), 200);
}
