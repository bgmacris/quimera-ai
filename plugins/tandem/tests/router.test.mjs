#!/usr/bin/env node
// router.test.mjs — agent-router.mjs in multi mode, with fake children (no Chrome, no MCP): routing by
// `agent`, stripping it, lazy children with the client's own handshake, a child's roots/list round trip,
// cancellations, a dead child, per-agent queues. Single mode is tests/focus.test.mjs (proxyStdio).
// No dependencies: mini-runner. Usage: node tests/router.test.mjs

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeStdio, takeAgent } from '../scripts/agent-router.mjs';
import { handshakeMemo } from '../scripts/mcp-memo.mjs';

let pass = 0; let fail = 0;
function ok(desc, cond, extra = '') {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}${extra ? ` — ${extra}` : ''}\n`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const msg = (o) => JSON.stringify(o) + '\n';
const call = (id, name, args) => msg({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

// A fake child: records what it receives; `autoInit` answers initialize like an MCP would.
function fakeChild(agent, { autoInit = true, initOk = true } = {}) {
  const c = new EventEmitter();
  c.agent = agent; c.stdin = new PassThrough(); c.stdout = new PassThrough(); c.got = []; c.killed = false;
  c.stdin.on('data', (d) => {
    for (const l of String(d).split('\n').filter(Boolean)) {
      const m = JSON.parse(l); c.got.push(m);
      if (m.method === 'initialize' && autoInit) {
        c.reply(initOk ? { jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake' } } }
          : { jsonrpc: '2.0', id: m.id, error: { code: -1, message: 'no' } });
      }
    }
  });
  c.reply = (o) => c.stdout.write(msg(o));
  c.kill = () => { c.killed = true; c.emit('exit', null, 'SIGTERM'); };
  c.calls = () => c.got.filter((m) => m.method === 'tools/call' && !String(m.id).startsWith('tandem-probe'));
  return c;
}

function harness({ opts = {}, emulator, route = {} } = {}) {
  const clientIn = new PassThrough(); const clientOut = new PassThrough();
  const toClient = []; const children = new Map(); const spawned = [];
  clientOut.on('data', (d) => { for (const l of String(d).split('\n').filter(Boolean)) toClient.push(JSON.parse(l)); });
  const events = [];
  const emulatorFor = (agent) => emulator?.(agent, events) ?? {
    async begin() { events.push(`begin:${agent}`); },
    end(name) { events.push(`end:${agent}:${name}`); },
  };
  const r = routeStdio({
    clientIn, clientOut, emulatorFor, multi: true, initTimeoutMs: 300,
    spawnChild: (agent, how) => { const c = fakeChild(agent, opts[agent] || opts['*'] || {}); c.how = how; spawned.push(agent); children.set(agent, c); return c; },
    ...route,
  });
  return { clientIn, toClient, children, spawned, events, r, send: (s) => clientIn.write(s) };
}

console.log('takeAgent');
{
  const a = takeAgent({ params: { name: 'x', arguments: { url: 'u', agent: 'a01' } } });
  ok('agent taken out of the arguments', a.agent === 'a01' && a.stripped && !('agent' in a.m.params.arguments) && a.m.params.arguments.url === 'u');
  ok('no agent → main, untouched', takeAgent({ params: { arguments: { url: 'u' } } }).agent === 'main' && !takeAgent({ params: { arguments: {} } }).stripped);
  const bad = takeAgent({ params: { arguments: { agent: '../x', url: 'u' } } });
  ok('an agent that is not an id → main, and still taken out', bad.agent === 'main' && bad.stripped && !('agent' in bad.m.params.arguments));
  ok('a non-string agent → main, taken out', takeAgent({ params: { arguments: { agent: 7 } } }).agent === 'main');
}

console.log('routing');
{
  const h = harness();
  ok('main is started at once, nothing else', h.spawned.join() === 'main');
  const init = { protocolVersion: '2025-11-25', capabilities: { roots: { listChanged: true } }, clientInfo: { name: 'claude-code' } };
  h.send(msg({ jsonrpc: '2.0', id: 0, method: 'initialize', params: init }));
  h.send(msg({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  h.send(msg({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  h.send(call(2, 'browser_navigate', { url: 'http://a/', agent: 'main' }));
  h.send(call(3, 'browser_snapshot', {}));
  await sleep(30);
  const main = h.children.get('main');
  ok('initialize, initialized and tools/list go to main', ['initialize', 'notifications/initialized', 'tools/list'].every((x) => main.got.some((m) => m.method === x)));
  const mc = main.calls();
  ok('agent "main" and no agent both go to main, agent taken out', mc.length === 2 && mc.every((m) => !('agent' in m.params.arguments)) && mc[0].params.arguments.url === 'http://a/');

  h.send(call(4, 'browser_navigate', { url: 'http://b/', agent: 'a0e815c57e8d30939' }));
  await sleep(50);
  const sub = h.children.get('a0e815c57e8d30939');
  ok('a new agent gets its own child, started on its first call', h.spawned.join() === 'main,a0e815c57e8d30939' && !!sub);
  const si = sub.got[0];
  ok('…whose handshake uses the CLIENT\'s initialize params (roots declared)', si?.method === 'initialize' && JSON.stringify(si.params) === JSON.stringify(init));
  ok('…then initialized, then the call (agent taken out)', sub.got[1]?.method === 'notifications/initialized' && sub.calls()[0]?.params.arguments.url === 'http://b/' && !('agent' in sub.calls()[0].params.arguments));
  ok('the sub\'s handshake answer never reaches the client', !h.toClient.some((m) => String(m.id).startsWith('tandem-')));
  ok('main did not get the sub\'s call', main.calls().length === 2);

  sub.reply({ jsonrpc: '2.0', id: 4, result: { content: [{ type: 'text', text: 'b' }] } });
  main.reply({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'a' }] } });
  await sleep(20);
  ok('each response reaches the client with its own id', h.toClient.find((m) => m.id === 4)?.result.content[0].text === 'b' && h.toClient.find((m) => m.id === 2)?.result.content[0].text === 'a');
  ok('emulator per agent: begin/end on the agent that made the call', h.events.includes('begin:a0e815c57e8d30939') && h.events.includes('end:a0e815c57e8d30939:browser_navigate') && h.events.includes('end:main:browser_navigate'));
}

console.log('a child\'s requests to the client (roots/list)');
{
  const h = harness();
  h.send(msg({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { roots: {} }, clientInfo: { name: 'cc' } } }));
  h.send(call(1, 'browser_tabs', { action: 'list', agent: 'sub1' }));
  await sleep(40);
  const sub = h.children.get('sub1'); const main = h.children.get('main');
  sub.reply({ jsonrpc: '2.0', id: 0, method: 'roots/list' });
  main.reply({ jsonrpc: '2.0', id: 0, method: 'roots/list' });
  await sleep(20);
  const reqs = h.toClient.filter((m) => m.method === 'roots/list');
  ok('both reach the client; the sub\'s with an id of ours (no clash with main\'s)', reqs.length === 2 && reqs.some((m) => m.id === 0) && reqs.some((m) => typeof m.id === 'string' && m.id.startsWith('tandem-sub1-')));
  const ours = reqs.find((m) => m.id !== 0).id;
  h.send(msg({ jsonrpc: '2.0', id: ours, result: { roots: [{ uri: 'file:///w' }] } }));
  h.send(msg({ jsonrpc: '2.0', id: 0, result: { roots: [{ uri: 'file:///w' }] } }));
  await sleep(20);
  const back = sub.got.find((m) => !m.method && m.result?.roots);
  ok('the answer goes back to the sub with ITS id', back?.id === 0);
  ok('main\'s answer goes to main untouched', main.got.some((m) => !m.method && m.id === 0 && m.result?.roots));
  ok('…and not to the sub', sub.got.filter((m) => !m.method && m.result?.roots).length === 1);
  sub.reply({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
  sub.reply({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 1, progress: 1 } });
  await sleep(20);
  ok('a sub\'s list_changed is dropped, its progress is forwarded', !h.toClient.some((m) => m.method === 'notifications/tools/list_changed') && h.toClient.some((m) => m.method === 'notifications/progress'));
  h.send(msg({ jsonrpc: '2.0', method: 'notifications/roots/list_changed' }));
  await sleep(20);
  ok('roots/list_changed from the client reaches every child', [main, sub].every((c) => c.got.some((m) => m.method === 'notifications/roots/list_changed')));
}

console.log('cancellation, a dead child, a child that cannot start');
{
  const h = harness();
  h.send(call(1, 'browser_click', { agent: 'subA' }));
  h.send(msg({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }));
  await sleep(40);
  const sub = h.children.get('subA');
  ok('a cancel goes to the child that has the call (even sent while it waited for its handshake)', sub.got.some((m) => m.method === 'notifications/cancelled') && !h.children.get('main').got.some((m) => m.method === 'notifications/cancelled'));
  ok('…and ends the call once', h.events.filter((e) => e === 'end:subA:browser_click').length === 1);

  h.send(call(2, 'browser_snapshot', { agent: 'subA' }));
  await sleep(20);
  sub.kill();
  await sleep(20);
  const err = h.toClient.find((m) => m.id === 2);
  ok('its child dies: the pending call gets an error, not silence', !!err?.error && /subA/.test(err.error.message));
  h.send(call(3, 'browser_snapshot', { agent: 'subA' }));
  await sleep(40);
  ok('the next call of that agent starts a new child', h.spawned.filter((a) => a === 'subA').length === 2 && h.children.get('subA').calls()[0]?.id === 3);
}
{
  const h = harness({ opts: { bad: { initOk: false } } });
  h.send(call(1, 'browser_click', { agent: 'bad' }));
  h.send(call(2, 'browser_snapshot', { agent: 'bad' }));
  await sleep(60);
  const e1 = h.toClient.find((m) => m.id === 1); const e2 = h.toClient.find((m) => m.id === 2);
  ok('a handshake that fails: the waiting calls get ONE error each', !!e1?.error && !!e2?.error && h.toClient.filter((m) => m.id === 1 || m.id === 2).length === 2);
  ok('…and that child is killed', h.children.get('bad').killed);
}
{
  const h = harness({ opts: { slow: { autoInit: false } } });
  h.send(call(1, 'browser_click', { agent: 'slow' }));
  await sleep(400);   // initTimeoutMs = 300
  ok('a handshake that never answers times out into an error', !!h.toClient.find((m) => m.id === 1)?.error);
}

console.log('per-agent queues');
{
  // A slow begin() (focus hold) on one agent must not delay another agent's call.
  const h = harness({ emulator: (agent, events) => ({
    async begin() { events.push(`begin:${agent}`); if (agent === 'slowA') await sleep(200); },
    end() {},
  }) });
  h.send(call(1, 'browser_click', { agent: 'slowA' }));
  await sleep(20);
  const t0 = Date.now();
  h.send(call(2, 'browser_click', { agent: 'fastB' }));
  while (!h.children.get('fastB')?.calls().length && Date.now() - t0 < 1000) await sleep(5);
  const waited = Date.now() - t0;
  ok(`another agent's call is not held behind it (${waited} ms)`, waited < 120 && !h.children.get('slowA').calls().length);
  await sleep(250);
  ok('the slow agent\'s call goes out after its begin()', h.children.get('slowA').calls().length === 1);
}

console.log('local tools (browser_tab_adopt runs in the router, never in a child)');
{
  const clientIn = new PassThrough(); const clientOut = new PassThrough();
  const toClient = []; const children = new Map(); const handled = [];
  clientOut.on('data', (d) => { for (const l of String(d).split('\n').filter(Boolean)) toClient.push(JSON.parse(l)); });
  const events = [];
  routeStdio({
    clientIn, clientOut, multi: true, initTimeoutMs: 300,
    emulatorFor: (agent) => ({ async begin() { events.push(`begin:${agent}`); }, end(name) { events.push(`end:${agent}:${name}`); } }),
    spawnChild: (agent) => { const c = fakeChild(agent); children.set(agent, c); return c; },
    localTools: { browser_tab_adopt: {
      def: { name: 'browser_tab_adopt', inputSchema: { type: 'object' } },
      async handle({ agent, args, ask }) { handled.push({ agent, args }); const r = await ask('browser_tabs', { action: 'list' }); return { content: [{ type: 'text', text: `adopted for ${agent}; child said ${r?.content?.[0]?.text}` }] }; },
    } },
  });
  const send = (s) => clientIn.write(s);
  send(msg({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  await sleep(20);
  children.get('main').reply({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'browser_click' }] } });
  await sleep(20);
  const listed = toClient.find((m) => m.id === 1)?.result.tools.map((t) => t.name) || [];
  ok('main\'s tools/list answer gets the local tool appended', listed.join() === 'browser_click,browser_tab_adopt');
  send(call(2, 'browser_tab_adopt', { url: 'x', agent: 'subZ' }));
  await sleep(40);
  const z = children.get('subZ');
  const asked = z.got.find((m) => m.method === 'tools/call');
  ok('the handler gets its agent and args (agent taken out); its ask goes to THAT agent\'s child', handled[0]?.agent === 'subZ' && handled[0].args.url === 'x' && !('agent' in handled[0].args) && asked?.params.name === 'browser_tabs');
  z.reply({ jsonrpc: '2.0', id: asked.id, result: { content: [{ type: 'text', text: 'tabs!' }] } });
  await sleep(30);
  const res = toClient.find((m) => m.id === 2);
  ok('the result reaches the client; the child\'s answer to the ask does not', res?.result.content[0].text === 'adopted for subZ; child said tabs!' && !toClient.some((m) => m.id === asked.id));
  ok('the local call never reaches a child as such', ![...children.values()].some((c) => c.calls().some((m) => m.params.name === 'browser_tab_adopt')));
  ok('…and holds the agent\'s emulator like any call', events.includes('begin:subZ') && events.includes('end:subZ:browser_tab_adopt'));
}
{
  // Single mode: no local tools at all.
  const clientIn = new PassThrough(); const clientOut = new PassThrough(); const toClient = [];
  clientOut.on('data', (d) => { for (const l of String(d).split('\n').filter(Boolean)) toClient.push(JSON.parse(l)); });
  let c;
  routeStdio({ clientIn, clientOut, multi: false, emulatorFor: () => ({ async begin() {}, end() {} }), spawnChild: (a) => (c = fakeChild(a)), localTools: { browser_tab_adopt: { def: { name: 'browser_tab_adopt' }, handle: async () => ({}) } } });
  clientIn.write(msg({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  await sleep(20);
  c.reply({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'browser_click' }] } });
  clientIn.write(call(2, 'browser_tab_adopt', {}));
  await sleep(20);
  ok('single mode: not listed, and a call goes to the MCP as is', toClient.find((m) => m.id === 1)?.result.tools.length === 1 && c.calls().some((m) => m.params.name === 'browser_tab_adopt'));
}

console.log('an answer to a child\'s request never waits behind its queue (roots/list while a local tool waits on the child)');
{
  const clientIn = new PassThrough(); const clientOut = new PassThrough();
  const toClient = []; const children = new Map();
  clientOut.on('data', (d) => { for (const l of String(d).split('\n').filter(Boolean)) toClient.push(JSON.parse(l)); });
  routeStdio({
    clientIn, clientOut, multi: true, initTimeoutMs: 300,
    emulatorFor: () => ({ async begin() {}, end() {} }),
    spawnChild: (agent) => { const c = fakeChild(agent); children.set(agent, c); return c; },
    localTools: { browser_tab_adopt: { def: { name: 'browser_tab_adopt', inputSchema: { type: 'object' } },
      async handle({ ask }) { const r = await ask('browser_tabs', { action: 'list' }, 2000); return { content: [{ type: 'text', text: r ? 'got it' : 'ask timed out' }] }; } } },
  });
  for (const [agent, id, rootsId] of [['main', 50, 'r-main'], ['subR', 51, 'r-sub']]) {
    clientIn.write(call(id, 'browser_tab_adopt', { agent }));
    await sleep(40);
    const c = children.get(agent);
    const probe = c.got.find((m) => String(m.id).startsWith('tandem-probe') && m.method === 'tools/call');   // not its handshake
    c.reply({ jsonrpc: '2.0', id: rootsId, method: 'roots/list' });   // as the MCP does on its first call
    await sleep(20);
    const asked = toClient.filter((m) => m.method === 'roots/list').pop();
    clientIn.write(msg({ jsonrpc: '2.0', id: asked.id, result: { roots: [] } }));
    await sleep(20);
    ok(`${agent}: the client's answer reaches the child while the local tool is still waiting`, c.got.some((m) => m.id === rootsId && m.result));
    c.reply({ jsonrpc: '2.0', id: probe.id, result: { content: [] } });   // only now the child answers the ask
    await sleep(20);
    ok(`${agent}: …and the local tool finishes`, toClient.find((m) => m.id === id)?.result?.content?.[0]?.text === 'got it');
  }
}

console.log('life cycle (idle stop at stopMs, tabs closed at tabsMs, cap of agents; main never)');
{
  let t = 0; const now = () => t;
  const clientIn = new PassThrough(); const clientOut = new PassThrough(); const toClient = [];
  clientOut.on('data', (d) => { for (const l of String(d).split('\n').filter(Boolean)) toClient.push(JSON.parse(l)); });
  const spawned = []; const children = new Map(); const stopped = []; const tabsClosed = []; const done = new Set();
  const r = routeStdio({
    clientIn, clientOut, multi: true, initTimeoutMs: 300, now,
    emulatorFor: () => ({ async begin() {}, end() {} }),
    spawnChild: (agent) => { const c = fakeChild(agent); spawned.push(agent); children.set(agent, c); return c; },
    lifecycle: { stopMs: 600_000, tabsMs: 1_800_000, maxAgents: 2, onStop: (a) => stopped.push(a), onTabsIdle: async (a) => { tabsClosed.push(a); }, finished: (a) => done.has(a), clearFinished: (a) => done.delete(a) },
  });
  const answer = async (agent, id) => { await sleep(30); const c = children.get(agent); const m = c.calls().find((x) => x.id === id); if (m) c.reply({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'ok' }] } }); await sleep(20); };
  clientIn.write(call(1, 'browser_snapshot', { agent: 'main' })); await answer('main', 1);
  clientIn.write(call(2, 'browser_snapshot', { agent: 's1' })); await answer('s1', 2);
  t = 9 * 60_000; await r.tick();
  ok('9 min idle: nothing stopped', !stopped.length && r.agents().includes('s1'));
  t = 10 * 60_000; await r.tick();
  ok('10 min idle: the subagent\'s MCP is stopped (onStop first), main is not', stopped.join() === 's1' && !r.agents().includes('s1') && r.agents().includes('main') && children.get('s1').killed);
  t = 11 * 60_000;
  clientIn.write(call(3, 'browser_snapshot', { agent: 's1' })); await answer('s1', 3);
  ok('it comes back: its next call starts a new MCP and is answered', spawned.filter((a) => a === 's1').length === 2 && toClient.some((m) => m.id === 3 && m.result));
  t = 11 * 60_000 + 29 * 60_000; await r.tick();
  ok('its idle time starts again from that call (29 min later: tabs not closed yet)', !tabsClosed.length);
  t = 11 * 60_000 + 30 * 60_000; await r.tick();
  ok('30 min idle: its tabs are closed', tabsClosed.join() === 's1');
  // Finished (SubagentStop): stopped on the next tick, tabs kept; a call clears the mark; busy → waits; main → never.
  stopped.length = 0; tabsClosed.length = 0;
  clientIn.write(call(40, 'browser_snapshot', { agent: 'f1' })); await answer('f1', 40);
  done.add('f1'); await r.tick();
  ok('a finished subagent: its MCP stopped at once, not after 10 min', stopped.join() === 'f1' && !r.agents().includes('f1') && !done.has('f1'));
  ok('…its tabs are not closed: it may come back', !tabsClosed.length);
  stopped.length = 0;
  clientIn.write(call(41, 'browser_snapshot', { agent: 'f2' })); await answer('f2', 41);
  done.add('f2'); clientIn.write(call(42, 'browser_snapshot', { agent: 'f2' })); await answer('f2', 42);
  await r.tick();
  ok('resumed before the tick: the call clears the mark, not stopped', !done.has('f2') && r.agents().includes('f2') && !stopped.length);
  clientIn.write(call(43, 'browser_click', { agent: 'f2' })); await sleep(30);
  done.add('f2'); await r.tick();
  ok('busy: not stopped, the mark stays for a later tick', r.agents().includes('f2') && done.has('f2') && !stopped.length);
  await answer('f2', 43); await r.tick();
  ok('…stopped once idle', !r.agents().includes('f2') && stopped.join() === 'f2');
  done.add('main'); await r.tick();
  ok('main: a mark never stops it', r.agents().includes('main'));
  done.clear();
  t = 200 * 60_000; await r.tick();
  ok('main: never stopped, its tabs never closed by idleness', r.agents().includes('main') && !stopped.includes('main') && !tabsClosed.includes('main'));
  // Cap of 2 subagents: a third stops the least recently used IDLE one.
  clientIn.write(call(4, 'browser_snapshot', { agent: 'c1' })); await answer('c1', 4);
  t += 1000; clientIn.write(call(5, 'browser_snapshot', { agent: 'c2' })); await answer('c2', 5);
  t += 1000; clientIn.write(call(6, 'browser_click', { agent: 'c2' })); await sleep(30);   // c2 busy (unanswered)
  stopped.length = 0;
  t += 1000; clientIn.write(call(7, 'browser_snapshot', { agent: 'c3' })); await answer('c3', 7);
  ok('cap: a 3rd subagent stops the least recently used idle one (c1), not the busy c2', stopped.join() === 'c1' && r.agents().includes('c2') && r.agents().includes('c3'));
  ok('…and the busy call of c2 is still answered later', (await answer('c2', 6), toClient.some((m) => m.id === 6 && m.result)));
  // A lane that died must not take a NEWER lane of the same agent with it.
  const oldC3 = children.get('c3'); t += 1000;
  r.tick(); stopped.length = 0;
  t = 1e9; await r.tick();   // everything idle for ages: c2, c3 stopped
  clientIn.write(call(8, 'browser_snapshot', { agent: 'c3' })); await sleep(10);
  oldC3.emit('exit', 0, null); await answer('c3', 8);
  ok('the old MCP of an agent exiting late does not drop its new lane', r.agents().includes('c3') && toClient.some((m) => m.id === 8 && m.result));
}

console.log('client EOF');
{
  const h = harness();
  h.send(call(1, 'browser_click', { agent: 'x1' }));
  await sleep(30);
  const ends = [];
  for (const [a, c] of h.children) { c.stdin.on('end', () => ends.push(a)); c.stdin.resume(); }
  h.clientIn.end();
  await sleep(30);
  ok('closes every child\'s stdin', ends.sort().join() === 'main,x1');
}

// A real memo on a temporary disk (mcp-memo.mjs).
const INIT = { protocolVersion: '2025-11-25', capabilities: { roots: {} }, clientInfo: { name: 'claude-code' } };
const TOOLS = { tools: [{ name: 'browser_navigate', inputSchema: {} }] };
const LOCAL = { browser_tab_adopt: { def: { name: 'browser_tab_adopt' }, handle: async () => ({ content: [{ type: 'text', text: 'adopted' }] }) } };
const warmMemo = (tools = TOOLS) => {
  const memo = handshakeMemo({ dir: mkdtempSync(join(tmpdir(), 'tandem router ')), version: '0.0.83', env: {} });
  memo.record({ method: 'server/discover' }, { error: { code: -32601, message: 'Method not found' } });
  memo.record({ method: 'initialize', params: INIT }, { result: { protocolVersion: INIT.protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'Playwright' } } });
  memo.record({ method: 'tools/list' }, { result: tools });
  return memo;
};
const handshake = async (h) => {
  h.send(msg({ jsonrpc: '2.0', id: 'd', method: 'server/discover', params: {} }));
  h.send(msg({ jsonrpc: '2.0', id: 0, method: 'initialize', params: INIT }));
  h.send(msg({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  h.send(msg({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  await sleep(30);
};
const answer = (h, id) => h.toClient.find((m) => m.id === id);
// A fake MCP that answers tools/list (with these tools) and every call.
const answering = (c, tools = TOOLS) => {
  c.stdin.on('data', (d) => {
    for (const l of String(d).split('\n').filter(Boolean)) {
      const m = JSON.parse(l);
      if (m.method === 'tools/list') c.reply({ jsonrpc: '2.0', id: m.id, result: tools });
      else if (m.method === 'tools/call') c.reply({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `done ${m.params.name}` }] } });
    }
  });
};

console.log('main on demand: the memo answers the handshake, no MCP runs');
{
  const h = harness({ route: { memo: warmMemo(), localTools: LOCAL } });
  ok('nothing started before the client speaks', h.spawned.length === 0);
  await handshake(h);
  ok('…nor after the whole handshake', h.spawned.length === 0, h.spawned.join());
  ok('server/discover: the MCP\'s "method not found"', answer(h, 'd')?.error?.code === -32601);
  ok('initialize: the MCP\'s answer', answer(h, 0)?.result?.serverInfo?.name === 'Playwright' && answer(h, 0)?.result?.protocolVersion === INIT.protocolVersion);
  ok('tools/list: its tools + the local ones', answer(h, 1)?.result?.tools.map((t) => t.name).join() === 'browser_navigate,browser_tab_adopt');
  ok('…answers are JSON-RPC', answer(h, 1)?.jsonrpc === '2.0');
  h.send(msg({ jsonrpc: '2.0', id: 'p', method: 'ping' }));
  h.send(msg({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 77 } }));
  await sleep(20);
  ok('ping answered, a stray cancel dropped, still no MCP', JSON.stringify(answer(h, 'p')?.result) === '{}' && h.spawned.length === 0);
  // Second tools/list: the local tools aren't added twice.
  h.send(msg({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  await sleep(20);
  ok('a second tools/list: same list', answer(h, 2)?.result?.tools.length === 2);
}

console.log('main on demand: the first call starts it, with the client\'s handshake');
{
  const h = harness({ route: { memo: warmMemo() } });
  await handshake(h);
  h.send(call(5, 'browser_navigate', { url: 'http://a/', agent: 'main' }));
  await sleep(30);
  const main = h.children.get('main');
  ok('main started now, marked on demand', h.spawned.join() === 'main' && main.how?.onDemand === true);
  ok('…with the client\'s own initialize', JSON.stringify(main.got[0]?.params) === JSON.stringify(INIT) && main.got[0]?.method === 'initialize');
  ok('…then notifications/initialized', main.got[1]?.method === 'notifications/initialized');
  const c = main.calls();
  ok('the call reaches it, without `agent`', c.length === 1 && c[0].id === 5 && !('agent' in c[0].params.arguments));
  ok('the handshake isn\'t answered to the client again', h.toClient.filter((m) => m.id !== undefined && String(m.id).startsWith('tandem-probe')).length === 0);
  main.reply({ jsonrpc: '2.0', id: 5, result: { content: [{ type: 'text', text: 'ok' }] } });
  await sleep(20);
  ok('its answer reaches the client', answer(h, 5)?.result?.content?.[0]?.text === 'ok');
  // Up now: everything goes to it, as ever.
  h.send(msg({ jsonrpc: '2.0', id: 6, method: 'tools/list' }));
  await sleep(20);
  ok('main up: tools/list goes to it', main.got.some((m) => m.id === 6));
  main.reply({ jsonrpc: '2.0', method: 'roots/list', id: 40 });
  await sleep(20);
  ok('its requests reach the client', h.toClient.some((m) => m.method === 'roots/list'));
  h.send(msg({ jsonrpc: '2.0', id: 40, result: { roots: [] } }));
  await sleep(20);
  ok('…and the answer comes back', main.got.some((m) => m.id === 40 && m.result));
}

console.log('main on demand: a roots/list during its first call doesn\'t deadlock');
{
  const h = harness({ route: { memo: warmMemo() } });
  await handshake(h);
  h.send(call(5, 'browser_navigate', { agent: 'main' }));
  await sleep(20);
  const main = h.children.get('main');
  main.reply({ jsonrpc: '2.0', id: 0, method: 'roots/list' });
  await sleep(20);
  ok('the request reaches the client while the call is pending', h.toClient.some((m) => m.method === 'roots/list'));
  h.send(msg({ jsonrpc: '2.0', id: h.toClient.find((m) => m.method === 'roots/list').id, result: { roots: [{ uri: 'file:///x' }] } }));
  await sleep(20);
  ok('the answer reaches main at once', main.got.some((m) => !m.method && m.result?.roots));
}

console.log('main on demand: a subagent\'s call doesn\'t start main');
{
  const h = harness({ route: { memo: warmMemo() } });
  await handshake(h);
  h.send(call(5, 'browser_click', { agent: 'x1' }));
  await sleep(30);
  ok('only the subagent\'s MCP', h.spawned.join() === 'x1', h.spawned.join());
  h.send(msg({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  await sleep(20);
  ok('tools/list is still the memo\'s', answer(h, 2)?.result?.tools?.length === 1 && h.spawned.join() === 'x1');
  h.send(msg({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 5 } }));
  await sleep(20);
  ok('cancelling its call goes to it', h.children.get('x1').got.some((m) => m.method === 'notifications/cancelled'));
}

console.log('main on demand: tools checked against the memo when it starts');
{
  const memo = warmMemo();
  const h = harness({ route: { memo, localTools: LOCAL } });
  await handshake(h);
  h.send(call(5, 'browser_navigate', { agent: 'main' }));
  await sleep(5);
  const NEW = { tools: [{ name: 'browser_navigate', inputSchema: {} }, { name: 'browser_new', inputSchema: {} }] };
  answering(h.children.get('main'), NEW);
  // Its probe may already be out: the fake answers from now on, so ask it again if needed.
  const probe = h.children.get('main').got.find((m) => m.method === 'tools/list');
  if (probe) h.children.get('main').reply({ jsonrpc: '2.0', id: probe.id, result: NEW });
  await sleep(40);
  ok('different tools: the client is told', h.toClient.some((m) => m.method === 'notifications/tools/list_changed'));
  ok('…the memo is corrected', memo.answer({ method: 'tools/list' })?.result.tools.length === 2);
  h.send(msg({ jsonrpc: '2.0', id: 8, method: 'tools/list' }));
  await sleep(30);
  ok('…the new list has the new tool and the local one, once', answer(h, 8)?.result?.tools.map((t) => t.name).join() === 'browser_navigate,browser_new,browser_tab_adopt', JSON.stringify(answer(h, 8)));
  ok('…the correction carries no local tool', memo.answer({ method: 'tools/list' })?.result.tools.every((t) => t.name !== 'browser_tab_adopt'));

  const same = harness({ route: { memo: warmMemo() } });
  await handshake(same);
  same.send(call(5, 'browser_navigate', { agent: 'main' }));
  await sleep(5);
  const c = same.children.get('main');
  answering(c);
  const p2 = c.got.find((m) => m.method === 'tools/list');
  if (p2) c.reply({ jsonrpc: '2.0', id: p2.id, result: TOOLS });
  await sleep(30);
  ok('same tools: the client hears nothing', !same.toClient.some((m) => m.method === 'notifications/tools/list_changed'));
}

console.log('main on demand: it dies, or can\'t start');
{
  const ends = [];
  const h = harness({ route: { memo: warmMemo(), onClientEnd: () => ends.push(1) } });
  await handshake(h);
  h.send(call(5, 'browser_navigate', { agent: 'main' }));
  await sleep(30);
  const first = h.children.get('main');
  first.kill();
  await sleep(20);
  ok('its pending call gets an error, not silence', answer(h, 5)?.error?.message?.includes('main'));
  h.send(msg({ jsonrpc: '2.0', id: 'p2', method: 'ping' }));
  h.send(msg({ jsonrpc: '2.0', id: 3, method: 'tools/list' }));
  await sleep(20);
  ok('still answered from the memo while down', answer(h, 'p2') && answer(h, 3)?.result?.tools?.length === 1);
  h.send(call(6, 'browser_snapshot', {}));
  await sleep(30);
  ok('the next call starts a new one', h.spawned.join() === 'main,main' && h.children.get('main') !== first && h.children.get('main').calls()[0]?.id === 6);
  h.clientIn.end();
  await sleep(20);
  ok('the client going away is reported (the launcher exits on it)', ends.length === 1);

  const noInit = harness({ opts: { main: { initOk: false } }, route: { memo: warmMemo() } });
  await handshake(noInit);
  noInit.send(call(5, 'browser_navigate', {}));
  await sleep(30);
  ok('a failed handshake fails the call', answer(noInit, 5)?.error?.message?.includes('main'));

  const noSpawn = harness({ opts: { main: { autoInit: false } }, route: { memo: warmMemo() } });
  await handshake(noSpawn);
  noSpawn.send(call(5, 'browser_navigate', {}));
  await sleep(20);
  noSpawn.children.get('main').emit('error', new Error('spawn npx ENOENT'));
  await sleep(20);
  ok('can\'t be spawned: the call fails now, not after the handshake\'s timeout', answer(noSpawn, 5)?.error?.message?.includes('ENOENT'), JSON.stringify(answer(noSpawn, 5)));
}

console.log('main on demand: nobody waits for an MCP that failed (review of T306)');
{
  const h = harness({ opts: { main: { autoInit: false } }, route: { memo: warmMemo(), localTools: LOCAL } });
  await handshake(h);
  h.send(call(10, 'browser_navigate', {})); h.send(call(11, 'browser_navigate', {}));
  await sleep(20);
  const main = h.children.get('main');
  h.send(msg({ jsonrpc: '2.0', id: 12, method: 'ping' }));
  h.send(msg({ jsonrpc: '2.0', id: 13, method: 'tools/list' }));
  await sleep(20);
  ok('while it starts, a ping doesn\'t wait for it', answer(h, 12)?.result && !main.got.some((m) => m.method === 'ping'));
  ok('…nor tools/list: the memo answers', answer(h, 13)?.result?.tools.some((t) => t.name === 'browser_navigate'));
  h.send(msg({ jsonrpc: '2.0', id: 14, method: 'resources/list' }));
  await sleep(20);
  const t0 = Date.now();
  main.emit('exit', 1, null);
  await sleep(30);
  ok('it dies while starting: the call in flight gets an error', answer(h, 10)?.error);
  ok('…the one queued behind it too, now, not at the handshake\'s timeout', answer(h, 11)?.error && Date.now() - t0 < 200, `${Date.now() - t0} ms`);
  ok('…and a request only it could answer', answer(h, 14)?.error);
  h.send(call(15, 'browser_navigate', {}));
  await sleep(20);
  ok('the next call starts a new one', h.spawned.filter((a) => a === 'main').length === 2);
}
{
  const h = harness({ opts: { main: { autoInit: true } }, route: { memo: warmMemo(), localTools: LOCAL } });
  await handshake(h);
  h.send(call(20, 'browser_navigate', {}));
  await sleep(20);
  const main = h.children.get('main');
  h.send(msg({ jsonrpc: '2.0', id: 21, method: 'resources/list' }));
  await sleep(20);
  main.emit('exit', 1, null);
  await sleep(20);
  ok('it dies running: a pending request gets an error', answer(h, 21)?.error);
  const before = h.toClient.filter((m) => m.id === 21).length;
  ok('…only one', before === 1);
}
{
  const memo = warmMemo();
  const h = harness({ opts: { '*': { autoInit: true } }, route: { memo, localTools: LOCAL } });
  await handshake(h);
  h.send(call(30, 'browser_navigate', { agent: 'a0e815c57e8d30939' }));
  await sleep(10);
  const sub = h.children.get('a0e815c57e8d30939');
  ok('only a subagent uses the browser: main stays off', !h.spawned.includes('main'));
  await sleep(10);
  const list = sub.got.find((m) => m.method === 'tools/list');
  ok('…and its MCP is compared with the memo', !!list);
  sub.reply({ jsonrpc: '2.0', id: list?.id, result: { tools: [{ name: 'browser_new' }] } });
  await sleep(20);
  ok('…which it corrects, telling the client', h.toClient.some((m) => m.method === 'notifications/tools/list_changed') && memo.answer({ method: 'tools/list' })?.result.tools[0].name === 'browser_new');
  h.send(call(31, 'browser_navigate', { agent: 'a1e815c57e8d30939' }));
  await sleep(20);
  ok('…once per session', !h.children.get('a1e815c57e8d30939').got.some((m) => m.method === 'tools/list'));
}

console.log('cold memo: main at once, its answers fill the memo');
{
  const memo = handshakeMemo({ dir: mkdtempSync(join(tmpdir(), 'tandem router ')), version: '0.0.83', env: {} });
  const h = harness({ opts: { main: { autoInit: true } }, route: { memo, localTools: LOCAL } });
  ok('nothing yet: the client hasn\'t said what it wants', h.spawned.length === 0);
  h.send(msg({ jsonrpc: '2.0', id: 'd', method: 'server/discover', params: {} }));
  await sleep(20);
  ok('the first message starts main', h.spawned.join() === 'main');
  const main = h.children.get('main');
  ok('…at once, not on demand', main.how?.onDemand === false);
  main.reply({ jsonrpc: '2.0', id: 'd', error: { code: -32601, message: 'Method not found' } });
  h.send(msg({ jsonrpc: '2.0', id: 0, method: 'initialize', params: INIT }));
  h.send(msg({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  h.send(msg({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  await sleep(20);
  ok('the client\'s handshake goes to it, in order', ['server/discover', 'initialize', 'notifications/initialized', 'tools/list'].every((x, i) => main.got[i]?.method === x), main.got.map((m) => m.method).join());
  ok('its handshake isn\'t done twice', main.got.filter((m) => m.method === 'initialize').length === 1);
  main.reply({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'browser_navigate' }] } });
  await sleep(20);
  ok('the client gets its tools + the local one', answer(h, 1)?.result?.tools.map((t) => t.name).join() === 'browser_navigate,browser_tab_adopt');
  ok('the memo gets its tools, without the local one', memo.answer({ method: 'tools/list' })?.result.tools.map((t) => t.name).join() === 'browser_navigate');
  ok('…and the initialize + discover', memo.answer({ method: 'initialize', params: INIT }) && memo.answer({ method: 'server/discover' }));

  // Memo warm for discover but not for this protocolVersion: main at once, from initialize.
  const partial = warmMemo();
  const p = harness({ route: { memo: partial } });
  p.send(msg({ jsonrpc: '2.0', id: 'd', method: 'server/discover', params: {} }));
  await sleep(10);
  ok('another protocol: server/discover still from the memo', answer(p, 'd')?.error?.code === -32601 && p.spawned.length === 0);
  p.send(msg({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { ...INIT, protocolVersion: '2024-11-05' } }));
  await sleep(20);
  ok('…its initialize starts main at once, and gets the real answer', p.spawned.join() === 'main' && p.children.get('main').how?.onDemand === false && answer(p, 0)?.result?.protocolVersion === '2024-11-05');

  const unknown = harness({ route: { memo: warmMemo() } });
  await handshake(unknown);
  unknown.send(msg({ jsonrpc: '2.0', id: 'r', method: 'resources/list' }));
  await sleep(30);
  ok('a request the memo can\'t answer starts main and reaches it after its handshake', unknown.spawned.join() === 'main' && unknown.children.get('main').got.map((m) => m.method).join().endsWith('resources/list') && unknown.children.get('main').got[0].method === 'initialize', unknown.children.get('main')?.got.map((m) => m.method).join());
}

console.log('no memo, or single mode: as before');
{
  const h = harness();
  ok('no memo: main at once', h.spawned.join() === 'main');
  const memo = warmMemo();
  const clientIn = new PassThrough(); const clientOut = new PassThrough(); const spawned = [];
  routeStdio({ clientIn, clientOut, multi: false, memo, emulatorFor: () => ({ async begin() {}, end() {} }), spawnChild: (a) => { spawned.push(a); return fakeChild(a); } });
  ok('single mode ignores the memo: main at once', spawned.join() === 'main');
}

console.log(`\n${pass} ok, ${fail} failures`);
process.exit(fail ? 1 : 0);
