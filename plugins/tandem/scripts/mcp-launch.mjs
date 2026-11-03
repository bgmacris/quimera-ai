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
//
// MULTI-SESSION (default; TANDEM_MULTISESSION=0 turns it off — the 0.9.x launcher below): one MCP child PER
// AGENT (main + each subagent), each connected to Chrome through tandem's CDP relay (cdp-relay.mjs), so it
// sees only its own tabs; the router (agent-router.mjs) sends each call to its agent's child by the `agent`
// that autostart.mjs writes into it. "main" starts with the launcher via npx (it installs the pin on its
// first run, and the handshake must not wait); the others on their first call, via `node <cli.js>` of the
// same pin when it resolves (npx keeps a ~100 MB npm process alive per child — R05 §M2), npx otherwise.
// If the relay can't start, it falls back to single mode, straight to Chrome.
//
// Per agent, the proxy keeps the agent's tab painting while its tools run (focus-emulation.mjs) — without
// it a click on a background/covered/minimized tab hangs — and saves the PDFs it receives
// (pdf-capture.mjs). TANDEM_FOCUS_EMULATION=0 / TANDEM_PDF_CAPTURE=0 turn each off; in single mode, both
// off → plain stdio inherit, as before 0.9.5.

import { execFile, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { listPages } from './cdp.mjs';
import { cdpPort, dataDir, ensureDataDir } from './paths.mjs';
import { routeStdio } from './agent-router.mjs';
import { startRelay } from './cdp-relay.mjs';
import { DEFAULT_LINGER_MS, combine, focusEmulator, proxyStdio } from './focus-emulation.mjs';
import { chooseHumanTab, humanTabs } from './human-tabs.mjs';
import { tabOwners } from './tab-owners.mjs';
import { pdfCapturer } from './pdf-capture.mjs';
import { isMain } from './is-main.mjs';

export const MCP_VERSION_PIN = '0.0.83';

export const mcpVersion = (env = process.env) => env.TANDEM_MCP_VERSION || MCP_VERSION_PIN;

// npx form: ['-y', '@playwright/mcp@<pin>', ...flags]. cdpEndpoint: the relay's, per agent (multi-session).
export function mcpArgs(env = process.env, { cdpEndpoint } = {}) {
  const dir = env.TANDEM_DATA_DIR || dataDir();
  const extra = (env.TANDEM_MCP_ARGS || '').trim().split(/\s+/).filter(Boolean);
  return ['-y', `@playwright/mcp@${mcpVersion(env)}`,
    '--cdp-endpoint', cdpEndpoint || `http://127.0.0.1:${cdpPort(dir)}`,
    '--output-dir', join(dir, 'output'),
    '--file-paths', 'absolute', '--no-webmcp',
    '--output-max-size', '52428800', '--timeout-action', '10000',
    ...extra];
}

export const multiSession = (env = process.env) => env.TANDEM_MULTISESSION !== '0';

// The pinned MCP's cli.js, as npx installed it, to start more children with plain `node` (R05 §15.2:
// 0.25–0.42 s with the cache warm). → path, or null (Windows: .bin is a .cmd shim; any doubt → null, npx).
export function resolveMcpCli(version, { timeoutMs = 60_000 } = {}) {
  if (process.platform === 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('npx', ['-y', '-p', `@playwright/mcp@${version}`, '-c', 'command -v playwright-mcp'], { timeout: timeoutMs }, (err, out) => {
      if (err) return resolve(null);
      try {
        const cli = realpathSync(String(out).trim().split('\n').pop());
        const pkg = JSON.parse(readFileSync(join(dirname(cli), 'package.json'), 'utf8'));
        resolve(basename(cli) === 'cli.js' && pkg.name === '@playwright/mcp' && pkg.version === version ? cli : null);
      } catch { resolve(null); }
    });
  });
}

// Phase 4 (R05 §16): the human hands a tab over. Only the one they brought into view (human-tabs.mjs);
// closing it later gives it back (cdp-relay.mjs). A local tool of the router: never reaches an MCP child.
export const ADOPT_TOOL = 'browser_tab_adopt';
const tabIndex = (result, url) => {
  const text = (result?.content || []).map((c) => c.text || '').join('\n');
  for (const m of text.matchAll(/^- (\d+): .*?\((\S+?)\)\s*$/gm)) if (m[2] === url) return +m[1];
  return null;
};
const textResult = (text, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });
export function adoptTool({ relay, port, dataDir: dir }) {
  return {
    def: {
      name: ADOPT_TOOL,
      title: 'Take over the human\'s tab',
      description: 'Take over a tab of the HUMAN in the shared Chrome (with their logins), when the human wants to give it to you: '
        + 'only the tab they brought into view can be taken, so ask them to bring it to the front first. If several are in view, '
        + 'pass `url` (part of its URL). It becomes your current tab. Closing it later gives it back to the human: it is not closed.',
      inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'Part of the URL of the human\'s tab, when several are in view' } }, additionalProperties: false },
    },
    async handle({ agent, args, ask }) {
      // The agent's MCP connects to Chrome (through the relay) on its first browser call.
      if (!relay.agents().includes(agent)) await ask('browser_tabs', { action: 'list' });
      const pick = chooseHumanTab(await humanTabs({ port, registry: tabOwners(dir) }), { url: typeof args.url === 'string' ? args.url : undefined });
      if (!pick.tab) {
        const list = pick.list.length ? `\n\nThe human's tabs in view:\n${pick.list.map((t) => `- ${t.title || '(untitled)'} (${t.url})`).join('\n')}` : '';
        return textResult(`### Result\ntandem: ${pick.error}${list}`, true);
      }
      await relay.adopt(agent, pick.tab.id);
      let idx = null;
      for (const t0 = Date.now(); idx === null && Date.now() - t0 < 3000;) {
        idx = tabIndex(await ask('browser_tabs', { action: 'list' }), pick.tab.url);
        if (idx === null) await new Promise((r) => setTimeout(r, 150));
      }
      const sel = idx !== null ? await ask('browser_tabs', { action: 'select', index: idx }) : null;
      const head = `### Result\nYou now have the human's tab "${pick.tab.title || '(untitled)'}" (${pick.tab.url})`
        + (sel ? ' as your current tab.' : ', but it could not be selected: find it with browser_tabs list.')
        + ' The human still sees it and may use it too. Closing it gives it back to the human (it is not closed).';
      return { content: [{ type: 'text', text: head }, ...(sel?.content || [])] };
    },
  };
}

// cmd.exe quoting for the Windows `npx.cmd` shim (data dirs live under "C:\Users\First Last\…").
const winQuote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);

const isCli = isMain(import.meta.url);
if (isCli) {
  const args = mcpArgs();
  const win = process.platform === 'win32';
  if (process.env.TANDEM_MCP_DRYRUN === '1') { process.stdout.write(JSON.stringify({ cmd: win ? 'npx.cmd' : 'npx', args, multiSession: multiSession() }) + '\n'); process.exit(0); }
  try { mkdirSync(join(ensureDataDir(), 'output'), { recursive: true }); } catch { /* the MCP reports it */ }
  const focus = process.env.TANDEM_FOCUS_EMULATION !== '0';
  const capture = process.env.TANDEM_PDF_CAPTURE !== '0';
  // TANDEM_DEBUG=1: what the holds and the router do, on stderr (Claude Code keeps an MCP's stderr in its logs).
  const log = process.env.TANDEM_DEBUG === '1' ? (m) => process.stderr.write(`tandem: ${m}\n`) : () => {};
  const linger = Number(process.env.TANDEM_FOCUS_LINGER_MS);
  const lingerMs = Number.isFinite(linger) && linger >= 0 ? linger : DEFAULT_LINGER_MS;
  // Multi-session: the relay says which pages are the agent's (pagesFor), and hands each new one over before
  // the agent's MCP learns of it (onPage → adopt), so PDF capture is armed for its first navigation.
  let relay = null;
  const emulators = new Map();   // agent → its emulator
  const emulatorFor = (agent) => {
    const tag = agent === 'main' ? log : (m) => log(`[${agent}] ${m}`);
    const pagesFor = relay ? async () => { const ids = new Set(relay.ownedBy(agent)); return (await listPages(cdpPort(), 500)).filter((p) => ids.has(p.id)); } : null;
    const e = combine(
      focus && focusEmulator({ port: cdpPort(), lingerMs, log: tag, pagesFor }),
      capture && pdfCapturer({ port: cdpPort(), lingerMs, outDir: join(dataDir(), 'output', 'pdf'), log: tag, pagesFor }),
    );
    emulators.set(agent, e);
    return e;
  };
  const onPage = (agent, info) => emulators.get(agent)?.adopt({ id: info.targetId, url: info.url, type: info.type }) ?? null;
  // Windows: npx is a .cmd shim; Node refuses to spawn .cmd/.bat without a shell (CVE-2024-27980),
  // so go through cmd.exe with explicit quoting. Elsewhere: plain spawn, no shell.
  const spawnNpx = (a, stdio) => (win
    ? spawn(['npx.cmd', ...a].map(winQuote).join(' '), { stdio, shell: true, windowsHide: true })
    : spawn('npx', a, { stdio }));
  const onSpawnError = (e) => {
    process.stderr.write(`tandem: ERROR — cannot run npx (${e.message}). Node/npx must be in PATH.\n`);
    process.exit(127);
  };

  if (multiSession()) {
    try { relay = await startRelay({ port: cdpPort(), dataDir: dataDir(), log: (m) => log(`relay: ${m}`), onPage }); }
    catch (e) { process.stderr.write(`tandem: multi-session relay could not start (${e.message}); one MCP for the whole session, as before.\n`); }
  }

  if (relay) {
    let cli = null;
    const children = new Set();
    // End of the session (Claude Code: SIGINT, +100 ms SIGTERM, killed at ~400 ms — R05 §17; or the client's
    // EOF): close this session's agents' tabs, give back the handed-over ones (decided 2026-11-03). Bounded:
    // what doesn't make it is reaped by the next relay. Once, whoever asks first; exits wait for it.
    let ending = null;
    const shutdown = () => (ending ??= Promise.race([relay.closeAll().catch(() => 0), new Promise((r) => setTimeout(r, 300))])
      .then((n) => log(`relay: session end, closed ${typeof n === 'number' ? n : '?'} agent tab(s)`)));
    const spawnChild = (agent) => {
      const a = mcpArgs(process.env, { cdpEndpoint: relay.endpoint(agent) });
      const c = agent !== 'main' && cli ? spawn(process.execPath, [cli, ...a.slice(2)], { stdio: ['pipe', 'pipe', 'inherit'] }) : spawnNpx(a, ['pipe', 'pipe', 'inherit']);
      children.add(c);
      c.on('exit', () => children.delete(c));
      if (agent === 'main') {
        c.on('error', onSpawnError);
        c.on('exit', async (code, signal) => { await shutdown(); for (const o of children) { try { o.kill(); } catch {} } process.exit(signal ? 1 : (code ?? 0)); });
      } else c.on('error', (e) => log(`router: agent ${agent}: cannot start its MCP (${e.message})`));
      log(`router: started the MCP of agent ${agent} (${agent !== 'main' && cli ? 'node cli.js' : 'npx'})`);
      return c;
    };
    const localTools = { [ADOPT_TOOL]: adoptTool({ relay, port: cdpPort(), dataDir: dataDir() }) };
    const envMs = (name, def) => { const n = Number(process.env[name]); return process.env[name] !== undefined && Number.isFinite(n) && n >= 0 ? n : def; };
    const lifecycle = {
      stopMs: envMs('TANDEM_AGENT_IDLE_MS', 10 * 60_000),        // a subagent's MCP stopped after 10 min unused
      tabsMs: envMs('TANDEM_AGENT_TABS_IDLE_MS', 30 * 60_000),   // …and its tabs closed after 30
      maxAgents: envMs('TANDEM_MAX_AGENTS', 8),                  // subagents' MCPs alive at once (0 = no cap)
      checkMs: envMs('TANDEM_LIFECYCLE_CHECK_MS', 30_000),
      onStop: (agent) => relay.suspend(agent),
      onTabsIdle: (agent) => relay.closeAgent(agent),
    };
    routeStdio({ clientIn: process.stdin, clientOut: process.stdout, spawnChild, emulatorFor, multi: true, log, localTools, lifecycle });
    // Leftovers of sessions that died without closing their tabs (crash, SIGKILL before the 300 ms).
    setInterval(() => { relay.reapDead().catch(() => {}); }, 60_000).unref();
    // After main is up: later children skip npx if this resolves (it never delays the handshake).
    resolveMcpCli(mcpVersion()).then((p) => { cli = p; log(`router: MCP cli ${p ? 'resolved' : 'not resolved (children via npx)'}`); });
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, async () => { await shutdown(); for (const c of children) { try { c.kill(sig); } catch {} } });
  } else {
    const proxied = focus || capture;
    const stdio = proxied ? ['pipe', 'pipe', 'inherit'] : 'inherit';
    const child = spawnNpx(args, stdio);
    if (proxied) {
      proxyStdio({ clientIn: process.stdin, clientOut: process.stdout, serverIn: child.stdin, serverOut: child.stdout, emulator: emulatorFor('main') });
      child.stdin.on('error', () => {});   // the MCP died mid-write: its exit below ends us
    }
    child.on('error', onSpawnError);
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { try { child.kill(sig); } catch {} });
    child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
  }
}
