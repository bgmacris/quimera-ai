// sandbox-guard.mjs — deny the browser_* calls that would HANG on a page that cannot run scripts.
//
// @playwright/mcp (0.0.83, still on Playwright main 2026-10-29) ends every action with a "settle" wait
// that is a setTimeout INSIDE the page. A document served with CSP `sandbox` (no `allow-scripts`) — every
// raw.githubusercontent.com file — runs no page tasks at all: the wait never resolves and the tool call
// never returns, no error, no timeout. Seen in the tandem-vs-Firecrawl bench (2 of 5 research runs hung
// reading READMEs); fix proposed upstream: https://github.com/microsoft/playwright/pull/43746.
//
// Until that ships, the autostart PreToolUse hook asks this module before the calls that go through that
// wait. Probe over the browser endpoint (Playwright holds the page targets), two steps:
//   sync `1`       answers  → the page is not busy;
//   a microtask    resolves → the page runs scripts → allow.
// Sync answers but the microtask never does → the page cannot run scripts → deny with what to do instead.
// Microtasks, not timers: a hidden tab delays timers and rAF (measured: rAF 757 ms / never), never
// microtasks — a timer probe would deny on background tabs. A busy page (sync slow) is allowed: unknown.
// The current tab comes from the last `Page URL` the PostToolUse hook saw; when it can't be told apart,
// allow — a missed hang is what tandem had before, a wrong deny breaks a call that would have worked.
// TANDEM_SANDBOX_GUARD=0 turns it off.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { browserWsUrl, connect, listPages } from './cdp.mjs';
import { sessionKey } from './map-inject-core.mjs';

// The tools whose handler goes through the MCP's waitForCompletion (read from the 0.0.83 bundle).
// browser_type only with submit/slowly; a click that NAVIGATES returns (the navigation rejects the wait),
// but whether a click navigates is not known before it runs.
const WAITING = /^mcp__.*tandem__browser_(click|drag|drop|evaluate|file_upload|handle_dialog|mouse_click_xy|mouse_drag_xy|press_key|press_sequentially|run_code_unsafe)$/;
const TYPE = /^mcp__.*tandem__browser_type$/;

export function guarded(tool, toolInput = {}) {
  if (WAITING.test(tool)) return true;
  return TYPE.test(tool) && !!(toolInput.submit || toolInput.slowly);
}

const urlFile = (dataDir, sessionId) => join(dataDir, '.hook-state', sessionKey(sessionId), '.page-url');

// PostToolUse records it; '.page-url' cannot clash with the per-host markers (hosts don't start with '.').
export function rememberPageUrl(dataDir, sessionId, url) {
  try {
    mkdirSync(join(dataDir, '.hook-state', sessionKey(sessionId)), { recursive: true });
    writeFileSync(urlFile(dataDir, sessionId), url);
  } catch { /* never break the session */ }
}

export function lastPageUrl(dataDir, sessionId) {
  try { return readFileSync(urlFile(dataDir, sessionId), 'utf8'); } catch { return null; }
}

// Which page targets can be the MCP's current tab: those on the last URL seen, else the only page.
export function candidatePages(pages, lastUrl) {
  const onUrl = lastUrl ? pages.filter((p) => p.url === lastUrl) : [];
  if (onUrl.length) return onUrl;
  return pages.length === 1 ? pages : [];
}

const race = (p, ms) => Promise.race([p.then(() => true, () => false), new Promise((f) => setTimeout(() => f(null), ms))]);

// 'scripts' | 'blocked' | 'busy' | 'unknown'
export async function probeTarget(client, targetId, ms = 400) {
  let sessionId;
  try {
    ({ sessionId } = await client.call('Target.attachToTarget', { targetId, flatten: true }));
    const sync = await race(client.call('Runtime.evaluate', { expression: '1', returnByValue: true }, sessionId), ms);
    if (sync === null) return 'busy';
    if (!sync) return 'unknown';
    const micro = await race(client.call('Runtime.evaluate', {
      expression: 'new Promise(r => queueMicrotask(() => r(1)))', awaitPromise: true, returnByValue: true,
    }, sessionId), ms);
    return micro === null ? 'blocked' : micro ? 'scripts' : 'unknown';
  } catch { return 'unknown'; } finally {
    if (sessionId) client.call('Target.detachFromTarget', { sessionId }).catch(() => {});
  }
}

// null = allow; else the PreToolUse deny for the hook to print.
export async function sandboxGuard({ input, port, dataDir, env = process.env }) {
  if (env.TANDEM_SANDBOX_GUARD === '0') return null;
  const tool = String(input?.tool_name || '');
  if (!guarded(tool, input?.tool_input || {})) return null;
  let client;
  try {
    const pages = candidatePages(await listPages(port, 1000), lastPageUrl(dataDir, input.session_id));
    if (!pages.length) return null;
    client = await connect(await browserWsUrl(port, 1000), { timeoutMs: 1000 });
    for (const p of pages) if (await probeTarget(client, p.id) !== 'blocked') return null;
    const url = pages[0].url;
    const name = tool.replace(/^.*__/, '');
    return {
      permissionDecision: 'deny',
      permissionDecisionReason: `tandem: the current page (${url}) cannot run scripts — it is served with CSP \`sandbox\`, as every raw.githubusercontent.com file is — and ${name} would hang forever on it (a @playwright/mcp bug: its post-action wait is a timer inside the page; fix proposed in microsoft/playwright#43746). Instead: read the page with browser_snapshot; or browser_navigate to a normal page and fetch('${url}') from browser_evaluate there (raw.githubusercontent.com allows CORS); to follow a link, browser_navigate to its href rather than clicking it.`,
    };
  } catch { return null; } finally { client?.close(); }
}
