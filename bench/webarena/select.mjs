#!/usr/bin/env node
// select.mjs — pick the pilot: N intent templates × K instances, deterministic, single site.
// Input: tasks.json from `webarena-verified agent-input-get --sites <site> --config config.json`
// (URLs already rendered). Output: plan.json = tasks ordered template by template, instance 1..K —
// the order matters: arms C/D build their site profile on instance 1 and reuse it on 2..K.
// Usage: select.mjs <tasks.json> <plan.json> [--templates 10] [--instances 4] [--seed 7]

import { readFileSync, writeFileSync } from 'node:fs';

const [inp, out, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? +rest[i + 1] : d; };
const N = opt('templates', 10); const K = opt('instances', 4); let seed = opt('seed', 7);
if (!inp || !out) { process.stderr.write('usage: select.mjs <tasks.json> <plan.json> [--templates N] [--instances K] [--seed S]\n'); process.exit(2); }

const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);  // LCG: reproducible
const byTpl = new Map();
for (const t of JSON.parse(readFileSync(inp, 'utf8'))) {
  if (t.sites.length !== 1) continue;                                          // single-site only
  (byTpl.get(t.intent_template_id) || byTpl.set(t.intent_template_id, []).get(t.intent_template_id)).push(t);
}
const eligible = [...byTpl.entries()].filter(([, ts]) => ts.length >= K).sort((a, b) => a[0] - b[0]);
for (let i = eligible.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [eligible[i], eligible[j]] = [eligible[j], eligible[i]]; }
const plan = eligible.slice(0, N).flatMap(([tpl, ts]) => ts.sort((a, b) => a.task_id - b.task_id).slice(0, K)
  .map((t, i) => ({ ...t, template: tpl, instance: i + 1 })));
writeFileSync(out, JSON.stringify(plan, null, 2) + '\n');
process.stdout.write(`plan: ${plan.length} tasks (${Math.min(N, eligible.length)} templates × ${K}) of ${eligible.length} eligible templates → ${out}\n`);
