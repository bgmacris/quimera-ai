#!/usr/bin/env node
// host.test.mjs — tests de la normalización ÚNICA de host (scripts/host.mjs).
// Sin dependencias: mini-runner. host.mjs es la fuente única que usan recipe/fingerprint/hook/map
// para convertir "URL o host" → clave del store; un fallo aquí = path traversal o clave divergente.
// Cubre: URLs y hosts pelados, esquema en MAYÚSCULA (bug arreglado), userinfo/puerto, IDN→punycode,
// y —lo crítico— que todo lo hostil (traversal, vacío, no-ASCII, IPv6) se RECHACE.
// Uso: node tests/host.test.mjs   (exit 0 = verde).

import { normalizeHost } from '../scripts/host.mjs';

let pass = 0; let fail = 0;
function t(desc, got, want) {
  if (got === want) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}\n`); }
}
function ok(desc, cond) {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}\n`); }
}
function rejects(desc, input) {
  let threw = false;
  try { normalizeHost(input); } catch { threw = true; }
  ok(desc, threw);
}

// --- hosts y URLs válidos ----------------------------------------------------------
process.stdout.write('[válidos]\n');
t('host pelado intacto', normalizeHost('books.toscrape.com'), 'books.toscrape.com');
t('URL entera → host', normalizeHost('https://books.toscrape.com/cat/page-1.html'), 'books.toscrape.com');
t('esquema en MAYÚSCULA + host mixto (bug arreglado)', normalizeHost('HTTPS://Foo.COM/x'), 'foo.com');
t('userinfo y puerto descartados', normalizeHost('http://user:pass@example.es:8443/path'), 'example.es');
t('host:puerto pelado → sin puerto', normalizeHost('foo.com:8080'), 'foo.com');
t('host pelado con path', normalizeHost('example.com/foo/bar'), 'example.com');
t('subdominios conservados', normalizeHost('https://a.b.c.example.org/'), 'a.b.c.example.org');
t('IDN en URL → punycode', normalizeHost('https://café.com'), 'xn--caf-dma.com');
t('ya en minúsculas e idempotente', normalizeHost(normalizeHost('https://X.EXAMPLE.com')), 'x.example.com');

// --- hostiles: deben lanzar (sin esto, path traversal o clave basura) ---------------
process.stdout.write('[rechazos]\n');
rejects('traversal con barras', '../../etc/passwd');
rejects('solo dos puntos', '..');
rejects('cadena vacía', '');
rejects('solo espacios', '   ');
rejects('espacios internos', 'a b');
rejects('host pelado no-ASCII (sin esquema que lo punycodee)', 'café.com');
rejects('IPv6 literal (no es clave de fichero)', 'https://[::1]:9222');
rejects('no-string (number)', 123);
rejects('no-string (null)', null);

// --- invariante de seguridad: nada de lo que SALE puede traversar -------------------
process.stdout.write('[invariante]\n');
const validos = [
  'books.toscrape.com', 'https://a.b.c.example.org/x?y=1', 'HTTP://Z.com:99/p',
  'http://u@host.io/path', 'sub.dominio.es',
];
let seguro = true;
for (const v of validos) {
  const h = normalizeHost(v);
  if (h.includes('/') || h.includes('..') || h !== h.toLowerCase() || !/^[a-z0-9.-]+$/.test(h)) seguro = false;
}
ok('invariante: toda salida válida es [a-z0-9.-], sin / ni ..', seguro);

// --- resumen ----------------------------------------------------------------------
process.stdout.write(`\nhost: ${pass} ok, ${fail} fallos\n`);
process.exit(fail === 0 ? 0 : 1);
