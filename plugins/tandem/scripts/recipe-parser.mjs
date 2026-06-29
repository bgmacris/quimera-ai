// recipe-parser.mjs — DSL parser and validator for recipes (tandem:map).
//
// Understands the profile markdown (sites/<host>.md): extracts locators and recipes into
// structures, and validates a recipe against its locators. Hand-parsed flat-YAML (no deps).
// Does NOT compile or execute: only "understands" the text. Compilation lives in recipe-compiler.mjs.

export const ACTIONS = new Set(['navigate', 'type', 'click', 'wait-url', 'return', 'extract']);

// --- profile parsing ---------------------------------------------------------------
function section(md, title) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trim().startsWith(`## ${title}`));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end));
}

// Locators: `- name:` and below, `sel: <selector>`. isTemplate if sel has {holes}.
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
    // navigate: warn if operand contains {…} (probably meant <- {param})
    if (step.action === 'navigate') {
      if (/\{[^}]+\}/.test(step.operand) && !step.arg) {
        warnings.push(`navigate: operand contains '{…}' — did you mean '<- {param}' to pass it as an argument?`);
      }
      continue;
    }
    // wait-url does not use a locator
    if (step.action === 'wait-url') continue;
    // extract: plain locator → must exist and have sel; map {…} → basic validation
    if (step.action === 'extract') {
      if (!step.operand.startsWith('{')) {
        const loc = locators.get(step.operand);
        if (!loc) { errors.push(`locator not found: '${step.operand}' (step extract)`); continue; }
        if (!loc.sel) { errors.push(`locator '${step.operand}' has no sel: — not actionable (step extract)`); continue; }
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
