#!/usr/bin/env node
// run.mjs — run one arm of the tandem benchmark over a plan (see README.md).
//
// Per task: reset the site (env-ctrl) → fresh tandem Chrome → HAR recorder (all tabs) → one
// isolated `claude -p` (only tandem's MCP + Write; --restricted; arm instructions/profile appended)
// → stop recorder → metrics.json. Output per task, as WebArena-Verified expects:
//   <out>/<arm>/<task_id>/{agent_response.json, network.har}  + transcript.jsonl, metrics.json
// Arms C/D carry a site profile across tasks: after each task the agent's ./profile-draft.md is
// promoted to the arm's profile — a SIMULATED human approval (logged), since -p has no human.
//
// Usage: run.mjs --plan plan.json --arm A|B|C|D --out <dir> [--model sonnet] [--port 9444]
//          [--reset-cmd ./reset-shopping-admin.sh | --no-reset] [--envctrl http://localhost:7781]
//          [--app-url http://localhost:7780/admin] [--header "X-M2-Admin-Auto-Login: admin:admin1234"]
//          [--budget 3] [--timeout 900] [--limit N] [--resume] [--no-reset] [--headful]

import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARMS } from './arms.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TANDEM = resolve(HERE, '../../plugins/tandem');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);
const plan = JSON.parse(readFileSync(opt('plan'), 'utf8'));
const armKey = opt('arm'); const arm = ARMS[armKey];
if (!arm || !opt('out')) { process.stderr.write('usage: run.mjs --plan plan.json --arm A|B|C|D --out <dir> […]\n'); process.exit(2); }
const OUT = resolve(opt('out'), armKey);
const model = opt('model', 'sonnet'); const port = opt('port', '9444');
const envctrl = opt('envctrl', 'http://localhost:7781'); const header = opt('header', '');
const appUrl = opt('app-url', 'http://localhost:7780/admin');
const budget = opt('budget', '3'); const timeoutS = +opt('timeout', '900');
const limit = +opt('limit', String(plan.length));

// Headless by default: the runner restarts Chrome on every task, and a window popping up every few
// minutes steals the focus of whoever is working on the machine. --headful to watch it.
const env = { ...process.env, TANDEM_DATA_DIR: join(OUT, 'tandem-data'), TANDEM_CDP_PORT: port,
  TANDEM_CHROME_ARGS: has('headful') ? (process.env.TANDEM_CHROME_ARGS || '') : '--headless=new' };
const daemon = (cmd) => execFileSync(join(TANDEM, 'scripts/chrome-daemon.sh'), [cmd], { env, encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --reset-cmd: shell command that restores a clean site (e.g. reset-shopping-admin.sh recreates the
// container — the published image's env-ctrl has no /reset). Then wait for env-ctrl AND the app.
async function resetSite() {
  if (has('no-reset')) return;
  if (!opt('reset-cmd')) throw new Error('--reset-cmd is required (or --no-reset)');
  execFileSync('sh', ['-c', opt('reset-cmd')], { stdio: 'inherit' });
  for (let i = 0; i < 150; i++) {
    // /status (success:true), not /health: the documented /health answers 404 "Not found" (verified 2026-10-20).
    try {
      const st = await fetch(`${envctrl}/status`, { signal: AbortSignal.timeout(5000) });
      const app = await fetch(appUrl, { headers: header ? { [header.split(/:\s*/)[0]]: header.split(/:\s*/).slice(1).join(':') } : {}, redirect: 'manual', signal: AbortSignal.timeout(60000) });
      if (st.ok && (await st.json()).success && app.status < 500) return;
    } catch { /* booting */ }
    await sleep(2000);
  }
  throw new Error('env-ctrl status timeout after reset');
}

function startRecorder(harPath) {
  const args = [join(TANDEM, 'scripts/cdp-record.mjs'), '--out', harPath, '--reveal'];
  if (header) args.push('--extra-header', header);
  const rec = spawn('node', args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('recorder did not start')), 15000);
    rec.stderr.on('data', (d) => { if (String(d).includes('recording')) { clearTimeout(t); res(rec); } });
    rec.on('exit', (c) => rej(new Error(`recorder exited ${c}`)));
  });
}

// Bytes/calls per tool from the stream-json transcript: what the observation strategy costs.
function analyze(transcriptPath) {
  const names = new Map(); const perTool = {}; let final = null;
  for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type === 'result') final = m;
    for (const c of m.message?.content || []) {
      if (c.type === 'tool_use') { names.set(c.id, c.name); (perTool[c.name] ||= { calls: 0, resultBytes: 0 }).calls++; }
      if (c.type === 'tool_result') {
        const n = names.get(c.tool_use_id) || '?';
        const text = typeof c.content === 'string' ? c.content : (c.content || []).map((x) => x.text || '').join('');
        (perTool[n] ||= { calls: 0, resultBytes: 0 }).resultBytes += Buffer.byteLength(text);
      }
    }
  }
  return {
    costUsd: final?.total_cost_usd ?? null, turns: final?.num_turns ?? null, durationMs: final?.duration_ms ?? null,
    isError: final?.is_error ?? true, usage: final?.usage ?? null, perTool,
    observationBytes: Object.entries(perTool).filter(([k]) => k.startsWith('mcp__tandem__')).reduce((s, [, v]) => s + v.resultBytes, 0),
  };
}

function runClaude(dir, systemPrompt, intent, startUrl) {
  writeFileSync(join(dir, 'system-prompt.txt'), systemPrompt);
  const mcp = { mcpServers: { tandem: { command: join(TANDEM, 'scripts/mcp-launch.sh'), env: { TANDEM_DATA_DIR: env.TANDEM_DATA_DIR, TANDEM_CDP_PORT: port } } } };
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify(mcp));
  const args = ['-p', '--model', model, '--restricted', '--strict-mcp-config', '--mcp-config', join(dir, 'mcp.json'),
    '--tools', 'Write', '--allowedTools', 'mcp__tandem', 'Write', '--permission-mode', 'acceptEdits',
    '--append-system-prompt', systemPrompt,
    '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--max-budget-usd', budget];
  if (arm.disallowed.length) args.push('--disallowedTools', ...arm.disallowed);
  // Prompt on stdin: --allowedTools/--disallowedTools are variadic and would swallow a trailing argument.
  const userPrompt = `Task: ${intent}\nStart by navigating to: ${startUrl}`;
  const out = createWriteStream(join(dir, 'transcript.jsonl'));
  const p = spawn('claude', args, { cwd: dir, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  p.stdin.end(userPrompt);
  p.stdout.pipe(out); p.stderr.pipe(createWriteStream(join(dir, 'claude.stderr')));
  return new Promise((res) => {
    const t = setTimeout(() => { p.kill('SIGTERM'); }, timeoutS * 1000);
    p.on('exit', (code) => { clearTimeout(t); out.end(() => res(code)); });
  });
}

mkdirSync(OUT, { recursive: true });
const profilePath = join(OUT, 'profile.md');
for (const task of plan.slice(0, limit)) {
  const dir = join(OUT, String(task.task_id));
  if (has('resume') && existsSync(join(dir, 'metrics.json'))) continue;
  mkdirSync(dir, { recursive: true });
  const started = Date.now(); const log = [];
  try {
    await resetSite();
    daemon('stop'); daemon('start');
    const rec = await startRecorder(join(dir, 'network.har'));
    const profile = arm.profile && existsSync(profilePath) ? readFileSync(profilePath, 'utf8') : null;
    const site = new URL(task.start_urls[0]).origin;
    const code = await runClaude(dir, arm.prompt(site, profile), task.intent, task.start_urls[0]);
    rec.kill('SIGTERM'); await new Promise((r) => rec.on('exit', r));
    log.push(`claude exit ${code}`);
    if (!existsSync(join(dir, 'agent_response.json'))) {
      writeFileSync(join(dir, 'agent_response.json'), JSON.stringify({ task_type: 'retrieve', status: 'UNKNOWN_ERROR', retrieved_data: null, error_details: 'harness: agent wrote no agent_response.json' }));
      log.push('no agent_response.json → UNKNOWN_ERROR written by harness');
    }
    const draft = join(dir, 'profile-draft.md');
    if (arm.profile && existsSync(draft) && statSync(draft).size <= 10000) {
      copyFileSync(draft, profilePath);
      log.push('profile-draft promoted (SIMULATED human approval)');
    }
    const m = { task_id: task.task_id, template: task.template, instance: task.instance, arm: armKey, model, profileIn: !!profile,
      wallMs: Date.now() - started, log, ...analyze(join(dir, 'transcript.jsonl')) };
    writeFileSync(join(dir, 'metrics.json'), JSON.stringify(m, null, 2) + '\n');
    process.stdout.write(`[${armKey}] task ${task.task_id} (tpl ${task.template} #${task.instance}) $${m.costUsd ?? '?'} obs=${m.observationBytes}B turns=${m.turns}\n`);
  } catch (e) {
    writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ task_id: task.task_id, arm: armKey, harnessError: e.message, log }, null, 2) + '\n');
    process.stdout.write(`[${armKey}] task ${task.task_id} HARNESS ERROR: ${e.message}\n`);
  }
}
daemon('stop');
