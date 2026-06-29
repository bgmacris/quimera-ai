# quimera

[![CI](https://github.com/bgmacris/quimera/actions/workflows/ci.yml/badge.svg)](https://github.com/bgmacris/quimera/actions/workflows/ci.yml)

A [Claude Code](https://code.claude.com) plugin marketplace by [bgmacris](https://github.com/bgmacris).

One plugin today — **[tandem](plugins/tandem)**: a Chrome browser **shared in real time** between you
and Claude Code. You drive it with the mouse and clear the captchas/logins; Claude operates it over
CDP and **learns how each site is navigated**, then acts by durable selectors instead of
re-snapshotting the page — a site profile is **~16–30× smaller than one page snapshot** (measured
with `wc -c`). The human-in-the-loop handoff is the point: the walls you clear, Claude continues past.

## Install

```
/plugin marketplace add bgmacris/quimera
/plugin install tandem@quimera
```

## Plugins

| Plugin | What it does |
|---|---|
| **[tandem](plugins/tandem)** | Shared human+Claude Chrome (CDP + Playwright MCP) with per-site navigation memory: human–AI handoff past captchas/logins, frugal navigation by durable `sel:` locators, recon and reverse-engineering of site logic. Full docs in [`plugins/tandem`](plugins/tandem). |

## Adding a plugin

Each plugin lives under [`plugins/<name>`](plugins) with its own `.claude-plugin/plugin.json`; register
it with one entry in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json).
