// paths.mjs — single source for tandem's data dir and CDP port (node side).
//
// Mirrors lib.sh (bash side) so commands, hooks, the MCP launcher and every IDE adapter agree:
//   data dir: TANDEM_DATA_DIR, else ~/.claude/tandem (one store for Claude Code AND the
//             Cursor/OpenCode adapters — two stores on the same port meant a silent wrong profile).
//   CDP port: TANDEM_CDP_PORT, else the cdp-port file written by the last start, else 9222.
//             The env wins: an explicit override must not be shadowed by a stale file.
//
// The data dir holds a Chrome profile with live sessions, intercept logs and screenshots →
// it is created 0700 and re-tightened on use (umask-proof).

import { homedir } from 'node:os';
import { join } from 'node:path';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';

export function dataDir() {
  return process.env.TANDEM_DATA_DIR || join(homedir(), '.claude', 'tandem');
}

export function cdpPort(dir = dataDir()) {
  if (process.env.TANDEM_CDP_PORT) return +process.env.TANDEM_CDP_PORT;
  try { return +readFileSync(join(dir, 'cdp-port'), 'utf8').trim() || 9222; } catch { return 9222; }
}

// mkdir -p with 0700 on the data dir itself (enough to close everything below it to other users).
export function ensureDataDir(dir = dataDir()) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* not ours to fix: leave it */ }
  return dir;
}
