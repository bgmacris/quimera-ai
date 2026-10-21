// recipe-parser.mjs — DSL parser and validator for recipes (tandem:map).
//
// Understands the profile markdown (sites/<host>.md): extracts locators and recipes into
// structures, and validates a recipe against its locators. Hand-parsed flat-YAML (no deps).
// Does NOT compile or execute: only "understands" the text. Compilation lives in recipe-compiler.mjs.

export const ACTIONS = new Set(['navigate', 'type', 'click', 'wait-url', 'return', 'extract', 'extract-all']);

// --- profile parsing ---------------------------------------------------------------
function section(md, title) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');   // CRLF (Windows checkout/editor) broke every line-anchored regex
  const start = lines.findIndex((l) => l.trim().startsWith(`## ${title}`));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end));
}

// The selector part of a `sel:` value: profiles annotate after it — `  (comment)` or `| verified DATE`.
// A comment starts at 2+ spaces followed by '(' or '|', or at ' | '. Selectors themselves never contain
// those (`:has(…)`, `:nth-child(2)` have no double space before the paren).
export function selValue(raw) {
  return raw.split(/\s{2,}[(|]|\s\|\s/)[0].trim();
}

// Locators, in either form (both appear in real profiles — the shipped example uses both):
//   - name:                     - name:   sel: <selector>   | verified …
//       sel: <selector>
// isTemplate if sel has {holes}. A `- name:` line without any sel: stays (sel null → validate says so).
export function parseLocators(md) {
  const out = new Map();
  let cur = null;
  for (const line of section(md, 'Locators')) {
    const one = line.match(/^-\s+([a-z0-9-]+):\s+sel:\s*(.+)$/);
    const head = one || line.match(/^-\s+([a-z0-9-]+):\s*$/);
    if (head) { cur = head[1]; out.set(cur, { sel: null, holes: [] }); }
    const sel = one ? [null, one[2]] : (!head && line.match(/^\s+sel:\s*(.+?)\s*$/));
    if (sel && cur) {
      const value = selValue(sel[1]);
      const holes = [...value.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      out.set(cur, { sel: value, holes });
    }
  }
  return out;
}

// `- name: …` lines in Locators that are neither form above: dropped silently before, now reported.
export function unparsedLocatorLines(md) {
  return section(md, 'Locators').filter((l) => /^-\s+\S/.test(l)
    && !/^-\s+([a-z0-9-]+):\s*$/.test(l) && !/^-\s+([a-z0-9-]+):\s+sel:\s*\S/.test(l));
}

// Recipes: header `name(params):` and steps `- action: operand [<- {param}|"lit"]`.
export function parseRecipes(md) {
  const out = new Map();
  let cur = null;
  for (const line of section(md, 'Recipes')) {
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

// --- validation --------------------------------------------------------------------
export function validate(recipe, locators) {
  const errors = []; const warnings = [];
  if (!recipe) return { ok: false, errors: ['recipe not found'], warnings };
  for (const step of recipe.steps) {
    if (!ACTIONS.has(step.action)) { errors.push(`unknown action: '${step.action}' (valid: ${[...ACTIONS].join(', ')})`); continue; }
    // referenced param must be in the signature
    if (step.arg?.kind === 'param' && !recipe.params.includes(step.arg.name)) {
      errors.push(`param not declared in signature: {${step.arg.name}} (step ${step.action})`);
    }
    // navigate: only http(s) — a literal is checked here, an argument at compile time.
    if (step.action === 'navigate') {
      const lit = step.arg?.kind === 'literal' ? step.arg.value : (!step.arg ? step.operand : null);
      if (lit != null && lit && !/\{[^}]+\}/.test(lit) && !/^https?:\/\//i.test(lit)) errors.push(`navigate: only http(s) URLs ('${lit.slice(0, 40)}')`);
      if (/\{[^}]+\}/.test(step.operand) && !step.arg) {
        warnings.push(`navigate: operand contains '{…}' — did you mean '<- {param}' to pass it as an argument?`);
      }
      continue;
    }
    // wait-url does not use a locator
    if (step.action === 'wait-url') continue;
    // extract / extract-all: plain locator, or (extract only) a map {key: url | url:/re/ | <locator>} —
    // every locator named in the map is checked too (it used to pass validate and fail at compile).
    if (step.action === 'extract' || step.action === 'extract-all') {
      const names = step.operand.startsWith('{')
        ? step.operand.replace(/^\{|\}$/g, '').split(',').map((p) => p.trim()).filter(Boolean)
          .map((p) => (p.indexOf(':') < 0 ? null : p.slice(p.indexOf(':') + 1).trim()))
        : [step.operand];
      if (step.action === 'extract-all' && step.operand.startsWith('{')) errors.push('extract-all takes one locator, not a {…} map');
      for (const n of names) {
        if (n == null) { errors.push(`extract: pair without ':' in map '${step.operand}'`); continue; }
        if (n === 'url' || /^url:\/.*\/$/.test(n)) continue;
        const loc = locators.get(n);
        if (!loc) errors.push(`locator not found: '${n}' (step ${step.action})`);
        else if (!loc.sel) errors.push(`locator '${n}' has no sel: — not actionable (step ${step.action})`);
      }
      continue;
    }
    // return url is special
    if (step.action === 'return' && step.operand === 'url') continue;
    // type, click, return <locator>: must exist and have sel
    const loc = locators.get(step.operand);
    if (!loc) { errors.push(`locator not found: '${step.operand}' (step ${step.action})`); continue; }
    if (!loc.sel) { errors.push(`locator '${step.operand}' has no sel: — not actionable`); continue; }
    // if sel is a template, click must supply the hole value
    if (loc.holes.length && step.action === 'click' && !step.arg) {
      errors.push(`locator '${step.operand}' is a template (${loc.holes.map((h) => `{${h}}`).join(',')}) but the step does not pass '<- {param}'`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
