// is-main.mjs — "was this module run directly?" Node resolves symlinks for the entry module
// (import.meta.url is the REAL path) but process.argv[1] keeps the path as typed: comparing the two raw
// made a script launched through a symlinked dir (/tmp on macOS, a linked ~/dev, Cursor's plugin link)
// silently do nothing — the MCP launcher exited 0 and the tools vanished.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMain(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  let p = argv1;
  try { p = realpathSync(argv1); } catch { /* keep as typed */ }
  return fileURLToPath(metaUrl) === p;
}
