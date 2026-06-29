#!/usr/bin/env node
// selector.mjs — Playwright selector generator/validator for tandem:map (frugal navigation).
//
// A site profile (sites/<host>.md) stores, per locator, an EXECUTABLE `sel:` that the agent
// passes as `target` to browser_click/type/evaluate to act WITHOUT browser_snapshot (the
// accessibility tree snapshot weighs ~18× the entire profile — see docs/01). That `target`
// goes to page.locator(), which accepts CSS and Playwright engines (role=, text=, ...).
//
// Why a helper instead of typing selectors by hand: the syntax has non-obvious escapes —
// quotes inside name, metacharacters in regex mode, the '/' that delimits the regex. Hand-typed
// selectors in each profile silently produce broken selectors. Same lesson as page-signals.mjs:
// critical syntax lives in tested code, not prose. This is an AUTHORING helper (used when
// writing the `sel:` during recon); at runtime the MCP already receives the written `sel:`.
//
// Relevant Playwright semantics: `role=R[name="X"]` matches the EXACT accessible name (case-
// insensitive, trimmed); for SUBSTRING (robust against long/dynamic names) use regex
// `role=R[name=/X/]`. locator() is strict: if the selector matches >1 element, the action
// throws — so CLASS locators (rows, items) are TEMPLATE with a concrete id, not a prefix.
//
// CLI:  selector.mjs <role> <name> [--regex] [--anchor]
//   --regex   name as substring pattern (robust for long/dynamic names)
//   --anchor  with --regex, anchors to start (^) — e.g. a row 'TCK-2026-016…'
// Examples:
//   selector.mjs button "New ticket"                   → role=button[name="New ticket"]
//   selector.mjs textbox "Search" --regex              → role=textbox[name=/Search/]
//   selector.mjs row "TCK-2026-016" --regex --anchor   → role=row[name=/^TCK\-2026\-016/]

// Escapes a literal for placement inside double quotes in a Playwright selector.
export function escapeStringName(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Escapes a literal for use as a regex pattern (all metacharacters, including '/'
// which delimits the expression). $& = the entire match.
export function escapeRegexName(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

// Builds the selector. name is always taken literally (the helper escapes as needed).
// No name → bare role (valid but risky: only for roles the agent knows are unique on the page).
export function buildSelector({ role, name, regex = false, anchor = false } = {}) {
  if (!role || typeof role !== 'string') throw new Error('role is required');
  if (name == null || name === '') return `role=${role}`;
  if (regex) {
    const pat = (anchor ? '^' : '') + escapeRegexName(name);
    return `role=${role}[name=/${pat}/]`;
  }
  return `role=${role}[name="${escapeStringName(name)}"]`;
}

// CHEAP syntactic validation (not a Playwright parser): detects the most common escape errors —
// unbalanced brackets, unclosed quotes or slashes. Returns true if well-formed.
export function isWellFormed(sel) {
  if (typeof sel !== 'string' || !sel.length) return false;
  if ((sel.match(/\[/g) || []).length !== (sel.match(/\]/g) || []).length) return false;
  const m = sel.match(/name=(.*)\]/);
  if (!m) return true; // CSS or other engine without name= → not judged here
  const v = m[1];
  if (v.startsWith('/')) return /^\/.*\/[a-z]*$/.test(v); // regex: /…/ with optional flags
  return /^".*"$/.test(v);                                 // string: balanced "…"
}

// --- CLI ----------------------------------------------------------------------------
import { fileURLToPath } from 'node:url';
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const [role, name] = argv.filter((a) => !a.startsWith('--'));
  if (!role) {
    process.stderr.write('usage: selector.mjs <role> <name> [--regex] [--anchor]\n');
    process.exit(2);
  }
  try {
    process.stdout.write(buildSelector({
      role, name, regex: flags.has('--regex'), anchor: flags.has('--anchor'),
    }) + '\n');
    process.exit(0);
  } catch (e) {
    process.stderr.write('selector: ' + e.message + '\n');
    process.exit(2);
  }
}
