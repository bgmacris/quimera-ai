// agent-router.mjs — the launcher's stdio proxy, with one @playwright/mcp child per agent (research R05 §15).
//
// Claude Code talks to ONE MCP server per session; its subagents share that process (R05 §1). tandem's
// PreToolUse hook (autostart.mjs) writes the caller into every browser call as `arguments.agent`
// (agent_id, or "main"), via updatedInput — measured with allow/ask/bypass and in subagents, and Claude
// Code does not check it against the tool's schema (R05 §15.2). The router takes it out (the MCP's schemas
// are additionalProperties:false) and sends the call to that agent's child, each child connected to Chrome
// through the CDP relay (cdp-relay.mjs), so it only ever sees its own tabs.
//
// Children: "main" is started with the launcher (the client's handshake goes to it); any other agent's
// child is started on its first call, and the router does its handshake with the CLIENT's own
// `initialize` params — Claude Code declares `roots`, and @playwright/mcp then asks roots/list and uses
// the first root as its working root (R05 §15.2). A child's requests to the client (roots/list) are
// forwarded with ids of our own and the answers routed back. initialize, server/discover, tools/list and
// anything that is not a tool call go to "main"; a non-main child's list_changed notifications are dropped
// (the client listed main's tools). A non-main child that dies fails its pending calls; the next call
// starts a new one.
//
// Per agent ("lane"): its own queue (a hold on one agent's tab never delays another's call), its own
// emulator (focus + PDF capture, agent-tab.mjs: its own last URL) and its own probe — `browser_tabs list`
// asked to ITS child, which through the relay lists only its tabs.
//
// Local tools (multi mode): tools the router itself provides — `localTools[name] = { def, handle }` — added to
// main's tools/list answer and run here, in the agent's lane (its queue, its emulator held), never sent to a
// child. handle({ agent, args, ask }) → an MCP tool result; ask(name, args) calls a tool on THAT agent's child
// without the client seeing it. browser_tab_adopt (mcp-launch.mjs, phase 4) is one.
//
// Life cycle (multi mode, phase 5, decided 2026-11-03): a subagent that has not used the browser for
// lifecycle.stopMs (10 min) gets its MCP stopped — onStop(agent) first (the relay keeps its handed-over
// tabs) — and is started again by its next call, seeing its tabs; after lifecycle.tabsMs (30 min)
// onTabsIdle(agent) closes its tabs too. A subagent may come back: Claude Code resumes one with the same
// agent_id (measured), so "it stopped" is never final. A subagent that finished (lifecycle.finished, from
// the SubagentStop hook) has its MCP stopped AND its tabs closed on the next tick (0.11: a finished task leaves
// no tabs behind; if it is resumed, it opens a new one — cookies live in the profile, only the page is lost);
// a call from it before that tick clears the mark. At most lifecycle.maxAgents subagents' MCPs live at
// once: a new one stops the least recently used idle one (none idle → over the cap, logged). "main" is
// never stopped: the client's handshake lives in it.
//
// Single mode (multi: false — TANDEM_MULTISESSION=0, and focus-emulation.mjs's proxyStdio): one child,
// no `agent` handling, every line forwarded byte for byte as before 0.10 — except notes added to a result.
// MCP stdio transport: one JSON-RPC message per line, no embedded newlines.

import { extractTabUrl } from './map-inject-core.mjs';

export const AGENT_ID = /^[\w.-]{1,64}$/;
const MAIN = 'main';
const LIST_CHANGED = /^notifications\/(tools|resources|prompts)\/list_changed$/;
const DEFAULT_INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'tandem', version: '0' } };

// tools/call message → { agent, m } with `agent` taken out of the arguments (always: the child would refuse it).
export function takeAgent(m) {
  const a = m?.params?.arguments;
  if (!a || typeof a !== 'object' || !Object.hasOwn(a, 'agent')) return { agent: MAIN, m, stripped: false };
  const { agent, ...rest } = a;
  return {
    agent: typeof agent === 'string' && AGENT_ID.test(agent) ? agent : MAIN,
    m: { ...m, params: { ...m.params, arguments: rest } },
    stripped: true,
  };
}

// spawnChild(agent) → { stdin, stdout, on?(event, fn) } (a ChildProcess fits). emulatorFor(agent) → emulator.
// initTimeoutMs: a new child's handshake (npx may install on its first run).
export function routeStdio({ clientIn, clientOut, spawnChild, emulatorFor, multi = true, initTimeoutMs = 120_000, log = () => {}, localTools = {}, lifecycle = null, now = Date.now }) {
  const lastUsed = new Map();       // agent → last time it used the browser (call queued or answered)
  const local = multi ? localTools : {};
  const listIds = new Set();        // client tools/list request ids: main's answer gets the local tools
  const lanes = new Map();          // agent → lane
  const callLane = new Map();       // client request id → lane (to route notifications/cancelled)
  const fromChild = new Map();      // our id for a child's request to the client → { lane, id }
  let initParams = null;            // the client's initialize params, for the children started later
  let reqN = 0;
  let ended = false;
  const toClient = (s) => clientOut.write(s + '\n');

  function makeLane(agent) {
    const child = spawnChild(agent);
    const emulator = emulatorFor(agent);
    const calls = new Map();        // request id → { name, args }
    const probes = new Map();       // our own request id → resolve
    let probeId = 0;
    let asking = null;
    let owed = null;                // the `### Page` section a probe took from the agent
    let queue = Promise.resolve();
    let dead = false;
    const write = (s) => { if (!dead) child.stdin.write(s + '\n'); };
    child.stdin.on?.('error', () => {});   // died mid-write: its exit handles it

    const ask = (method, params, ms = 5000) => new Promise((resolve) => {
      const id = `tandem-probe-${++probeId}`;
      const t = setTimeout(() => { probes.delete(id); resolve(null); }, ms); t.unref?.();
      probes.set(id, (m) => { clearTimeout(t); resolve(m); });
      write(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
    // Multi mode: a child sees only its agent's tabs (the relay), so before its first call answers it has
    // none — nothing to locate, and asking would race the call itself: both make the MCP open a page
    // (measured: an extra about:blank per new agent, multi-real-e2e M1).
    let hasTabs = !multi;
    // One question in flight at a time: every hold asks on the same begin().
    emulator.useLocator?.((prev) => (!hasTabs ? Promise.resolve(null) : asking ??= ask('tools/call', { name: 'browser_tabs', arguments: { action: 'list' } })
      .then((m) => {
        const url = extractTabUrl({ tool_name: 'browser_tabs', tool_response: m?.result ?? null });
        if (prev && url && url !== prev) owed = `### Page\n- Page URL: ${url}`;
        return url;
      })
      .finally(() => { asking = null; })));

    // → the notes to add to this response (none for a cancelled call: its response never comes).
    const finish = (id, result) => {
      const c = calls.get(id); if (!c) return [];
      calls.delete(id); callLane.delete(id); lastUsed.set(agent, now()); emulator.end(c.name, c.args, result);
      return result ? (emulator.notes?.(c.name, c.args, result) || []) : [];
    };

    const lane = {
      agent,
      queued: 0,                    // calls waiting in its queue (not yet in `calls`)
      idle: () => calls.size === 0 && lane.queued === 0,
      // Everything for this child goes through its queue, in arrival order.
      enqueue(fn) { queue = queue.then(fn).catch((e) => log(`router ${agent}: ${e.message}`)); return queue; },
      write,
      async call(id, name, args, line) {
        calls.set(id, { name, args });
        await lane.ready;
        if (dead) {   // queued behind a handshake that failed (fail() already answered those it knew of)
          if (!calls.has(id)) return;
          finish(id, null);
          toClient(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: `tandem: the browser MCP of agent ${agent} is not available` } }));
          return;
        }
        await emulator.begin();
        write(line);
      },
      cancel(requestId, line) { finish(requestId, null); write(line); },
      // A local tool: run here, with the agent's emulator held as for any call.
      async local(id, name, args) {
        calls.set(id, { name, args });
        await lane.ready;
        let result;
        if (dead) result = { content: [{ type: 'text', text: `tandem: the browser MCP of agent ${agent} is not available` }], isError: true };
        else {
          await emulator.begin();
          const askTool = async (n, a, ms = 30_000) => (await ask('tools/call', { name: n, arguments: a || {} }, ms))?.result ?? null;
          try { result = await local[name].handle({ agent, args: args || {}, ask: askTool }); }
          catch (e) { result = { content: [{ type: 'text', text: `tandem: ${name} failed: ${e.message}` }], isError: true }; }
          if (!result?.isError) hasTabs = true;
        }
        if (!calls.has(id)) return;   // cancelled meanwhile
        const notes = finish(id, result);
        if (notes.length) result = { ...result, content: [...(result.content || []), ...notes.map((text) => ({ type: 'text', text }))] };
        toClient(JSON.stringify({ jsonrpc: '2.0', id, result }));
      },
      end() { queue.then(() => { try { child.stdin.end(); } catch {} }); },
      kill() { try { child.kill?.(); } catch {} },
      // The child is gone: its pending calls get an error (the client would wait for them forever).
      fail(why) {
        if (dead) return; dead = true;
        if (lanes.get(agent) === lane) lanes.delete(agent);   // not a newer lane of the same agent
        for (const id of [...calls.keys()]) {
          finish(id, null);
          toClient(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: `tandem: ${why}` } }));
        }
        for (const [rid, r] of fromChild) if (r.lane === lane) fromChild.delete(rid);
        emulator.close?.();
      },
      ready: Promise.resolve(),
    };

    lines(child.stdout, (line) => {
      let m = null; try { m = JSON.parse(line); } catch { /* not ours to judge */ }
      if (!m) { toClient(line); return; }
      if (!m.method && probes.has(m.id)) { const r = probes.get(m.id); probes.delete(m.id); r(m); return; }   // ours
      if (!m.method && m.id !== undefined) {   // a response, not a server request
        const isCall = calls.has(m.id);
        if (isCall && m.result) hasTabs = true;
        const notes = finish(m.id, m.result ?? null);
        if (isCall && owed && Array.isArray(m.result?.content)) {
          if (!hasPageSection(m.result)) notes.unshift(owed);
          owed = null;
        }
        if (agent === MAIN && listIds.delete(m.id) && Array.isArray(m.result?.tools) && Object.keys(local).length) {
          m.result.tools.push(...Object.values(local).map((t) => t.def));
          toClient(JSON.stringify(m));
          return;
        }
        if (notes.length && Array.isArray(m.result?.content)) {
          m.result.content.push(...notes.map((text) => ({ type: 'text', text })));
          toClient(JSON.stringify(m));
        } else toClient(line);
        return;
      }
      if (!multi || agent === MAIN) { toClient(line); return; }
      if (m.id !== undefined) {   // a request to the client (roots/list): our id, the answer routed back
        const rid = `tandem-${agent}-${++reqN}`;
        fromChild.set(rid, { lane, id: m.id });
        toClient(JSON.stringify({ ...m, id: rid }));
      } else if (!LIST_CHANGED.test(m.method)) toClient(line);
    });
    child.on?.('exit', () => { if (agent !== MAIN) lane.fail(`the browser MCP of agent ${agent} exited`); });

    if (multi && agent !== MAIN) {
      // Its handshake, as the client did main's. A child that can't start fails its calls; the next call retries.
      lane.ready = ask('initialize', initParams || DEFAULT_INIT, initTimeoutMs).then((r) => {
        if (!r?.result) { lane.fail(`could not start the browser MCP for agent ${agent}`); lane.kill(); return; }
        write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
        log(`router: agent ${agent} ready`);
      });
    }
    return lane;
  }

  // Stop an agent's MCP (its lane goes; the next call starts a new one). Its tabs stay (onStop).
  const retire = (l, why) => {
    if (lanes.get(l.agent) !== l) return;
    lanes.delete(l.agent);
    try { lifecycle?.onStop?.(l.agent); } catch (e) { log(`router: onStop ${l.agent}: ${e.message}`); }
    log(`router: stopped the MCP of agent ${l.agent} (${why})`);
    l.end(); l.kill();
  };
  const laneFor = (agent) => {
    let l = lanes.get(agent);
    if (!l) {
      if (lifecycle?.maxAgents && agent !== MAIN) {
        const subs = [...lanes.values()].filter((x) => x.agent !== MAIN);
        if (subs.length >= lifecycle.maxAgents) {
          const lru = subs.filter((x) => x.idle()).sort((a, b) => (lastUsed.get(a.agent) || 0) - (lastUsed.get(b.agent) || 0))[0];
          if (lru) retire(lru, `cap of ${lifecycle.maxAgents} agents`);
          else log(`router: ${subs.length + 1} agents' MCPs alive, over the cap of ${lifecycle.maxAgents} (none idle)`);
        }
      }
      l = makeLane(agent); lanes.set(agent, l);
    }
    return l;
  };
  // Idle checks (also callable from tests).
  const tick = async () => {
    if (!lifecycle) return;
    const t = now();
    for (const l of [...lanes.values()]) {
      if (l.agent === MAIN || !l.idle() || lifecycle.finished?.(l.agent)) continue;   // finished: below
      if (lifecycle.stopMs && t - (lastUsed.get(l.agent) ?? t) >= lifecycle.stopMs) retire(l, `idle ${Math.round((t - lastUsed.get(l.agent)) / 60_000)} min`);
    }
    for (const [agent, at] of [...lastUsed]) {
      if (agent === MAIN) continue;
      const done = !!lifecycle.finished?.(agent);
      if (!done && (!lifecycle.tabsMs || t - at < lifecycle.tabsMs)) continue;
      const l = lanes.get(agent);
      if (l && !l.idle()) continue;
      if (l) retire(l, done ? 'subagent finished' : 'idle, closing its tabs');
      lastUsed.delete(agent);
      if (done) lifecycle.clearFinished?.(agent);
      try { await lifecycle.onTabsIdle?.(agent); log(`router: closed the tabs of agent ${agent} (${done ? 'finished' : 'idle'})`); }
      catch (e) { log(`router: onTabsIdle ${agent}: ${e.message}`); }
    }
  };
  if (lifecycle?.checkMs) setInterval(() => { tick(); }, lifecycle.checkMs).unref?.();
  laneFor(MAIN);   // at once: the client's handshake goes to it

  lines(clientIn, (line) => {
    if (ended) return;
    let m = null; try { m = JSON.parse(line); } catch { /* forward as is */ }
    const main = laneFor(MAIN);
    if (m?.method === 'tools/call' && m.id !== undefined) {
      const { agent, m: out, stripped } = multi ? takeAgent(m) : { agent: MAIN, m, stripped: false };
      const l = laneFor(agent);
      const fwd = stripped ? JSON.stringify(out) : line;
      callLane.set(m.id, l);   // now, not when its turn comes: a cancel may arrive while it waits
      const name = out.params?.name;
      lastUsed.set(agent, now()); l.queued++;
      if (agent !== MAIN) lifecycle?.clearFinished?.(agent);   // it was resumed, it isn't finished any more
      if (Object.hasOwn(local, name)) l.enqueue(() => { l.queued--; return l.local(m.id, name, out.params?.arguments); });
      else l.enqueue(() => { l.queued--; return l.call(m.id, name, out.params?.arguments, fwd); });
      return;
    }
    if (m?.method === 'notifications/cancelled') {
      const l = callLane.get(m.params?.requestId) || main;
      l.enqueue(() => l.cancel(m.params?.requestId, line));
      return;
    }
    // The answer to a child's request goes straight to it, never behind its queue: a call that waits on the
    // child (a local tool's ask) holds the queue, and the child answers nothing until it has this — its
    // roots/list on its first call, so a browser_tab_adopt as an agent's first call hung for 30 s and failed.
    if (m && !m.method && m.id !== undefined) {
      if (multi && fromChild.has(m.id)) {
        const { lane, id } = fromChild.get(m.id); fromChild.delete(m.id);
        lane.write(JSON.stringify({ ...m, id }));
      } else main.write(line);
      return;
    }
    if (multi && m?.method === 'notifications/roots/list_changed') {
      for (const l of lanes.values()) l.enqueue(() => l.write(line));
      return;
    }
    if (m?.method === 'initialize') initParams = m.params;
    if (m?.method === 'tools/list' && m.id !== undefined) listIds.add(m.id);
    main.enqueue(() => main.write(line));
  }, () => { ended = true; for (const l of lanes.values()) l.end(); });

  return {
    agents: () => [...lanes.keys()],
    tick,
    kill() { for (const l of lanes.values()) l.kill(); },
  };
}

export const hasPageSection = (result) => (result?.content || []).some((c) => /(^|\n)### Page(\r?\n|$)/.test(c?.text || ''));

export function lines(stream, onLine, onEnd = () => {}) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l) onLine(l); }
  });
  stream.on('end', () => { if (buf) onLine(buf); onEnd(); });
}
