// agent-tab.mjs — hold a CDP session on the agent's tab while its tools run, and LINGER after.
//
// The launcher (mcp-launch.mjs) is the one process that lives as long as the MCP, so what must stay on
// while the agent works goes here: focus emulation (focus-emulation.mjs) and PDF capture (pdf-capture.mjs).
// Both are session-scoped in Chrome: on while our session is attached, gone when it detaches or the
// connection closes (a crash releases them by itself).
//
// Which tab: the MCP's current one isn't exposed, so the same guess as sandbox-guard.mjs — the pages on
// the last URL a result showed (map-inject-core.mjs parser: `### Page` / `(current)`), else the only page.
// Before any result (the session's first call) with several tabs open — or when no tab is on that URL
// any more (it moved on its own) — a locator, the proxy asking the MCP `browser_tabs list` itself, names
// it; the first begin() may wait up to firstBudgetMs (the MCP connects to Chrome on its first call anyway). Unknown → nothing. Only those pages: the human's other
// tabs are not touched.
// begin() before each tools/call is forwarded (waits at most budgetMs, or firstBudgetMs while the tab
// is still unknown); end() after its response;
// LINGER after the last one, everything is released.

import { browserWsUrl, connect, listPages } from './cdp.mjs';
import { extractTabUrl } from './map-inject-core.mjs';
import { candidatePages } from './sandbox-guard.mjs';

export const DEFAULT_LINGER_MS = 15_000;

// onClient(client): once per connection (register event handlers). onAttach(client, sessionId, page):
// once per attached tab — what to switch on.
// callTimeoutMs: per CDP call on the hold's connection (begin() is bounded by its budget either way).
export function agentTabHold({ port, lingerMs = DEFAULT_LINGER_MS, budgetMs = 500, firstBudgetMs = 3000, callTimeoutMs = budgetMs, log = () => {}, label = 'tab', onClient = () => {}, onAttach }) {
  let client = null;
  let lastUrl = null;
  let locate = null;   // async (lastKnownUrl) => the MCP's current tab URL, or null
  let busy = 0;
  let timer = null;
  const held = new Map();   // targetId → sessionId

  async function ensureClient() {
    if (client) return client;
    const c = await connect(await browserWsUrl(port, budgetMs), { timeoutMs: callTimeoutMs });
    c.onClose(() => { if (client === c) { client = null; held.clear(); } });   // Chrome gone: nothing held
    onClient(c);
    return (client = c);
  }
  // Detaching is what switches it off (session-scoped).
  const release = (id) => { const s = held.get(id); held.delete(id); client?.call('Target.detachFromTarget', { sessionId: s }).catch(() => {}); };
  const releaseAll = () => { for (const id of [...held.keys()]) release(id); };

  async function enable() {
    const all = await listPages(port, budgetMs);
    let pages = candidatePages(all, lastUrl);
    // No page on the last URL a result showed: none yet, or the tab moved on its own since (a script
    // navigation, a blob:, a redirect, the human) — ask the MCP which tab is its own.
    if (!pages.length && all.length > 1 && locate) {
      const url = await locate(lastUrl).catch((e) => { log(`${label}: locate failed: ${e.message}`); return null; });
      log(`${label}: the MCP says its tab is ${url || '?'} (${all.length} tabs open)`);   // not the human's URLs
      if (url) { lastUrl = url; pages = candidatePages(all, lastUrl); }
    }
    log(`${label}: tab ${lastUrl || '?'} → ${pages.length} page(s) of ${all.length}`);
    const want = new Set(pages.map((p) => p.id));
    for (const id of held.keys()) if (!want.has(id)) release(id);   // no longer the current tab
    if (!want.size) return;
    const c = await ensureClient();
    for (const page of pages) {
      if (held.has(page.id)) continue;
      const { sessionId } = await c.call('Target.attachToTarget', { targetId: page.id, flatten: true });
      held.set(page.id, sessionId);
      await onAttach(c, sessionId, page);
      // Past budgetMs the call went ahead; if it already ended AND the linger fired, nobody will release this.
      if (busy === 0 && !timer) release(page.id);
    }
  }

  return {
    // Before a tool call is forwarded. Never throws, never waits past its budget: a slow or absent Chrome
    // must not delay the call more than that (autostart.mjs reports a missing browser).
    async begin() {
      busy++; clearTimeout(timer); timer = null;
      const done = enable().catch((e) => log(`${label}: ${e.message}`));
      const wait = !lastUrl && locate ? firstBudgetMs : budgetMs;
      await Promise.race([done, new Promise((r) => setTimeout(r, wait).unref())]);
    },
    useLocator(fn) { locate = fn; },
    // After its response. `name`/`args`/`result` update the current-tab guess.
    end(name, args, result) {
      const url = extractTabUrl({ tool_name: name, tool_input: args || {}, tool_response: result })
        || (typeof args?.url === 'string' ? args.url : null);
      if (url) lastUrl = url;
      if (--busy > 0) return;
      busy = 0;
      timer = setTimeout(() => { timer = null; releaseAll(); }, lingerMs); timer.unref();
    },
    close() { clearTimeout(timer); client?.close(); },
    get held() { return held.size; },
  };
}
