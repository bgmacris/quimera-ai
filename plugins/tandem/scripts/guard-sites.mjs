#!/usr/bin/env node
// guard-sites.mjs — PreToolUse gate: writing a site profile needs the HUMAN's confirmation.
//
// Profiles (sites/<host>.md) are injected into every later session. Memory-poisoning work
// (PMPA, arXiv 2609.13889, tested on Claude Code) shows that once a persistent memory is
// poisoned, prompt-level defenses barely help (cross-session attack success stayed ~97%).
// The skill's "show the draft to the human first" rule IS a prompt-level defense, so the
// write itself is gated here, outside the model: the hook answers "ask" and Claude Code shows
// a permission prompt — verified 2026-10-20 that bypassPermissions does not auto-approve it.
//
// Covers Write/Edit/MultiEdit by path. Bash is covered heuristically (a command that mentions
// the sites dir and looks like it writes): defense in depth, not a sandbox.
// Silent (no output) = no opinion → normal permission flow.

import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { dataDir } from './paths.mjs';
import { isMain } from './is-main.mjs';

// Resolve symlinks of the deepest existing ancestor (the file itself may not exist yet).
function real(p) {
  let cur = resolve(p); const tail = [];
  for (;;) {
    try { return join(realpathSync(cur), ...tail.reverse()); } catch { /* not there yet */ }
    const up = dirname(cur);
    if (up === cur) return resolve(p);
    tail.push(basename(cur)); cur = up;
  }
}

export function isProfilePath(filePath, sitesDir) {
  if (typeof filePath !== 'string' || !filePath) return false;
  // macOS (APFS) and Windows are case-insensitive: ~/.claude/Tandem/sites IS the store there.
  const fold = (p) => (process.platform === 'darwin' || process.platform === 'win32' ? p.toLowerCase() : p);
  const f = fold(real(filePath.replace(/^~(?=[\\/])/, homedir())));
  const s = fold(real(sitesDir));
  // path.relative, not startsWith(s + '/'): Windows paths use '\\' (the gate never fired there).
  const rel = relative(s, f);
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel) && f.toLowerCase().endsWith('.md');
}

// Read-only engine invocations that mention the store are fine (list/show/path, recipe compile…).
const READ_ONLY = /^\s*(\S*\/)?(map\.sh\s+(list|show|path|index)|recipe\.mjs\s+(validate|compile)|cat|less|head|tail|grep|rg|wc|ls)\b/;
const WRITES = /(>|>>|\btee\b|\bcp\b|\bmv\b|\bsed\s+-i|\bperl\s+-i|\bdd\b|\bpython3?\b|\bnode\b|\bruby\b|\binstall\b|\brm\b|\bln\b|\bcurl\b|\bwget\b|\brsync\b|\btar\b|\bunzip\b|\bpatch\b)/;

function mentionsStore(text, sitesDir) {
  const home = homedir();
  const fwd = sitesDir.replace(/\\/g, '/');   // Git Bash on Windows writes C:/… or /c/…
  const forms = [sitesDir, fwd, sitesDir.replace(home, '~'), sitesDir.replace(home, '$HOME'), 'tandem/sites', 'tandem\\sites'];
  return forms.some((f) => text.includes(f));
}

export function bashTouchesProfiles(command, sitesDir) {
  if (typeof command !== 'string') return false;
  // Redirections to /dev/null or stderr→stdout are not writes to the store.
  command = command.replace(/\d?>{1,2}\s*\/dev\/null|\d?>&\d/g, '');
  if (!mentionsStore(command, sitesDir)) return false;
  if (READ_ONLY.test(command) && !/[>|]/.test(command)) return false;
  return WRITES.test(command);
}

// The MCP's own tools write files too: `filename` on evaluate/snapshot/screenshot/… lands wherever the
// MCP's roots allow — with Claude Code started from $HOME that includes the store (verified with the
// real MCP 0.0.83: evaluate+filename wrote sites/<host>.md). A RELATIVE filename resolves against the
// MCP's working directory, NOT output/ (verified: cwd/sub/rel-test.md; an external audit wrote
// ~/.claude/tandem/sites/rel.md with `.claude/tandem/sites/rel.md` from $HOME). The MCP's cwd isn't
// known here for sure, so every plausible base is checked: the session cwd, this process's, output/.
// run_code_unsafe runs Node-side Playwright code: heuristic, like Bash.
export function mcpTouchesProfiles(toolInput, sitesDir, { cwd, outputDir = join(dirname(sitesDir), 'output') } = {}) {
  const ti = toolInput || {};
  if (typeof ti.filename === 'string' && ti.filename) {
    const f = ti.filename.replace(/^~(?=[\\/])/, homedir());
    const bases = [...new Set([cwd, process.cwd(), outputDir].filter(Boolean))];
    if (bases.some((b) => isProfilePath(resolve(b, f), sitesDir))) return true;
  }
  return typeof ti.code === 'string' && mentionsStore(ti.code, sitesDir);
}

export function decide(input, sitesDir = join(dataDir(), 'sites')) {
  const tool = input?.tool_name || '';
  const ti = input?.tool_input || {};
  let hit = false;
  if (/^(Write|Edit|MultiEdit)$/.test(tool)) hit = isProfilePath(ti.file_path, sitesDir);
  else if (tool === 'Bash') hit = bashTouchesProfiles(ti.command, sitesDir);
  else if (/__browser_/.test(tool)) hit = mcpTouchesProfiles(ti, sitesDir, { cwd: input?.cwd });
  if (!hit) return null;
  // An interactive session in bypassPermissions approves a hook's `ask` by itself, with no prompt
  // (verified 2026-10-21: decision source "config"/"mode", 40 ms after the hook). Bypass is the human's
  // choice to skip approvals, and tandem:map must keep working there: the write goes through, with a
  // visible notice to review it (injection still wraps profiles as data and flags instruction-like
  // lines). TANDEM_PROFILE_GATE=strict denies instead.
  const file = ti.file_path || 'a site profile (via Bash)';
  if (input?.permission_mode === 'bypassPermissions' && process.env.TANDEM_PROFILE_GATE !== 'strict') {
    return {
      systemMessage: `tandem: ${file} was written WITHOUT approval (bypass mode). Review it — site profiles are injected into future sessions.`,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'tandem:map — bypass mode: profile write allowed, the human is notified to review it.',
      },
    };
  }
  if (input?.permission_mode === 'bypassPermissions') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'tandem:map — TANDEM_PROFILE_GATE=strict: writing a site profile needs the human\'s approval, and '
          + 'bypass-permissions mode would approve it without asking. Show the human the exact content and ask '
          + 'them to leave bypass mode (shift+tab) to approve it, or to save it themselves.',
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason:
        'tandem:map — this writes a site profile that will be injected into future sessions. '
        + 'Approve only if you reviewed this exact content (it was drafted from web pages, which can carry injected instructions).',
    },
  };
}

const isCli = isMain(import.meta.url);
if (isCli) {
  let input = null;
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
  const out = decide(input);
  if (out) process.stdout.write(JSON.stringify(out));
  process.exit(0);
}
