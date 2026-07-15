#!/usr/bin/env node
// Cursor adapter: tandem:map profile auto-injection (postToolUse on browser_navigate).
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const tandemRoot = join(here, '..', '..', '..');
const { normalizeHost } = await import(pathToFileURL(join(tandemRoot, 'scripts/host.mjs')).href);
const {
  tryInjectProfile, cleanupSessionMarkers, extractNavigateUrl, extractSessionId,
} = await import(pathToFileURL(join(tandemRoot, 'adapters/shared/map-inject-core.mjs')).href);

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function silent() { process.exit(0); }

const raw = readStdin();
let input = null;
try { input = JSON.parse(raw); } catch { /* handled below */ }

const sessionId = extractSessionId(input);

if (process.argv[2] === 'cleanup') {
  cleanupSessionMarkers(sessionId);
  silent();
}

if (!input) silent();

const url = extractNavigateUrl(input);
const result = tryInjectProfile({ url, sessionId, normalizeHost });
if (!result.ok) silent();

process.stdout.write(JSON.stringify({ additional_context: result.context }));
process.exit(0);
