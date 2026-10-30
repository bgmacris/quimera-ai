#!/usr/bin/env node
// focus-e2e.mjs — the REAL MCP through tandem's launcher clicks a button on a tab that is in the
// BACKGROUND (`hidden`, no animation frames). Without focus emulation Playwright's "stable" check never
// ends and the click fails at --timeout-action; with it the click goes through. Runs both (the first is
// the control: it proves the setup reproduces the bug), then checks the emulation is released after the
// linger. Needs tandem's Chrome up on TANDEM_CDP_PORT (tests/e2e.sh) and the fixture site.
// Usage: node tests/focus-e2e.mjs <site-url>   (exit 0 = green)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connect, browserWsUrl } from '../scripts/cdp.mjs';

const SITE = process.argv[2];
const launcher = fileURLToPath(new URL('../scripts/mcp-launch.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; let fail = 0;
const ok = (desc, cond, extra = '') => {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}${extra ? ` — ${extra}` : ''}\n`); if (process.env.GITHUB_ACTIONS) process.stdout.write(`::error title=focus-e2e::${desc}\n`); }
};

function mcp(env) {
  const p = spawn(process.execPath, [launcher], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = ''; const waiters = new Map(); let id = 0;
  p.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); waiters.get(m.id)?.(m); } catch {} }
  });
  const rpc = (method, params, ms = 120000) => new Promise((res, rej) => {
    const n = ++id; waiters.set(n, res); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    setTimeout(() => rej(new Error(`${method} timeout`)), ms);
  });
  const text = (r) => (r.result?.content || []).map((c) => c.text || '').join('\n');
  return { p, rpc, text, call: (name, args, ms) => rpc('tools/call', { name, arguments: args }, ms) };
}

// CDP side: which tab is ours, its visibility, its title.
const cdp = await connect(await browserWsUrl());
async function onTarget(url, expr) {
  const { targetInfos } = await cdp.call('Target.getTargets');
  const t = targetInfos.find((x) => x.type === 'page' && x.url === url);
  if (!t) return undefined;
  const { sessionId } = await cdp.call('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  try { return (await cdp.call('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId)).result?.value; }
  finally { await cdp.call('Target.detachFromTarget', { sessionId }).catch(() => {}); }
}

async function run(label, env) {
  const m = mcp({ TANDEM_FOCUS_LINGER_MS: '500', ...env });
  try {
    await m.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'focus-e2e', version: '0' } });
    m.p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const tools = (await m.rpc('tools/list', {})).result.tools;
    const props = tools.find((t) => t.name === 'browser_click').inputSchema.properties;
    const url = `${SITE}/focus?run=${label}`;
    await m.call('browser_navigate', { url });
    // Another tab in front: ours goes to the background, as when the human switches tabs.
    await cdp.call('Target.createTarget', { url: `${SITE}/front?run=${label}` });
    await sleep(800);
    const vis = await onTarget(url, 'document.visibilityState');
    const ref = m.text(await m.call('browser_snapshot', {})).match(/button "Go" \[ref=(\w+)\]/)?.[1];
    const t0 = Date.now();
    const r = await m.call('browser_click', { element: 'Go', [props.target ? 'target' : 'ref']: ref }, 60000);
    const ms = Date.now() - t0;
    const clicked = (await onTarget(url, 'document.title')) === 'clicked';
    await sleep(1500);   // > linger
    const after = await onTarget(url, 'document.visibilityState');
    return { vis, ref, ms, clicked, isError: !!r.result?.isError || !!r.error, after };
  } finally { m.p.kill(); }
}

console.log('focus emulation — click on a background tab through the real MCP');
const off = await run('off', { TANDEM_FOCUS_EMULATION: '0' });
ok('setup: the agent tab is hidden in the background', off.vis === 'hidden', `visibilityState=${off.vis}`);
ok('setup: snapshot found the button', !!off.ref);
ok(`control (TANDEM_FOCUS_EMULATION=0): the click does NOT go through (${off.ms} ms)`, !off.clicked && off.isError);
const on = await run('on', {});
ok('the agent tab was hidden before the click', on.vis === 'hidden', `visibilityState=${on.vis}`);
ok(`with focus emulation: the click goes through (${on.ms} ms)`, on.clicked && !on.isError && on.ms < 5000);
ok('emulation released after the linger (tab hidden again)', on.after === 'hidden', `visibilityState=${on.after}`);
cdp.close();
console.log(`focus-e2e: ${pass} ok, ${fail} failures`);
process.exit(fail ? 1 : 0);
