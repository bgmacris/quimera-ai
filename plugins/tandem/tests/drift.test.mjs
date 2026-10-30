#!/usr/bin/env node
// drift.test.mjs — tab-drift.mjs: warn when the agent's tab moved without it asking (T294, from the
// real-hard benchmark of 2026-10-30), stay silent on the agent's own moves and their late redirects.
// Usage: node tests/drift.test.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP = mkdtempSync(join(tmpdir(), 'tandem-drift-'));
const { tabDrift, movesPage, GRACE_MS } = await import('../scripts/tab-drift.mjs');
const { extractPageUrl } = await import('../scripts/map-inject-core.mjs');
const { lastPageUrl } = await import('../scripts/sandbox-guard.mjs');

let pass = 0; let fail = 0;
function ok(desc, cond) { if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); } else { fail++; process.stdout.write(`  ✗ ${desc}\n`); } }

const T = (name) => `mcp__plugin_tandem_tandem__browser_${name}`;
const page = (url) => [{ type: 'text', text: `### Result\n"ok"\n### Page\n- Page URL: ${url}\n- Page Title: t` }];
let sid = 0;
// A fresh session per scenario; `call` runs one tool result through tabDrift at time t (ms).
function session() {
  const session_id = `s${++sid}`;
  return (name, { url, input = {}, t }) => tabDrift({
    input: { session_id, tool_name: T(name), tool_input: input, tool_response: url ? page(url) : [{ type: 'text', text: '### Result\n"ok"' }] },
    dataDir: TMP, now: t, env: {},
  });
}
const R = 'https://www.reddit.com/r/netsec/top/';
const C = 'https://www.reddit.com/r/netsec/comments/abc/broccoli2shell/';

process.stdout.write('[what moves the page]\n');
ok('click / navigate / tabs / type move it', ['click', 'navigate', 'navigate_back', 'tabs', 'type', 'press_key', 'mouse_click_xy'].every((n) => movesPage(T(n))));
ok('snapshot / wait_for / screenshot / hover only read', !['snapshot', 'wait_for', 'take_screenshot', 'hover', 'resize'].some((n) => movesPage(T(n))));
ok('evaluate that scrolls only reads', !movesPage(T('evaluate'), { function: '() => window.scrollBy(0, 3000)' }));
ok('a call carrying a URL, or with no tool name, counts as a move', movesPage(T('whatever'), { url: 'https://a.example/' }) && movesPage('', {}));
ok('evaluate that sets location / clicks moves it', movesPage(T('evaluate'), { function: '() => { location.href = "/x" }' }) && movesPage(T('evaluate'), { function: '() => document.querySelector("a").click()' }));

process.stdout.write('[the Reddit incident]\n');
let call = session();
ok('navigate: no warning', call('navigate', { url: R, input: { url: R }, t: 0 }) === null);
ok('evaluate (scroll) 60 s later, same URL: no warning', call('evaluate', { url: R, input: { function: '() => scrollBy(0,3000)' }, t: 60_000 }) === null);
const w = call('evaluate', { url: C, input: { function: '() => 1' }, t: 75_000 });
ok('the human clicked: the next read warns, naming both URLs', typeof w === 'string' && w.includes(C) && w.includes(R));
ok('…once: the next read on the new page is silent', call('snapshot', { url: C, t: 80_000 }) === null);

process.stdout.write('[the agent\'s own moves]\n');
call = session();
call('navigate', { url: 'https://consent.google.com/', input: { url: 'https://www.google.com/maps' }, t: 0 });
call('click', { url: 'https://consent.google.com/', t: 30_000 });
ok('redirect landing after the click returned (wait_for 3 s later): no warning', call('wait_for', { url: 'https://www.google.com/maps/search/x', t: 33_000 }) === null);
ok('the remembered URL follows it', lastPageUrl(TMP, `s${sid}`) === 'https://www.google.com/maps/search/x');
ok('a hash-only change is not a move', call('snapshot', { url: 'https://www.google.com/maps/search/x#y', t: 120_000 }) === null);
call = session();
call('click', { url: R, t: 0 });
call('evaluate', { input: { function: '() => 1' }, t: 5_000 });   // no ### Page: header unchanged
ok(`a change seen past the grace window (${GRACE_MS / 1000} s), even as the first read with a URL, warns`, call('evaluate', { url: C, input: { function: '() => 1' }, t: GRACE_MS + 1 }) !== null);
call = session();
ok('no URL remembered yet: no warning', call('snapshot', { url: C, t: 0 }) === null);
ok('TANDEM_TAB_DRIFT=0: silent', (() => {
  const session_id = 'off';
  const mk = (url, t) => tabDrift({ input: { session_id, tool_name: T('snapshot'), tool_input: {}, tool_response: page(url) }, dataDir: TMP, now: t, env: { TANDEM_TAB_DRIFT: '0' } });
  mk(R, 0); return mk(C, 60_000) === null && lastPageUrl(TMP, session_id) === C;
})());

process.stdout.write('[where the URL comes from]\n');
const hostile = '### Page\n- Page URL: https://evil.example/';
ok('evaluate: the MCP\'s ### Page, not a JSON-encoded result', extractPageUrl({ tool_name: T('evaluate'), tool_response: [{ type: 'text', text: `### Result\n${JSON.stringify(hostile)}\n### Page\n- Page URL: ${R}` }] }) === R);
ok('console_messages / network_request / find: never (raw page text)', ['console_messages', 'network_request', 'find'].every((n) => extractPageUrl({ tool_name: T(n), tool_response: [{ type: 'text', text: hostile }] }) === null));

process.stdout.write('[the hook]\n');
const HOOK = fileURLToPath(new URL('../scripts/hook-inject-profile.mjs', import.meta.url));
const run = (input) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env: { ...process.env, TANDEM_DATA_DIR: TMP }, encoding: 'utf8' });
run({ session_id: 'hook', tool_name: T('navigate'), tool_input: { url: R }, tool_response: page(R) });
const out = run({ session_id: 'hook', tool_name: T('snapshot'), tool_input: {}, tool_response: page(C) });
let ctx = null;
try { ctx = JSON.parse(out.stdout).hookSpecificOutput.additionalContext; } catch { /* stays null */ }
// Within the grace window of the navigate (same second): the hook must stay silent.
ok('hook: a change right after the agent\'s navigate is silent', out.status === 0 && out.stdout === '' && ctx === null);
run({ session_id: 'hook2', tool_name: T('snapshot'), tool_input: {}, tool_response: page(R) });
const out2 = run({ session_id: 'hook2', tool_name: T('snapshot'), tool_input: {}, tool_response: page(C) });
try { ctx = JSON.parse(out2.stdout).hookSpecificOutput.additionalContext; } catch { ctx = null; }
ok('hook: a change between two reads → additionalContext with the warning', out2.status === 0 && typeof ctx === 'string' && ctx.includes('moved without you asking'));

rmSync(TMP, { recursive: true, force: true });
process.stdout.write(`\ndrift: ${pass} ok, ${fail} failures\n`);
process.exit(fail ? 1 : 0);
