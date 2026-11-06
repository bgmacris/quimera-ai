#!/usr/bin/env node
// lazy-main-e2e.mjs — main's MCP on demand (T306) through the REAL launcher and the real MCP, on a real Chrome:
//   Z1 cold: main at once, the memo fills
//   Z2 warm: same handshake, no process until a call needs one
//   Z3 the first call starts main (node cli.js), it works and sees only its tab
//   Z4 main dies: the launcher survives, the next call starts a new one and sees its tab
//   Z5 a subagent's call starts only its MCP
//   Z6 the client goes (EOF, SIGINT), with and without MCPs: launcher gone, no process left, tabs closed
//   Z7 memo with other tools: corrected on start, client told
//   Z8 npx's cache lost (the memo's cli no longer exists): on demand via npx, works; also if it goes during the
//      wait for the first call, or the cli dies at once
//   Z9 TANDEM_LAZY_MCP=0: main at once, as before
// Needs a DISPOSABLE Chrome on TANDEM_CDP_PORT (tests/e2e.sh). Usage: node tests/lazy-main-e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, browserWsUrl } from '../scripts/cdp.mjs';

// The port must come from the env: the launcher gets another data dir, so a port read from this one wouldn't reach it.
const PORT = +process.env.TANDEM_CDP_PORT;
if (!PORT || PORT === 9222 || !process.env.TANDEM_DATA_DIR) { console.error('lazy-main-e2e: needs TANDEM_CDP_PORT (not 9222) and TANDEM_DATA_DIR: it closes tabs'); process.exit(2); }
const DATA = mkdtempSync(join(tmpdir(), 'tandem-lazy-'));   // its own: this test is about an empty memo
const launcher = fileURLToPath(new URL('../scripts/mcp-launch.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Windows: no pgrep and no signals (kill() terminates, no handler runs: Claude Code closes stdin there, as far as we
// can tell), the MCP always goes via npx (resolveMcpCli: .bin is a .cmd shim), so one child is cmd → npm → node.
const WIN = process.platform === 'win32';
const childrenOf = (pid) => {
  const r = WIN
    ? spawnSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}").ProcessId`], { encoding: 'utf8' })
    : spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' });
  return (r.stdout || '').split(/\s+/).filter(Boolean).map(Number);
};
const killTree = (pid) => { if (WIN) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']); else process.kill(pid, 'SIGKILL'); };
let pass = 0; let fail = 0;
const ok = (desc, cond, extra = '') => {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}${extra ? ` — ${extra}` : ''}\n`); if (process.env.GITHUB_ACTIONS) process.stdout.write(`::error title=lazy-main-e2e::${desc}\n`); }
};
const site = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<title>t${req.url}</title><h1>${req.url}</h1>`); });
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const U = (p) => `http://127.0.0.1:${site.address().port}${p}`;
const cdp = await connect(await browserWsUrl());
const pages = async () => (await cdp.call('Target.getTargets')).targetInfos.filter((t) => t.type === 'page');
const has = async (path) => (await pages()).some((t) => t.url === U(path));

function launch(env = {}) {
  const stderr = []; const notes = [];
  const p = spawn(process.execPath, [launcher], { env: { ...process.env, TANDEM_DATA_DIR: DATA, TANDEM_DEBUG: '1', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  p.stderr.on('data', (d) => stderr.push(...String(d).split('\n').filter(Boolean)));
  let buf = ''; const waiters = new Map(); let id = 0;
  const send = (m) => p.stdin.write(JSON.stringify(m) + '\n');
  p.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1);
      let m; try { m = JSON.parse(l); } catch { continue; }
      if (m.method === 'roots/list') { send({ jsonrpc: '2.0', id: m.id, result: { roots: [] } }); continue; }
      if (m.method) { notes.push(m.method); continue; }
      if (m.id !== undefined) { waiters.get(m.id)?.(m); waiters.delete(m.id); }
    }
  });
  const rpc = (method, params, ms = 90000) => new Promise((res) => { const n = ++id; const t = setTimeout(() => res({ timeout: true }), ms); t.unref(); waiters.set(n, (m) => { clearTimeout(t); res(m); }); send({ jsonrpc: '2.0', id: n, method, params }); });
  const call = async (agent, name, args = {}) => { const r = await rpc('tools/call', { name, arguments: { ...args, agent } }); return { t: (r.result?.content || []).map((c) => c.text || '').join('\n'), err: !!r.timeout || !!r.error || !!r.result?.isError, r }; };
  const init = async () => {
    const d = await rpc('server/discover', {});
    const i = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: { roots: {} }, clientInfo: { name: 'lazy-e2e', version: '0' } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const t = await rpc('tools/list', {});
    return { d, i, t };
  };
  const exited = new Promise((r) => p.on('exit', (code, signal) => r({ code, signal })));
  const kids = () => childrenOf(p.pid);
  return { p, call, rpc, init, stderr, notes, exited, kids };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const tree = (pid) => { const c = childrenOf(pid); return [...c, ...c.flatMap(tree)]; };
const stop = (L) => (WIN ? L.p.stdin.end() : L.p.kill('SIGINT'));
const gone = async (L, how) => { how(); return Promise.race([L.exited, sleep(5000).then(() => null)]); };
const tabsOf = async (L, agent) => [...(await L.call(agent, 'browser_tabs', { action: 'list' })).t.matchAll(/^- (\d+): .*?\((\S+?)\)\s*$/gm)].map((m) => m[2]);
const memoFile = () => join(DATA, 'mcp-memo', readdirSync(join(DATA, 'mcp-memo')).find((f) => f.endsWith('.json')));
const SUB = 'a0e815c57e8d30939';

try {
  console.log('main on demand');
  for (const t of (await pages()).slice(1)) await cdp.call('Target.closeTarget', { targetId: t.targetId }).catch(() => {});

  const cold = launch();
  const hs = await cold.init();
  ok('Z1 cold: main started at once via npx', cold.stderr.some((l) => l.includes('started the MCP of agent main (npx)')), cold.stderr.join(' | '));
  ok('Z1 the handshake works', hs.d.error?.code === -32601 && hs.i.result?.serverInfo?.name && hs.t.result?.tools?.some((t) => t.name === 'browser_tab_adopt'));
  for (const t0 = Date.now(); !cold.stderr.some((l) => l.includes('MCP cli')) && Date.now() - t0 < 30000;) await sleep(100);
  const m1 = JSON.parse(readFileSync(memoFile(), 'utf8'));
  ok('Z1 the memo has the tools (no local one), initialize, discover, cli', m1.tools?.tools?.length > 5 && m1.tools.tools.every((t) => t.name !== 'browser_tab_adopt') && m1.initialize?.['2025-11-25'] && m1.discover?.code === -32601 && (WIN || m1.cli?.endsWith('cli.js')));
  await gone(cold, () => cold.p.stdin.end());

  const L = launch();
  const hs2 = await L.init();
  await sleep(400);
  ok('Z2 warm: same answers', JSON.stringify(hs2.t.result.tools) === JSON.stringify(hs.t.result.tools) && JSON.stringify(hs2.i.result) === JSON.stringify(hs.i.result) && hs2.d.error?.code === -32601);
  ok('Z2 no process: no child at all', L.kids().length === 0, `children: ${L.kids()}`);
  if (!WIN) {
    const rss = +spawnSync('ps', ['-o', 'rss=', '-p', String(L.p.pid)], { encoding: 'utf8' }).stdout.trim();
    process.stdout.write(`    (launcher alone: ${Math.round(rss / 1024)} MB RSS)\n`);
  }

  const t0 = Date.now();
  const nav = await L.call('main', 'browser_navigate', { url: U('/main-own') });
  process.stdout.write(`    (first call: ${Date.now() - t0} ms)\n`);
  ok('Z3 the first call works', !nav.err && (await has('/main-own')), nav.t.slice(0, 200));
  if (WIN) ok('Z3 main started via npx, Windows has no cli', L.stderr.some((l) => l.includes('started the MCP of agent main (npx)')), L.stderr.join(' | '));
  else {
    ok('Z3 main started via node cli.js, not npx', L.stderr.some((l) => l.includes('started the MCP of agent main (node cli.js)')), L.stderr.join(' | '));
    ok('Z3 one process: no npm exec', L.kids().length === 1 && tree(L.kids()[0]).length === 0, `children: ${L.kids()}`);
  }
  ok('Z3 it sees only its tab', (await tabsOf(L, 'main')).join() === U('/main-own'));
  await sleep(300);
  // The MCP itself sends list_changed when it connects to Chrome (with or without the memo: measured), so the log says it.
  ok('Z3 same tools as the memo: nothing corrected', !L.stderr.some((l) => l.includes('differ from the memo')), L.stderr.join(' | '));

  const [first] = L.kids();
  killTree(first);
  await sleep(300);
  ok('Z4 main killed: the launcher survives', L.p.exitCode === null && L.kids().length === 0);
  const after = await tabsOf(L, 'main');
  ok('Z4 the next call starts a new one, and it sees its tab', after.includes(U('/main-own')) && L.kids().length === 1, after.join());
  const nav2 = await L.call('main', 'browser_navigate', { url: U('/main-own2') });
  ok('Z4 it works', !nav2.err);
  await gone(L, () => stop(L));
  await sleep(300);

  const S = launch();
  await S.init();
  const sub = await S.call(SUB, 'browser_navigate', { url: U('/sub-own') });
  ok('Z5 a subagent\'s call works', !sub.err, sub.t.slice(0, 200));
  ok('Z5 only its MCP started', S.stderr.filter((l) => l.includes('started the MCP')).length === 1 && S.stderr.some((l) => l.includes(`started the MCP of agent ${SUB}`)), S.stderr.join(' | '));
  const mainToo = await tabsOf(S, 'main');
  ok('Z5 main comes later, without its tab', !mainToo.includes(U('/sub-own')) && S.kids().length === 2, mainToo.join());

  const pids = [...S.kids(), ...S.kids().flatMap(tree)];
  const end = await gone(S, () => S.p.stdin.end());
  await sleep(500);
  ok('Z6 EOF with MCPs: launcher gone, none left', end && pids.every((p) => !alive(p)), `left: ${pids.filter(alive)}`);
  ok('Z6 …its tabs closed', !(await has('/sub-own')));

  if (!WIN) {
    const idle = launch();
    await idle.init();
    const e1 = await gone(idle, () => idle.p.kill('SIGINT'));
    ok('Z6 SIGINT with no MCP: launcher gone', !!e1);
  }
  const idle2 = launch();
  await idle2.init();
  const e2 = await gone(idle2, () => idle2.p.stdin.end());
  ok('Z6 EOF with no MCP: launcher gone', !!e2);
  const busy = launch();
  await busy.init();
  await busy.call('main', 'browser_navigate', { url: U('/busy') });
  const busyPids = [...busy.kids(), ...busy.kids().flatMap(tree)];
  const e3 = await gone(busy, () => stop(busy));
  await sleep(500);
  ok(`Z6 ${WIN ? 'EOF' : 'SIGINT'} with main up: launcher gone, none left, tab closed`, !!e3 && busyPids.every((p) => !alive(p)) && !(await has('/busy')), `left: ${busyPids.filter(alive)}`);

  const good = readFileSync(memoFile(), 'utf8');
  const poisoned = JSON.parse(good);
  poisoned.tools.tools = poisoned.tools.tools.filter((t) => t.name !== 'browser_click');
  writeFileSync(memoFile(), JSON.stringify(poisoned));
  const D = launch();
  const hsD = await D.init();
  ok('Z7 a memo without a tool: the client gets that list', !hsD.t.result.tools.some((t) => t.name === 'browser_click'));
  await D.call('main', 'browser_navigate', { url: U('/drift') });
  for (const t1 = Date.now(); !D.stderr.some((l) => l.includes('differ from the memo')) && Date.now() - t1 < 11000;) await sleep(100);
  ok('Z7 on start: corrected, the client told', D.stderr.some((l) => l.includes('differ from the memo')) && D.notes.includes('notifications/tools/list_changed'), D.stderr.join(' | '));
  const relist = await D.rpc('tools/list', {});
  ok('Z7 …and lists the right tools', relist.result?.tools?.some((t) => t.name === 'browser_click') && relist.result.tools.filter((t) => t.name === 'browser_tab_adopt').length === 1);
  ok('Z7 the memo is corrected', JSON.parse(readFileSync(memoFile(), 'utf8')).tools.tools.some((t) => t.name === 'browser_click'));
  await gone(D, () => stop(D));

  const lost = JSON.parse(readFileSync(memoFile(), 'utf8'));
  lost.cli = '/nonexistent/@playwright/mcp/cli.js';
  writeFileSync(memoFile(), JSON.stringify(lost));
  const N = launch();
  await N.init();
  ok('Z8 the cli is gone: still no process', N.kids().length === 0);
  const nav3 = await N.call('main', 'browser_navigate', { url: U('/via-npx') });
  ok('Z8 on demand via npx: works', !nav3.err && N.stderr.some((l) => l.includes('started the MCP of agent main (npx)')), N.stderr.join(' | '));
  for (const t1 = Date.now(); !N.stderr.some((l) => l.includes('MCP cli')) && Date.now() - t1 < 30000;) await sleep(100);
  if (!WIN) ok('Z8 …and the memo gets the right cli back', JSON.parse(readFileSync(memoFile(), 'utf8')).cli?.endsWith('@playwright/mcp/cli.js') && !JSON.parse(readFileSync(memoFile(), 'utf8')).cli.startsWith('/nonexistent'));
  await gone(N, () => stop(N));

  // A cli good when the session starts, that goes during its long wait for a first call: the next one goes via npx.
  const fake = (body) => {
    const d = mkdtempSync(join(tmpdir(), 'tandem-fake-cli-'));
    const version = readFileSync(launcher, 'utf8').match(/MCP_VERSION_PIN = '([^']+)'/)[1];
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name: '@playwright/mcp', version }));
    writeFileSync(join(d, 'cli.js'), body);
    return d;
  };
  const setCli = (d) => { const f = JSON.parse(readFileSync(memoFile(), 'utf8')); f.cli = join(d, 'cli.js'); writeFileSync(memoFile(), JSON.stringify(f)); };
  const dGone = fake('process.exit(1)');
  setCli(dGone);
  const W1 = launch();
  await W1.init();
  rmSync(dGone, { recursive: true, force: true });
  const navW1 = await W1.call('main', 'browser_navigate', { url: U('/cli-went') });
  ok('Z8b the cli went while waiting: the first call goes via npx, and works', !navW1.err && W1.stderr.some((l) => l.includes('started the MCP of agent main (npx)')), W1.stderr.join(' | '));
  await gone(W1, () => stop(W1));

  // A cli that looks right and dies at once: that call fails, the next one goes via npx.
  const dDead = fake('process.exit(1)');
  setCli(dDead);
  const W2 = launch();
  await W2.init();
  const t2 = Date.now();
  const [c1, c2] = await Promise.all([W2.call('main', 'browser_navigate', { url: U('/x1') }), W2.call('main', 'browser_navigate', { url: U('/x2') })]);
  ok('Z8c a cli that dies: both parallel calls answered at once, with an error', c1.err && c2.err && Date.now() - t2 < 15000, `${Date.now() - t2} ms`);
  const c3 = await W2.call('main', 'browser_navigate', { url: U('/x3') });
  ok('Z8c the next call goes via npx, and works', !c3.err && W2.stderr.some((l) => l.includes('started the MCP of agent main (npx)')), W2.stderr.join(' | '));
  await gone(W2, () => stop(W2));

  const off = launch({ TANDEM_LAZY_MCP: '0' });
  await off.init();
  ok('Z9 TANDEM_LAZY_MCP=0: main at once', off.stderr.some((l) => l.includes('started the MCP of agent main (npx)')) && off.kids().length >= 1);   // ≥: it may be resolving the cli too
  const eOff = await gone(off, () => off.p.stdin.end());
  ok('Z9 …and the launcher ends with it', !!eOff);
} finally {
  cdp.close?.();
  site.close();
}
console.log(`\n${pass} ok, ${fail} failures`);
process.exit(fail ? 1 : 0);
