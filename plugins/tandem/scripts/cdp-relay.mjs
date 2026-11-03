// cdp-relay.mjs — a CDP relay that shows each agent only its own tabs (research R05 §5–§15).
//
// One relay per session (the MCP launcher). Every agent's @playwright/mcp child connects to
// ws://127.0.0.1:<port>/<token>/agent/<id>; the relay opens one upstream browser connection per agent and
// forwards the client's commands, then filters what Chrome says back by an ownership map:
//   - a page created by an agent's Target.createTarget is that agent's;
//   - a popup inherits its opener's owner (targetInfo.openerId — Chrome sends it with rel=noopener too);
//   - anything else (the human's tabs, other sessions' tabs, Chrome's first about:blank) is foreign.
// A page a client may not see is never shown to it: the relay resumes it (the client asked for
// waitForDebuggerOnStart — a hidden page nobody resumed would stay paused for everyone) and detaches.
// Commands aimed at what the client can't see are refused: a session id it was never shown, a foreign page
// by target id (close/activate/attach/getTargetInfo), and closing or crashing the whole browser.
//
// Ordering (read from the 0.0.83 bundle): Playwright's newPage sends Target.createTarget and expects the
// page to be attached already, so Chrome's attachedToTarget arrives BEFORE the createTarget response. While
// any agent has a createTarget in flight, attachments of unknown owner are buffered and decided when the
// response names the target.
//
// newWindow: the relay adds newWindow+background to each createTarget: every agent page opens in a window
// of its own, without taking the keyboard focus from the human (measured R05 §9: newWindow alone took it).
// CDP can't put a new tab in a given window (no windowId in createTarget, Chrome 156), so a second
// `browser_tabs new` of the same agent gets another window; its popups open in the opener's window.
//
// Ownership is also written to tab-owners.mjs (shared by all sessions), so a foreign page can be told apart
// as the human's or another session's.
//
// Handing over (phase 4, R05 §16): adopt(agent, targetId) gives an existing page — the human's — to an agent:
// owner changes, then the relay attaches to it on that agent's upstream connection so Chrome announces it
// there and Playwright takes it as a new tab (measured with 0.0.83). release(targetId) gives it back: the
// agent's sessions on it are detached (Playwright sees the page close) and it is nobody's again. A page
// the agent adopted is never really closed by it: Target.closeTarget / Page.close on it = release; and an
// agent left with no connection (browser_close only disconnects Playwright: measured) releases them all.
//
// onPage(agent, targetInfo) — called when a page is shown to an agent (one it created, or its popup). If it
// returns a promise, everything for that client waits behind it, in order, at most holdMs: the launcher arms
// the agent's PDF capture and focus emulation on the page BEFORE Playwright learns of it, so the page's first
// navigation is already seen (R05 §15.4: a createTarget page is not paused, but Playwright navigates only
// after the attach and the createTarget response, both held here; a popup is paused until Playwright resumes it).

import { browserWsUrl } from './cdp.mjs';
import { tabOwners } from './tab-owners.mjs';
import { newToken, startWsServer } from './ws-server.mjs';

const RELAY_ID = 1_000_000_000;   // ids of the relay's own upstream commands
const FOREIGN = '#foreign';
const AGENT = /^[\w.-]{1,64}$/;
const DENY_BROWSER = new Set(['Browser.close', 'Browser.crash', 'Browser.crashGpuProcess']);
const BY_TARGET = new Set(['Target.closeTarget', 'Target.activateTarget', 'Target.attachToTarget', 'Target.getTargetInfo']);

export async function startRelay({ port, dataDir = null, newWindow = true, log = () => {}, callTimeoutMs = 10_000, onPage = null, holdMs = 1000 }) {
  const token = newToken();
  const srv = await startWsServer({ token });
  const registry = dataDir ? tabOwners(dataDir) : null;
  try { registry?.sweep(); } catch { /* best effort */ }
  const owner = new Map();          // targetId → agent | FOREIGN
  const adopted = new Set();        // targetIds handed over to an agent (the human's): closing = release
  const kind = new Map();           // targetId → target type, as seen in any event
  const conns = new Set();
  let pendingCreates = 0;           // createTarget in flight, all agents
  const stats = { shown: 0, hidden: 0, buffered: 0, popupsInherited: 0, denied: 0, held: 0, holdTimeouts: 0 };

  const setOwner = (id, agent) => {
    owner.set(id, agent);
    if (agent !== FOREIGN) { try { registry?.claim(id, agent); } catch (e) { log(`owners: ${e.message}`); } }
  };
  const ownerOf = (info) => {
    const known = owner.get(info.targetId);
    if (known) return known;
    const o = info.openerId && owner.get(info.openerId);
    if (o && o !== FOREIGN) { setOwner(info.targetId, o); stats.popupsInherited++; return o; }
    return null;
  };
  const forget = (id) => {   // every connection sees the destruction: decide after all of them did
    setTimeout(() => {
      if (owner.has(id) && owner.get(id) !== FOREIGN) { try { registry?.release(id); } catch {} }
      owner.delete(id); kind.delete(id);
    }, 5000).unref();
  };
  const resolveAll = () => { for (const c of conns) c.resolveBuffer(); };

  srv.on('connection', (client, path) => {
    const agent = decodeURIComponent((path.match(/^\/agent\/([^/?]+)$/) || [])[1] || '');
    if (!AGENT.test(agent)) { client.close(1008); return; }

    let up = null;                    // upstream WebSocket, once open
    const early = [];                 // client messages before upstream opened
    let relayId = RELAY_ID;
    const ownCalls = new Map();       // relay id → { resolve, reject, timer }
    const visible = new Set();        // session ids this client may see
    const pages = new Map();          // its top-level page sessions: sessionId → targetId
    const creates = new Set();        // ids of this client's createTarget requests
    const getTargets = new Set();     // ids of this client's Target.getTargets requests
    let buffer = [];                  // browser-level attachedToTarget of unknown owner

    // In order, always: while a hold (onPage) is pending, every message queues behind it.
    let outQ = Promise.resolve(); let queued = 0;
    const toClient = (m) => {
      const s = typeof m === 'string' ? m : JSON.stringify(m);
      if (!queued) return client.send(s);
      queued++; outQ = outQ.then(() => { queued--; client.send(s); });
    };
    const holdOut = (p) => {
      queued++; stats.held++;
      const t0 = Date.now();
      outQ = outQ.then(() => Promise.race([Promise.resolve(p).catch((e) => log(`relay ${agent}: onPage: ${e.message}`)), new Promise((r) => setTimeout(r, holdMs).unref())]))
        .then(() => { queued--; const ms = Date.now() - t0; if (ms >= holdMs) { stats.holdTimeouts++; log(`relay ${agent}: page hold hit ${holdMs} ms`); } });
    };
    const toUp = (s) => (up ? up.send(s) : early.push(s));
    const relaySend = (method, params, sessionId) => { const id = relayId++; toUp(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); return id; };
    const deny = (m, why) => { stats.denied++; toClient({ id: m.id, ...(m.sessionId ? { sessionId: m.sessionId } : {}), error: { code: -32000, message: `tandem: ${why}` } }); };

    const show = (ev) => {
      stats.shown++; visible.add(ev.params.sessionId);
      if (ev.params.targetInfo.type === 'page') {
        pages.set(ev.params.sessionId, ev.params.targetInfo.targetId);
        let hold = null;
        try { hold = onPage?.(agent, ev.params.targetInfo); } catch (e) { log(`relay ${agent}: onPage: ${e.message}`); }
        if (hold && typeof hold.then === 'function') holdOut(hold);
      }
      toClient(ev);
    };
    const hide = (ev) => {
      stats.hidden++;
      const sid = ev.params.sessionId;
      if (ev.params.waitingForDebugger) relaySend('Runtime.runIfWaitingForDebugger', undefined, sid);
      relaySend('Target.detachFromTarget', { sessionId: sid });
    };
    const decide = (ev) => {
      const info = ev.params.targetInfo;
      kind.set(info.targetId, info.type);
      if (info.type !== 'page') return show(ev);           // workers, the browser target: not tab-owned
      const o = ownerOf(info);
      if (o === agent) return show(ev);
      if (o) return hide(ev);
      if (pendingCreates > 0) { stats.buffered++; buffer.push(ev); return; }
      setOwner(info.targetId, FOREIGN);
      return hide(ev);
    };
    const conn = {
      agent, pages,
      resolveBuffer() { const pending = buffer; buffer = []; for (const ev of pending) decide(ev); },
      call(method, params, sessionId) {
        return new Promise((resolve, reject) => {
          const id = relaySend(method, params, sessionId);
          const timer = setTimeout(() => { ownCalls.delete(id); reject(new Error(`${method}: timeout`)); }, callTimeoutMs);
          ownCalls.set(id, { resolve, reject, timer });
        });
      },
    };
    conns.add(conn);

    const fromUp = (data) => {
      const m = JSON.parse(data);
      if (m.id !== undefined) {
        if (m.id >= RELAY_ID) {
          const w = ownCalls.get(m.id); if (!w) return;
          ownCalls.delete(m.id); clearTimeout(w.timer);
          return m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result);
        }
        if (creates.delete(m.id)) {
          pendingCreates--;
          if (m.result?.targetId) { setOwner(m.result.targetId, agent); kind.set(m.result.targetId, 'page'); }
          resolveAll();                                     // flushes our own attach BEFORE the response
        } else if (getTargets.delete(m.id) && m.result?.targetInfos) {
          m.result.targetInfos = m.result.targetInfos.filter((t) => t.type !== 'page' || ownerOf(t) === agent);
          return toClient(m);
        }
        return toClient(data);
      }
      const sid = m.sessionId;
      if (m.method === 'Target.attachedToTarget') {
        if (!sid) return decide(m);
        if (visible.has(sid)) { visible.add(m.params.sessionId); toClient(data); }
        return;
      }
      if (m.method === 'Target.detachedFromTarget') {
        pages.delete(m.params.sessionId);
        if (visible.delete(m.params.sessionId)) toClient(data);
        return;
      }
      if (!sid && /^Target\.target(Created|InfoChanged|Destroyed)$/.test(m.method)) {
        const info = m.params.targetInfo;
        const id = info?.targetId ?? m.params.targetId;
        if (info) kind.set(id, info.type);
        if (m.method === 'Target.targetDestroyed') {
          const mine = owner.get(id) === agent;
          if (kind.get(id) === 'page') forget(id);
          if (mine || kind.get(id) !== 'page') toClient(data);
          return;
        }
        if (info.type !== 'page' || ownerOf(info) === agent) toClient(data);
        return;
      }
      if (sid && !visible.has(sid)) return;
      toClient(data);
    };

    client.on('message', (s) => {
      let m; try { m = JSON.parse(s); } catch { return; }
      if (m.sessionId) {
        if (!visible.has(m.sessionId)) return deny(m, `session not shown to ${agent}`);
        const tid = pages.get(m.sessionId);
        if (m.method === 'Page.close' && tid && adopted.has(tid)) {   // closing an adopted tab gives it back
          return void relay.release(tid).then(() => toClient({ id: m.id, sessionId: m.sessionId, result: {} }));
        }
        return toUp(s);
      }
      if (DENY_BROWSER.has(m.method)) return deny(m, `${m.method} is not allowed through the shared browser`);
      if (m.method === 'Target.closeTarget' && adopted.has(m.params?.targetId) && owner.get(m.params.targetId) === agent) {
        return void relay.release(m.params.targetId).then(() => toClient({ id: m.id, result: { success: true } }));
      }
      if (m.method === 'Target.createTarget') {
        creates.add(m.id); pendingCreates++;
        if (newWindow && m.params?.newWindow === undefined) {
          m.params = { ...m.params, newWindow: true, background: true };
          return toUp(JSON.stringify(m));
        }
      } else if (m.method === 'Target.getTargets') getTargets.add(m.id);
      else if (BY_TARGET.has(m.method)) {
        const id = m.params?.targetId;
        if (kind.get(id) === 'page' && owner.get(id) !== agent) return deny(m, `target not owned by ${agent}`);
      }
      toUp(s);
    });

    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      conns.delete(conn);
      pendingCreates -= creates.size; creates.clear();
      for (const w of ownCalls.values()) { clearTimeout(w.timer); w.reject(new Error('relay connection closed')); }
      ownCalls.clear();
      try { up?.close(); } catch {} try { client.close(); } catch {}
      resolveAll();
      // The agent let go of the browser (browser_close disconnects Playwright, a child died, Chrome went away):
      // the tabs it was handed go back to the human. Its own tabs stay — as before, closing them is phase 5.
      if (![...conns].some((c) => c.agent === agent)) {
        for (const id of [...adopted]) if (owner.get(id) === agent) relay.release(id).catch(() => {});
      }
    };
    client.on('close', close);

    browserWsUrl(port).then((url) => {
      if (closed) return;
      const ws = new WebSocket(url);
      ws.onopen = () => { up = ws; for (const s of early.splice(0)) ws.send(s); };
      ws.onmessage = (e) => { try { fromUp(e.data); } catch (err) { log(`relay ${agent}: ${err.message}`); } };
      ws.onclose = close; ws.onerror = close;
    }, (e) => { log(`relay ${agent}: no browser (${e.message})`); close(); });
  });

  const connsOf = (agent) => [...conns].filter((c) => c.agent === agent);
  const relay = {
    port: srv.port, stats, owner,
    endpoint: (agent) => `ws://127.0.0.1:${srv.port}/${token}/agent/${encodeURIComponent(agent)}`,
    // The agent's top-level page sessions on its own upstream connection(s).
    pagesOf: (agent) => connsOf(agent).flatMap((c) => [...c.pages].map(([sessionId, targetId]) => ({ sessionId, targetId, call: (method, params) => c.call(method, params, sessionId) }))),
    // A browser-level command on the agent's upstream connection.
    call: (agent, method, params) => { const c = connsOf(agent)[0]; return c ? c.call(method, params) : Promise.reject(new Error(`no connection for ${agent}`)); },
    agents: () => [...new Set([...conns].map((c) => c.agent))],
    // Give a page (the human's: the caller checked) to an agent whose MCP is connected.
    adopt: async (agent, targetId) => {
      const c = connsOf(agent)[0]; if (!c) throw new Error(`no browser connection for ${agent} yet`);
      const prev = owner.get(targetId);
      setOwner(targetId, agent); kind.set(targetId, 'page'); adopted.add(targetId);
      try { await c.call('Target.attachToTarget', { targetId, flatten: true }); }
      catch (e) { adopted.delete(targetId); if (prev) owner.set(targetId, prev); else owner.delete(targetId); try { registry?.release(targetId); } catch {} throw e; }
    },
    // Give it back: nobody's (the human's) again, and the agents that saw it stop seeing it.
    release: async (targetId) => {
      adopted.delete(targetId);
      owner.set(targetId, FOREIGN);
      try { registry?.release(targetId); } catch {}
      await Promise.all([...conns].flatMap((c) => [...c.pages].filter(([, t]) => t === targetId)
        .map(([sessionId]) => c.call('Target.detachFromTarget', { sessionId }).catch(() => {}))));
    },
    isAdopted: (targetId) => adopted.has(targetId),
    // Target ids of the pages this agent owns (created, or popups of its pages).
    ownedBy: (agent) => [...owner].filter(([, a]) => a === agent).map(([id]) => id),
    close: () => srv.close(),
  };
  return relay;
}
