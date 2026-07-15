#!/usr/bin/env node
// merge-opencode-fragment.mjs — deep-merge tandem fragment into ~/.config/opencode/opencode.jsonc
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tandemRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fragmentPath = join(dirname(fileURLToPath(import.meta.url)), 'opencode.fragment.jsonc');
const configPath = join(homedir(), '.config', 'opencode', 'opencode.jsonc');
const mcpWrap = join(tandemRoot, 'adapters/shared/mcp-wrap.sh');

function loadJson(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8');
  // ponytail: our fragments are plain JSON; avoid regex strip that breaks https:// in URLs
  return JSON.parse(raw);
}

function mergeDeep(target, source) {
  for (const [key, val] of Object.entries(source)) {
    if (key === 'mcp' && val && typeof val === 'object' && val.tandem) {
      target.mcp = { ...(target.mcp || {}), tandem: val.tandem };
      continue;
    }
    if (key === 'agent' && val && typeof val === 'object' && val['web-navigator']) {
      target.agent = { ...(target.agent || {}), 'web-navigator': val['web-navigator'] };
      continue;
    }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      target[key] = mergeDeep(target[key] && typeof target[key] === 'object' ? { ...target[key] } : {}, val);
    } else if (Array.isArray(val) && key === 'instructions') {
      const base = Array.isArray(target[key]) ? target[key] : [];
      target[key] = [...new Set([...base, ...val])];
    } else if (Array.isArray(val) && key === 'paths') {
      const base = Array.isArray(target[key]) ? target[key] : [];
      target[key] = [...new Set([...base, ...val])];
    } else {
      target[key] = val;
    }
  }
  return target;
}

let fragment = loadJson(fragmentPath);
fragment = JSON.parse(
  JSON.stringify(fragment)
    .replaceAll('@TANDEM_ROOT@', tandemRoot)
    .replaceAll('@MCP_WRAP@', mcpWrap),
);

mkdirSync(dirname(configPath), { recursive: true });
const existing = loadJson(configPath);
if (!existing.$schema) {
  existing.$schema = 'https://opencode.ai/config.json';
}
const merged = mergeDeep(existing, fragment);
writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`);
process.stdout.write(`Merged tandem fragment into ${configPath}\n`);
