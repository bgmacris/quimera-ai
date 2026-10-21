// recipe-compiler.mjs — compiles a parsed recipe to executable code/steps (tandem:map).
//
// From structure (locators + recipe from recipe-parser.mjs) to two forms (authoring helper:
// does NOT execute — the agent is the one that executes):
//   --fast: a Playwright `async (page) => {…}` function for `browser_run_code_unsafe` (1 call).
//   --step: a list of steps `{action,target,value}` the agent executes with browser_click/type.
//
// Security (browser_run_code_unsafe is RCE-equivalent): the structure comes from the co-curated
// store; DATA (args) is untrusted and ALWAYS enters via JSON.stringify (inert JS literal). The
// template `sel:` is the only point where a value goes inside a selector string → escaped
// per-engine with selector.mjs functions BEFORE JSON.stringify. assertCompiledSafe (from
// recipe-safety.mjs) is the final net over the generated code.

import { escapeStringName, escapeRegexName } from './selector.mjs';
import { assertCompiledSafe } from './recipe-safety.mjs';

// --- template filling (per-engine escape, reuses selector.mjs) --------------------
function holeEngine(segment) {
  if (/=\//.test(segment)) return 'regex';   // name=/.../  → pattern
  return 'string';                            // text="…" / [..="…"] → literal in quotes
}
export function fillTemplate(sel, argByHole) {
  return sel.replace(/\{([^}]+)\}/g, (m, hole) => {
    const val = argByHole[hole];
    if (val == null) throw new Error(`missing value for hole: {${hole}}`);
    const seg = sel.split('>>').find((s) => s.includes(m)) || sel;
    return holeEngine(seg) === 'regex' ? escapeRegexName(val) : escapeStringName(val);
  });
}

// --- navigate: http(s) only ----------------------------------------------------------
// The MCP's own browser_navigate refuses file: ("Access to file: protocol is blocked"), so a --step
// recipe could not read local files — but --fast runs page.goto inside browser_run_code_unsafe, where
// that guard does not apply: an untrusted ARGUMENT (file:///etc/hostname, javascript:…) changed what
// the recipe does. Both modes now accept only absolute http(s) URLs.
export function safeUrl(u) {
  let parsed;
  try { parsed = new URL(String(u)); } catch { throw new Error(`navigate: not an absolute URL: '${String(u).slice(0, 60)}'`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`navigate: only http(s) URLs (got '${parsed.protocol}')`);
  return parsed.href;
}

// --- value resolution -------------------------------------------------------------
function argValue(arg, args) {
  if (!arg) return undefined;
  if (arg.kind === 'literal') return arg.value;
  if (!(arg.name in args)) throw new Error(`missing argument: ${arg.name}`);
  return args[arg.name];
}
function locSel(name, locators) {
  const loc = locators.get(name);
  if (!loc || !loc.sel) throw new Error(`locator missing sel: '${name}'`);
  return loc;
}

// --- --fast compilation -----------------------------------------------------------
const J = JSON.stringify;
export function compileFast(recipe, locators, args = {}) {
  const lines = [];
  for (const step of recipe.steps) {
    switch (step.action) {
      case 'navigate': {
        const url = safeUrl(step.arg ? String(argValue(step.arg, args) ?? step.operand) : step.operand);
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
          const uniqueHoles = new Set(loc.holes);
          if (uniqueHoles.size > 1) throw new Error(`locator '${step.operand}' has ${uniqueHoles.size} distinct holes (${[...uniqueHoles].join(', ')}): a click step can only provide one value`);
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
      case 'extract-all': {
        const { sel } = locSel(step.operand, locators);
        lines.push(`return (await page.locator(${J(sel)}).allTextContents()).map((t) => t.trim());`); break;
      }
      default:
        throw new Error(`unknown action: ${step.action}`);
    }
  }
  const code = `async (page) => {\n  ${lines.join('\n  ')}\n}`;
  assertCompiledSafe(code);
  return code;
}

// One element's text, STRICT: a locator matching several elements throws (as clicks do) instead of
// silently taking the first — that hid a list being read as one record. Lists: `extract-all`.
const one = (sel) => `((await page.locator(${J(sel)}).textContent()) || '').trim()`;

function returnExpr(operand, locators) {
  if (operand === 'url') return 'page.url()';
  return one(locSel(operand, locators).sel);
}

// extract operand: plain locator name  OR  `{ key: source, ... }`  source = url | url:/regex/ | <locator>
function extractExpr(operand, locators) {
  // plain locator: `extract: item-catalogue`
  if (!operand.startsWith('{')) return one(locSel(operand, locators).sel);
  // map syntax: `extract: { title: detail-title, price: detail-price }`
  const inner = operand.replace(/^\{/, '').replace(/\}$/, '').trim();
  const pairs = inner.split(',').map((p) => p.trim()).filter(Boolean);
  const fields = pairs.map((p) => {
    const i = p.indexOf(':');
    if (i < 0) throw new Error(`extract: pair without ':' in map: '${p}'`);
    const key = p.slice(0, i).trim();
    const src = p.slice(i + 1).trim();
    if (src === 'url') return `${J(key)}: page.url()`;
    const m = src.match(/^url:\/(.*)\/$/);
    if (m) return `${J(key)}: (page.url().match(new RegExp(${J(m[1])})) || [])[1]`;
    return `${J(key)}: ${one(locSel(src, locators).sel)}`;
  });
  return `{ ${fields.join(', ')} }`;
}

// --- --step compilation -----------------------------------------------------------
export function compileSteps(recipe, locators, args = {}) {
  return recipe.steps.map((step) => {
    switch (step.action) {
      case 'navigate': {
        const url = safeUrl(step.arg ? String(argValue(step.arg, args) ?? step.operand) : step.operand);
        return { action: 'navigate', value: url };
      }
      case 'type': return { action: 'type', target: locSel(step.operand, locators).sel, value: String(argValue(step.arg, args) ?? '') };
      case 'click': {
        const loc = locSel(step.operand, locators);
        let sel = loc.sel;
        if (loc.holes.length) {
          const uniqueHoles = new Set(loc.holes);
          if (uniqueHoles.size > 1) throw new Error(`locator '${step.operand}' has ${uniqueHoles.size} distinct holes (${[...uniqueHoles].join(', ')}): a click step can only provide one value`);
          const v = String(argValue(step.arg, args) ?? '');
          sel = fillTemplate(sel, Object.fromEntries(loc.holes.map((h) => [h, v])));
        }
        return { action: 'click', target: sel };
      }
      case 'wait-url': return { action: 'wait', waitFor: 'url', value: step.operand };
      case 'return': return { action: 'extract', source: step.operand };
      case 'extract': return { action: 'extract', map: step.operand };
      case 'extract-all': return { action: 'extract-all', target: locSel(step.operand, locators).sel };
      default: throw new Error(`unknown action: ${step.action}`);
    }
  });
}
