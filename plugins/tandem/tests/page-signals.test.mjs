#!/usr/bin/env node
// page-signals.test.mjs — tests del fingerprint de página (scripts/page-signals.mjs).
// Sin dependencias: mini-runner + un document MOCK dirigido (no jsdom). Cubre:
//   - norm: dígitos→'#', espacios colapsados, trim, null-safe (la pieza anti-falso-drift).
//   - collectSignals: roles/landmarks/botones/inputs/headings/nav-links, dedup + orden,
//     y que normaliza los textos (un botón 'Pedido 112' y 'Pedido 115' dan la MISMA señal).
//   - consistencia: el blob que emite `print` produce lo mismo que collectSignals en proceso
//     (garantiza que la serialización .toString() no diverge del código testeado).
// Uso: node tests/page-signals.test.mjs   (exit 0 = verde).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { norm, collectSignals, browserBlob } from '../scripts/page-signals.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0; let fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function t(desc, got, want) {
  if (eq(got, want)) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}\n`); }
}

// --- document MOCK dirigido ---------------------------------------------------------
// map: { '<selector exacto>': [ {atributos..., textContent, tagName} ] }. querySelectorAll
// devuelve un array (tiene forEach); querySelector devuelve el primero o null. Si collectSignals
// cambia un selector, deja de recibir nodos → la señal desaparece → el test lo detecta.
function mockDoc(map) {
  const nodeOf = (p) => ({
    getAttribute: (k) => (k in p ? p[k] : null),
    textContent: p.textContent ?? '',
    tagName: p.tagName ?? 'DIV',
  });
  return {
    querySelectorAll: (sel) => (map[sel] || []).map(nodeOf),
    querySelector: (sel) => (map[sel] && map[sel].length ? nodeOf(map[sel][0]) : null),
  };
}

// --- norm -------------------------------------------------------------------------
process.stdout.write('[norm]\n');
t('dígitos → #', norm('Bandeja 112'), 'Bandeja #');
t('secuencias múltiples de dígitos', norm('Pedido 5 de 200'), 'Pedido # de #');
t('counts distintos colapsan igual', norm('Bandeja 112') === norm('Bandeja 115'), true);
t('espacios colapsados + trim', norm('  a   b  '), 'a b');
t('null-safe', norm(null), '');
t('undefined-safe', norm(undefined), '');
t('sin dígitos intacto', norm('Tickets'), 'Tickets');

// --- collectSignals ---------------------------------------------------------------
process.stdout.write('[collectSignals]\n');
const doc = mockDoc({
  '[role]': [{ role: 'navigation' }, { role: 'button' }],
  header: [{}],
  main: [{}],
  button: [{ 'aria-label': 'Enviar' }, { textContent: 'Pedido 112' }],
  'input,textarea': [{ placeholder: 'Buscar' }],
  'h1,h2,h3': [{ textContent: 'Tickets 2026', tagName: 'H1' }],
  'nav a,[role=navigation] a': [{ textContent: 'Tickets' }],
});
const sigs = collectSignals(doc);
t('está ordenado', eq(sigs, [...sigs].sort()), true);
t('rol presente', sigs.includes('role:navigation'), true);
t('landmark presente (header)', sigs.includes('landmark:header'), true);
t('landmark ausente (nav no está)', sigs.includes('landmark:nav'), false);
t('button por aria-label', sigs.includes('button:Enviar'), true);
t('button normalizado (112→#)', sigs.includes('button:Pedido #'), true);
t('textbox por placeholder', sigs.includes('textbox:Buscar'), true);
t('heading con tag + norm', sigs.includes('h1:Tickets #'), true);
t('nav-link', sigs.includes('nav-link:Tickets'), true);

// dedup: dos botones que normalizan al mismo texto → una sola señal.
const dup = collectSignals(mockDoc({ button: [{ textContent: 'Pedido 112' }, { textContent: 'Pedido 999' }] }));
t('dedup tras normalizar', dup.filter((s) => s === 'button:Pedido #').length, 1);

// --- consistencia blob (print) vs función en proceso ------------------------------
process.stdout.write('[blob print]\n');
// Evalúa el blob inyectándole el document mock como `document` en su scope.
const evalBlob = (blob, document) => new Function('document', `return (${blob})();`)(document);
const fromBlob = evalBlob(browserBlob(), doc);
t('blob produce idéntico a collectSignals', eq(fromBlob, sigs), true);
// y que el CLI `print` emite ese mismo blob.
const { execFileSync } = await import('node:child_process');
const printed = execFileSync('node', [join(HERE, '..', 'scripts', 'page-signals.mjs'), 'print'], { encoding: 'utf8' }).trim();
t('CLI print == browserBlob()', printed, browserBlob());

// --- resumen ----------------------------------------------------------------------
process.stdout.write(`\npage-signals: ${pass} ok, ${fail} fallos\n`);
process.exit(fail === 0 ? 0 : 1);
