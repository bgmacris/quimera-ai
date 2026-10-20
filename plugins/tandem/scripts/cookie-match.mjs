// cookie-match.mjs — `--domain` filter of cdp-cookies (separate module: testable without a CLI).

// Label-boundary domain match (cookie domains may carry a leading dot).
export function domainMatches(cookieDomain, filter) {
  const d = cookieDomain.toLowerCase().replace(/^\./, '');
  const f = filter.toLowerCase().replace(/^\./, '');
  if (/^[\d.]+$/.test(d) || /^[\d.]+$/.test(f)) return d === f;   // IP literals: exact only ("0.0.1" ≠ "127.0.0.1")
  return d === f || d.endsWith('.' + f);
}
