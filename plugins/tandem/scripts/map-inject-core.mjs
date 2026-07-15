// map-inject-core.mjs — shared tandem:map profile-injection logic.
//
// Single source of truth for the "on browser_navigate, inject the site profile
// once per (session, host)" behaviour. Consumed by:
//   - scripts/hook-inject-profile.mjs        (Claude Code PostToolUse hook)
//   - adapters/cursor/hooks/inject-profile.mjs   (Cursor postToolUse hook)
//   - adapters/opencode/plugins/tandem-map-inject.ts (OpenCode tool.execute.after)
//
// Pure logic only: every entry point resolves its own data dir (defaults differ
// by host IDE) and formats its own output envelope. This module never hardcodes
// a default dir and never writes to stdout.

import { join } from 'node:path';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmSync,
} from 'node:fs';

// TANDEM_DATA_DIR always wins; otherwise the caller's context-specific default
// (Claude Code: ~/.claude/tandem; multi-IDE adapters: ~/.local/share/tandem).
export function resolveDataDir(fallback) {
  return process.env.TANDEM_DATA_DIR || fallback;
}

export function sessionKey(sessionId) {
  return (sessionId || 'no-session').replace(/[^a-z0-9_-]/gi, '_').slice(0, 64);
}

export function profileContext(host, profile) {
  return [
    `tandem:map — navigation profile for ${host} (auto-loaded on navigate).`,
    'Use it to navigate this site KNOWING instead of re-deriving the DOM. Anchor by role+name,',
    'never by eNN refs (ephemeral). Cheap re-check before trusting a locator; if it fails,',
    're-derive live and update the profile (don\'t patch it blindly).',
    '',
    profile,
  ].join('\n');
}

/**
 * Inject the site profile once per (session, host).
 * @returns {{ ok: true, host: string, context: string } | { ok: false }}
 */
export function tryInjectProfile({ url, sessionId, dataDir, normalizeHost }) {
  if (!url || typeof url !== 'string') return { ok: false };

  let host;
  try { host = normalizeHost(url); } catch { return { ok: false }; }

  const profilePath = join(dataDir, 'sites', `${host}.md`);
  if (!existsSync(profilePath)) return { ok: false };

  const sid = sessionKey(sessionId);
  const marker = join(dataDir, '.hook-state', sid, host);
  if (existsSync(marker)) return { ok: false };

  try {
    mkdirSync(join(dataDir, '.hook-state', sid), { recursive: true });
    writeFileSync(marker, '');
  } catch {
    return { ok: false };
  }

  let profile;
  try { profile = readFileSync(profilePath, 'utf8'); } catch { return { ok: false }; }

  return { ok: true, host, context: profileContext(host, profile) };
}

export function cleanupSessionMarkers(sessionId, dataDir) {
  const sid = sessionKey(sessionId);
  try {
    rmSync(join(dataDir, '.hook-state', sid), { recursive: true, force: true });
  } catch { /* ignore */ }
}

/** Extract the navigate URL from a hook's stdin JSON (Claude / Cursor shapes). */
export function extractNavigateUrl(input) {
  if (!input || typeof input !== 'object') return null;
  const toolInput = input.tool_input || input.toolInput || {};
  const url = toolInput.url;
  return typeof url === 'string' ? url : null;
}

/** Extract the session id from a hook's stdin JSON (Claude / Cursor / OpenCode shapes). */
export function extractSessionId(input) {
  if (!input || typeof input !== 'object') return 'no-session';
  return input.session_id || input.conversation_id || input.sessionID || 'no-session';
}
