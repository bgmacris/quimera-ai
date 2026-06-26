// recipe-parser.mjs — parseo y validación del DSL de recetas (tandem:map).
//
// Entiende el markdown del perfil (sites/<host>.md): extrae locators y recetas a estructuras,
// y valida una receta contra los locators. Formato YAML-plano parseado a mano (sin deps).
// NO compila ni ejecuta: solo "entiende" el texto. La compilación vive en recipe-compiler.mjs.

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
    // navigate: advertir si el operando contiene {…} (probablemente quiso <- {param})
    if (step.action === 'navigate') {
      if (/\{[^}]+\}/.test(step.operand) && !step.arg) {
        warnings.push(`navigate: el operando contiene '{…}' — ¿quisiste '← {param}' para pasarlo como argumento?`);
      }
      continue;
    }
    // wait-url no usa locator
    if (step.action === 'wait-url') continue;
    // extract: locator plano → debe existir y tener sel; mapa {…} → validación básica
    if (step.action === 'extract') {
      if (!step.operand.startsWith('{')) {
        const loc = locators.get(step.operand);
        if (!loc) { errors.push(`locator inexistente: '${step.operand}' (paso extract)`); continue; }
        if (!loc.sel) { errors.push(`locator '${step.operand}' no tiene sel: — no es accionable (paso extract)`); continue; }
      }
      continue;
    }
    // return url es especial
    if (step.action === 'return' && step.operand === 'url') continue;
    // type, click, return <locator>: deben existir y tener sel
    const loc = locators.get(step.operand);
    if (!loc) { errors.push(`locator inexistente: '${step.operand}' (paso ${step.action})`); continue; }
    if (!loc.sel) { errors.push(`locator '${step.operand}' no tiene sel: — no es accionable`); continue; }
    // si el sel es plantilla, click debe aportar el valor del hueco
    if (loc.holes.length && step.action === 'click' && !step.arg) {
      errors.push(`locator '${step.operand}' es plantilla (${loc.holes.map((h) => `{${h}}`).join(',')}) pero el paso no pasa '<- {param}'`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
