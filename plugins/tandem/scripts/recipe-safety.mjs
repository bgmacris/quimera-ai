// recipe-safety.mjs — red de seguridad sobre el código compilado (tandem:map).
//
// `browser_run_code_unsafe` es RCE-equivalent. Esta es la última red: inspecciona el ESQUELETO
// del código generado (con el contenido de los strings vaciado, porque ahí viven los valores de
// usuario ya inertes por JSON.stringify) contra una allowlist estricta. Rechaza template strings,
// tokens estructurales peligrosos y cualquier `page.<método>` fuera de los permitidos.

export function assertCompiledSafe(code) {
  // Quita el CONTENIDO de los string literals (ahí viven los valores de usuario, ya inertes por
  // JSON.stringify) para no dar falsos positivos si un valor contiene p.ej. "require".
  const skeleton = code.replace(/"(\\.|[^"\\])*"/g, '""').replace(/'(\\.|[^'\\])*'/g, "''");
  if (/`|\$\{/.test(skeleton)) throw new Error('código compilado: template strings no permitidos');
  if (/\b(require|process|import|eval|Function|fetch|globalThis|child_process|module|constructor|while|for|XMLHttpRequest)\b/.test(skeleton)) {
    throw new Error('código compilado: token estructural no permitido (posible inyección)');
  }
  const calls = [...skeleton.matchAll(/page\.([A-Za-z]+)/g)].map((m) => m[1]);
  const okCalls = new Set(['goto', 'locator', 'waitForURL', 'url']);
  for (const c of calls) if (!okCalls.has(c)) throw new Error(`código compilado: page.${c} no permitido`);
  return true;
}
