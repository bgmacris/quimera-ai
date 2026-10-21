#!/usr/bin/env node
// recipe.mjs — facade + CLI for tandem:map EXECUTABLE RECIPES (procedural memory).
//
// A recipe in the profile (sites/<host>.md, section ## Recipes) is a named, PARAMETERIZED
// sequence of steps over the profile's locators (by their `sel:`). Work is split by
// responsibility across three modules; this is the public face (re-exports) + the CLI:
//   recipe-parser.mjs    — understands the DSL: parseLocators/parseRecipes/parseProfile/validate/ACTIONS.
//   recipe-compiler.mjs  — structure → code/steps: fillTemplate/compileFast/compileSteps.
//   recipe-safety.mjs    — final net over compiled code: assertCompiledSafe.
//
// Compiles to two forms (authoring helper: does NOT execute — the agent executes):
//   --fast: a Playwright `async (page) => {…}` function for `browser_run_code_unsafe` (1 call).
//   --step: a list of steps `{action,target,value}` the agent executes with browser_click/type.
//
// Format (flat-YAML, hand-parsed — the plugin has no deps):
//   open-ticket-by-id(id):
//     - type:     ticket-search  <- {id}
//     - click:    ticket-row     <- {id}
//     - wait-url: /tickets/
//     - return:   url

import { readFileSync } from 'node:fs';
import { parseProfile, unparsedLocatorLines, validate } from './recipe-parser.mjs';
import { compileFast, compileSteps } from './recipe-compiler.mjs';
import { normalizeHost } from './host.mjs';
import { resolveProfile } from './profile.mjs';
import { isMain } from './is-main.mjs';

export { ACTIONS, parseLocators, parseRecipes, parseProfile, validate } from './recipe-parser.mjs';
export { fillTemplate, compileFast, compileSteps } from './recipe-compiler.mjs';
export { assertCompiledSafe } from './recipe-safety.mjs';

// --- CLI ---------------------------------------------------------------------------
// Same resolution as the hook/map.sh: `host_port`, falling back to the legacy port-less profile.
function loadProfile(host) {
  const r = resolveProfile(host);
  if (!r) { process.stderr.write(`recipe: no profile for '${normalizeHost(host)}'\n`); process.exit(1); }
  const md = readFileSync(r.path, 'utf8');
  return { ...parseProfile(md), unparsed: unparsedLocatorLines(md) };
}

const isCli = isMain(import.meta.url);
if (isCli) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const pos = argv.slice(1).filter((a) => !a.startsWith('--'));
  try {
    if (cmd === 'validate') {
      const { locators, recipes, unparsed } = loadProfile(pos[0]);
      let bad = 0;
      for (const l of unparsed) process.stdout.write(`⚠ Locators: line not understood (use "- name:   sel: …" or "- name:" + indented "sel:"): ${l.trim().slice(0, 100)}\n`);
      for (const [name, r] of recipes) {
        const v = validate(r, locators);
        if (!v.ok) { bad++; process.stdout.write(`✗ ${name}\n${v.errors.map((e) => `    ${e}`).join('\n')}\n`); }
        else process.stdout.write(`✓ ${name}\n`);
        for (const w of v.warnings) process.stdout.write(`    ⚠ ${w}\n`);
      }
      process.exit(bad ? 1 : 0);
    }
    if (cmd === 'compile') {
      const [host, recipeName, ...rest] = pos;
      const { locators, recipes } = loadProfile(host);
      const recipe = recipes.get(recipeName);
      if (!recipe) { process.stderr.write(`recipe: recipe '${recipeName}' not found in ${host}\n`); process.exit(1); }
      if (rest.length < recipe.params.length) {
        process.stderr.write(`recipe: compile requires ${recipe.params.length} arg(s): ${recipe.params.join(', ')}\n`);
        process.exit(1);
      }
      const args = Object.fromEntries(recipe.params.map((p, i) => [p, rest[i]]));
      const v = validate(recipe, locators);
      if (!v.ok) { process.stderr.write(`recipe: invalid recipe:\n${v.errors.map((e) => `  ${e}`).join('\n')}\n`); process.exit(1); }
      if (flags.has('--step')) process.stdout.write(JSON.stringify(compileSteps(recipe, locators, args), null, 2) + '\n');
      else process.stdout.write(compileFast(recipe, locators, args) + '\n');
      process.exit(0);
    }
    process.stderr.write('usage: recipe.mjs {validate <host> | compile <host> <recipe> [args…] [--fast|--step]}\n');
    process.exit(2);
  } catch (e) {
    process.stderr.write('recipe: ' + e.message + '\n');
    process.exit(2);
  }
}
