// human-tabs.mjs — which of the HUMAN's tabs an agent may adopt (multi-session phase 4, research R05 §16).
//
// Decided by Bog (2026-11-03): only the tab the human brought into view. The physical gesture is the
// consent — a page injecting "adopt my bank tab" can't point anywhere else — and `url` only chooses
// among the visible ones. Measured headful: `visible` = the active tab of each window that is not
// minimized, also while another app is in front; hasFocus() only with Chrome itself in front.
//   one visible → that one; several → the focused one if exactly one; else `url` among the visible;
//   anything else → no adoption, the visible ones are listed.
// "The human's" = no live tandem session claims it (tab-owners.mjs): not this session's agents', not
// another session's. visibilityState is read in an ISOLATED world: the page's own scripts can't fake it.

import { browserWsUrl, connect, listPages } from './cdp.mjs';

const INTERNAL = /^(chrome|chrome-extension|devtools|chrome-untrusted|edge):/;

// cands: [{ id, url, title, visible, focused }] → { tab } | { error, list }
export function chooseHumanTab(cands, { url } = {}) {
  const visible = cands.filter((c) => c.visible);
  const list = visible.map(({ url: u, title }) => ({ url: u, title }));
  if (url) {
    const hits = visible.filter((c) => c.url.includes(url));
    if (hits.length === 1) return { tab: hits[0] };
    if (hits.length > 1) return { error: `${hits.length} of the human's visible tabs match "${url}": pass more of the URL`, list: hits.map(({ url: u, title }) => ({ url: u, title })) };
    const hidden = cands.some((c) => !c.visible && c.url.includes(url));
    return { error: hidden
      ? `the human's tab matching "${url}" is not in view: ask the human to bring it to the front in the shared Chrome, then call this again`
      : `none of the human's visible tabs matches "${url}"`, list };
  }
  if (visible.length === 1) return { tab: visible[0] };
  if (!visible.length) return { error: 'no tab of the human is in view: ask the human to bring the tab they want to give you to the front in the shared Chrome, then call this again', list };
  const focused = visible.filter((c) => c.focused);
  if (focused.length === 1) return { tab: focused[0] };
  return { error: `${visible.length} of the human's tabs are in view: pass \`url\` (part of its URL) to say which one`, list };
}

// The human's tabs with what the human sees of them. registry: tabOwners(dataDir) (classify → 'human').
export async function humanTabs({ port, registry, timeoutMs = 800 }) {
  const pages = (await listPages(port, 1500)).filter((p) => p.type === 'page' && !INTERNAL.test(p.url || '') && registry.classify(p.id) === 'human');
  if (!pages.length) return [];
  const c = await connect(await browserWsUrl(port, 1500), { timeoutMs });
  try {
    return await Promise.all(pages.map(async (p) => {
      const out = { id: p.id, url: p.url || '', title: p.title || '', visible: false, focused: false };
      let sessionId;
      try {
        ({ sessionId } = await c.call('Target.attachToTarget', { targetId: p.id, flatten: true }));
        const { frameTree } = await c.call('Page.getFrameTree', {}, sessionId);
        const { executionContextId: contextId } = await c.call('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'tandem-visibility' }, sessionId);
        const v = (await c.call('Runtime.evaluate', { expression: '[document.visibilityState, document.hasFocus()]', contextId, returnByValue: true }, sessionId)).result?.value;
        if (Array.isArray(v)) { out.visible = v[0] === 'visible'; out.focused = v[1] === true; }
      } catch { /* busy or paused page: not in view as far as we can tell */ }
      finally { if (sessionId) c.call('Target.detachFromTarget', { sessionId }).catch(() => {}); }
      return out;
    }));
  } finally { c.close(); }
}
