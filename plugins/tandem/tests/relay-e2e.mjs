#!/usr/bin/env node
// relay-e2e.mjs — the CDP relay (scripts/cdp-relay.mjs) with REAL @playwright/mcp children, one per agent,
// as the multi-session launcher will run them (R05 §5, §15). Brings its own tiny site.
//   R1 concurrent first calls: each agent lands on ITS page and lists only its own tab (repeated)
//   R2 popups (opener and rel=noopener) go to their owner, nobody else sees them
//   R3 the human's tab: invisible to every agent, and it loads (not left paused)
//   R4 the human closes an agent's tab: that agent carries on, the others don't notice
//   R5 interleaved navigate+snapshot of two agents in parallel stay on their own pages
//   R6 clicks of every agent, serial and parallel, with focus emulation through relay.pagesOf()
//   R7 a raw CDP client through the relay: getTargets filtered, foreign close/attach refused, unknown
//      session refused, Browser.close refused
//   R8 the shared registry: our pages claimed (mine), the human's unclaimed; a big message (full-page
//      screenshot) crosses the relay
// Needs Chrome on TANDEM_CDP_PORT (tests/e2e.sh starts it) and TANDEM_DATA_DIR. Exit 0 = green.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { startRelay } from '../scripts/cdp-relay.mjs';
import { cdpPort, dataDir } from '../scripts/paths.mjs';
import { MCP_VERSION_PIN } from '../scripts/mcp-launch.mjs';
import { tabOwners } from '../scripts/tab-owners.mjs';

const ROUNDS = +(process.env.RELAY_E2E_ROUNDS || 3);
const PORT = cdpPort();
const DATA = process.env.TANDEM_DATA_DIR || dataDir();
const CDP = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; let fail = 0;
const ok = (desc, cond, extra = '') => {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}${extra ? ` — ${extra}` : ''}\n`); if (process.env.GITHUB_ACTIONS) process.stdout.write(`::error title=relay-e2e::${desc}\n`); }
};

const site = createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  const p = req.url;
  if (p.startsWith('/tall')) return res.end(`<title>tall</title><div style="height:12000px;background:linear-gradient(red,blue)"></div>`);
  // Random pixels don't compress: a screenshot of this is many MB (the big-message check).
  if (p.startsWith('/noise')) return res.end(`<title>noise</title><body style="margin:0"><canvas id=c width=1600 height=2400></canvas><script>
    const c = document.getElementById('c').getContext('2d'); const d = c.createImageData(1600, 2400);
    crypto.getRandomValues(new Uint8Array(d.data.buffer, 0, 65536));
    for (let i = 0; i < d.data.length; i += 65536) crypto.getRandomValues(new Uint8Array(d.data.buffer, i, Math.min(65536, d.data.length - i)));
    for (let i = 3; i < d.data.length; i += 4) d.data[i] = 255; c.putImageData(d, 0, 0); document.title = 'noise-ready';</script>`);
  const links = p.startsWith('/pop') ? `<a href="/child${p}" target="_blank">abrir</a> <a href="/child2${p}" target="_blank" rel="noopener">abrir2</a>` : '';
  res.end(`<title>page${p}</title><h1>${p}</h1>${links}<button onclick="document.title='clicked'">ok</button>`);
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const U = (p) => `http://127.0.0.1:${site.address().port}${p}`;

const relay = await startRelay({ port: PORT, dataDir: DATA, log: (s) => process.stderr.write(`relay: ${s}\n`) });

const children = new Map();
function child(agent) {
  if (children.has(agent)) return children.get(agent);
  const p = spawn('npx', ['-y', `@playwright/mcp@${MCP_VERSION_PIN}`, '--cdp-endpoint', relay.endpoint(agent),
    '--output-dir', `${DATA}/output`, '--no-webmcp', '--timeout-action', '10000'], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = ''; let id = 0; const waiters = new Map();
  p.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (m.id !== undefined) { waiters.get(m.id)?.(m); waiters.delete(m.id); } } catch {} }
  });
  const rpc = (method, params, ms = 60000) => new Promise((res, rej) => {
    const n = ++id; waiters.set(n, res); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    setTimeout(() => rej(new Error(`${agent} ${method} ${params?.name || ''} timeout`)), ms);
  });
  const c = { p, rpc, ready: rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: `relay-e2e:${agent}`, version: '0' } })
    .then(() => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')) };
  children.set(agent, c);
  return c;
}
const call = async (agent, name, args = {}) => {
  const c = child(agent); await c.ready;
  const m = await c.rpc('tools/call', { name, arguments: args });
  return { err: !!(m.error || m.result?.isError), text: (m.result?.content || []).map((x) => x.text || '').join('\n') || m.error?.message || '', content: m.result?.content || [] };
};
const pageUrl = (t) => t.match(/^- Page URL: (\S+)/m)?.[1];
const tabUrls = (t) => [...t.matchAll(/^- \d+: (?:\(current\) )?\[[^\]]*\]\((\S+)\)$/gm)].map((m) => m[1]);
const listTabs = async (agent) => tabUrls((await call(agent, 'browser_tabs', { action: 'list' })).text);
const chromePages = async () => (await (await fetch(`${CDP}/json/list`)).json()).filter((p) => p.type === 'page');
const withFocus = async (agent, fn) => {
  await Promise.all(relay.pagesOf(agent).map((p) => p.call('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})));
  try { return await fn(); } finally { await Promise.all(relay.pagesOf(agent).map((p) => p.call('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {}))); }
};

try {
  console.log(`R1 concurrent first calls: ${ROUNDS} rounds × 3 new agents`);
  let good = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const agents = ['A', 'B', 'C'].map((x) => `${x}${r}`);
    const res = await Promise.all(agents.map((a) => call(a, 'browser_navigate', { url: U(`/r${r}-${a}`) })));
    const lists = await Promise.all(agents.map(listTabs));
    const fine = agents.every((a, i) => !res[i].err && pageUrl(res[i].text) === U(`/r${r}-${a}`) && lists[i].length === 1 && lists[i][0] === U(`/r${r}-${a}`));
    if (fine) good++; else console.log('   round', r, agents.map((a, i) => ({ a, err: res[i].err, url: pageUrl(res[i].text), list: lists[i] })));
  }
  ok(`R1 ${good}/${ROUNDS} rounds: every agent on its own page, sees only it`, good === ROUNDS);
  const urls = (await chromePages()).map((p) => p.url).filter((u) => u.startsWith(U('/')));
  ok('R1 no page navigated twice (nobody drove another agent\'s tab)', new Set(urls).size === urls.length, JSON.stringify(urls));

  console.log('R2 popups');
  await call('P', 'browser_navigate', { url: U('/pop-P') });
  const snap = (await call('P', 'browser_snapshot')).text;
  const ref1 = snap.match(/link "abrir" \[ref=(e\d+)\]/)?.[1]; const ref2 = snap.match(/link "abrir2" \[ref=(e\d+)\]/)?.[1];
  await withFocus('P', () => call('P', 'browser_click', { element: 'abrir', target: ref1 }));
  await call('P', 'browser_tabs', { action: 'select', index: 0 });
  await withFocus('P', () => call('P', 'browser_click', { element: 'abrir2', target: ref2 }));
  await sleep(800);
  const pTabs = await listTabs('P'); const aTabs = await listTabs('A0');
  ok('R2 opener popup goes to its owner', pTabs.includes(U('/child/pop-P')), JSON.stringify(pTabs));
  ok('R2 noopener popup goes to its owner', pTabs.includes(U('/child2/pop-P')), JSON.stringify(pTabs));
  ok('R2 other agents don\'t see them', !aTabs.some((u) => u.includes('pop-P')), JSON.stringify(aTabs));

  console.log('R3 the human\'s tab');
  const t0 = Date.now();
  const human = await (await fetch(`${CDP}/json/new?${encodeURIComponent(U('/humano'))}`, { method: 'PUT' })).json();
  let loaded = 0;
  for (let i = 0; i < 100 && !loaded; i++) { if ((await chromePages()).some((p) => p.id === human.id && p.title === 'page/humano')) loaded = Date.now() - t0; else await sleep(50); }
  ok(`R3 it loads, not left paused (${loaded} ms)`, loaded > 0 && loaded < 3000);
  const seen = await Promise.all(['A0', 'B0', 'P'].map(listTabs));
  ok('R3 no agent sees it', seen.every((l) => !l.includes(U('/humano'))), JSON.stringify(seen));

  console.log('R4 the human closes an agent\'s tab');
  const a1Tab = [...relay.owner].find(([, a]) => a === 'A1')?.[0];
  await fetch(`${CDP}/json/close/${a1Tab}`); await sleep(500);
  const after = await call('A1', 'browser_navigate', { url: U('/A1-otra') });
  ok('R4 the agent carries on in a new tab of its own', !after.err && pageUrl(after.text) === U('/A1-otra'), after.text.slice(0, 200));
  ok('R4 another agent doesn\'t notice', (await listTabs('B1')).length === 1);

  console.log('R5 interleaved actions');
  const steps = async (a) => { let n = 0; for (let i = 0; i < 4; i++) { const u = U(`/${a}-step${i}`); await call(a, 'browser_navigate', { url: u }); if (pageUrl((await call(a, 'browser_snapshot')).text) === u) n++; } return n; };
  const [g1, g2] = await Promise.all([steps('A2'), steps('B2')]);
  ok(`R5 snapshots on their own page: A2 ${g1}/4, B2 ${g2}/4`, g1 === 4 && g2 === 4);

  console.log('R6 clicks of every agent (focus emulation through the relay)');
  const clickers = ['K0', 'K1', 'K2'];
  for (const a of clickers) await call(a, 'browser_navigate', { url: U(`/${a}-button`) });
  const click = async (a) => { const r = await withFocus(a, () => call(a, 'browser_click', { element: 'ok', target: 'button' })); return r.err ? `${a}:fail` : `${a}:ok`; };
  const serial = []; for (const a of clickers) serial.push(await click(a));
  const parallel = await Promise.all(clickers.map(click));
  ok(`R6 serial ${serial.join(' ')} · parallel ${parallel.join(' ')}`, [...serial, ...parallel].every((x) => x.endsWith(':ok')));
  ok('R6 pagesOf gives each agent only its own pages', relay.pagesOf('K0').every((p) => relay.owner.get(p.targetId) === 'K0') && relay.pagesOf('K0').length >= 1);

  console.log('R7 raw CDP client through the relay');
  const raw = new WebSocket(relay.endpoint('raw'));
  await new Promise((r, j) => { raw.onopen = r; raw.onerror = j; });
  let rid = 0; const rw = new Map();
  raw.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id !== undefined) { rw.get(m.id)?.(m); rw.delete(m.id); } };
  const rcall = (method, params, sessionId) => new Promise((r) => { const id = ++rid; rw.set(id, r); raw.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  // The relay learns a page's kind from the events of SOME connection: let this one discover them too.
  await rcall('Target.setDiscoverTargets', { discover: true }); await sleep(300);
  const listed = (await rcall('Target.getTargets')).result.targetInfos.filter((t) => t.type === 'page');
  ok('R7 getTargets lists none of the others\' pages', listed.length === 0, JSON.stringify(listed.map((t) => t.url)));
  const closeH = await rcall('Target.closeTarget', { targetId: human.id });
  ok('R7 closing the human\'s tab is refused', /not owned/.test(closeH.error?.message || ''), JSON.stringify(closeH));
  const attachK = await rcall('Target.attachToTarget', { targetId: relay.pagesOf('K0')[0]?.targetId, flatten: true });
  ok('R7 attaching to another agent\'s tab is refused', /not owned/.test(attachK.error?.message || ''), JSON.stringify(attachK));
  const ghost = await rcall('Runtime.evaluate', { expression: '1' }, 'DEADBEEFDEADBEEFDEADBEEFDEADBEEF');
  ok('R7 a session never shown is refused', /session not shown/.test(ghost.error?.message || ''), JSON.stringify(ghost));
  const bclose = await rcall('Browser.close');
  ok('R7 Browser.close is refused', /not allowed/.test(bclose.error?.message || ''), JSON.stringify(bclose));
  ok('R7 the human\'s tab is still there', (await chromePages()).some((p) => p.id === human.id));
  const mine = await rcall('Target.createTarget', { url: U('/raw-own') });
  const closeMine = await rcall('Target.closeTarget', { targetId: mine.result?.targetId });
  ok('R7 its own tab it may close', closeMine.result?.success === true, JSON.stringify(closeMine));
  const big = await rcall('Target.createTarget', { url: U('/noise') });
  const { sessionId: bs } = (await rcall('Target.attachToTarget', { targetId: big.result.targetId, flatten: true })).result;
  for (let i = 0; i < 50 && (await rcall('Runtime.evaluate', { expression: 'document.title', returnByValue: true }, bs)).result?.result?.value !== 'noise-ready'; i++) await sleep(100);
  const cap = await rcall('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1600, height: 2400, scale: 1 }, captureBeyondViewport: true }, bs);
  const mb = (cap.result?.data?.length || 0) / 1024 / 1024;
  ok(`R8 a ${mb.toFixed(1)} MB message crosses the relay both ways (Chrome → relay → client)`, mb > 8, JSON.stringify(cap.error || {}));
  raw.close();

  console.log('R8 registry and big messages');
  const reg = tabOwners(DATA);
  const k0 = relay.pagesOf('K0')[0]?.targetId;
  ok('R8 an agent page is claimed as ours, with its agent', reg.classify(k0) === 'mine' && reg.lookup(k0)?.agent === 'K0');
  ok('R8 the human\'s tab is nobody\'s', reg.classify(human.id) === 'human');
  await call('T', 'browser_navigate', { url: U('/tall') });
  const shot = await call('T', 'browser_take_screenshot', { fullPage: true, type: 'png' });
  const img = shot.content.find((c) => c.type === 'image');
  ok(`R8 full-page screenshot crosses the relay (${img ? Math.round(img.data.length / 1024) : 0} KB base64)`, !shot.err && img && img.data.length > 100_000, shot.text.slice(0, 200));

  console.log('R9 onPage holds a new page from its agent, in order (phase 3b: arm PDF capture first)');
  for (const [label, onPageMs, holdMs] of [['slow onPage (300 ms)', 300, 1000], ['onPage that never settles (cap 400 ms)', Infinity, 400]]) {
    const seen = [];
    const r9 = await startRelay({ port: PORT, dataDir: null, holdMs, onPage: (agent, info) => { seen.push({ agent, id: info.targetId }); return new Promise((res) => { if (onPageMs !== Infinity) setTimeout(res, onPageMs); }); } });
    const ws = new WebSocket(r9.endpoint('H'));
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let n = 0; const order = []; const wait = new Map(); const t0 = Date.now();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'page') order.push({ what: 'attach', ms: Date.now() - t0, id: m.params.targetInfo.targetId });
      if (m.id !== undefined) { if (wait.get(m.id)?.create) order.push({ what: 'response', ms: Date.now() - t0 }); wait.get(m.id)?.r(m); wait.delete(m.id); }
    };
    const send = (method, params, extra = {}) => new Promise((r) => { const id = ++n; wait.set(id, { r, ...extra }); ws.send(JSON.stringify({ id, method, params })); });
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });   // as Playwright does
    const created = await send('Target.createTarget', { url: 'about:blank' }, { create: true });
    const tid = created.result?.targetId;
    const a = order.find((o) => o.what === 'attach'); const resp = order.find((o) => o.what === 'response');
    const want = onPageMs === Infinity ? holdMs : onPageMs;
    ok(`R9 ${label}: onPage got the agent and the new page`, seen.length === 1 && seen[0].agent === 'H' && seen[0].id === tid, JSON.stringify(seen));
    ok(`R9 ${label}: the attach waits for it (${a?.ms} ms ≥ ${want - 20})`, a && a.ms >= want - 20 && a.id === tid, JSON.stringify(order));
    ok(`R9 ${label}: …and the createTarget response comes after the attach, not before`, a && resp && order.indexOf(a) < order.indexOf(resp), JSON.stringify(order));
    if (onPageMs === Infinity) ok(`R9 ${label}: counted as a hold timeout`, r9.stats.holdTimeouts === 1, JSON.stringify(r9.stats));
    if (tid) await send('Target.closeTarget', { targetId: tid });
    ws.close(); r9.close();
  }
} catch (e) {
  ok(`no exception: ${e.message}`, false);
} finally {
  console.log(`relay stats: ${JSON.stringify(relay.stats)}`);
  for (const c of children.values()) { try { c.p.stdin.end(); c.p.kill(); } catch {} }
  relay.close(); site.close();
  console.log(`\nresult: ${pass} ok, ${fail} failures`);
  setTimeout(() => process.exit(fail ? 1 : 0), 300);
}
