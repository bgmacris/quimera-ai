// tab-groups.mjs — each agent's tabs in a tab group of its own (0.12, research R09 §3.1 and §5).
//
// Since 0.11 agents' pages are background tabs in one window: one window, but nothing tells the human's tabs from
// an agent's. CDP has no tab groups, so tandem loads a tiny extension (extension/) over CDP — Extensions.loadUnpacked,
// no flag needed in Chrome 157 (measured headful and headless) — and drives its service worker with
// Runtime.evaluate. The extension does not survive a Chrome restart (measured): nothing is left in the profile.
//
// Groups: "main · <project>" open, "sub <id> · <project>" collapsed (Bog, 2026-11-09); one color per session.
// A handed-over tab of the human's joins its agent's group only if it is loose and in the same window, and leaves it
// when given back. A group goes away by itself when its last tab closes (Chrome then deletes its saved-group entry;
// one orphan tab entry is left in Sync Data — R09 §5).
//
// MV3 workers stop ~30 s after their last event; an attached CDP session keeps it alive (measured 45 s), and a
// stopped one is started again by loading the extension again (same id). Several sessions share it: each attaches.
// Never in the way: every operation is serialized, bounded, and its failure only logged. Off with
// TANDEM_AGENT_GROUPS=0, and in external browser mode (the user's own Chrome).

import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserWsUrl, connect } from './cdp.mjs';

export const EXTENSION_DIR = resolve(fileURLToPath(new URL('../extension/', import.meta.url)));
const COLORS = ['blue', 'purple', 'cyan', 'green', 'orange', 'pink', 'yellow', 'red'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const samePath = (a, b) => resolve(String(a || '')).replace(/[\\/]+$/, '').toLowerCase() === resolve(b).replace(/[\\/]+$/, '').toLowerCase();

export function sessionColor(seed) {
  let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
export function groupTitle(agent, project) {
  return `${agent === 'main' ? 'main' : `sub ${String(agent).slice(0, 4)}`}${project ? ` · ${project}` : ''}`;
}
export function groupsEnabled(env = process.env) {
  return env.TANDEM_AGENT_GROUPS !== '0' && env.TANDEM_BROWSER !== 'external';
}

// titleOf(agent) → a readable title (0.13, session-titles.mjs) or null: then the 0.12 one, groupTitle().
export function tabGrouper({ port, project = basename(process.cwd()), seed = String(process.pid), extDir = EXTENSION_DIR, log = () => {}, timeoutMs = 5000, titleOf = () => null }) {
  const color = sessionColor(seed);
  // The extension's version on disk (= the plugin's: tab-groups.test.mjs checks it). Unreadable → always reload.
  let diskVersion;
  const version = () => { if (diskVersion === undefined) { try { diskVersion = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8')).version; } catch { diskVersion = null; } } return diskVersion; };
  const groupOf = new Map();          // agent → groupId (may be stale: the worker checks)
  let conn = null; let session = null; let failures = 0; let off = false;
  let chain = Promise.resolve();
  const serial = (fn) => (chain = chain.then(fn, fn));

  async function acquire() {
    if (conn && session) return;
    if (!conn) {
      const c = await connect(await browserWsUrl(port, timeoutMs), { timeoutMs });
      c.onClose(() => { if (conn === c) { conn = null; session = null; } });
      c.on('Target.detachedFromTarget', (p) => { if (p.sessionId === session) session = null; });
      conn = c;
    }
    const sw = async (id) => (await conn.call('Target.getTargets')).targetInfos
      .find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${id}/`));
    const loaded = (await conn.call('Extensions.getExtensions', {}).catch(() => ({ extensions: [] }))).extensions?.find((e) => samePath(e.path, extDir));
    let id = loaded?.id;
    // Chrome outlives sessions: after a plugin update the loaded copy may be older than extension/ on disk.
    let t = id && loaded.version === version() && await sw(id);
    if (!t) {   // not loaded, an older copy, or its worker stopped: (re)loading starts it
      id = (await conn.call('Extensions.loadUnpacked', { path: extDir })).id;
      for (let i = 0; i < 30 && !(t = await sw(id)); i++) await sleep(100);
      if (!t) throw new Error('the extension loaded but its worker did not start');
      log(`extension ${id} loaded`);
    }
    session = (await conn.call('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  }

  async function run(fn, arg) {
    for (let attempt = 0; ; attempt++) {
      try {
        await acquire();
        const r = await conn.call('Runtime.evaluate', { expression: `self.tandem.${fn}(${JSON.stringify(arg)})`, awaitPromise: true, returnByValue: true }, session);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text);
        failures = 0;
        return r.result.value;
      } catch (e) {
        session = null;
        if (attempt >= 1) throw e;
      }
    }
  }

  const guarded = (what, fn) => serial(async () => {
    if (off) return null;
    try { return await fn(); }
    catch (e) {
      log(`${what}: ${e.message}`);
      if (++failures >= 3) { off = true; log('tab groups off for this session after 3 failures in a row'); }
      return null;
    }
  });

  const nameOf = (agent) => { try { return titleOf(agent) || groupTitle(agent, project); } catch { return groupTitle(agent, project); } };

  return {
    color,
    // A page the agent created, or a popup of one of its pages.
    add: (agent, targetId) => guarded(`group ${targetId} for ${agent}`, async () => {
      const r = await run('group', { targetIds: [targetId], groupId: groupOf.get(agent) ?? null, title: nameOf(agent), color, collapsed: agent !== 'main' });
      if (r?.groupId != null) groupOf.set(agent, r.groupId);
      return r;
    }),
    // A tab of the human's handed over: into the agent's group only if loose and in the same window.
    adopt: (agent, targetId) => guarded(`group handed-over ${targetId} for ${agent}`, async () => {
      const r = await run('group', { targetIds: [targetId], groupId: groupOf.get(agent) ?? null, title: nameOf(agent), color, collapsed: agent !== 'main', onlyLoose: true });
      if (r?.groupId != null) groupOf.set(agent, r.groupId);
      return r;
    }),
    // The agent's title changed (a /rename): its group, if any, takes the new one.
    retitle: (agent) => (groupOf.has(agent) ? guarded(`retitle ${agent}`, () => run('retitle', { groupId: groupOf.get(agent), title: nameOf(agent) })) : Promise.resolve(null)),
    // Given back to the human: out of the agent's group.
    release: (agent, targetId) => guarded(`ungroup ${targetId}`, () => run('ungroup', { targetIds: [targetId], groupId: groupOf.get(agent) ?? null })),
    list: () => serial(() => run('list', {})),
    idle: () => serial(() => null),
    close: () => { off = true; try { conn?.close(); } catch {} },
  };
}
