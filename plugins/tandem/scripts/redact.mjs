// redact.mjs — credential-bearing HTTP headers, redacted in the intercept LOG by default
// (the log outlives the capture). `cdp-intercept.mjs start --reveal` keeps them in clear —
// for when replaying the auth context is the point. Separate module: testable without a CLI.

const SENSITIVE_HEADERS = /^(authorization|proxy-authorization|cookie|set-cookie|x-csrf-token|x-xsrf-token|x-api-key|x-auth-token)$/i;

export function redactHeaders(headers) {
  if (!headers) return headers;
  return Object.fromEntries(Object.entries(headers).map(
    ([k, v]) => [k, SENSITIVE_HEADERS.test(k) ? `[redacted ${String(v).length}b]` : v],
  ));
}
