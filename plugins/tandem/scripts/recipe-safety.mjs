// recipe-safety.mjs — safety net over compiled code (tandem:map).
//
// `browser_run_code_unsafe` is RCE-equivalent. This is the last net: it inspects the SKELETON
// of the generated code (with string content blanked out, because that's where user values live
// already inert via JSON.stringify) against a strict allowlist. Rejects template strings,
// dangerous structural tokens, and any `page.<method>` outside the permitted set.

export function assertCompiledSafe(code) {
  // Strip the CONTENT of string literals (that's where user values live, already inert via
  // JSON.stringify) to avoid false positives if a value contains e.g. "require".
  const skeleton = code.replace(/"(\\.|[^"\\])*"/g, '""').replace(/'(\\.|[^'\\])*'/g, "''");
  if (/`|\$\{/.test(skeleton)) throw new Error('compiled code: template strings not allowed');
  if (/\b(require|process|import|eval|Function|fetch|globalThis|child_process|module|constructor|while|for|XMLHttpRequest)\b/.test(skeleton)) {
    throw new Error('compiled code: structural token not allowed (possible injection)');
  }
  const calls = [...skeleton.matchAll(/page\.([A-Za-z]+)/g)].map((m) => m[1]);
  const okCalls = new Set(['goto', 'locator', 'waitForURL', 'url']);
  for (const c of calls) if (!okCalls.has(c)) throw new Error(`compiled code: page.${c} not allowed`);
  return true;
}
