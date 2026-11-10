#!/usr/bin/env node
// tab-groups.test.mjs — the pure parts of scripts/tab-groups.mjs (no Chrome). The groups themselves: groups-e2e.mjs.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const { EXTENSION_DIR, groupTitle, groupsEnabled, sessionColor } = await import('../scripts/tab-groups.mjs');

let pass = 0; let fail = 0;
const ok = (desc, cond) => { if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); } else { fail++; process.stdout.write(`  ✗ ${desc}\n`); } };

const COLORS = ['blue', 'purple', 'cyan', 'green', 'orange', 'pink', 'yellow', 'red'];
ok('session color: one of Chrome\'s group colors', COLORS.includes(sessionColor('12345')));
ok('session color: stable for a seed', sessionColor('abc') === sessionColor('abc'));
ok('session color: seeds spread over several colors', new Set(Array.from({ length: 40 }, (_, i) => sessionColor(String(1000 + i)))).size >= 5);
ok('title: main → "main · project"', groupTitle('main', 'quimera') === 'main · quimera');
ok('title: subagent → "sub <4 chars> · project"', groupTitle('a1b2c3d4e5', 'quimera') === 'sub a1b2 · quimera');
ok('title: no project → no separator', groupTitle('main', '') === 'main');
ok('on by default', groupsEnabled({}) === true);
ok('TANDEM_AGENT_GROUPS=0 → off', groupsEnabled({ TANDEM_AGENT_GROUPS: '0' }) === false);
ok('external browser (the user\'s own Chrome) → off', groupsEnabled({ TANDEM_BROWSER: 'external' }) === false);
const manifest = JSON.parse(readFileSync(join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
ok('extension: MV3 with its worker present', manifest.manifest_version === 3 && existsSync(join(EXTENSION_DIR, manifest.background.service_worker)));
ok('extension: only tabs, tabGroups, debugger — no host permissions', JSON.stringify([...manifest.permissions].sort()) === '["debugger","tabGroups","tabs"]' && !manifest.host_permissions && !manifest.content_scripts);
const pj = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
ok('extension version = plugin version', manifest.version === pj.version);

console.log(`\nresult: ${pass} ok, ${fail} failures`);
process.exit(fail ? 1 : 0);
