// recipe-compiler.mjs — compila una receta parseada a código/pasos ejecutables (tandem:map).
//
// De la estructura (locators + receta de recipe-parser.mjs) a dos formas (helper de autoría: NO
// ejecuta — quien ejecuta es el agente):
//   --fast: una función Playwright `async (page) => {…}` para `browser_run_code_unsafe` (1 call).
//   --step: una lista de pasos `{action,target,value}` que el agente ejecuta con browser_click/type.
//
// Seguridad (browser_run_code_unsafe es RCE-equivalent): la estructura viene del store co-curado;
// los DATOS (args) son no confiables y entran SIEMPRE por JSON.stringify (literal JS inerte). El
// `sel:` plantilla es el único punto donde un valor va dentro de un string de selector → se escapa
// por-engine con las funciones de selector.mjs ANTES del JSON.stringify. assertCompiledSafe (de
// recipe-safety.mjs) es la red final sobre el código generado.

import { escapeStringName, escapeRegexName } from './selector.mjs';
import { assertCompiledSafe } from './recipe-safety.mjs';

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
      case 'navigate': {
        const url = step.arg ? String(argValue(step.arg, args) ?? step.operand) : step.operand;
        lines.push(`await page.goto(${J(url)});`); break;
      }
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

// extract operand: plain locator name  OR  `{ clave: fuente, ... }`  fuente = url | url:/regex/ | <locator>
function extractExpr(operand, locators) {
  // plain locator: `extract: item-catalogo`
  if (!operand.startsWith('{')) {
    const { sel } = locSel(operand, locators);
    return `((await page.locator(${J(sel)}).first().textContent()) || '').trim()`;
  }
  // map syntax: `extract: { titulo: detalle-titulo, precio: detalle-precio }`
  const inner = operand.replace(/^\{/, '').replace(/\}$/, '').trim();
  const pairs = inner.split(',').map((p) => p.trim()).filter(Boolean);
  const fields = pairs.map((p) => {
    const i = p.indexOf(':');
    if (i < 0) throw new Error(`extract: par sin ':' en el mapa: '${p}'`);
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
      case 'navigate': {
        const url = step.arg ? String(argValue(step.arg, args) ?? step.operand) : step.operand;
        return { action: 'navigate', value: url };
      }
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
