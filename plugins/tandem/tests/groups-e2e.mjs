#!/usr/bin/env node
// groups-e2e.mjs — 0.12: each agent's tabs in a tab group of its own, through the REAL launcher (tab-groups.mjs,
// extension/). R09 §5.
//   G1 main's page → group "main · …", open
//   G2 a subagent's page → a group of its own, "sub xxxx · …", collapsed, same session color
//   G3 main's second tab → main's same group
//   G4 a tab of the human's handed over → into main's group; given back → out of it, still open
//   G5 the subagent finishes (SubagentStop hook) → its tab closed, its group gone
//   G6 TANDEM_AGENT_GROUPS=0 → no group
//   G8 0.13: readable titles — main's group takes the session's title, a subagent's "↳ <description>", from
//      Claude Code's files (a fixture CLAUDE_CONFIG_DIR); a /rename reaches main's group on its next call
//   G7 end of the session → main's tabs closed, no group left
// Needs a DISPOSABLE Chrome on TANDEM_CDP_PORT (tests/e2e.sh). Usage: node tests/groups-e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { connect, browserWsUrl } from '../scripts/cdp.mjs';
import { cdpPort } from '../scripts/paths.mjs';
import { tabGrouper } from '../scripts/tab-groups.mjs';

const PORT = cdpPort(); const DATA = process.env.TANDEM_DATA_DIR;
if (PORT === 9222 || !DATA) { console.error('groups-e2e: refuses to run on port 9222 or without a TANDEM_DATA_DIR (it closes tabs)'); process.exit(2); }
const launcher = fileURLToPath(new URL('../scripts/mcp-launch.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; let fail = 0;
const ok = (desc, cond, extra = '') => {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}${extra ? ` — ${extra}` : ''}\n`); if (process.env.GITHUB_ACTIONS) process.stdout.write(`::error title=groups-e2e::${desc}\n`); }
};
const site = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<title>t${req.url}</title><h1>${req.url}</h1>`); });
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const U = (p) => `http://127.0.0.1:${site.address().port}${p}`;
const cdp = await connect(await browserWsUrl());
const pages = async () => (await cdp.call('Target.getTargets')).targetInfos.filter((t) => t.type === 'page');
// The test's own view of the groups: the same extension, its own attachment.
const probe = tabGrouper({ port: PORT, log: (m) => process.stderr.write(`probe: ${m}\n`) });
const view = async () => { await sleep(700); return (await probe.list()) || { tabs: [], groups: {} }; };
const tabAt = (v, path) => v.tabs.find((t) => t.url === U(path));
const groupOf = (v, t) => (t && t.groupId !== -1 ? v.groups[t.groupId] : null);

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
  const init = async () => { await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: { roots: {} }, clientInfo: { name: 'groups-e2e', version: '0' } }); send({ jsonrpc: '2.0', method: 'notifications/initialized' }); await rpc('tools/list', {}); };
  const exited = new Promise((r) => p.on('exit', (code, signal) => r({ code, signal })));
  return { p, call, init, stderr, exited };
}

const SUB = 'b7c21e9a40d35f118';
try {
  console.log('0.12 — each agent\'s tabs in a group of its own');
  for (const t of (await pages()).slice(1)) await cdp.call('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
  const L = launch({ TANDEM_AGENT_IDLE_MS: '600000', TANDEM_AGENT_TABS_IDLE_MS: '6000000', TANDEM_LIFECYCLE_CHECK_MS: '250' });
  await L.init();
  await L.call('main', 'browser_navigate', { url: U('/main-1') });
  let v = await view();
  const m1 = tabAt(v, '/main-1'); const gm = groupOf(v, m1);
  ok('G1 main\'s page is in a group', !!gm, JSON.stringify(v).slice(0, 400));
  ok('G1 …titled "main · …", open', gm && /^main · /.test(gm.title) && gm.collapsed === false, JSON.stringify(gm));

  await L.call(SUB, 'browser_navigate', { url: U('/sub-1') });
  v = await view();
  const s1 = tabAt(v, '/sub-1'); const gs = groupOf(v, s1);
  ok('G2 the subagent\'s page is in another group', !!gs && s1.groupId !== tabAt(v, '/main-1')?.groupId, JSON.stringify(v.tabs));
  ok('G2 …titled "sub b7c2 · …", collapsed', gs && /^sub b7c2 · /.test(gs.title) && gs.collapsed === true, JSON.stringify(gs));
  ok('G2 …same color as main\'s (one per session)', gs && gm && gs.color === gm.color);
  ok('G2 one window for both', new Set(v.tabs.filter((t) => /\/(main|sub)-/.test(t.url)).map((t) => t.windowId)).size === 1);

  await L.call('main', 'browser_tabs', { action: 'new' });
  await L.call('main', 'browser_navigate', { url: U('/main-2') });
  v = await view();
  ok('G3 main\'s second tab joins main\'s group', tabAt(v, '/main-2')?.groupId === tabAt(v, '/main-1')?.groupId && tabAt(v, '/main-2')?.groupId !== -1, JSON.stringify(v.tabs));

  // G4: a tab of the human's, in front (in view), handed over to main.
  const { targetId: humanId } = await cdp.call('Target.createTarget', { url: U('/human') });
  await cdp.call('Target.activateTarget', { targetId: humanId }); await sleep(800);
  const ad = await L.call('main', 'browser_tab_adopt', { url: '/human' });
  v = await view();
  ok('G4 handed over: the human\'s tab joins main\'s group', !ad.err && tabAt(v, '/human')?.groupId !== -1 && tabAt(v, '/human')?.groupId === tabAt(v, '/main-1')?.groupId, `${ad.t.slice(0, 200)} ${JSON.stringify(v.tabs)}`);
  const list = (await L.call('main', 'browser_tabs', { action: 'list' })).t;
  const idx = [...list.matchAll(/^- (\d+): .*?\((\S+?)\)\s*$/gm)].find((m) => m[2] === U('/human'))?.[1];
  await L.call('main', 'browser_tabs', { action: 'close', index: Number(idx) });
  v = await view();
  ok('G4 given back: still open, out of the group', !!tabAt(v, '/human') && tabAt(v, '/human').groupId === -1 && tabAt(v, '/main-1')?.groupId !== -1, JSON.stringify(v.tabs));
  await cdp.call('Target.closeTarget', { targetId: humanId }).catch(() => {});

  // G5: the subagent finishes.
  const hook = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/session-hook.mjs', import.meta.url)), 'subagent-stop'],
    { input: JSON.stringify({ session_id: 's', hook_event_name: 'SubagentStop', agent_id: SUB, agent_type: 'general-purpose' }), env: process.env });
  await sleep(1500);
  v = await view();
  ok('G5 the finished subagent\'s tab is closed and its group gone', hook.status === 0 && !!gs && !tabAt(v, '/sub-1') && !Object.values(v.groups).some((g) => /^sub b7c2/.test(g.title)), JSON.stringify(v.groups));

  // G6: off.
  const L2 = launch({ TANDEM_AGENT_GROUPS: '0' });
  await L2.init();
  await L2.call('main', 'browser_navigate', { url: U('/off') });
  v = await view();
  ok('G6 TANDEM_AGENT_GROUPS=0: no group', tabAt(v, '/off')?.groupId === -1, JSON.stringify(tabAt(v, '/off')));
  L2.p.kill('SIGINT'); await Promise.race([L2.exited, sleep(5000)]);

  // G8: readable titles (0.13). A fixture of Claude Code's files: the session's transcript + a subagent's meta.
  const cfg = mkdtempSync(join(tmpdir(), 'tandem-g8-'));
  try {
    const proj = join(cfg, 'projects', '-x-app'); const S = 'g8000000-0000-0000-0000-000000000000'; const A = 'ae1e6f53f7683bf93';
    const tr = join(proj, `${S}.jsonl`);
    mkdirSync(join(proj, S, 'subagents'), { recursive: true });
    writeFileSync(tr, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Grupos legibles', sessionId: S })}\n`);
    writeFileSync(join(proj, S, 'subagents', `agent-${A}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: 'Leer la documentación' }));
    const L3 = launch({ CLAUDE_CONFIG_DIR: cfg, TANDEM_TITLE_TTL_MS: '300' });
    await L3.init();
    await L3.call('main', 'browser_navigate', { url: U('/t-main'), agent_transcript: tr });
    await L3.call(A, 'browser_navigate', { url: U('/t-sub'), agent_transcript: tr });
    v = await view();
    const tm = groupOf(v, tabAt(v, '/t-main')); const ts = groupOf(v, tabAt(v, '/t-sub'));
    ok('G8 main\'s group: the session\'s title', tm?.title === 'Grupos legibles' && tm.collapsed === false, JSON.stringify(tm));
    ok('G8 the subagent\'s group: "↳ <description>", collapsed', ts?.title === '↳ Leer la documentación' && ts.collapsed === true, JSON.stringify(ts));
    appendFileSync(tr, `${JSON.stringify({ type: 'custom-title', customTitle: 'Renombrada', sessionId: S })}\n`);
    await sleep(500);
    await L3.call('main', 'browser_tabs', { action: 'list', agent_transcript: tr });
    v = await view();
    ok('G8 /rename → main\'s group takes the new title on its next call', groupOf(v, tabAt(v, '/t-main'))?.title === 'Renombrada', JSON.stringify(groupOf(v, tabAt(v, '/t-main'))));
    L3.p.kill('SIGINT'); await Promise.race([L3.exited, sleep(5000)]);
    ok('G8 no "groups:" errors in its launcher log', !L3.stderr.some((l) => /groups: .*(failures|Error|error)/.test(l)), L3.stderr.filter((l) => /groups:/.test(l)).join(' | '));
  } finally { rmSync(cfg, { recursive: true, force: true }); }

  // G7: end of the session.
  L.p.kill('SIGINT'); await Promise.race([L.exited, sleep(5000)]);
  v = await view();
  ok('G7 end of the session: main\'s tabs closed, no group left', !tabAt(v, '/main-1') && !tabAt(v, '/main-2') && Object.keys(v.groups).length === 0, JSON.stringify(v));
  ok('no "groups:" errors in the launcher log', !L.stderr.some((l) => /groups: .*(failures|Error|error)/.test(l)), L.stderr.filter((l) => /groups:/.test(l)).join(' | '));
} catch (e) {
  ok(`no exception: ${e.stack}`, false);
} finally {
  probe.close(); cdp.close(); site.close();
  console.log(`groups-e2e: ${pass} ok, ${fail} failures`);
  setTimeout(() => process.exit(fail ? 1 : 0), 200);
}
