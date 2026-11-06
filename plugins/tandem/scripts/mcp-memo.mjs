// mcp-memo.mjs — what the pinned @playwright/mcp answers to a client's handshake, kept on disk so that a
// session that never uses the browser doesn't start it (T306, research R08 §3): ~280 MB per session, measured.
//
// What the answers depend on — measured on 0.0.83 by varying each one: tools/list on the MCP's version and
// flags, not on the client; initialize on the protocolVersion asked for, not on clientInfo or capabilities;
// server/discover (Claude Code's first message) is "method not found" whatever is asked. So: one file per
// version + every flag it runs with + PLAYWRIGHT_MCP_* (the MCP reads its config from them too) + the content of
// its config file (a path says nothing: the file can be edited), inside it one initialize per protocolVersion. A version that isn't exact ("latest") isn't memoized: its answers can change under the same name.
//
// Written from a real MCP's answers the first time (cold: the launcher behaves as before 0.10.1, nothing lost),
// and checked again each time the MCP does start (agent-router.mjs). Atomic: sessions share the data dir.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const METHOD_NOT_FOUND = -32601;
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
const isObject = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const validTools = (r) => isObject(r) && Array.isArray(r.tools) && r.tools.length > 0 && !r.nextCursor
  && r.tools.every((t) => isObject(t) && typeof t.name === 'string');
// A client told "go ahead" with less than this has nothing to work with, and only a real initialize would repair it.
const validInit = (r) => isObject(r) && typeof r.protocolVersion === 'string' && isObject(r.capabilities);

// The MCP's config file, by flag or env; its content, or null if there is none or it can't be read.
function configContent(args, env) {
  const i = args.indexOf('--config');
  const flag = i >= 0 ? args[i + 1] : args.find((a) => a.startsWith('--config='))?.slice('--config='.length);
  const path = flag || env.PLAYWRIGHT_MCP_CONFIG;
  if (!path) return null;
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

// args: the flags the launcher starts the MCP with. Without them, the ones in TANDEM_MCP_ARGS.
export function memoKey(version, env = process.env, flags = null) {
  const args = flags || (env.TANDEM_MCP_ARGS || '').trim().split(/\s+/).filter(Boolean);
  const config = Object.keys(env).filter((k) => k.startsWith('PLAYWRIGHT_MCP_')).sort().map((k) => [k, env[k]]);
  return createHash('sha256').update(JSON.stringify({ version, args, config, file: configContent(args, env) })).digest('hex').slice(0, 16);
}

// → the memo, or null when this version can't be memoized.
export function handshakeMemo({ dir, version, env = process.env, args = null }) {
  if (!EXACT_VERSION.test(version)) return null;
  const folder = join(dir, 'mcp-memo');
  const file = join(folder, `${version}-${memoKey(version, env, args)}.json`);
  const read = () => { try { const d = JSON.parse(readFileSync(file, 'utf8')); return isObject(d) ? d : {}; } catch { return {}; } };
  let data = read();
  const save = (change) => {
    data = { ...data, ...read() };   // another session may have written since: the disk is the newest
    change(data);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      mkdirSync(folder, { recursive: true });
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, file);
    } catch {   // no memo: the next session starts its MCP, as before (Windows: rename fails if another session has it open)
      try { rmSync(tmp, { force: true }); } catch { /* nothing to leave behind */ }
    }
  };
  return {
    // The answer to this request, { result } or { error }; null if only a real MCP can give it.
    answer(m) {
      if (m?.method === 'server/discover') return isObject(data.discover) ? { error: data.discover } : null;
      if (m?.method === 'tools/list') return !m.params?.cursor && validTools(data.tools) ? { result: data.tools } : null;
      if (m?.method === 'initialize') {
        // Both or neither: a client told "go ahead" needs the tools too.
        const r = isObject(data.initialize) ? data.initialize[m.params?.protocolVersion] : null;
        return validInit(r) && validTools(data.tools) ? { result: r } : null;
      }
      return null;
    },
    // A real MCP's response to that request.
    record(m, response) {
      const res = JSON.parse(JSON.stringify(response));   // a copy: the router adds its own tools to the response it forwards
      if (m?.method === 'server/discover') { if (res?.error?.code === METHOD_NOT_FOUND) save((d) => { d.discover = res.error; }); }
      else if (m?.method === 'tools/list') { if (!m.params?.cursor && validTools(res?.result)) save((d) => { d.tools = res.result; }); }
      else if (m?.method === 'initialize' && validInit(res?.result) && m.params?.protocolVersion) {
        save((d) => { d.initialize = { ...d.initialize, [m.params.protocolVersion]: res.result }; });
      }
    },
    sameTools: (result) => JSON.stringify(result) === JSON.stringify(data.tools),
    cli: () => (typeof data.cli === 'string' ? data.cli : null),
    setCli: (path) => save((d) => { d.cli = path; }),
  };
}
