#!/usr/bin/env node
// map-inject-core.mjs — shared tandem:map profile injection logic (Cursor + OpenCode adapters).
// Upstream Claude Code keeps scripts/hook-inject-profile.mjs until a future PR merges this.

import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmSync,
} from 'node:fs';

export function tandemDataDir() {
  return process.env.TANDEM_DATA_DIR || join(homedir(), '.local', 'share', 'tandem');
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

/** @returns {{ ok: true, host: string, context: string } | { ok: false }} */
export function tryInjectProfile({ url, sessionId, normalizeHost }) {
  if (!url || typeof url !== 'string') return { ok: false };

  let host;
  try { host = normalizeHost(url); } catch { return { ok: false }; }

  const dataDir = tandemDataDir();
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

export function cleanupSessionMarkers(sessionId) {
  const sid = sessionKey(sessionId);
  try {
    rmSync(join(tandemDataDir(), '.hook-state', sid), { recursive: true, force: true });
  } catch { /* ignore */ }
}

/** Cursor / Claude hook stdin shapes */
export function extractNavigateUrl(input) {
  if (!input || typeof input !== 'object') return null;
  const toolInput = input.tool_input || input.toolInput || {};
  const url = toolInput.url;
  return typeof url === 'string' ? url : null;
}

export function extractSessionId(input) {
  if (!input || typeof input !== 'object') return 'no-session';
  return input.session_id || input.conversation_id || input.sessionID || 'no-session';
}
