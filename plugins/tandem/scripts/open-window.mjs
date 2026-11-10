#!/usr/bin/env node
// open-window.mjs <port> [--minimized] — the window /tandem:browser-start opens for the human, without taking the
// focus: a new window in the background, minimized with --minimized. Prints the page's target id (for STARTUP_PAGE).
// Used by ensure_human_window (lib.sh) when TANDEM_START_WINDOW=background|minimized. Contributed by David, measured
// on Linux Mint X11 (Cinnamon/Muffin): with it the window stays Iconic/_NET_WM_STATE_HIDDEN and the active window does
// not change; with PUT /json/new Chrome sometimes took the focus.
import { browserWsUrl, connect } from './cdp.mjs';

const [port, flag] = process.argv.slice(2);
const cdp = await connect(await browserWsUrl(Number(port), 5000), { timeoutMs: 5000 });
try {
  const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank', newWindow: true, background: true });
  if (flag === '--minimized') {
    try {
      const { windowId } = await cdp.call('Browser.getWindowForTarget', { targetId });
      await cdp.call('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    } catch (e) { process.stderr.write(`tandem: could not minimize the window (${e.message})\n`); }
  }
  process.stdout.write(`${targetId}\n`);
} finally { cdp.close(); }
