#!/usr/bin/env node
// multi-real-e2e.mjs — multi-session through tandem's REAL launcher (mcp-launch.mjs → router → relay → one
// @playwright/mcp per agent), on REAL public pages, with three agents working in parallel as Claude Code's
// main agent and two subagents would. The client behaves like Claude Code: declares `roots`, answers every
// child's roots/list, and every call carries `agent` (what autostart.mjs writes via updatedInput).
//   M1 parallel first navigations: each agent lands on its page and lists only its own tab
//   M2 the human's tab: no agent sees it, and it loads (not left paused by the relay)
//   M3 parallel clicks on real links: each agent ends where it clicked, the others don't move
//   M4 parallel popups (target=_blank; rel=noopener on the RFC page): the popup is its opener's and nobody else's.
//      MEASURED, not asserted: how many clicks hang (R05 §M: a pre-existing @playwright/mcp issue with
//      simultaneous popups from several clients, reproduced without the relay)
//   M5 roots reach the lazy children: a relative screenshot filename lands in the client's root
//   M6 client EOF: the launcher and every child exit, the agents' tabs closed (phase 5)
//   M7 (before M6) a NEW subagent's FIRST call opens a real PDF: captured as it arrives (phase 3b: the
//      relay holds the new page until the capture is armed)
// NOT in tests/e2e.sh (CI): real sites can be down or change. Run by hand with tandem's Chrome up:
//   TANDEM_DATA_DIR=… TANDEM_CDP_PORT=… node tests/multi-real-e2e.mjs      (exit 0 = green)
// MULTI_REAL_ROUNDS=n repeats M4 (default 3).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect, browserWsUrl } from '../scripts/cdp.mjs';
import { dataDir } from '../scripts/paths.mjs';

const ROUNDS = +(process.env.MULTI_REAL_ROUNDS || 3);
const DATA = process.env.TANDEM_DATA_DIR || dataDir();
const launcher = fileURLToPath(new URL('../scripts/mcp-launch.mjs', import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'tandem-multi-root-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; let fail = 0;
const ok = (desc, cond, extra = '') => {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}${extra ? ` — ${extra}` : ''}\n`); }
};
const note = (s) => process.stdout.write(`  · ${s}\n`);

// The agents: Claude Code's main agent and two subagents (agent_id-shaped ids).
const MAIN = 'main'; const A = 'a0e815c57e8d30939'; const B = 'ac1b5e98441c8d67c';
const short = (a) => (a === MAIN ? 'main' : a.slice(0, 6));

const PAGES = {
  [MAIN]: { url: 'https://en.wikipedia.org/wiki/Web_browser', link: /link "web page" \[ref=(\w+)\]/i, after: /wikipedia\.org\/wiki\/Web_page/ },
  [A]: { url: 'https://books.toscrape.com/', link: /link "A Light in the \.\.\." \[ref=(\w+)\]/, after: /a-light-in-the-attic/ },
  [B]: { url: 'https://quotes.toscrape.com/', link: /link "Next(?: →)?" \[ref=(\w+)\]/, after: /quotes\.toscrape\.com\/page\/2/ },
};
const POPUPS = {
  [A]: { url: 'https://the-internet.herokuapp.com/windows', link: /link "Click Here" \[ref=(\w+)\]/, child: /the-internet\.herokuapp\.com\/windows\/new/ },
  [B]: { url: 'https://the-internet.herokuapp.com/windows', link: /link "Click Here" \[ref=(\w+)\]/, child: /the-internet\.herokuapp\.com\/windows\/new/ },
  // rel=noopener (PyPI was the first choice: it served curl a 3 KB bot check minutes after serving the page)
  [MAIN]: { url: 'https://www.rfc-editor.org/rfc/rfc6455', link: /link "http:\/\/whatwg\.org\/html5" \[ref=(\w+)\]/, child: /whatwg\.org/ },
};

// --- the launcher, driven like Claude Code drives it ------------------------------------------------
const stderr = [];
const p = spawn(process.execPath, [launcher], { env: { ...process.env, TANDEM_DEBUG: '1', TANDEM_FOCUS_LINGER_MS: '2000' }, stdio: ['pipe', 'pipe', 'pipe'] });
p.stderr.on('data', (d) => stderr.push(...String(d).split('\n').filter(Boolean)));
const rootsAsked = [];
let buf = ''; const waiters = new Map(); let id = 0;
const send = (m) => p.stdin.write(JSON.stringify(m) + '\n');
p.stdout.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(l); } catch { continue; }
    if (m.method === 'roots/list') { rootsAsked.push(m.id); send({ jsonrpc: '2.0', id: m.id, result: { roots: [{ uri: pathToFileURL(ROOT).href }] } }); continue; }
    if (m.id !== undefined && !m.method) { waiters.get(m.id)?.(m); waiters.delete(m.id); }
  }
});
const rpc = (method, params, ms = 120000) => new Promise((res) => {
  const n = ++id; const t = setTimeout(() => { waiters.delete(n); res({ timeout: true }); }, ms);
  waiters.set(n, (m) => { clearTimeout(t); res(m); });
  send({ jsonrpc: '2.0', id: n, method, params });
});
const text = (r) => (r?.result?.content || []).map((c) => c.text || '').join('\n');
const call = async (agent, name, args, ms) => {
  const t0 = Date.now();
  const r = await rpc('tools/call', { name, arguments: { ...args, agent } }, ms);
  return { r, t: text(r), ms: Date.now() - t0, err: !!r.timeout || !!r.error || !!r.result?.isError };
};
const tabsOf = async (agent) => {
  const { t } = await call(agent, 'browser_tabs', { action: 'list' });
  return [...t.matchAll(/^- \d+: .*?\((\S+?)\)\s*$/gm)].map((m) => m[1]);
};
let KEY = 'target';
const refIn = async (agent, re) => {
  const { t } = await call(agent, 'browser_snapshot', {});
  const ref = t.match(re)?.[1];
  if (!ref) note(`${short(agent)}: no ${re} in its snapshot; links seen: ${[...t.matchAll(/link "([^"]{0,40})"/g)].slice(0, 12).map((m) => m[1]).join(' | ')}`);
  return ref;
};

// CDP side: the human, and the truth about what is open.
const cdp = await connect(await browserWsUrl());
const pages = async () => (await cdp.call('Target.getTargets')).targetInfos.filter((t) => t.type === 'page');
const owners = () => {
  const dir = join(DATA, 'owners');
  const o = {};
  try { for (const f of readdirSync(dir)) { try { o[f] = JSON.parse(readFileSync(join(dir, f), 'utf8')).agent; } catch {} } } catch {}
  return o;
};

let exitCode = 1;
try {
  console.log('multi-session on real pages — launcher → router → relay, three agents in parallel');
  const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: { roots: { listChanged: true } }, clientInfo: { name: 'multi-real-e2e', version: '0' } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const tools = (await rpc('tools/list', {})).result?.tools || [];
  KEY = tools.find((t) => t.name === 'browser_click')?.inputSchema.properties.target ? 'target' : 'ref';
  ok('handshake through the router (main): initialize + tools/list', !!init.result && tools.some((t) => t.name === 'browser_navigate'));

  console.log('M1 parallel first navigations');
  const nav = await Promise.all([MAIN, A, B].map((a) => call(a, 'browser_navigate', { url: PAGES[a].url })));
  [MAIN, A, B].forEach((a, i) => ok(`${short(a)}: landed on its page (${nav[i].ms} ms)`, !nav[i].err && nav[i].t.includes(`Page URL: ${PAGES[a].url}`), nav[i].t.slice(0, 200)));
  const lists = await Promise.all([MAIN, A, B].map(tabsOf));
  [MAIN, A, B].forEach((a, i) => ok(`${short(a)}: lists only its own tab`, lists[i].length === 1 && lists[i][0] === PAGES[a].url, JSON.stringify(lists[i])));
  const started = stderr.filter((l) => /started the MCP of agent/.test(l));
  note(`children: ${started.map((l) => l.replace(/.*agent (\S+) \((.*)\)/, (_, a, how) => `${short(a)}=${how}`)).join(', ')}`);

  console.log('M2 the human\'s tab');
  const { targetId: human } = await cdp.call('Target.createTarget', { url: 'https://example.com/' });
  await sleep(2500);
  const seen = await Promise.all([MAIN, A, B].map(tabsOf));
  ok('no agent lists the human\'s tab', seen.every((l) => !l.some((u) => u.includes('example.com'))), JSON.stringify(seen));
  const { sessionId: hs } = await cdp.call('Target.attachToTarget', { targetId: human, flatten: true });
  const ready = (await cdp.call('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, hs)).result?.value;
  await cdp.call('Target.detachFromTarget', { sessionId: hs }).catch(() => {});
  ok('…and it loaded (the relay did not leave it paused)', ready === 'complete', `readyState=${ready}`);
  ok('the human\'s tab is nobody\'s in the shared registry', !(human in owners()));

  console.log('M3 parallel clicks on real links');
  const refs = await Promise.all([MAIN, A, B].map((a) => refIn(a, PAGES[a].link)));
  [MAIN, A, B].forEach((a, i) => ok(`${short(a)}: found its link in its own snapshot`, !!refs[i]));
  const clicks = await Promise.all([MAIN, A, B].map((a, i) => (refs[i] ? call(a, 'browser_click', { element: 'link', [KEY]: refs[i] }, 60000) : null)));
  for (const [i, a] of [MAIN, A, B].entries()) {
    const c = clicks[i]; if (!c) continue;
    const now = await tabsOf(a);
    ok(`${short(a)}: its click went through and it is where it clicked (${c.ms} ms)`, !c.err && now.length === 1 && PAGES[a].after.test(now[0]), `${c.t.slice(0, 160)} tabs=${JSON.stringify(now)}`);
  }

  console.log(`M4 parallel popups × ${ROUNDS} (isolation asserted; hangs measured)`);
  const hangs = { [MAIN]: 0, [A]: 0, [B]: 0 }; const slow = [];
  for (let r = 1; r <= ROUNDS; r++) {
    // Each agent back to one tab on its popup page.
    await Promise.all([MAIN, A, B].map(async (a) => {
      const l = await tabsOf(a);
      for (let k = l.length - 1; k > 0; k--) await call(a, 'browser_tabs', { action: 'close', index: k });
      await call(a, 'browser_tabs', { action: 'select', index: 0 });
      await call(a, 'browser_navigate', { url: POPUPS[a].url });
    }));
    const prefs = await Promise.all([MAIN, A, B].map((a) => refIn(a, POPUPS[a].link)));
    if (prefs.some((x) => !x)) { ok(`round ${r}: every agent found its popup link`, false, JSON.stringify(prefs)); continue; }
    const res = await Promise.all([MAIN, A, B].map((a, i) => call(a, 'browser_click', { element: 'popup link', [KEY]: prefs[i] }, 30000)));
    await sleep(1500);
    const after = await Promise.all([MAIN, A, B].map(tabsOf));
    const reg = owners();
    const all = await pages();
    for (const [i, a] of [MAIN, A, B].entries()) {
      if (res[i].err) hangs[a]++;
      if (res[i].ms > 5000) slow.push(`${short(a)} r${r} ${res[i].ms} ms${res[i].err ? ' (error)' : ''}`);
      const others = [MAIN, A, B].filter((x) => x !== a);
      const mine = after[i].filter((u) => POPUPS[a].child.test(u));
      // A popup page in Chrome claimed by this agent.
      const claimed = all.filter((t) => POPUPS[a].child.test(t.url) && reg[t.targetId] === a).length;
      ok(`r${r} ${short(a)}: sees its popup (${mine.length}), registry says it is ${short(a)}'s (${claimed})`, mine.length >= 1 && claimed >= 1, JSON.stringify(after[i]));
      // Only its page and its popups — for A and B the URLs are the same, so the count check below matters.
      ok(`r${r} ${short(a)}: lists only its page and its popup`, after[i].every((u) => u.startsWith(new URL(POPUPS[a].url).origin) || POPUPS[a].child.test(u)) && after[i].length === 2, `${JSON.stringify(after[i])} (others: ${others.map(short)})`);
    }
    // A and B open the SAME popup URL: each must see exactly its own one.
    const aPops = after[1].filter((u) => POPUPS[A].child.test(u)).length; const bPops = after[2].filter((u) => POPUPS[B].child.test(u)).length;
    ok(`r${r}: same popup URL in two agents → one each, not both in both (A ${aPops}, B ${bPops})`, aPops === 1 && bPops === 1);
  }
  note(`MEASURE popup clicks that errored/hung (of ${ROUNDS} each): main ${hangs[MAIN]}, A ${hangs[A]}, B ${hangs[B]}; slow > 5 s: ${slow.join('; ') || 'none'}`);

  console.log('M5 roots reach the lazy children');
  ok('every child asked the client roots/list (main + 2 subagents, ours ids for the subs)', rootsAsked.length >= 3 && rootsAsked.filter((x) => String(x).startsWith('tandem-')).length >= 2, JSON.stringify(rootsAsked));
  const shot = await call(A, 'browser_take_screenshot', { filename: `shot-${short(A)}.png` });
  ok('a subagent\'s relative screenshot filename lands in the client\'s root', existsSync(join(ROOT, `shot-${short(A)}.png`)), `${shot.t.slice(0, 200)} root=${ROOT}`);

  console.log('M7 a new subagent\'s first call is a real PDF');
  const C = 'a7f3c2e1b0d9e8f7a';
  const PDF = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
  const first = await call(C, 'browser_navigate', { url: PDF });
  const path = first.t.match(/saved to (\S+\.pdf) \(/)?.[1];
  const head = path && existsSync(path) ? readFileSync(path).subarray(0, 5).toString('latin1') : null;
  ok(`captured on its first call (${first.ms} ms), the file is a PDF`, first.t.includes('### tandem: PDF captured') && head === '%PDF-', first.t.slice(-300));

  console.log('M6 client EOF');
  const exited = new Promise((r) => p.on('exit', r));
  p.stdin.end();
  const code = await Promise.race([exited, sleep(15000).then(() => 'timeout')]);
  ok('the launcher exits', code !== 'timeout', `exit=${code}`);
  await sleep(500);
  const left = (await pages()).filter((t) => [...Object.values(PAGES), ...Object.values(POPUPS)].some((x) => t.url.startsWith(x.url)));
  ok(`the agents' tabs are closed with the session (phase 5): ${left.length} left`, left.length === 0, JSON.stringify(left.map((t) => t.url)));
  await cdp.call('Target.closeTarget', { targetId: human }).catch(() => {});
  exitCode = fail ? 1 : 0;
} catch (e) {
  process.stdout.write(`  ✗ crashed: ${e.stack}\n`); fail++;
} finally {
  try { p.kill(); } catch {}
  cdp.close();
  if (process.env.MULTI_REAL_STDERR) (await import('node:fs')).writeFileSync(process.env.MULTI_REAL_STDERR, stderr.join('\n') + '\n');
  if (fail || process.env.MULTI_REAL_DEBUG) process.stdout.write(`--- launcher stderr (last 30)\n${stderr.slice(-30).join('\n')}\n`);
  process.stdout.write(`multi-real-e2e: ${pass} ok, ${fail} failures\n`);
  process.exit(exitCode);
}
