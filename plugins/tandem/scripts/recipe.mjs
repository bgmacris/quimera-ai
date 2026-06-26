#!/usr/bin/env node
// recipe.mjs — fachada + CLI de las RECETAS ejecutables de tandem:map (procedural memory).
//
// Una receta del perfil (sites/<host>.md, sección ## Recetas) es una secuencia nombrada y
// PARAMETRIZADA de pasos sobre los locators del perfil (por su `sel:`). El trabajo está repartido
// por responsabilidad en tres módulos; esto es la cara pública (re-exporta) + la CLI:
//   recipe-parser.mjs    — entiende el DSL: parseLocators/parseRecipes/parseProfile/validate/ACTIONS.
//   recipe-compiler.mjs  — estructura → código/pasos: fillTemplate/compileFast/compileSteps.
//   recipe-safety.mjs    — red final sobre el código compilado: assertCompiledSafe.
//
// Compila a dos formas (helper de autoría: NO ejecuta — quien ejecuta es el agente):
//   --fast: una función Playwright `async (page) => {…}` para `browser_run_code_unsafe` (1 call).
//   --step: una lista de pasos `{action,target,value}` que el agente ejecuta con browser_click/type.
//
// Formato (YAML-plano, parseado a mano — el plugin no tiene deps):
//   abrir-ticket-por-id(id):
//     - type:     busqueda-tickets  <- {id}
//     - click:    fila-de-ticket    <- {id}
//     - wait-url: /tickets/
//     - return:   url

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseProfile, validate } from './recipe-parser.mjs';
import { compileFast, compileSteps } from './recipe-compiler.mjs';
import { normalizeHost } from './host.mjs';

export { ACTIONS, parseLocators, parseRecipes, parseProfile, validate } from './recipe-parser.mjs';
export { fillTemplate, compileFast, compileSteps } from './recipe-compiler.mjs';
export { assertCompiledSafe } from './recipe-safety.mjs';

// --- CLI ---------------------------------------------------------------------------
function dataDir() { return process.env.TANDEM_DATA_DIR || join(homedir(), '.claude', 'tandem'); }
function loadProfile(host) {
  const path = join(dataDir(), 'sites', `${normalizeHost(host)}.md`);
  if (!existsSync(path)) { process.stderr.write(`recipe: no hay perfil para '${host}' (${path})\n`); process.exit(1); }
  return parseProfile(readFileSync(path, 'utf8'));
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const pos = argv.slice(1).filter((a) => !a.startsWith('--'));
  try {
    if (cmd === 'validate') {
      const { locators, recipes } = loadProfile(pos[0]);
      let bad = 0;
      for (const [name, r] of recipes) {
        const v = validate(r, locators);
        if (!v.ok) { bad++; process.stdout.write(`✗ ${name}\n${v.errors.map((e) => `    ${e}`).join('\n')}\n`); }
        else process.stdout.write(`✓ ${name}\n`);
      }
      process.exit(bad ? 1 : 0);
    }
    if (cmd === 'compile') {
      const [host, recipeName, ...rest] = pos;
      const { locators, recipes } = loadProfile(host);
      const recipe = recipes.get(recipeName);
      if (!recipe) { process.stderr.write(`recipe: receta '${recipeName}' no está en ${host}\n`); process.exit(1); }
      const args = Object.fromEntries(recipe.params.map((p, i) => [p, rest[i]]));
      const v = validate(recipe, locators);
      if (!v.ok) { process.stderr.write(`recipe: receta inválida:\n${v.errors.map((e) => `  ${e}`).join('\n')}\n`); process.exit(1); }
      if (flags.has('--step')) process.stdout.write(JSON.stringify(compileSteps(recipe, locators, args), null, 2) + '\n');
      else process.stdout.write(compileFast(recipe, locators, args) + '\n');
      process.exit(0);
    }
    process.stderr.write('uso: recipe.mjs {validate <host> | compile <host> <receta> [args…] [--fast|--step]}\n');
    process.exit(2);
  } catch (e) {
    process.stderr.write('recipe: ' + e.message + '\n');
    process.exit(2);
  }
}
