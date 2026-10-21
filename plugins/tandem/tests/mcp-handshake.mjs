#!/usr/bin/env node
// mcp-handshake.mjs — launches the REAL MCP server through tandem's launcher (scripts/mcp-launch.mjs)
// and does the MCP handshake (initialize + tools/list) over stdio. No Chrome needed: the MCP connects
// to CDP lazily. This is what Claude Code does at session start, so it proves the launcher works on
// the platform it runs on — the point of the Windows CI job. Usage: node tests/mcp-handshake.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('../scripts/mcp-launch.mjs', import.meta.url));
const env = { ...process.env, TANDEM_DATA_DIR: mkdtempSync(join(tmpdir(), 'tandem hs ')), TANDEM_CDP_PORT: '9399' }; // a space on purpose
const mcp = spawn(process.execPath, [launcher], { env, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = ''; const waiters = new Map(); let id = 0;
mcp.stdout.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); waiters.get(m.id)?.(m); } catch {} }
});
const rpc = (method, params) => new Promise((res, rej) => {
  const n = ++id; waiters.set(n, res); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  setTimeout(() => rej(new Error(`${method} timeout`)), 180000);
});
let ok = false;
try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'tandem-ci', version: '0' } });
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const { result } = await rpc('tools/list', {});
  const names = (result?.tools || []).map((t) => t.name);
  ok = !!init.result && names.includes('browser_navigate') && names.includes('browser_find');
  process.stdout.write(`handshake: server=${init.result?.serverInfo?.name}@${init.result?.serverInfo?.version} tools=${names.length} ${ok ? 'OK' : 'MISSING TOOLS'}\n`);
  // Cursor's lease hook lists every browser tool by name (one matcher each): a tool added by an MCP
  // upgrade would not renew the lease. Fail when the two lists drift.
  const cursor = JSON.parse(readFileSync(fileURLToPath(new URL('../adapters/cursor/hooks/hooks.json', import.meta.url)), 'utf8'));
  const touched = new Set(cursor.hooks.postToolUse.filter((e) => /run-session-hook\.sh touch/.test(e.command)).map((e) => e.matcher.replace(/^MCP:/, '')));
  const missing = names.filter((n) => !touched.has(n)); const stale = [...touched].filter((n) => !names.includes(n));
  if (missing.length || stale.length) {
    ok = false;
    process.stdout.write(`cursor lease matchers drift — missing: ${missing.join(', ') || '-'} · stale: ${stale.join(', ') || '-'} (adapters/cursor/hooks/hooks.json)\n`);
  } else process.stdout.write(`cursor lease matchers: ${touched.size}/${names.length} tools covered\n`);
} catch (e) { process.stdout.write(`handshake FAILED: ${e.message}\n`); }
mcp.kill();
process.exit(ok ? 0 : 1);
