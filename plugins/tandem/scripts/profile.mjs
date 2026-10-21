#!/usr/bin/env node
// profile.mjs — site-profile store access: resolve, index, sections (tandem:map).
//
// Why an INDEX: real profiles outgrow the context budget. A teammate's `localhost.md` reached 26 KB;
// Claude Code moves an additionalContext over 10,000 chars to a file and shows a 2,000-char preview,
// so on every navigate the model saw ~8 % of its own site memory, cut at an arbitrary point. Now:
//   - profile ≤ INLINE_MAX chars → injected whole (small profiles: no extra round-trip);
//   - bigger → an INDEX ≤ INDEX_MAX chars (frontmatter, sections with sizes, recipe signatures,
//     routes) and the model pulls the section it needs: `map.sh show <key> --section "<title>"`.
// The high level of the memory is always present; the detail is fetched (cf. HMT, R01).
//
// Resolution: key = normalizeHost(url) (`host` or `host_port`); if `sites/<key>.md` is missing, fall
// back to the legacy port-less `sites/<host>.md` (profiles written before ports were part of the key),
// then to the `www.` / non-`www.` twin.
//
// CLI:  profile.mjs resolve  <url|key>           → path of the profile that applies (exit 1 if none)
//       profile.mjs index    <url|key>           → the index
//       profile.mjs sections <url|key>           → section titles with sizes
//       profile.mjs section  <url|key> <title>   → one section (exact or prefix match, case-insensitive)

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostOf, normalizeHost } from './host.mjs';
import { dataDir } from './paths.mjs';

export const INLINE_MAX = 6000;
export const INDEX_MAX = 2000;

// → { key, path, legacy } for the profile that applies to `raw`, or null.
// Candidates, in order: the exact key, the legacy port-less host, and each with/without `www.`
// (`www.example.com` and `example.com` are almost always one site; a profile saved under either is found).
export function resolveProfile(raw, dir = dataDir()) {
  const key = normalizeHost(raw);
  const www = (k) => (k.startsWith('www.') ? k.slice(4) : `www.${k}`);
  const cands = [...new Set([key, hostOf(key), www(key), www(hostOf(key))])];
  for (const c of cands) {
    const path = join(dir, 'sites', `${c}.md`);
    if (existsSync(path)) return { key, path, legacy: c !== key };
  }
  return null;
}

// Frontmatter (between the first two '---') + `## ` sections with their char sizes.
export function parseSections(md) {
  const lines = md.split('\n');
  let i = 0; const front = {};
  if (lines[0] === '---') {
    for (i = 1; i < lines.length && lines[i] !== '---'; i++) {
      const m = lines[i].match(/^([A-Za-z_]+):\s*(.*)$/); if (m) front[m[1]] = m[2];
    }
    i++;
  }
  const sections = [];
  for (; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.*)$/);
    if (m) sections.push({ title: m[1].trim(), lines: [] });
    else if (sections.length) sections[sections.length - 1].lines.push(lines[i]);
  }
  for (const s of sections) s.chars = s.lines.join('\n').length;
  return { front, sections };
}

export function findSection(md, title) {
  const { sections } = parseSections(md);
  const t = title.toLowerCase();
  return sections.find((s) => s.title.toLowerCase() === t) || sections.find((s) => s.title.toLowerCase().startsWith(t)) || null;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// The index: everything the model needs to know WHAT the profile holds and HOW to fetch it, ≤ max chars.
export function buildIndex(key, md, { source = `sites/${key}.md`, max = INDEX_MAX, mapCmd = 'scripts/map.sh' } = {}) {
  const { front, sections } = parseSections(md);
  const out = [];
  const push = (line) => { if (out.join('\n').length + line.length + 1 <= max) { out.push(line); return true; } return false; };
  push(`INDEX of ${source} (${md.length} chars, ${sections.length} sections) — fetch a section with:`);
  push(`  ${mapCmd} show ${key} --section "<title>"`);
  if (front.updated) push(`updated: ${front.updated}`);
  if (front.auth) push(`auth: ${clip(front.auth, 160)}`);
  push('sections:');
  for (const s of sections) if (!push(`- ${clip(s.title, 70)} (${s.chars} chars)`)) break;
  const recipes = sections.filter((s) => /^recipes/i.test(s.title))
    .flatMap((s) => s.lines.map((l) => l.match(/^([A-Za-z0-9-]+)(\([^)]*\))?:\s*$/)).filter(Boolean).map((m) => m[1] + (m[2] || '')));
  if (recipes.length) {
    push('recipes:');
    let shown = 0;
    for (const r of recipes) { if (!push(`- ${clip(r, 80)}`)) break; shown++; }
    if (shown < recipes.length) push(`  …+${recipes.length - shown} more (section Recipes)`);
  }
  // Route lines: bullets and table rows — minus separator rows and header rows (the row right above a separator).
  const isSep = (l) => /^\s*\|[-:\s|]+\|?\s*$/.test(l || '');
  const routes = sections.filter((s) => /^routes/i.test(s.title)).flatMap((s) => s.lines.filter((l, i, a) => /^\s*[-|]/.test(l) && !isSep(l) && !isSep(a[i + 1])));
  if (routes.length) {
    push('routes:');
    let shown = 0;
    for (const r of routes) { if (!push(`  ${clip(r.trim(), 90)}`)) break; shown++; }
    if (shown < routes.length) push(`  …+${routes.length - shown} more (section Routes)`);
  }
  return out.join('\n');
}

// --- CLI ------------------------------------------------------------------------------
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
  const [cmd, raw, ...rest] = process.argv.slice(2);
  if (!['resolve', 'index', 'sections', 'section'].includes(cmd) || !raw) {
    process.stderr.write('usage: profile.mjs {resolve|index|sections|section <title>} <url|key>\n'); process.exit(2);
  }
  let r;
  try { r = resolveProfile(raw); } catch (e) { process.stderr.write(`profile: ${e.message}\n`); process.exit(2); }
  if (!r) { process.stderr.write(`profile: no profile for '${normalizeHost(raw)}'\n`); process.exit(1); }
  if (cmd === 'resolve') { process.stdout.write(r.path + '\n'); process.exit(0); }
  const md = readFileSync(r.path, 'utf8');
  if (cmd === 'index') process.stdout.write(buildIndex(r.key, md, { source: `sites/${basename(r.path)}` }) + '\n');
  if (cmd === 'sections') for (const s of parseSections(md).sections) process.stdout.write(`${s.title}\t${s.chars}\n`);
  if (cmd === 'section') {
    const s = findSection(md, rest.join(' '));
    if (!s) { process.stderr.write(`profile: no section '${rest.join(' ')}' — see: map.sh sections ${r.key}\n`); process.exit(1); }
    process.stdout.write(`## ${s.title}\n${s.lines.join('\n')}\n`);
  }
}
