#!/usr/bin/env node
// recipe.mjs — compilador de RECETAS ejecutables de tandem:map (procedural memory).
//
// Una receta del perfil (sites/<host>.md, sección ## Recetas) es una secuencia nombrada y
// PARAMETRIZADA de pasos sobre los locators del perfil (por su `sel:`). Este módulo la PARSEA,
// VALIDA y COMPILA a dos formas (helper de autoría: NO ejecuta — quien ejecuta es el agente):
//   --fast: una función Playwright `async (page) => {…}` para `browser_run_code_unsafe` (1 call).
//   --step: una lista de pasos `{action,target,value}` que el agente ejecuta con browser_click/type.
//
// Seguridad (browser_run_code_unsafe es RCE-equivalent): la estructura viene del store co-curado;
// los DATOS (args) son no confiables y entran SIEMPRE por JSON.stringify (literal JS inerte). El
// `sel:` plantilla es el único punto donde un valor va dentro de un string de selector → se escapa
// por-engine con las funciones de selector.mjs ANTES del JSON.stringify. `assertCompiledSafe` es la
// red final: inspecciona el ESQUELETO (sin el contenido de los strings) contra una allowlist.
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
import { escapeStringName, escapeRegexName } from './selector.mjs';

export const ACTIONS = new Set(['navigate', 'type', 'click', 'wait-url', 'return', 'extract']);

// --- parseo del perfil -------------------------------------------------------------
function section(md, title) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trim().startsWith(`## ${title}`));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end));
}

// Locators: `- nombre:` y, debajo, `sel: <selector>`. isTemplate si el sel tiene {huecos}.
export function parseLocators(md) {
  const out = new Map();
  let cur = null;
  for (const line of section(md, 'Locators')) {
    const head = line.match(/^-\s+([a-z0-9-]+):\s*$/);
    if (head) { cur = head[1]; out.set(cur, { sel: null, holes: [] }); continue; }
    const sel = line.match(/^\s+sel:\s*(.+?)\s*$/);
    if (sel && cur) {
      const value = sel[1];
      const holes = [...value.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      out.set(cur, { sel: value, holes });
    }
  }
  return out;
}

// Recetas: cabecera `nombre(params):` y pasos `- accion: operando [<- {param}|"lit"]`.
export function parseRecipes(md) {
  const out = new Map();
  let cur = null;
  for (const line of section(md, 'Recetas')) {
    const head = line.match(/^([A-Za-z0-9-]+)(?:\(([^)]*)\))?:\s*$/);
    if (head) {
      const params = head[2] ? head[2].split(',').map((s) => s.trim()).filter(Boolean) : [];
      cur = { name: head[1], params, steps: [] };
      out.set(head[1], cur);
      continue;
    }
    const step = line.match(/^\s*-\s*([a-z-]+):\s*(.*)$/);
    if (step && cur) {
      const action = step[1];
      let operand = step[2].trim(); let arg = null;
      const arrow = operand.split('<-');
      if (arrow.length === 2) {
        operand = arrow[0].trim();
        const raw = arrow[1].trim();
        const param = raw.match(/^\{([^}]+)\}$/);
        const lit = raw.match(/^"(.*)"$/);
        arg = param ? { kind: 'param', name: param[1] }
          : lit ? { kind: 'literal', value: lit[1] }
            : { kind: 'literal', value: raw };
      }
      cur.steps.push({ action, operand, arg });
    }
  }
  return out;
}

export function parseProfile(md) {
  return { locators: parseLocators(md), recipes: parseRecipes(md) };
}

// --- relleno de plantillas (escape por-engine, reusa selector.mjs) -----------------
function holeEngine(segment) {
  if (/=\//.test(segment)) return 'regex';   // name=/.../  → patrón
  return 'string';                            // text="…" / [..="…"] → literal entre comillas
}
export function fillTemplate(sel, argByHole) {
  return sel.replace(/\{([^}]+)\}/g, (m, hole) => {
    const val = argByHole[hole];
    if (val == null) throw new Error(`hueco sin valor: {${hole}}`);
    const seg = sel.split('>>').find((s) => s.includes(m)) || sel;
    return holeEngine(seg) === 'regex' ? escapeRegexName(val) : escapeStringName(val);
  });
}

// --- validación --------------------------------------------------------------------
export function validate(recipe, locators) {
  const errors = []; const warnings = [];
  if (!recipe) return { ok: false, errors: ['receta inexistente'], warnings };
  for (const step of recipe.steps) {
    if (!ACTIONS.has(step.action)) { errors.push(`acción desconocida: '${step.action}' (válidas: ${[...ACTIONS].join(', ')})`); continue; }
    // el param referenciado debe estar en la firma
    if (step.arg?.kind === 'param' && !recipe.params.includes(step.arg.name)) {
      errors.push(`param no declarado en la firma: {${step.arg.name}} (paso ${step.action})`);
    }
    // acciones sobre locator: existe y tiene sel
    if (['type', 'click', 'return', 'extract'].includes(step.action) && step.action !== 'return' || (step.action === 'return' && step.operand !== 'url')) {
      if (step.action === 'extract') continue; // extract se valida aparte (mapa)
      const loc = locators.get(step.operand);
      if (!loc) { errors.push(`locator inexistente: '${step.operand}' (paso ${step.action})`); continue; }
      if (!loc.sel) { errors.push(`locator '${step.operand}' no tiene sel: — no es accionable`); continue; }
      // si el sel es plantilla, el step debe aportar el valor del hueco
      if (loc.holes.length && step.action === 'click' && !step.arg) {
        errors.push(`locator '${step.operand}' es plantilla (${loc.holes.map((h) => `{${h}}`).join(',')}) pero el paso no pasa '<- {param}'`);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

// --- resolución de valores ---------------------------------------------------------
function argValue(arg, args) {
  if (!arg) return undefined;
  if (arg.kind === 'literal') return arg.value;
  if (!(arg.name in args)) throw new Error(`falta argumento: ${arg.name}`);
  return args[arg.name];
}
function locSel(name, locators) {
  const loc = locators.get(name);
  if (!loc || !loc.sel) throw new Error(`locator sin sel: '${name}'`);
  return loc;
}

// --- compilación --fast ------------------------------------------------------------
const J = JSON.stringify;
export function compileFast(recipe, locators, args = {}) {
  const lines = [];
  for (const step of recipe.steps) {
    switch (step.action) {
      case 'navigate':
        lines.push(`await page.goto(${J(step.operand)});`); break;
      case 'type': {
        const { sel } = locSel(step.operand, locators);
        lines.push(`await page.locator(${J(sel)}).fill(${J(String(argValue(step.arg, args) ?? ''))});`); break;
      }
      case 'click': {
        const loc = locSel(step.operand, locators);
        let sel = loc.sel;
        if (loc.holes.length) {
          const v = String(argValue(step.arg, args) ?? '');
          sel = fillTemplate(sel, Object.fromEntries(loc.holes.map((h) => [h, v])));
        }
        lines.push(`await page.locator(${J(sel)}).click();`); break;
      }
      case 'wait-url':
        lines.push(`await page.waitForURL((u) => u.href.includes(${J(step.operand)}));`); break;
      case 'return':
        lines.push(`return ${returnExpr(step.operand, locators)};`); break;
      case 'extract':
        lines.push(`return ${extractExpr(step.operand, locators)};`); break;
      default:
        throw new Error(`acción desconocida: ${step.action}`);
    }
  }
  const code = `async (page) => {\n  ${lines.join('\n  ')}\n}`;
  assertCompiledSafe(code);
  return code;
}

function returnExpr(operand, locators) {
  if (operand === 'url') return 'page.url()';
  const { sel } = locSel(operand, locators);
  return `((await page.locator(${J(sel)}).first().textContent()) || '').trim()`;
}

// extract operand: `{ clave: fuente, ... }`  fuente = url | url:/regex/ | <locator>
function extractExpr(operand, locators) {
  const inner = operand.replace(/^\{/, '').replace(/\}$/, '').trim();
  const pairs = inner.split(',').map((p) => p.trim()).filter(Boolean);
  const fields = pairs.map((p) => {
    const i = p.indexOf(':');
    const key = p.slice(0, i).trim();
    const src = p.slice(i + 1).trim();
    if (src === 'url') return `${J(key)}: page.url()`;
    const m = src.match(/^url:\/(.*)\/$/);
    if (m) return `${J(key)}: (page.url().match(new RegExp(${J(m[1])})) || [])[1]`;
    const { sel } = locSel(src, locators);
    return `${J(key)}: ((await page.locator(${J(sel)}).first().textContent()) || '').trim()`;
  });
  return `{ ${fields.join(', ')} }`;
}

// --- compilación --step ------------------------------------------------------------
export function compileSteps(recipe, locators, args = {}) {
  return recipe.steps.map((step) => {
    switch (step.action) {
      case 'navigate': return { action: 'navigate', value: step.operand };
      case 'type': return { action: 'type', target: locSel(step.operand, locators).sel, value: String(argValue(step.arg, args) ?? '') };
      case 'click': {
        const loc = locSel(step.operand, locators);
        let sel = loc.sel;
        if (loc.holes.length) {
          const v = String(argValue(step.arg, args) ?? '');
          sel = fillTemplate(sel, Object.fromEntries(loc.holes.map((h) => [h, v])));
        }
        return { action: 'click', target: sel };
      }
      case 'wait-url': return { action: 'wait', waitFor: 'url', value: step.operand };
      case 'return': return { action: 'extract', source: step.operand };
      case 'extract': return { action: 'extract', map: step.operand };
      default: throw new Error(`acción desconocida: ${step.action}`);
    }
  });
}

// --- red de seguridad: el esqueleto (sin contenido de strings) solo puede tener lo permitido --
export function assertCompiledSafe(code) {
  // Quita el CONTENIDO de los string literals (ahí viven los valores de usuario, ya inertes por
  // JSON.stringify) para no dar falsos positivos si un valor contiene p.ej. "require".
  const skeleton = code.replace(/"(\\.|[^"\\])*"/g, '""').replace(/'(\\.|[^'\\])*'/g, "''");
  if (/`|\$\{/.test(skeleton)) throw new Error('código compilado: template strings no permitidos');
  if (/\b(require|process|import|eval|Function|fetch|globalThis|child_process|module|constructor|while|for|XMLHttpRequest)\b/.test(skeleton)) {
    throw new Error('código compilado: token estructural no permitido (posible inyección)');
  }
  const calls = [...skeleton.matchAll(/page\.([A-Za-z]+)/g)].map((m) => m[1]);
  const okCalls = new Set(['goto', 'locator', 'waitForURL', 'url']);
  for (const c of calls) if (!okCalls.has(c)) throw new Error(`código compilado: page.${c} no permitido`);
  return true;
}

// --- CLI ---------------------------------------------------------------------------
function dataDir() { return process.env.TANDEM_DATA_DIR || join(homedir(), '.claude', 'tandem'); }
function loadProfile(host) {
  const path = join(dataDir(), 'sites', `${host.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').toLowerCase()}.md`);
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
