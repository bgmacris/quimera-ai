#!/usr/bin/env node
// report.mjs — aggregate a benchmark run: per arm, success (WebArena-Verified eval_result.json,
// written by `webarena-verified eval-tasks`), cost, observation bytes, turns — overall and by
// instance number within a template (1 = cold, 2..K = profile warm for arms C/D).
// Usage: report.mjs <out-dir> [--json]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [OUT] = process.argv.slice(2);
if (!OUT) { process.stderr.write('usage: report.mjs <out-dir> [--json]\n'); process.exit(2); }
const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

const rows = [];
for (const arm of readdirSync(OUT).filter((d) => /^[A-Z]$/.test(d)).sort()) {
  for (const t of readdirSync(join(OUT, arm)).filter((d) => /^\d+$/.test(d))) {
    const m = read(join(OUT, arm, t, 'metrics.json')); if (!m) continue;
    const ev = read(join(OUT, arm, t, 'eval_result.json'));
    rows.push({ ...m, arm, score: ev ? ev.score : null });
  }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt = (x, d = 2) => (x == null ? '—' : x.toFixed(d));
function summarize(rs) {
  const scored = rs.filter((r) => r.score != null);
  return {
    n: rs.length, scored: scored.length, harnessErrors: rs.filter((r) => r.harnessError).length,
    success: mean(scored.map((r) => r.score)), costUsd: mean(rs.filter((r) => r.costUsd != null).map((r) => r.costUsd)),
    obsKB: mean(rs.filter((r) => r.observationBytes != null).map((r) => r.observationBytes / 1024)),
    turns: mean(rs.filter((r) => r.turns != null).map((r) => r.turns)),
    load1: mean(rs.filter((r) => r.loadBefore).map((r) => r.loadBefore[0])),   // machine load at task start
  };
}

const arms = [...new Set(rows.map((r) => r.arm))];
const out = { overall: {}, byInstance: {} };
for (const a of arms) {
  out.overall[a] = summarize(rows.filter((r) => r.arm === a));
  const inst = [...new Set(rows.filter((r) => r.arm === a).map((r) => r.instance).filter((i) => i != null))].sort();
  out.byInstance[a] = Object.fromEntries(inst.map((i) => [i, summarize(rows.filter((r) => r.arm === a && r.instance === i))]));
}
if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); process.exit(0); }

process.stdout.write('arm  n   scored  success  cost$   obsKB   turns  load1  harnessErr\n');
for (const a of arms) {
  const s = out.overall[a];
  process.stdout.write(`${a}    ${String(s.n).padEnd(4)}${String(s.scored).padEnd(8)}${fmt(s.success).padEnd(9)}${fmt(s.costUsd, 3).padEnd(8)}${fmt(s.obsKB, 1).padEnd(8)}${fmt(s.turns, 1).padEnd(7)}${fmt(s.load1, 1).padEnd(7)}${s.harnessErrors}\n`);
}
process.stdout.write('\nby instance within template (1 = cold; C/D warm from 2):\n');
for (const a of arms) {
  process.stdout.write(`${a}  ` + Object.entries(out.byInstance[a]).map(([i, s]) => `#${i} succ=${fmt(s.success)} obs=${fmt(s.obsKB, 1)}KB $${fmt(s.costUsd, 3)}`).join(' | ') + '\n');
}
