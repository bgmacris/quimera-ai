#!/usr/bin/env node
// mcp-launch.mjs — the MCP server command (.mcp.json). Node, not bash: tandem runs on Windows too
// (a teammate had to hand-patch .mcp.json to `bash.exe` in the plugin cache, lost on every update).
//
// CRITICAL: starts in milliseconds and does NOT touch Chrome, so Claude Code's `initialize` handshake
// is never blocked (if blocked, tools are silently dropped for the whole session). The MCP is LAZY:
// it connects to CDP on first tool use. Chrome is started by autostart.mjs or /tandem:browser-start.
//
// Pinned @playwright/mcp version (TANDEM_MCP_VERSION to test another). Flags:
//   --cdp-endpoint     tandem's port (paths.mjs: env TANDEM_CDP_PORT > saved cdp-port > 9222)
//   --output-dir       snapshots/screenshots under the data dir; file writes are only allowed there
//                      (or the MCP's workspace root) — verified on 0.0.76 and 0.0.83
//   --file-paths absolute, --no-webmcp (page-registered tools are untrusted input)
//   --output-max-size 50 MB (evicts oldest: snapshots carry what pages showed)
//   --timeout-action 10000 (ONE timeout for clicks and screenshots; 5 s failed 17 % of screenshots)
//   TANDEM_MCP_ARGS    extra flags, appended LAST so they override these (whitespace-split)
// TANDEM_MCP_DRYRUN=1 prints the command instead of running it (tests/CI).

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cdpPort, dataDir, ensureDataDir } from './paths.mjs';
import { isMain } from './is-main.mjs';

export const MCP_VERSION_PIN = '0.0.83';

export function mcpArgs(env = process.env) {
  const dir = env.TANDEM_DATA_DIR || dataDir();
  const extra = (env.TANDEM_MCP_ARGS || '').trim().split(/\s+/).filter(Boolean);
  return ['-y', `@playwright/mcp@${env.TANDEM_MCP_VERSION || MCP_VERSION_PIN}`,
    '--cdp-endpoint', `http://127.0.0.1:${cdpPort(dir)}`,
    '--output-dir', join(dir, 'output'),
    '--file-paths', 'absolute', '--no-webmcp',
    '--output-max-size', '52428800', '--timeout-action', '10000',
    ...extra];
}

// cmd.exe quoting for the Windows `npx.cmd` shim (data dirs live under "C:\Users\First Last\…").
const winQuote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);

const isCli = isMain(import.meta.url);
if (isCli) {
  const args = mcpArgs();
  const win = process.platform === 'win32';
  if (process.env.TANDEM_MCP_DRYRUN === '1') { process.stdout.write(JSON.stringify({ cmd: win ? 'npx.cmd' : 'npx', args }) + '\n'); process.exit(0); }
  try { mkdirSync(join(ensureDataDir(), 'output'), { recursive: true }); } catch { /* the MCP reports it */ }
  // Windows: npx is a .cmd shim; Node refuses to spawn .cmd/.bat without a shell (CVE-2024-27980),
  // so go through cmd.exe with explicit quoting. Elsewhere: plain spawn, no shell.
  const child = win
    ? spawn(['npx.cmd', ...args].map(winQuote).join(' '), { stdio: 'inherit', shell: true, windowsHide: true })
    : spawn('npx', args, { stdio: 'inherit' });
  child.on('error', (e) => {
    process.stderr.write(`tandem: ERROR — cannot run npx (${e.message}). Node/npx must be in PATH.\n`);
    process.exit(127);
  });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { try { child.kill(sig); } catch {} });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
}
