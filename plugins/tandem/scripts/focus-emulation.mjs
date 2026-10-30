// focus-emulation.mjs — keep the agent's tab painting while its tools run, so clicks don't hang.
//
// The bug: @playwright/mcp connects with connectOverCDP(..., { noDefaults: true }), and Playwright then
// skips Emulation.setFocusEmulationEnabled on the default context's pages (bundle 0.0.83). A tab that is
// not the active one of its window, a covered window or a minimized one is `hidden`: no animation frames,
// and Playwright's "stable" check before a click waits for frames → the click hangs until --timeout-action.
// Reproduced with ONE connection and plain playwright-core + noDefaults; with emulation on, background
// tabs, minimized windows and a hidden Chrome (⌘H) all stay visible and clickable (R05 §10, measured headful).
//
// Not always on: an animated hidden page with emulation costs what a visible one does (~26–30 % of a core
// measured, vs ~1 % without; R05 §11). So ON DEMAND: switched on before each tools/call reaches the MCP
// (on → first frame 13–14 ms), off LINGER after the last one ends. 15 s is the knee measured on 948 real
// pauses between browser calls (R05 §14): 90 % fewer visibilitychange flips than switching off after
// every call, for +16 points of painting time while the agent works; nothing once it stops.
//
// Session-scoped (verified headless: detaching the session or closing the connection that set it puts the
// tab back to `hidden`; another session switching it off does NOT), so a hook can't hold it — the launcher
// can: it lives as long as the MCP. A crash releases it by itself. Several sessions don't interfere.
//
// Which tab: the MCP's current one isn't exposed, so the same guess as sandbox-guard.mjs — the pages on
// the last URL a result showed (map-inject-core.mjs parser: `### Page` / `(current)`), else the only page.
// Unknown → nothing (what tandem did before). Only those pages: the human's other tabs are not touched.
// TANDEM_FOCUS_EMULATION=0 turns it off (the launcher then pipes nothing); TANDEM_FOCUS_LINGER_MS.

import { browserWsUrl, connect, listPages } from './cdp.mjs';
import { extractNavigateUrl } from './map-inject-core.mjs';
import { candidatePages } from './sandbox-guard.mjs';

export const DEFAULT_LINGER_MS = 15_000;

export function focusEmulator({ port, lingerMs = DEFAULT_LINGER_MS, budgetMs = 500, log = () => {} }) {
  let client = null;
  let lastUrl = null;
  let busy = 0;
  let timer = null;
  const held = new Map();   // targetId → sessionId with emulation on

  async function ensureClient() {
    if (client) return client;
    const c = await connect(await browserWsUrl(port, budgetMs), { timeoutMs: budgetMs });
    c.onClose(() => { if (client === c) { client = null; held.clear(); } });   // Chrome gone: nothing held
    return (client = c);
  }
  // Detaching is what switches it off (session-scoped).
  const release = (id) => { const s = held.get(id); held.delete(id); client?.call('Target.detachFromTarget', { sessionId: s }).catch(() => {}); };
  const releaseAll = () => { for (const id of [...held.keys()]) release(id); };

  async function enable() {
    const want = new Set(candidatePages(await listPages(port, budgetMs), lastUrl).map((p) => p.id));
    for (const id of held.keys()) if (!want.has(id)) release(id);   // no longer the current tab
    if (!want.size) return;
    const c = await ensureClient();
    for (const id of want) {
      if (held.has(id)) continue;
      const { sessionId } = await c.call('Target.attachToTarget', { targetId: id, flatten: true });
      held.set(id, sessionId);
      await c.call('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
      // Past budgetMs the call went ahead; if it already ended AND the linger fired, nobody will release this.
      if (busy === 0 && !timer) release(id);
    }
  }

  return {
    // Before a tool call is forwarded. Never throws, never waits past budgetMs: a slow or absent Chrome
    // must not delay the call more than that (autostart.mjs reports a missing browser).
    async begin() {
      busy++; clearTimeout(timer); timer = null;
      const done = enable().catch((e) => log(`focus: ${e.message}`));
      await Promise.race([done, new Promise((r) => setTimeout(r, budgetMs).unref())]);
    },
    // After its response. `name`/`args`/`result` update the current-tab guess.
    end(name, args, result) {
      const url = extractNavigateUrl({ tool_name: name, tool_input: args || {}, tool_response: result });
      if (url) lastUrl = url;
      if (--busy > 0) return;
      busy = 0;
      timer = setTimeout(() => { timer = null; releaseAll(); }, lingerMs); timer.unref();
    },
    close() { clearTimeout(timer); client?.close(); },
    get held() { return held.size; },
  };
}

// Transparent stdio proxy between the MCP client and the MCP server. MCP's stdio transport is one
// JSON-RPC message per line, no embedded newlines; every non-empty line is forwarded byte for byte, in order —
// parsing is only to watch tools/call. A request is held back only while begin() runs.
export function proxyStdio({ clientIn, clientOut, serverIn, serverOut, emulator }) {
  const calls = new Map();   // request id → { name, args }
  const finish = (id, result) => {
    const c = calls.get(id); if (!c) return;
    calls.delete(id); emulator.end(c.name, c.args, result);
  };
  let queue = Promise.resolve();
  lines(clientIn, (line) => {
    let m = null; try { m = JSON.parse(line); } catch { /* not ours to judge: forward */ }
    queue = queue.then(async () => {
      if (m?.method === 'tools/call' && m.id !== undefined) {
        calls.set(m.id, { name: m.params?.name, args: m.params?.arguments });
        await emulator.begin();
      } else if (m?.method === 'notifications/cancelled') finish(m.params?.requestId, null);
      serverIn.write(line + '\n');
    });
  }, () => queue.then(() => serverIn.end()));
  lines(serverOut, (line) => {
    try {
      const m = JSON.parse(line);
      if (!m.method && m.id !== undefined) finish(m.id, m.result ?? null);   // a response, not a server request
    } catch { /* forward anyway */ }
    clientOut.write(line + '\n');
  });
}

function lines(stream, onLine, onEnd = () => {}) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l) onLine(l); }
  });
  stream.on('end', () => { if (buf) onLine(buf); onEnd(); });
}
