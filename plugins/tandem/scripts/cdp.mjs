// cdp.mjs — minimal CDP client shared by tandem's direct-CDP tools (no deps, Node 22+).
//
// Native WebSocket + fetch. One connection multiplexes several targets via flattened sessions
// (Target.setAutoAttach {flatten:true}): every call/event carries an optional sessionId. This is
// what lets a tool watch ALL tabs without colliding with Playwright's own connection — a direct WS
// to a page target that Playwright already holds fails; the browser endpoint does not.
//
// Every connect and call has a timeout: a wedged Chrome must not hang a slash command forever.

import { cdpPort } from './paths.mjs';

export const DEFAULT_TIMEOUT_MS = 10_000;

export async function browserWsUrl(port = cdpPort(), timeoutMs = DEFAULT_TIMEOUT_MS) {
  const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
  const { webSocketDebuggerUrl } = await r.json();
  if (!webSocketDebuggerUrl) throw new Error('no browser webSocketDebuggerUrl');
  return webSocketDebuggerUrl;
}

export async function listPages(port = cdpPort(), timeoutMs = DEFAULT_TIMEOUT_MS) {
  const r = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(timeoutMs) });
  return (await r.json()).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
}

export function connect(wsUrl, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error(`CDP connect timeout (${timeoutMs} ms)`)); }, timeoutMs);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(new CdpClient(ws, timeoutMs)); });
    ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error(String(e.message || 'CDP websocket error'))); });
  });
}

export class CdpClient {
  constructor(ws, timeoutMs) {
    this.ws = ws; this.timeoutMs = timeoutMs; this.nextId = 0;
    this.pending = new Map(); this.handlers = new Map(); this.closeHandlers = [];
    ws.addEventListener('message', ({ data }) => this.#dispatch(data));
    ws.addEventListener('close', () => {
      for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error('CDP connection closed')); }
      this.pending.clear();
      for (const h of this.closeHandlers) h();
    });
  }

  #dispatch(data) {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id); if (!p) return;
      this.pending.delete(msg.id); clearTimeout(p.timer);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    } else if (msg.method) {
      for (const h of this.handlers.get(msg.method) || []) h(msg.params || {}, msg.sessionId);
    }
  }

  call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timeout`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  // handler(params, sessionId). Several handlers per event are allowed.
  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }

  onClose(handler) { this.closeHandlers.push(handler); }

  close() { try { this.ws.close(); } catch { /* already closed */ } }
}
