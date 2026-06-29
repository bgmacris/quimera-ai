#!/usr/bin/env node
// hook-inject-profile.mjs — PostToolUse hook for tandem:map.
//
// When navigating (MCP tool browser_navigate), if a site profile exists for that host in
// ~/.claude/tandem/sites/<host>.md, it injects it into the model context via
// hookSpecificOutput.additionalContext (field supported by PostToolUse — verified
// against the official Hooks Reference, 2026-06-22). If no profile, SILENCE (zero noise).
//
// Discipline (pitfalls from research, see docs/01-navigation-memory.md):
//  - Injects only if a profile EXISTS for the host.
//  - ONCE per (session, host): marks in .hook-state/<session_id>/<host> to avoid
//    re-injecting the same profile on every click within the site (context bloat).
//
// Intentionally in Node: node is already a dependency of the plugin (the MCP is @playwright/mcp);
// it parses/emits native JSON and normalizes the host with new URL(). Zero new dependency (jq).
//
// Usage: receives the hook JSON on stdin. No args = injection mode.
//        with arg "cleanup" = deletes the session marker (called by SessionEnd).

import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmSync,
} from 'node:fs';
import { normalizeHost } from './host.mjs';

const dataDir = process.env.TANDEM_DATA_DIR || join(homedir(), '.claude', 'tandem');
const sitesDir = join(dataDir, 'sites');
const stateDir = join(dataDir, '.hook-state');

// Read stdin synchronously (simple for a hook).
function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

// Silent exit: exit 0 with no stdout = hook does nothing.
function silent() { process.exit(0); }

const raw = readStdin();
let input;
try { input = JSON.parse(raw); } catch { silent(); }

const sessionId = ((input && input.session_id) || 'no-session').replace(/[^a-z0-9_-]/gi, '_').slice(0, 64);

// --- cleanup mode (SessionEnd) ----------------------------------------------------
if (process.argv[2] === 'cleanup') {
  try { rmSync(join(stateDir, sessionId), { recursive: true, force: true }); } catch {}
  process.exit(0);
}

// --- injection mode (PostToolUse browser_navigate) --------------------------------
const url = input?.tool_input?.url;
if (!url || typeof url !== 'string') silent();

let host;
try { host = normalizeHost(url); } catch { silent(); }

const profilePath = join(sitesDir, `${host}.md`);
if (!existsSync(profilePath)) silent();           // no profile → silence

// Once per (session, host).
const marker = join(stateDir, sessionId, host);
if (existsSync(marker)) silent();                 // already injected this session → silence
try {
  mkdirSync(join(stateDir, sessionId), { recursive: true });
  writeFileSync(marker, '');
} catch {}

let profile;
try { profile = readFileSync(profilePath, 'utf8'); } catch { silent(); }

const context = [
  `tandem:map — navigation profile for ${host} (auto-loaded on navigate).`,
  `Use it to navigate this site KNOWING instead of re-deriving the DOM. Anchor by role+name,`,
  `never by eNN refs (ephemeral). Cheap re-check before trusting a locator; if it fails,`,
  `re-derive live and update the profile (don't patch it blindly).`,
  ``,
  profile,
].join('\n');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext: context,
  },
}));
process.exit(0);
