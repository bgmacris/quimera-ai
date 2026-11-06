#!/usr/bin/env node
// mcp-memo.test.mjs — the memo of the MCP's handshake (mcp-memo.mjs), on a real disk: what makes an answer
// valid, what separates one memo from another, damaged files. No dependencies. Usage: node tests/mcp-memo.test.mjs
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handshakeMemo, memoKey } from '../scripts/mcp-memo.mjs';

let pass = 0; let fail = 0;
const ok = (desc, cond, extra = '') => {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}${extra ? ` — ${extra}` : ''}\n`); }
};
const tmp = () => mkdtempSync(join(tmpdir(), 'tandem memo '));
const INIT = { method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {} } };
const LIST = { method: 'tools/list' };
const TOOLS = { tools: [{ name: 'browser_navigate' }] };
const INIT_R = { protocolVersion: '2025-11-25', capabilities: { tools: {} } };
const env = {};

console.log('answers');
{
  const dir = tmp();
  const memo = handshakeMemo({ dir, version: '0.0.83', env });
  ok('empty: no answers', !memo.answer(INIT) && !memo.answer(LIST) && !memo.answer({ method: 'server/discover' }));
  memo.record(INIT, { result: INIT_R });
  ok('initialize alone is not an answer: the client would get no tools', !memo.answer(INIT));
  memo.record(LIST, { result: TOOLS });
  ok('initialize + tools: answered', memo.answer(INIT)?.result.protocolVersion === '2025-11-25' && memo.answer(LIST)?.result.tools.length === 1);
  ok('another protocolVersion: not answered', !memo.answer({ method: 'initialize', params: { protocolVersion: '2024-11-05' } }));
  ok('a page of tools/list: not answered', !memo.answer({ method: 'tools/list', params: { cursor: 'x' } }));
  ok('other methods: never', !memo.answer({ method: 'resources/list' }) && !memo.answer({ method: 'tools/call', params: {} }));
  memo.record({ method: 'server/discover' }, { error: { code: -32601, message: 'Method not found' } });
  ok('server/discover "method not found": answered', memo.answer({ method: 'server/discover' })?.error.code === -32601);

  const again = handshakeMemo({ dir, version: '0.0.83', env });
  ok('survives: a new session reads it', again.answer(INIT) && again.answer(LIST) && again.answer({ method: 'server/discover' }));
  ok('no temporary files left', readdirSync(join(dir, 'mcp-memo')).every((f) => f.endsWith('.json')));
}

console.log('what it refuses to keep');
{
  const dir = tmp();
  const memo = handshakeMemo({ dir, version: '0.0.83', env });
  memo.record({ method: 'server/discover' }, { result: { a: 1 } });
  ok('a server/discover that answers: not kept (it may depend on the request)', !memo.answer({ method: 'server/discover' }));
  memo.record({ method: 'server/discover' }, { error: { code: -32000, message: 'busy' } });
  ok('a server/discover with another error: not kept', !memo.answer({ method: 'server/discover' }));
  memo.record(LIST, { result: { tools: [] } });
  memo.record(LIST, { error: { code: 1 } });
  memo.record(INIT, { error: { code: 1 } });
  ok('no tools, or errors: not kept', !memo.answer(LIST));
  memo.record(LIST, { result: { ...TOOLS, nextCursor: 'more' } });
  ok('a partial list (nextCursor): not kept', !memo.answer(LIST));
}

console.log('the response is copied');
{
  const dir = tmp();
  const memo = handshakeMemo({ dir, version: '0.0.83', env });
  const res = { result: { tools: [{ name: 'browser_navigate' }] } };
  memo.record(LIST, res);
  res.result.tools.push({ name: 'browser_tab_adopt' });   // what the router does to the response it forwards
  ok('a later change to the response does not reach the memo', memo.answer(LIST).result.tools.length === 1);
  memo.setCli('/x/cli.js');   // another save, after the change
  ok('…nor the file, on a later save', handshakeMemo({ dir, version: '0.0.83', env }).answer(LIST).result.tools.length === 1);
  ok('the cli is kept', handshakeMemo({ dir, version: '0.0.83', env }).cli() === '/x/cli.js');
}

console.log('one memo per version + flags + config');
{
  ok('version', memoKey('0.0.83', {}) !== memoKey('0.0.84', {}));
  ok('flags', memoKey('0.0.83', {}) !== memoKey('0.0.83', { TANDEM_MCP_ARGS: '--caps vision' }));
  ok('flags: only the words count', memoKey('0.0.83', { TANDEM_MCP_ARGS: ' --caps  vision ' }) === memoKey('0.0.83', { TANDEM_MCP_ARGS: '--caps vision' }));
  ok('the MCP\'s env config', memoKey('0.0.83', {}) !== memoKey('0.0.83', { PLAYWRIGHT_MCP_CAPS: 'vision' }));
  ok('other env: no', memoKey('0.0.83', {}) === memoKey('0.0.83', { HOME: '/x', TANDEM_DEBUG: '1' }));
  const dir = tmp();
  handshakeMemo({ dir, version: '0.0.83', env }).record(LIST, { result: TOOLS });
  ok('a new pin starts empty', !handshakeMemo({ dir, version: '0.0.84', env }).answer(LIST));
  ok('"latest" and ranges: not memoized (same name, other answers)', ['latest', '0.0.x', '^0.0.83', 'next'].every((version) => handshakeMemo({ dir, version, env }) === null));
  ok('exact prerelease: memoized', handshakeMemo({ dir, version: '0.0.84-alpha.1', env }) !== null);
  ok('a version can\'t escape the folder', handshakeMemo({ dir, version: '../../0.0.83', env }) === null);
}

console.log('damaged files');
{
  const damaged = (content) => {
    const dir = tmp();
    const memo = handshakeMemo({ dir, version: '0.0.83', env });
    memo.record(LIST, { result: TOOLS });
    const f = join(dir, 'mcp-memo', readdirSync(join(dir, 'mcp-memo'))[0]);
    writeFileSync(f, content);
    return { dir, f, memo: handshakeMemo({ dir, version: '0.0.83', env }) };
  };
  for (const [what, content] of [['not JSON', '{oops'], ['an array', '[]'], ['null', 'null'], ['empty', '']]) {
    const { memo } = damaged(content);
    ok(`${what}: no answers, no crash`, !memo.answer(INIT) && !memo.answer(LIST));
  }
  const { memo } = damaged(JSON.stringify({ tools: { tools: 'x' }, initialize: { '2025-11-25': 3 }, discover: 'x', cli: 7 }));
  ok('wrong shapes: no answers', !memo.answer(INIT) && !memo.answer(LIST) && !memo.answer({ method: 'server/discover' }) && memo.cli() === null);
  const d = damaged('{oops');
  d.memo.record(LIST, { result: TOOLS });
  ok('a damaged file is repaired by the next real answer', handshakeMemo({ dir: d.dir, version: '0.0.83', env }).answer(LIST) && JSON.parse(readFileSync(d.f, 'utf8')).tools);
  const blocked = tmp(); writeFileSync(join(blocked, 'mcp-memo'), 'a file where the folder goes');
  const m2 = handshakeMemo({ dir: blocked, version: '0.0.83', env });
  m2.record(LIST, { result: TOOLS });
  ok('can\'t write: no crash', m2.answer(LIST) !== undefined);
}

console.log('what the key and the checks cover (review of T306)');
{
  ok('the flags the MCP runs with', memoKey('0.0.83', {}, ['--a']) !== memoKey('0.0.83', {}, ['--a', '--caps', 'vision']));
  const dir = tmp(); const cfg = join(dir, 'c.json');
  writeFileSync(cfg, '{"a":1}');
  const k1 = memoKey('0.0.83', {}, ['--config', cfg]);
  const k1b = memoKey('0.0.83', {}, [`--config=${cfg}`]);
  const k2 = memoKey('0.0.83', { PLAYWRIGHT_MCP_CONFIG: cfg });
  writeFileSync(cfg, '{"a":2}');
  ok('its config file\'s content, by flag', memoKey('0.0.83', {}, ['--config', cfg]) !== k1);
  ok('…by --config=', memoKey('0.0.83', {}, [`--config=${cfg}`]) !== k1b);
  ok('…by env', memoKey('0.0.83', { PLAYWRIGHT_MCP_CONFIG: cfg }) !== k2);
  ok('a config that can\'t be read: no crash', typeof memoKey('0.0.83', {}, ['--config', join(dir, 'none')]) === 'string');

  const d = tmp();
  const m = handshakeMemo({ dir: d, version: '0.0.83', env, args: ['--x'] });
  m.record(LIST, { result: TOOLS }); m.record(INIT, { result: INIT_R });
  const f = join(d, 'mcp-memo', readdirSync(join(d, 'mcp-memo'))[0]);
  writeFileSync(f, JSON.stringify({ tools: { tools: [1] }, initialize: { '2025-11-25': {} } }));
  const bad = handshakeMemo({ dir: d, version: '0.0.83', env, args: ['--x'] });
  ok('a tool that is not a tool, an empty initialize: no answers', !bad.answer(INIT) && !bad.answer(LIST));
  const nope = tmp(); const n = handshakeMemo({ dir: nope, version: '0.0.83', env });
  n.record(INIT, { result: {} }); n.record(LIST, { result: TOOLS });
  ok('an empty initialize isn\'t recorded', !n.answer(INIT));

  const blocked = tmp(); mkdirSync(join(blocked, 'mcp-memo'));
  const b = handshakeMemo({ dir: blocked, version: '0.0.83', env });
  mkdirSync(join(blocked, 'mcp-memo', `0.0.83-${memoKey('0.0.83', env)}.json`));   // the rename can't land
  b.record(LIST, { result: TOOLS });
  ok('a failed write leaves no .tmp', !readdirSync(join(blocked, 'mcp-memo')).some((x) => x.endsWith('.tmp')));
}

console.log('two sessions writing');
{
  const dir = tmp(); mkdirSync(join(dir, 'x'));
  const a = handshakeMemo({ dir, version: '0.0.83', env });
  const b = handshakeMemo({ dir, version: '0.0.83', env });
  a.record(LIST, { result: TOOLS });
  b.record(INIT, { result: INIT_R });
  ok('the second keeps what the first wrote', handshakeMemo({ dir, version: '0.0.83', env }).answer(INIT) !== null);
}

console.log(`\n${pass} ok, ${fail} failures`);
process.exit(fail ? 1 : 0);
