#!/usr/bin/env node
// host.mjs — normalización ÚNICA de "URL o host" → hostname canónico del store (tandem:map).
//
// El host entra en el path del store (sites/<host>.md, sites/<host>.fingerprints.json), así que
// un valor con '/', '..' o basura permitiría leer/escribir FUERA de sites/ (path traversal). Antes
// esta lógica vivía duplicada (y divergente) en recipe.mjs, fingerprint.mjs, hook-inject-profile.mjs
// y map.sh: solo una validaba el charset, otra rompía con esquemas en mayúscula. Aquí, una sola
// definición que normaliza y VALIDA. Lanza si el resultado no es un hostname plausible.
//
// Decisión deliberada: se descarta el PUERTO (un "sitio" se indexa por hostname, no host:port).
// Antes el comportamiento divergía —recipe/map lo conservaban, fingerprint reventaba con ':',
// el hook lo descartaba vía new URL()—; se unifica a descartarlo (y ':' rompería el nombre de
// fichero en macOS). Acepta una URL entera (con esquema) o un host pelado. IDN: una URL con host
// no-ASCII se normaliza a punycode (new URL); un host pelado no-ASCII se rechaza (pasa la URL).
// IPv6 literal NO se soporta como clave (':'/'[]' no van en nombre de fichero) → se rechaza.
//
// Uso como módulo:  import { normalizeHost } from './host.mjs'
// Uso CLI (map.sh): host.mjs <url-o-host>  → imprime el host, o exit 2 + error en stderr.

export function normalizeHost(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('host vacío');
  let host = raw.trim();
  if (/:\/\//.test(host)) {
    // Con esquema → URL entera. new URL().hostname ya viene limpio (sin esquema/puerto/path/
    // userinfo) y en minúsculas; no le apliques el strip manual o destrozarías casos válidos.
    try { host = new URL(host).hostname; } catch { /* malformado → cae a la validación, que lo rechaza */ }
  } else {
    // Host pelado: puede traer userinfo@ y/o :puerto. Corta en el primer ':' o '/'.
    host = host.replace(/^[^@]*@/, '').replace(/[:/].*$/, '');
  }
  host = host.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes('..') || host.startsWith('.') || host.endsWith('.')) {
    throw new Error(`host inválido tras normalizar: '${host}'`);
  }
  return host;
}

// --- CLI ----------------------------------------------------------------------------
import { fileURLToPath } from 'node:url';
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  try {
    process.stdout.write(normalizeHost(process.argv[2] ?? '') + '\n');
    process.exit(0);
  } catch (e) {
    process.stderr.write('host: ' + e.message + '\n');
    process.exit(2);
  }
}
