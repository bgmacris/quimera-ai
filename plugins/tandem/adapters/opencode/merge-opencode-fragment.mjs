#!/usr/bin/env node
// merge-opencode-fragment.mjs — deep-merge tandem fragment into ~/.config/opencode/opencode.jsonc
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tandemRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fragmentPath = join(dirname(fileURLToPath(import.meta.url)), 'opencode.fragment.jsonc');
const configPath = join(homedir(), '.config', 'opencode', 'opencode.jsonc');
const mcpWrap = join(tandemRoot, 'adapters/shared/mcp-wrap.sh');

// Strip // and /* */ comments from JSONC, string-aware so https:// inside a value
// and any // or /* */ sitting inside a string literal survive untouched.
function stripComments(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { out += next ?? ''; i += 1; continue; } // copy escaped char verbatim
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && next === '/') {
      i += 1;
      while (i + 1 < text.length && text[i + 1] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1; // land on '/', loop's i+=1 steps past it
      continue;
    }
    out += c;
  }
  return out;
}

// Remove trailing commas (JSONC allows them; JSON.parse does not), string-aware.
function stripTrailingCommas(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += text[i + 1] ?? ''; i += 1; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      if (text[j] === '}' || text[j] === ']') continue; // drop the trailing comma
    }
    out += c;
  }
  return out;
}

// Tolerant JSONC read: OpenCode's opencode.jsonc routinely carries comments and
// trailing commas. Plain JSON.parse would throw and abort the whole install.
function loadJson(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(stripTrailingCommas(stripComments(raw)));
  } catch (err) {
    throw new Error(`could not parse ${path} as JSONC: ${err.message}`);
  }
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

// The merge rewrites opencode.jsonc as plain (comment-free) JSON. Back up the
// original first so any comments the user had are recoverable.
if (existsSync(configPath)) {
  const backup = `${configPath}.bak`;
  copyFileSync(configPath, backup);
  process.stdout.write(`Backed up existing config -> ${backup}\n`);
}

writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`);
process.stdout.write(`Merged tandem fragment into ${configPath}\n`);
