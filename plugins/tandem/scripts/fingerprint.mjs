#!/usr/bin/env node
// fingerprint.mjs — detección de DRIFT estructural por ruta (tandem:map, T015).
//
// Staleness por SEÑAL, no por fecha de calendario: en vez de fiarte de cuán viejo es el
// tag [verificado], comparas el ESQUELETO estructural de la página (roles/controles/headings)
// contra el que guardaste. Si cambió → los locators de esa ruta en el perfil son sospechosos.
//
// Por qué el esqueleto y no la página entera: queremos drift de ESTRUCTURA, no de datos.
// El agente extrae las señales con un browser_evaluate canónico (ver skills/map/SKILL.md) que
// normaliza dígitos a '#' (así "Bandeja 112"→"115" NO cuenta como drift) y excluye filas de
// datos. Aquí solo se almacena/compara el set.
//
// Uso (el agente pasa el array de señales JSON por stdin):
//   echo '<json array de strings>' | fingerprint.mjs capture <host> <route-key>
//   echo '<json array de strings>' | fingerprint.mjs check   <host> <route-key>
//
// capture: guarda/actualiza el set de la ruta en sites/<host>.fingerprints.json.
// check:   compara stdin contra lo guardado; emite {status, added[], removed[]} por stdout.
//          status = new (no había) | match (igual) | drift (cambió).

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { normalizeHost } from './host.mjs';

const dataDir = process.env.TANDEM_DATA_DIR || join(homedir(), '.claude', 'tandem');
const sitesDir = join(dataDir, 'sites');

const [, , mode, rawHost, routeKey] = process.argv;
if (!mode || !rawHost || !routeKey || !['capture', 'check'].includes(mode)) {
  process.stderr.write('uso: fingerprint.mjs {capture|check} <host> <route-key>  (señales JSON por stdin)\n');
  process.exit(2);
}

// Normaliza y valida el host con la fuente única (host.mjs): entra en el path del store, sin
// validar permitiría path traversal. normalizeHost lanza si no es un hostname plausible.
let host;
try { host = normalizeHost(rawHost); } catch (e) {
  process.stderr.write(`fingerprint: ${e.message}\n`);
  process.exit(2);
}

function readStdinJson() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { /* vacío */ }
  let arr;
  try { arr = JSON.parse(raw); } catch {
    process.stderr.write('fingerprint: stdin no es JSON válido\n');
    process.exit(2);
  }
  if (!Array.isArray(arr)) {
    process.stderr.write('fingerprint: stdin debe ser un array de strings\n');
    process.exit(2);
  }
  // normaliza: strings, únicos, ordenados (estable)
  return [...new Set(arr.map((s) => String(s)))].sort();
}

const fpPath = join(sitesDir, `${host}.fingerprints.json`);
function loadStore() {
  if (!existsSync(fpPath)) return {};
  try { return JSON.parse(readFileSync(fpPath, 'utf8')); } catch { return {}; }
}
function saveStore(obj) {
  mkdirSync(sitesDir, { recursive: true });
  const tmp = fpPath + '.tmp';
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, fpPath);
}

const signals = readStdinJson();
const today = new Date().toISOString().slice(0, 10);

if (mode === 'capture') {
  const store = loadStore();
  store[routeKey] = { captured: today, count: signals.length, signals };
  saveStore(store);
  process.stdout.write(JSON.stringify({ status: 'captured', routeKey, count: signals.length }) + '\n');
  process.exit(0);
}

// mode === 'check'
const store = loadStore();
const prev = store[routeKey];
if (!prev) {
  process.stdout.write(JSON.stringify({ status: 'new', routeKey, hint: 'no hay fingerprint guardado; usa capture' }) + '\n');
  process.exit(0);
}
const prevSet = new Set(prev.signals);
const nowSet = new Set(signals);
const added = signals.filter((s) => !prevSet.has(s));
const removed = prev.signals.filter((s) => !nowSet.has(s));
const status = added.length === 0 && removed.length === 0 ? 'match' : 'drift';
process.stdout.write(JSON.stringify({
  status, routeKey, captured: prev.captured,
  prevCount: prev.count, nowCount: signals.length,
  added, removed,
}, null, 2) + '\n');
process.exit(status === 'drift' ? 1 : 0);
