#!/usr/bin/env node
// lifecycle-e2e.mjs — phase 5 through the REAL launcher (multi-session), with short timers (R05 §17):
//   L1 an idle subagent's MCP is stopped (TANDEM_AGENT_IDLE_MS); its tabs stay; its next call sees them
//   L2 after TANDEM_AGENT_TABS_IDLE_MS its tabs are closed and the one handed over is given back
//   L3 end of the session (SIGINT, as Claude Code sends it): the agents' own tabs closed, the handed-over
//      one given back, the launcher exits
//   L4 leftovers of a dead session (claims of a pid that is gone): the next launcher closes the agent's
//      own tab and leaves the handed-over one open (the human's)
// Needs a DISPOSABLE Chrome on TANDEM_CDP_PORT (tests/e2e.sh). Usage: node tests/lifecycle-e2e.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { connect, browserWsUrl } from '../scripts/cdp.mjs';
import { cdpPort } from '../scripts/paths.mjs';
import { tabOwners } from '../scripts/tab-owners.mjs';

const PORT = cdpPort(); const DATA = process.env.TANDEM_DATA_DIR;
if (PORT === 9222 || !DATA) { console.error('lifecycle-e2e: refuses to run on port 9222 or without a TANDEM_DATA_DIR (it closes tabs)'); process.exit(2); }
const launcher = fileURLToPath(new URL('../scripts/mcp-launch.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; let fail = 0;
const ok = (desc, cond, extra = '') => {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}${extra ? ` — ${extra}` : ''}\n`); if (process.env.GITHUB_ACTIONS) process.stdout.write(`::error title=lifecycle-e2e::${desc}\n`); }
};
const site = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<title>t${req.url}</title><h1>${req.url}</h1>`); });
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const U = (p) => `http://127.0.0.1:${site.address().port}${p}`;
const cdp = await connect(await browserWsUrl());
const pages = async () => (await cdp.call('Target.getTargets')).targetInfos.filter((t) => t.type === 'page');
const has = async (path) => (await pages()).some((t) => t.url === U(path));
const human = async (path) => { const { targetId } = await cdp.call('Target.createTarget', { url: U(path) }); await sleep(600); return targetId; };

function launch(env = {}) {
  const stderr = [];
  const p = spawn(process.execPath, [launcher], { env: { ...process.env, TANDEM_DEBUG: '1', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  p.stderr.on('data', (d) => stderr.push(...String(d).split('\n').filter(Boolean)));
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
  const rpc = (method, params, ms = 90000) => new Promise((res) => { const n = ++id; const t = setTimeout(() => res({ timeout: true }), ms); waiters.set(n, (m) => { clearTimeout(t); res(m); }); send({ jsonrpc: '2.0', id: n, method, params }); });
  const call = async (agent, name, args = {}) => { const r = await rpc('tools/call', { name, arguments: { ...args, agent } }); return { t: (r.result?.content || []).map((c) => c.text || '').join('\n'), err: !!r.timeout || !!r.error || !!r.result?.isError }; };
  const init = async () => { await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: { roots: {} }, clientInfo: { name: 'lifecycle-e2e', version: '0' } }); send({ jsonrpc: '2.0', method: 'notifications/initialized' }); await rpc('tools/list', {}); };
  const exited = new Promise((r) => p.on('exit', (code, signal) => r({ code, signal })));
  return { p, call, init, stderr, exited };
}
const tabsOf = async (L, agent) => [...(await L.call(agent, 'browser_tabs', { action: 'list' })).t.matchAll(/^- (\d+): .*?\((\S+?)\)\s*$/gm)].map((m) => m[2]);
const S = 'a0e815c57e8d30939';

try {
  console.log('phase 5 — life cycle of agents and their tabs');
  // Clean slate: one blank tab.
  for (const t of (await pages()).slice(1)) await cdp.call('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
  const L = launch({ TANDEM_AGENT_IDLE_MS: '1500', TANDEM_AGENT_TABS_IDLE_MS: '5000', TANDEM_LIFECYCLE_CHECK_MS: '250' });
  await L.init();
  await L.call('main', 'browser_navigate', { url: U('/main-own') });
  await L.call(S, 'browser_navigate', { url: U('/sub-own') });
  const given = await human('/given');
  const adopt = await L.call(S, 'browser_tab_adopt');
  ok('setup: the subagent has its tab and one handed over', !adopt.err && (await tabsOf(L, S)).length === 2, adopt.t.slice(0, 200));
  await sleep(2600);
  ok('L1 idle past TANDEM_AGENT_IDLE_MS: its MCP is stopped', L.stderr.some((l) => l.includes(`stopped the MCP of agent ${S}`)), L.stderr.slice(-5).join(' | '));
  ok('L1 …its tabs stay open, the handed-over one still its', (await has('/sub-own')) && (await has('/given')) && tabOwners(DATA).lookup(given)?.agent === S);
  const back = await tabsOf(L, S);
  ok('L1 its next call starts a new MCP that sees both its tabs', back.includes(U('/sub-own')) && back.includes(U('/given')), JSON.stringify(back));
  await sleep(5800);
  ok('L2 idle past TANDEM_AGENT_TABS_IDLE_MS: its own tab is closed', !(await has('/sub-own')), JSON.stringify((await pages()).map((t) => t.url)));
  ok('L2 …the handed-over one is open and the human\'s again', (await has('/given')) && tabOwners(DATA).classify(given) === 'human');
  ok('L2 main is untouched (never stopped, its tab open)', (await has('/main-own')) && !L.stderr.some((l) => l.includes('stopped the MCP of agent main')));

  // L3: a second subagent, a handed-over tab, then Claude Code's SIGINT.
  await L.call(S, 'browser_navigate', { url: U('/sub-again') });
  const given2 = await human('/given2');
  await L.call(S, 'browser_tab_adopt', { url: '/given2' });
  L.p.kill('SIGINT'); setTimeout(() => { try { L.p.kill('SIGTERM'); } catch {} }, 100);
  const ex = await Promise.race([L.exited, sleep(5000).then(() => 'timeout')]);
  await sleep(300);
  ok('L3 SIGINT: the launcher exits', ex !== 'timeout', JSON.stringify(ex));
  ok('L3 …the agents\' own tabs are closed (main\'s and the subagent\'s)', !(await has('/main-own')) && !(await has('/sub-again')), JSON.stringify((await pages()).map((t) => t.url)));
  ok('L3 …the handed-over tab is open and the human\'s', (await has('/given2')) && tabOwners(DATA).classify(given2) === 'human');

  // L4: a dead session's leftovers — claims written as a pid that is gone.
  const deadPid = 2 ** 22 + 4321;
  const own = await human('/dead-agent-tab'); const handed = await human('/dead-handed');
  const dead = tabOwners(DATA, { pid: deadPid });
  dead.claim(own, 'x1'); dead.claim(handed, 'x1', { adopted: true });
  const L2 = launch();
  await L2.init(); await sleep(1500);
  ok('L4 the next launcher closes the dead session\'s agent tab', !(await has('/dead-agent-tab')), L2.stderr.filter((l) => /reaped/.test(l)).join(' | '));
  ok('L4 …and leaves the handed-over one open, the human\'s', (await has('/dead-handed')) && tabOwners(DATA).classify(handed) === 'human');
  L2.p.kill('SIGINT'); await Promise.race([L2.exited, sleep(5000)]);
} catch (e) {
  ok(`no exception: ${e.stack}`, false);
} finally {
  cdp.close(); site.close();
  console.log(`lifecycle-e2e: ${pass} ok, ${fail} failures`);
  setTimeout(() => process.exit(fail ? 1 : 0), 200);
}
