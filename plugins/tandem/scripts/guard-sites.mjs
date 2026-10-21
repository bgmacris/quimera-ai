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

export function bashTouchesProfiles(command, sitesDir) {
  if (typeof command !== 'string') return false;
  // Redirections to /dev/null or stderr→stdout are not writes to the store.
  command = command.replace(/\d?>{1,2}\s*\/dev\/null|\d?>&\d/g, '');
  const home = homedir();
  const fwd = sitesDir.replace(/\\/g, '/');   // Git Bash on Windows writes C:/… or /c/…
  const forms = [sitesDir, fwd, sitesDir.replace(home, '~'), sitesDir.replace(home, '$HOME'), 'tandem/sites', 'tandem\\sites'];
  if (!forms.some((f) => command.includes(f))) return false;
  if (READ_ONLY.test(command) && !/[>|]/.test(command)) return false;
  return WRITES.test(command);
}

export function decide(input, sitesDir = join(dataDir(), 'sites')) {
  const tool = input?.tool_name || '';
  const ti = input?.tool_input || {};
  let hit = false;
  if (/^(Write|Edit|MultiEdit)$/.test(tool)) hit = isProfilePath(ti.file_path, sitesDir);
  else if (tool === 'Bash') hit = bashTouchesProfiles(ti.command, sitesDir);
  if (!hit) return null;
  // An interactive session in bypassPermissions approves a hook's `ask` by itself, with no prompt
  // (verified 2026-10-21: decision source "config"/"mode", 40 ms after the hook). There the human can't
  // be asked, so DENY: the gate exists to put a human between web content and future sessions.
  if (input?.permission_mode === 'bypassPermissions') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'tandem:map — writing a site profile needs the human\'s approval, and bypass-permissions mode approves '
          + 'it without asking. Show the human the exact content and ask them to leave bypass mode (shift+tab) '
          + 'to approve it, or to save it themselves.',
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
