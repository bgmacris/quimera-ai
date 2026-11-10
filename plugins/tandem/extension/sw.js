// sw.js — tandem's tab-group helper, driven over CDP by scripts/tab-groups.mjs (Runtime.evaluate on this worker).
// CDP has no tab groups and no tab ids; chrome.debugger.getTargets() maps a CDP target id to a tab id. It only
// lists targets: no attach, so no "is debugging this browser" bar (checked headful, Chrome 157, 2026-11-09).

const tabIdsOf = async (targetIds) => {
  const ts = await chrome.debugger.getTargets();
  return targetIds.map((id) => ts.find((t) => t.id === id)?.tabId).filter((x) => typeof x === 'number');
};
const groupExists = async (id) => { if (typeof id !== 'number') return null; try { return await chrome.tabGroups.get(id); } catch { return null; } };

self.tandem = {
  // Put the pages in the agent's group (groupId, if it still exists) or a new one. onlyLoose: leave alone a tab that
  // is already in a group, or in another window than the agent's group (a tab of the human's, handed over).
  async group({ targetIds, groupId, title, color, collapsed, onlyLoose = false }) {
    let tabIds = await tabIdsOf(targetIds);
    let g = await groupExists(groupId);
    if (onlyLoose) {
      const tabs = await Promise.all(tabIds.map((id) => chrome.tabs.get(id)));
      tabIds = tabs.filter((t) => t.groupId === -1 && (!g || t.windowId === g.windowId)).map((t) => t.id);
    }
    if (!tabIds.length) return { groupId: g?.id ?? null, grouped: 0 };
    if (g) { await chrome.tabs.group({ groupId: g.id, tabIds }); return { groupId: g.id, grouped: tabIds.length }; }
    const id = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(id, { title, color, collapsed });
    return { groupId: id, grouped: tabIds.length, created: true };
  },
  // A new title for a group that still exists (0.13: the session was renamed).
  async retitle({ groupId, title }) {
    const g = await groupExists(groupId);
    if (!g || g.title === title) return { retitled: false };
    await chrome.tabGroups.update(g.id, { title });
    return { retitled: true };
  },
  // Take the pages out of whatever group they are in, if it is this one (a handed-over tab going back).
  async ungroup({ targetIds, groupId }) {
    const tabs = await Promise.all((await tabIdsOf(targetIds)).map((id) => chrome.tabs.get(id)));
    const ids = tabs.filter((t) => t.groupId !== -1 && t.groupId === groupId).map((t) => t.id);
    if (ids.length) await chrome.tabs.ungroup(ids);
    return { ungrouped: ids.length };
  },
  // For tests and diagnostics: every tab with its group.
  // With no window at all (headful Chrome after its last tab closed) these calls throw "No current window": that is
  // an empty browser, not an error (seen 2026-11-09, Chrome 157 on macOS).
  async list() {
    const safe = async (p) => { try { return await p; } catch (e) { if (/No current window/i.test(String(e?.message))) return []; throw e; } };
    const ts = await safe(chrome.debugger.getTargets());
    const groups = Object.fromEntries((await safe(chrome.tabGroups.query({}))).map((g) => [g.id, { title: g.title, color: g.color, collapsed: g.collapsed, windowId: g.windowId }]));
    const tabs = (await safe(chrome.tabs.query({}))).map((t) => ({ tabId: t.id, targetId: ts.find((x) => x.tabId === t.id)?.id ?? null, windowId: t.windowId, active: t.active, groupId: t.groupId, url: t.url || t.pendingUrl || '' }));
    return { tabs, groups };
  },
};
