#!/usr/bin/env node
// router.test.mjs — agent-router.mjs in multi mode, with fake children (no Chrome, no MCP): routing by
// `agent`, stripping it, lazy children with the client's own handshake, a child's roots/list round trip,
// cancellations, a dead child, per-agent queues. Single mode is tests/focus.test.mjs (proxyStdio).
// No dependencies: mini-runner. Usage: node tests/router.test.mjs

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { routeStdio, takeAgent } from '../scripts/agent-router.mjs';

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

function harness({ opts = {}, emulator } = {}) {
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
    spawnChild: (agent) => { const c = fakeChild(agent, opts[agent] || opts['*'] || {}); spawned.push(agent); children.set(agent, c); return c; },
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

console.log(`\n${pass} ok, ${fail} failures`);
process.exit(fail ? 1 : 0);
