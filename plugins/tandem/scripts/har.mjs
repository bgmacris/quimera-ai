// har.mjs — CDP Network events → HAR 1.2 (pure, testable without Chrome).
//
// Consumed by cdp-record.mjs. The fidelity details matter to a network-trace evaluator such as
// WebArena-Verified's NetworkEventEvaluator, which reads request.url/method/headers (referer,
// accept, sec-fetch-*), request.postData, response.status/redirectURL/headers/cookies/content:
//  - every REDIRECT hop is its own entry (status 3xx + redirectURL), not folded into the final URL
//    — a form POST → 302 → GET is exactly what "mutate" tasks are scored on;
//  - request headers come from requestWillBeSentExtraInfo when present (the headers Chrome really
//    sent, incl. sec-fetch-* and cookie), falling back to requestWillBeSent's;
//  - response cookies are parsed from the raw Set-Cookie of responseReceivedExtraInfo.

import { redactHeaders } from './redact.mjs';

const toList = (obj) => Object.entries(obj || {}).flatMap(([name, v]) =>
  String(v).split('\n').map((value) => ({ name, value })));

function queryString(url) {
  try { return [...new URL(url).searchParams].map(([name, value]) => ({ name, value })); } catch { return []; }
}

export function parseSetCookie(headers) {
  const raw = Object.entries(headers || {}).find(([k]) => k.toLowerCase() === 'set-cookie')?.[1];
  if (!raw) return [];
  return String(raw).split('\n').map((line) => {
    const [pair] = line.split(';'); const i = pair.indexOf('=');
    return i < 0 ? null : { name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim() };
  }).filter(Boolean);
}

// One in-flight request (one hop). Mutated by the recorder as events arrive.
export function newEntry({ request, wallTime, type }) {
  return {
    started: new Date((wallTime || Date.now() / 1000) * 1000).toISOString(),
    type: type || null,
    method: request.method, url: request.url,
    reqHeaders: request.headers || {}, extraReqHeaders: null,
    postData: request.postData ?? null, hasPostData: !!request.hasPostData,
    status: 0, statusText: '', resHeaders: {}, extraResHeaders: null, mimeType: '',
    redirectURL: '', body: null,
  };
}

export function applyResponse(entry, response) {
  entry.status = response.status; entry.statusText = response.statusText || '';
  entry.resHeaders = response.headers || {}; entry.mimeType = response.mimeType || '';
}

// HAR entry from an in-flight record. reveal=false redacts credential headers (Authorization,
// Cookie, Set-Cookie, CSRF…) — response.cookies keep their NAMES with redacted values.
export function toHarEntry(e, { reveal = false } = {}) {
  const reqH = e.extraReqHeaders || e.reqHeaders;
  const resH = e.extraResHeaders || e.resHeaders;
  const cookies = parseSetCookie(resH).map((c) => (reveal ? c : { name: c.name, value: '[redacted]' }));
  const reqMime = Object.entries(reqH).find(([k]) => k.toLowerCase() === 'content-type')?.[1] || '';
  const out = {
    startedDateTime: e.started, time: 0,
    request: {
      method: e.method, url: e.url, httpVersion: 'HTTP/1.1',
      headers: toList(reveal ? reqH : redactHeaders(reqH)),
      queryString: queryString(e.url), cookies: [], headersSize: -1, bodySize: -1,
    },
    response: {
      status: e.status, statusText: e.statusText, httpVersion: 'HTTP/1.1',
      headers: toList(reveal ? resH : redactHeaders(resH)), cookies,
      content: { size: e.body?.length ?? 0, mimeType: e.mimeType, ...(e.body != null ? { text: e.body } : {}) },
      redirectURL: e.redirectURL, headersSize: -1, bodySize: -1,
    },
    cache: {}, timings: { send: 0, wait: 0, receive: 0 },
  };
  if (e.postData != null) out.request.postData = { mimeType: reqMime, text: e.postData };
  if (e.type) out._resourceType = e.type.toLowerCase();
  return out;
}

export function toHar(entries) {
  return { log: { version: '1.2', creator: { name: 'tandem cdp-record', version: '1' }, pages: [], entries } };
}

// Bodies worth fetching: what an evaluator can parse (JSON / form), capped. HTML and assets are
// skipped — large, and a navigation evaluator reads URLs/headers, not page text.
export const BODY_CAP = 256 * 1024;
export function wantsBody(e) {
  return /json|x-www-form-urlencoded/i.test(e.mimeType) && !['Image', 'Stylesheet', 'Script', 'Font', 'Media'].includes(e.type);
}
