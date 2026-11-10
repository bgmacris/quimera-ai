#!/usr/bin/env node
// session-titles.test.mjs — 0.13: readable tab-group titles from Claude Code's files (scripts/session-titles.mjs).
// Fixtures in a temp CLAUDE_CONFIG_DIR shaped like Claude Code 2.1.322's: <projects>/<cwd-slug>/<session>.jsonl with
// "custom-title"/"ai-title" lines, and <session>/subagents/agent-<id>.meta.json with "description"/"agentType".
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_TITLE, okTranscript, sessionTitle, subagentMetaPath, subagentTitle, tidy, titler } from '../scripts/session-titles.mjs';

let pass = 0; let fail = 0;
const ok = (desc, cond, extra = '') => { if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); } else { fail++; process.stdout.write(`  ✗ ${desc}${extra ? ` — ${extra}` : ''}\n`); } };

const cfg = mkdtempSync(join(tmpdir(), 'tandem-titles-'));
const env = { CLAUDE_CONFIG_DIR: cfg };
const proj = join(cfg, 'projects', '-Users-x-dev-app'); mkdirSync(proj, { recursive: true });
const S = 'aaaaaaaa-1111-2222-3333-444444444444';
const tr = join(proj, `${S}.jsonl`);
const line = (o) => JSON.stringify(o) + '\n';
const filler = (n) => Array.from({ length: n }, (_, i) => line({ type: 'user', message: { content: `x${i} `.repeat(40) } })).join('');
try {
  console.log('tidy');
  ok('one line, spaces collapsed', tidy('  a\n\tb   c ') === 'a b c');
  ok('cut with an ellipsis at MAX_TITLE', [...tidy('x'.repeat(60))].length === MAX_TITLE && tidy('x'.repeat(60)).endsWith('…'));
  ok('short titles kept', tidy('Plugin tandem catastro') === 'Plugin tandem catastro');
  ok('emoji not split in half', !tidy('🦊'.repeat(40)).includes('�'));
  ok('empty / not a string → null', tidy('  ') === null && tidy(7) === null);

  console.log('which transcripts are read');
  ok('a .jsonl under <config>/projects', okTranscript(tr, env));
  ok('not under projects → no', !okTranscript('/etc/passwd.jsonl', env) && !okTranscript(join(cfg, 'x.jsonl'), env));
  ok('.. out of projects → no', !okTranscript(join(cfg, 'projects', '..', 'evil.jsonl'), env));
  ok('not .jsonl → no', !okTranscript(join(proj, 'a.json'), env));
  ok('not a string → no', !okTranscript(null, env));

  console.log('session title');
  ok('no file → null', sessionTitle(tr, env) === null);
  writeFileSync(tr, filler(5));
  ok('no title yet → null', sessionTitle(tr, env) === null);
  appendFileSync(tr, line({ type: 'ai-title', aiTitle: 'Old name', sessionId: S }) + filler(3) + line({ type: 'ai-title', aiTitle: 'Plugin tandem catastro', sessionId: S }));
  ok('ai-title: the last one', sessionTitle(tr, env) === 'Plugin tandem catastro');
  appendFileSync(tr, line({ type: 'custom-title', customTitle: 'Grupos de pestañas', sessionId: S }) + line({ type: 'ai-title', aiTitle: 'Plugin tandem catastro', sessionId: S }));
  ok('custom-title (/rename) wins over a later ai-title', sessionTitle(tr, env) === 'Grupos de pestañas');
  appendFileSync(tr, filler(4000));   // ~1 MB after the titles: the first 256 KB tail has none
  ok('titles far from the end: the tail grows until it finds them', sessionTitle(tr, env) === 'Grupos de pestañas');
  appendFileSync(tr, '{"type":"ai-title","aiTi');   // a line being written
  ok('a half-written last line is skipped', sessionTitle(tr, env) === 'Grupos de pestañas');
  ok('a transcript outside projects is not read', sessionTitle(tr, { CLAUDE_CONFIG_DIR: join(cfg, 'other') }) === null);

  console.log('subagent title');
  const A = 'ab15143809a37485f';
  ok('meta path from the session transcript', subagentMetaPath(tr, A) === join(proj, S, 'subagents', `agent-${A}.meta.json`));
  ok('meta path from the subagent\'s own transcript', subagentMetaPath(join(proj, S, 'subagents', 'agent-zz.jsonl'), A) === join(proj, S, 'subagents', `agent-${A}.meta.json`));
  ok('no meta → null', subagentTitle(tr, A, env) === null);
  mkdirSync(join(proj, S, 'subagents'), { recursive: true });
  writeFileSync(subagentMetaPath(tr, A), JSON.stringify({ agentType: 'general-purpose', description: 'Write final report' }));
  ok('"↳ " + its description', subagentTitle(tr, A, env) === '↳ Write final report');
  ok('the same from its own transcript', subagentTitle(join(proj, S, 'subagents', `agent-${A}.jsonl`), A, env) === '↳ Write final report');
  writeFileSync(subagentMetaPath(tr, 'b2'), JSON.stringify({ agentType: 'tandem:web-navigator' }));
  ok('no description → its type', subagentTitle(tr, 'b2', env) === '↳ tandem:web-navigator');
  writeFileSync(subagentMetaPath(tr, 'b3'), '{ not json');
  ok('broken meta → null', subagentTitle(tr, 'b3', env) === null);
  ok('an agent id with a path in it → null', subagentTitle(tr, '../../x', env) === null);
  writeFileSync(subagentMetaPath(tr, 'b4'), JSON.stringify({ description: 'd'.repeat(80) }));
  ok('long description cut to MAX_TITLE with the arrow', [...subagentTitle(tr, 'b4', env)].length === MAX_TITLE);

  console.log('titler (cache, /rename)');
  let t = 0; const T = titler({ ttlMs: 1000, env, now: () => t });
  ok('unknown agent → null', T.title('main') === null);
  T.note('main', '/etc/x.jsonl');
  ok('a transcript outside projects is ignored', T.title('main') === null);
  T.note('main', tr); T.note(A, tr);
  ok('main → the session title', T.title('main') === 'Grupos de pestañas');
  ok('subagent → its description', T.title(A) === '↳ Write final report');
  ok('first read is not a change', T.changed('main') === false);
  appendFileSync(tr, '\n' + line({ type: 'custom-title', customTitle: 'Títulos legibles', sessionId: S }));
  ok('renamed, within ttl → still the cached title', T.title('main') === 'Grupos de pestañas' && T.changed('main') === false);
  t = 1500;
  ok('after ttl → changed() once', T.changed('main') === true && T.changed('main') === false);
  ok('…and the new title', T.title('main') === 'Títulos legibles');
} catch (e) {
  ok(`no exception: ${e.stack}`, false);
} finally {
  rmSync(cfg, { recursive: true, force: true });
  console.log(`session-titles: ${pass} ok, ${fail} failures`);
  process.exit(fail ? 1 : 0);
}
