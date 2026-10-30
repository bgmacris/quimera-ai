#!/usr/bin/env node
// drift-e2e.mjs — the premise of tab-drift.mjs against the REAL MCP: when someone else moves the agent's
// tab, the next READ tool (browser_evaluate, which prints `### Page` only when the tab header changed)
// carries the new URL, and tabDrift turns it into the warning. "Someone else" = another CDP client
// navigating the tab, as a human click in the window does. Needs tandem's Chrome up on TANDEM_CDP_PORT
// (tests/e2e.sh) and the fixture site.
// Usage: node tests/drift-e2e.mjs <site-url>   (exit 0 = green)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, browserWsUrl } from '../scripts/cdp.mjs';
import { tabDrift, GRACE_MS } from '../scripts/tab-drift.mjs';

const SITE = process.argv[2];
const launcher = fileURLToPath(new URL('../scripts/mcp-launch.mjs', import.meta.url));
const DATA = mkdtempSync(join(tmpdir(), 'tandem-drift-e2e-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; let fail = 0;
const ok = (desc, cond, extra = '') => {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}${extra ? ` — ${extra}` : ''}\n`); if (process.env.GITHUB_ACTIONS) process.stdout.write(`::error title=drift-e2e::${desc}\n`); }
};

const p = spawn(process.execPath, [launcher], { env: { ...process.env, TANDEM_FOCUS_EMULATION: '0' }, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = ''; const waiters = new Map(); let id = 0;
p.stdout.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); waiters.get(m.id)?.(m); } catch {} }
});
const rpc = (method, params, ms = 120000) => new Promise((res, rej) => {
  const n = ++id; waiters.set(n, res); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  setTimeout(() => rej(new Error(`${method} timeout`)), ms);
});
// One tool call through the MCP, its result through tabDrift as the PostToolUse hook would pass it.
let clock = 0;
async function call(name, args) {
  const r = await rpc('tools/call', { name, arguments: args });
  clock += GRACE_MS + 1;   // every call well past the previous one's grace window
  const warning = tabDrift({
    input: { session_id: 'drift-e2e', tool_name: `mcp__plugin_tandem_tandem__${name}`, tool_input: args, tool_response: r.result?.content },
    dataDir: DATA, now: clock, env: {},
  });
  return { text: (r.result?.content || []).map((c) => c.text || '').join('\n'), warning };
}

const A = `${SITE}/drift-a`; const B = `${SITE}/drift-b`;
console.log('tab drift — someone else moves the agent\'s tab, through the real MCP');
const cdp = await connect(await browserWsUrl());
try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'drift-e2e', version: '0' } });
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const nav = await call('browser_navigate', { url: A });
  ok('navigate (the agent\'s own move): no warning', nav.warning === null);
  const quiet = await call('browser_evaluate', { function: '() => 1' });
  ok('evaluate with nothing changed: no warning', quiet.warning === null);
  // The "human": another CDP client takes the same tab elsewhere.
  const { targetInfos } = await cdp.call('Target.getTargets');
  const t = targetInfos.find((x) => x.type === 'page' && x.url === A);
  const { sessionId } = await cdp.call('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  await cdp.call('Page.navigate', { url: B }, sessionId);
  await sleep(800);
  await cdp.call('Target.detachFromTarget', { sessionId }).catch(() => {});
  const moved = await call('browser_evaluate', { function: '() => document.title' });
  ok('the MCP prints the new ### Page in a read tool\'s result', moved.text.includes('### Page') && moved.text.includes(`- Page URL: ${B}`), moved.text.slice(0, 300));
  ok('tabDrift warns, naming both URLs', typeof moved.warning === 'string' && moved.warning.includes(B) && moved.warning.includes(A), String(moved.warning));
  const again = await call('browser_evaluate', { function: '() => 1' });
  ok('the next read on the new page: no warning', again.warning === null);
} finally {
  p.kill(); cdp.close(); rmSync(DATA, { recursive: true, force: true });
}
process.stdout.write(`drift-e2e: ${pass} ok, ${fail} failures\n`);
process.exit(fail ? 1 : 0);
