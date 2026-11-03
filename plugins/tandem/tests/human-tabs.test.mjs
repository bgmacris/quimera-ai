#!/usr/bin/env node
// human-tabs.test.mjs — chooseHumanTab (human-tabs.mjs): which of the human's tabs an agent may adopt.
// Rule decided 2026-11-03 (R05 §16): only one the human brought into view. Usage: node tests/human-tabs.test.mjs
import { chooseHumanTab } from '../scripts/human-tabs.mjs';

let pass = 0; let fail = 0;
const ok = (desc, cond) => { if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); } else { fail++; process.stdout.write(`  ✗ ${desc}\n`); } };
const tab = (id, url, visible, focused = false) => ({ id, url, title: id, visible, focused });
const bank = tab('bank', 'https://bank.example/account', false);
const mail = tab('mail', 'https://mail.example/inbox', true);
const docs = tab('docs', 'https://docs.example/d/1', true);

ok('one tab in view → that one', chooseHumanTab([bank, mail]).tab?.id === 'mail');
ok('none in view → no adoption, says to bring it to the front', !chooseHumanTab([bank]).tab && /bring/.test(chooseHumanTab([bank]).error));
ok('a hidden tab is never taken, even named by url', !chooseHumanTab([bank, mail], { url: 'bank.example' }).tab && /not in view/.test(chooseHumanTab([bank, mail], { url: 'bank.example' }).error));
const two = chooseHumanTab([mail, docs]);
ok('two in view, none focused → no adoption, both listed', !two.tab && two.list.length === 2 && /pass `url`/.test(two.error));
ok('two in view, one focused (Chrome in front) → the focused one', chooseHumanTab([mail, { ...docs, focused: true }]).tab?.id === 'docs');
ok('two in view, url picks one of them', chooseHumanTab([mail, docs], { url: 'docs.example' }).tab?.id === 'docs');
ok('url matching two visible → no adoption', !chooseHumanTab([mail, tab('mail2', 'https://mail.example/sent', true)], { url: 'mail.example' }).tab);
ok('url matching nothing → no adoption, the visible ones listed', (() => { const r = chooseHumanTab([mail, docs], { url: 'zzz' }); return !r.tab && r.list.length === 2; })());
ok('the listing never includes hidden tabs', chooseHumanTab([bank, mail, docs]).list.every((t) => t.url !== bank.url));
console.log(`\nhuman-tabs: ${pass} ok, ${fail} failures`);
process.exit(fail ? 1 : 0);
