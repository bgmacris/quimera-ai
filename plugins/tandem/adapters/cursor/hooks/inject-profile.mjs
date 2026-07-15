#!/usr/bin/env node
// Cursor adapter: tandem:map profile auto-injection (postToolUse on browser_navigate).
// Shared logic lives in upstream scripts/map-inject-core.mjs; this is the Cursor entry
// point (resolves the adapter data dir and formats Cursor's output envelope).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const tandemRoot = join(here, '..', '..', '..');
const { normalizeHost } = await import(pathToFileURL(join(tandemRoot, 'scripts/host.mjs')).href);
const {
  resolveDataDir, tryInjectProfile, cleanupSessionMarkers, extractNavigateUrl, extractSessionId,
} = await import(pathToFileURL(join(tandemRoot, 'scripts/map-inject-core.mjs')).href);

const dataDir = resolveDataDir(join(homedir(), '.local', 'share', 'tandem'));

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function silent() { process.exit(0); }

const raw = readStdin();
let input = null;
try { input = JSON.parse(raw); } catch { /* handled below */ }

const sessionId = extractSessionId(input);

if (process.argv[2] === 'cleanup') {
  cleanupSessionMarkers(sessionId, dataDir);
  silent();
}

if (!input) silent();

const url = extractNavigateUrl(input);
const result = tryInjectProfile({
  url, sessionId, dataDir, normalizeHost,
});
if (!result.ok) silent();

process.stdout.write(JSON.stringify({ additional_context: result.context }));
process.exit(0);
