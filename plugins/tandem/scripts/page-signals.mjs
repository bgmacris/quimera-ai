#!/usr/bin/env node
// page-signals.mjs — FUENTE ÚNICA del fingerprint de página de tandem:map (T015).
//
// El "evaluate canónico" que extrae el ESQUELETO estructural de una página (roles, landmarks,
// botones, inputs, headings, nav-links) vivía como un snippet en prosa dentro de skills/map.
// Problema: ese algoritmo es CRÍTICO —cambiarlo invalida TODOS los fingerprints guardados
// (falso drift en todo)— pero su única fuente era markdown que se tecleaba a mano. Aquí pasa a
// ser código versionado y testeable, con una sola definición del algoritmo.
//
// Dos consumidores, una fuente:
//   - node (test): importa { norm, collectSignals } y los ejercita en proceso.
//   - browser: `page-signals.mjs print` emite un blob AUTO-CONTENIDO `() => [...]` listo para
//     pegar en browser_evaluate. El blob se SERIALIZA de estas mismas funciones (.toString()),
//     así que no puede divergir del código testeado.
//
// `norm`: normaliza una cadena para que counts/fechas/ids NO cuenten como drift —
// colapsa espacios, recorta, y reduce cada secuencia de dígitos a '#'
// ('Bandeja 112' y 'Bandeja 115' → 'Bandeja #'). Es la pieza que evita los falsos drifts.

export const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().replace(/\d+/g, '#').replace(/[\x00-\x1F\x7F]/g, '').slice(0, 120);

// collectSignals(document[, normFn]): set ORDENADO de señales estructurales de la página.
// normFn es parámetro (default: norm) para que el blob de browser pueda inyectar la norm
// serializada y la función quede de verdad auto-contenida.
export function collectSignals(document, normFn = norm) {
  const sig = new Set();
  document.querySelectorAll('[role]').forEach((e) => { const r = e.getAttribute('role'); if (r) sig.add('role:' + r); });
  ['header', 'nav', 'main', 'aside', 'footer', 'form'].forEach((t) => { if (document.querySelector(t)) sig.add('landmark:' + t); });
  document.querySelectorAll('button').forEach((b) => { const n = normFn(b.getAttribute('aria-label') || b.textContent); if (n) sig.add('button:' + n); });
  document.querySelectorAll('input,textarea').forEach((i) => { const n = normFn(i.getAttribute('placeholder') || i.getAttribute('aria-label') || ''); if (n) sig.add('textbox:' + n); });
  document.querySelectorAll('h1,h2,h3').forEach((h) => { const n = normFn(h.textContent); if (n) sig.add(h.tagName.toLowerCase() + ':' + n); });
  document.querySelectorAll('nav a,[role=navigation] a').forEach((a) => { const n = normFn(a.textContent); if (n) sig.add('nav-link:' + n); });
  return [...sig].sort();
}

// Blob auto-contenido para browser_evaluate. Inyecta la norm REAL (serializada) en el scope y
// llama a collectSignals con el document global del navegador. Una sola arrow, sin imports.
export function browserBlob() {
  return `() => {\n  const norm = ${norm.toString()};\n  const collectSignals = ${collectSignals.toString()};\n  return collectSignals(document, norm);\n}`;
}

// --- CLI: `page-signals.mjs print` -------------------------------------------------
import { fileURLToPath } from 'node:url';
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  if (process.argv[2] === 'print') {
    process.stdout.write(browserBlob() + '\n');
    process.exit(0);
  }
  process.stderr.write('uso: page-signals.mjs print   (emite el blob para browser_evaluate)\n');
  process.exit(2);
}
