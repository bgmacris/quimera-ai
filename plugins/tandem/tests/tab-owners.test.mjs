#!/usr/bin/env node
// tab-owners.test.mjs — the cross-session ownership registry (scripts/tab-owners.mjs), no Chrome.
// No dependencies: mini-runner. Usage: node tests/tab-owners.test.mjs

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { tabOwners, ownersDir } = await import('../scripts/tab-owners.mjs');

let pass = 0; let fail = 0;
function ok(desc, cond) {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}\n`); }
}

const dir = mkdtempSync(join(tmpdir(), 'tandem-owners-'));
// Another live session: a real process that stays up during the test.
const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
const dead = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
await new Promise((r) => dead.on('exit', r));

try {
  const me = tabOwners(dir);
  const them = tabOwners(dir, { pid: other.pid });
  const ghost = tabOwners(dir, { pid: dead.pid });
  const A = 'AAAA1111BBBB2222CCCC3333DDDD4444'; const B = 'BBBB2222'; const C = 'CCCC3333'; const H = 'EEEE5555';

  me.claim(A, 'main'); them.claim(B, 'a0597f'); ghost.claim(C, 'sub');
  ok('mine → mine', me.classify(A) === 'mine');
  ok('another live session → session', me.classify(B) === 'session');
  ok('a dead session\'s claim → human', me.classify(C) === 'human' && me.lookup(C) === null);
  ok('never claimed → human', me.classify(H) === 'human');
  ok('lookup gives pid and agent', me.lookup(B)?.pid === other.pid && me.lookup(B)?.agent === 'a0597f');
  ok('claims are private files (0600 in a 0700 dir)', (statSync(join(ownersDir(dir), A)).mode & 0o777) === 0o600 && (statSync(ownersDir(dir)).mode & 0o777) === 0o700);

  me.release(B);
  ok('release does not drop another session\'s claim', me.classify(B) === 'session');
  me.release(A);
  ok('release drops our own', me.classify(A) === 'human' && !existsSync(join(ownersDir(dir), A)));

  writeFileSync(join(ownersDir(dir), 'FFFF6666'), 'not json');
  ok('a corrupt claim reads as nobody\'s', me.classify('FFFF6666') === 'human');
  const n = me.sweep();
  ok('sweep removes dead and corrupt claims, keeps live ones', n === 2 && !existsSync(join(ownersDir(dir), C)) && existsSync(join(ownersDir(dir), B)));
  me.claim(A, 'main');
  ok('sweep with live ids drops claims of closed tabs', me.sweep([B]) === 1 && me.classify(A) === 'human' && me.classify(B) === 'session');

  let threw = 0;
  for (const bad of ['../x', 'abc/def', '', 'zzzz9999', 'A'.repeat(65)]) { try { me.claim(bad, 'main'); } catch { threw++; } }
  ok('non-Chrome target ids are refused (they become file names)', threw === 5);
  ok('sweep on a missing dir is a no-op', tabOwners(join(dir, 'nope')).sweep() === 0);
  // reap(): claims of DEAD sessions, removed and returned with what they were (phase 5).
  const rdir = join(dir, 'reap'); const live = tabOwners(rdir);
  const deadPid = 2 ** 22 + 12345;   // above macOS/Linux pid ranges in practice: not alive
  const deadReg = tabOwners(rdir, { pid: deadPid });
  deadReg.claim('AAAA0000AAAA0000', 'a1');
  deadReg.claim('BBBB0000BBBB0000', 'a1', { adopted: true });
  live.claim('CCCC0000CCCC0000', 'main');
  const reaped = live.reap().sort((x, y) => x.targetId.localeCompare(y.targetId));
  ok('reap returns the dead session\'s claims, own and handed-over told apart', JSON.stringify(reaped) === JSON.stringify([{ targetId: 'AAAA0000AAAA0000', agent: 'a1', adopted: false }, { targetId: 'BBBB0000BBBB0000', agent: 'a1', adopted: true }]));
  ok('…removes them, and keeps the live session\'s', live.classify('AAAA0000AAAA0000') === 'human' && !existsSync(join(ownersDir(rdir), 'BBBB0000BBBB0000')) && live.classify('CCCC0000CCCC0000') === 'mine');
  ok('reap twice: nothing more', live.reap().length === 0);
  ok('an adopted claim records it', (live.claim('DDDD0000DDDD0000', 'x', { adopted: true }), live.lookup('DDDD0000DDDD0000')?.adopted === true));
} finally {
  other.kill(); rmSync(dir, { recursive: true, force: true });
}

console.log(`\nresult: ${pass} ok, ${fail} failures`);
process.exit(fail ? 1 : 0);
