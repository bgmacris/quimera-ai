#!/usr/bin/env node
// hook-inject-profile.mjs — PostToolUse hook for tandem:map (Claude Code).
//
// When navigating (MCP tool browser_navigate), if a site profile exists for that host in
// <data-dir>/sites/<host>.md, it injects it into the model context via
// hookSpecificOutput.additionalContext (field supported by PostToolUse — verified
// against the official Hooks Reference, 2026-06-22). If no profile, SILENCE (zero noise).
//
// Discipline (pitfalls from research, see docs/01-navigation-memory.md):
//  - Injects only if a profile EXISTS for the host.
//  - ONCE per (session, host): marks in .hook-state/<session_id>/<host> to avoid
//    re-injecting the same profile on every click within the site (context bloat).
//
// The shared logic lives in scripts/map-inject-core.mjs (also consumed by the Cursor
// and OpenCode adapters). This file is the thin Claude Code entry point: it resolves the
// data dir (~/.claude/tandem by default), reads the hook JSON on stdin, and formats the
// Claude-specific output envelope.
//
// Usage: receives the hook JSON on stdin. No args = injection mode.
//        with arg "cleanup" = deletes the session marker (called by SessionEnd).

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { normalizeHost } from './host.mjs';
import {
  resolveDataDir, tryInjectProfile, cleanupSessionMarkers,
  extractNavigateUrl, extractSessionId,
} from './map-inject-core.mjs';

const dataDir = resolveDataDir(join(homedir(), '.claude', 'tandem'));

// Read stdin synchronously (simple for a hook).
function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

// Silent exit: exit 0 with no stdout = hook does nothing.
function silent() { process.exit(0); }

const raw = readStdin();
let input = null;
try { input = JSON.parse(raw); } catch { /* handled below per mode */ }

const sessionId = extractSessionId(input);

// --- cleanup mode (SessionEnd) — runs even if stdin was invalid JSON ---------------
if (process.argv[2] === 'cleanup') {
  cleanupSessionMarkers(sessionId, dataDir);
  process.exit(0);
}

// --- injection mode: need valid JSON input ----------------------------------------
if (!input) silent();

const url = extractNavigateUrl(input);
const result = tryInjectProfile({
  url, sessionId, dataDir, normalizeHost,
});
if (!result.ok) silent();

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext: result.context,
  },
}));
process.exit(0);
