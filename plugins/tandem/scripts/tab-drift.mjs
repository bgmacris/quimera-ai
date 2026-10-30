// tab-drift.mjs — tell the agent when its tab moved without it asking.
//
// The browser is shared and nobody owns a tab: a human click in the window moves the page the agent is
// extracting from, and nothing says so. Seen in the real-hard benchmark (2026-10-30, Reddit): two clicks
// by the human took the agent's tab to another page mid-measure; the agent noticed only because one of
// them opened a new tab. @playwright/mcp does print the new `### Page` URL in the next result (read tools
// print the section only when the tab header changed), but in the middle of the output, unmarked — easy to
// read past, and a multi-step extraction then mixes two pages.
//
// The PostToolUse hook calls `tabDrift` on every browser_* result. The tools by which the agent moves the
// page update the remembered URL; any other tool whose `### Page` URL differs from it (hash ignored)
// gets a warning in additionalContext. Late effects of the agent's own actions are not drift (a redirect
// that lands after a click returned), so a read within GRACE_MS of the last move updates silently.
// Trade-off: a human click inside that window goes unreported. Time, not "the first read after a move":
// a read prints `### Page` only once the header changes, so that first read can come minutes later and
// carry exactly the human's click.
//
// The remembered URL is the one sandbox-guard.mjs keeps (`.page-url`): both want where the tab is.
// TANDEM_TAB_DRIFT=0 turns the warning off (the URL is still remembered).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractNavigateUrl, extractPageUrl, sessionKey } from './map-inject-core.mjs';
import { lastPageUrl, rememberPageUrl } from './sandbox-guard.mjs';

export const GRACE_MS = 15_000;

const MOVERS = /browser_(navigate\w*|reload|click|drag|drop|press_key|press_sequentially|type|select_option|fill_form|handle_dialog|file_upload|mouse_\w+|run_code\w*|tabs|close)$/;
// browser_evaluate is a read unless its code can navigate.
const NAVIGATING_JS = /\b(location|history)\b|\.click\s*\(|\.submit\s*\(|requestSubmit|dispatchEvent|window\.open\s*\(/;

// A call that carries a URL asked to go there (navigate, tabs new), whatever its name. No name at all
// (another host's hook shape): it can't be told apart from a move, so it never warns.
export function movesPage(tool, toolInput = {}) {
  if (!tool || MOVERS.test(tool) || typeof toolInput.url === 'string') return true;
  return /browser_evaluate$/.test(tool) && NAVIGATING_JS.test(String(toolInput.function || ''));
}

const sameUrl = (a, b) => a.replace(/#.*$/, '') === b.replace(/#.*$/, '');

const movedFile = (dataDir, sessionId) => join(dataDir, '.hook-state', sessionKey(sessionId), '.moved');

function markMoved(dataDir, sessionId, now) {
  try {
    mkdirSync(join(dataDir, '.hook-state', sessionKey(sessionId)), { recursive: true });
    writeFileSync(movedFile(dataDir, sessionId), String(now));
  } catch { /* never break the session */ }
}

function lastMove(dataDir, sessionId) {
  try { return Number(readFileSync(movedFile(dataDir, sessionId), 'utf8')) || 0; } catch { return 0; }
}

/**
 * Record where the tab is after this tool call; return the warning for the model when it moved on its
 * own, else null. `now` and `env` are injectable for tests.
 */
export function tabDrift({ input, dataDir, now = Date.now(), env = process.env }) {
  const sessionId = input?.session_id;
  const tool = String(input?.tool_name || '');
  const url = extractPageUrl(input) || extractNavigateUrl(input);
  if (movesPage(tool, input?.tool_input || {})) {
    markMoved(dataDir, sessionId, now);
    if (url) rememberPageUrl(dataDir, sessionId, url);
    return null;
  }
  if (!url) return null;
  const before = lastPageUrl(dataDir, sessionId);
  rememberPageUrl(dataDir, sessionId, url);
  if (!before || sameUrl(before, url)) return null;
  if (now - lastMove(dataDir, sessionId) < GRACE_MS) return null;
  if (env.TANDEM_TAB_DRIFT === '0') return null;
  const name = tool.replace(/^.*__/, '');
  return `tandem: your tab moved without you asking. It is now on ${url}; at your previous browser call it was on ${before}, and nothing you ran since navigates (${name} only reads). In a shared browser that is usually the human clicking in the window; it can also be a page redirect or script. What you read before belongs to the old page: check where you are before continuing a multi-step extraction, and browser_navigate back if you need the old page.`;
}
