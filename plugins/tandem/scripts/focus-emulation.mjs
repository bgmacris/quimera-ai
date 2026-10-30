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
// Which tab, and the on-while-working/linger cycle: agent-tab.mjs (shared with pdf-capture.mjs).
// TANDEM_FOCUS_EMULATION=0 turns it off; TANDEM_FOCUS_LINGER_MS.

import { DEFAULT_LINGER_MS, agentTabHold } from './agent-tab.mjs';
import { extractTabUrl } from './map-inject-core.mjs';

export { DEFAULT_LINGER_MS };

export function focusEmulator({ port, lingerMs = DEFAULT_LINGER_MS, budgetMs = 500, log = () => {} }) {
  return agentTabHold({
    port, lingerMs, budgetMs, log, label: 'focus',
    onAttach: (c, sessionId) => c.call('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId),
  });
}

// Several watchers behind one proxy: begin() in parallel (each bounded by its own budget), end() to all,
// and the notes each wants added to the response.
export function combine(...watchers) {
  const ws = watchers.filter(Boolean);
  return {
    async begin() { await Promise.all(ws.map((w) => w.begin())); },
    end(name, args, result) { for (const w of ws) w.end(name, args, result); },
    notes(name, args, result) { return ws.flatMap((w) => (w.notes ? w.notes(name, args, result) : [])); },
    useLocator(fn) { for (const w of ws) w.useLocator?.(fn); },
    close() { for (const w of ws) w.close?.(); },
  };
}

// Transparent stdio proxy between the MCP client and the MCP server. MCP's stdio transport is one
// JSON-RPC message per line, no embedded newlines; every non-empty line is forwarded byte for byte, in order —
// parsing is only to watch tools/call. A request is held back only while begin() runs. The one exception
// to byte for byte: a tools/call result the emulator has notes for (emulator.notes) gets them appended
// as text blocks — e.g. "a PDF was captured" (pdf-capture.mjs). And the proxy may ask the MCP itself
// (ids `tandem-probe-N`, answers never reach the client): `browser_tabs list`, to name the agent's tab
// before any result has (agent-tab.mjs). Every MCP response marks a tab's header as reported, so the probe
// swallows a change the agent never saw (and tab-drift.mjs warns on) — and `browser_tabs` doesn't print
// `### Page` itself (verified, 0.0.83). When the probe finds the tab on another URL than the last one known,
// the agent's next result gets `### Page` / `- Page URL:` with that URL (the MCP's own answer), unless it
// has its own section.
export function proxyStdio({ clientIn, clientOut, serverIn, serverOut, emulator }) {
  const calls = new Map();   // request id → { name, args }
  const probes = new Map();  // our own request id → resolve
  let probeId = 0;
  const ask = (method, params, ms = 5000) => new Promise((resolve) => {
    const id = `tandem-probe-${++probeId}`;
    const t = setTimeout(() => { probes.delete(id); resolve(null); }, ms); t.unref?.();
    probes.set(id, (m) => { clearTimeout(t); resolve(m); });
    serverIn.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  // One question in flight at a time: every hold asks on the same begin().
  let asking = null;
  let owed = null;   // the `### Page` section the probe took from the agent
  emulator.useLocator?.((prev) => (asking ??= ask('tools/call', { name: 'browser_tabs', arguments: { action: 'list' } })
    .then((m) => {
      const url = extractTabUrl({ tool_name: 'browser_tabs', tool_response: m?.result ?? null });
      if (prev && url && url !== prev) owed = `### Page\n- Page URL: ${url}`;
      return url;
    })
    .finally(() => { asking = null; })));
  // → the notes to add to this response (none for a cancelled call: its response never comes).
  const finish = (id, result) => {
    const c = calls.get(id); if (!c) return [];
    calls.delete(id); emulator.end(c.name, c.args, result);
    return result ? (emulator.notes?.(c.name, c.args, result) || []) : [];
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
    let out = line;
    try {
      const m = JSON.parse(line);
      if (!m.method && probes.has(m.id)) { const r = probes.get(m.id); probes.delete(m.id); r(m); return; }   // ours: not for the client
      if (!m.method && m.id !== undefined) {   // a response, not a server request
        const isCall = calls.has(m.id);
        const notes = finish(m.id, m.result ?? null);
        if (isCall && owed && Array.isArray(m.result?.content)) {
          if (!hasPageSection(m.result)) notes.unshift(owed);
          owed = null;
        }
        if (notes.length && Array.isArray(m.result?.content)) {
          m.result.content.push(...notes.map((text) => ({ type: 'text', text })));
          out = JSON.stringify(m);
        }
      }
    } catch { /* forward anyway */ }
    clientOut.write(out + '\n');
  });
}

const hasPageSection = (result) => (result?.content || []).some((c) => /(^|\n)### Page(\r?\n|$)/.test(c?.text || ''));

function lines(stream, onLine, onEnd = () => {}) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l) onLine(l); }
  });
  stream.on('end', () => { if (buf) onLine(buf); onEnd(); });
}
