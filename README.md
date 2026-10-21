# quimera-ai

[![CI](https://github.com/bgmacris/quimera-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/bgmacris/quimera-ai/actions/workflows/ci.yml)

A [Claude Code](https://code.claude.com) plugin marketplace by [bgmacris](https://github.com/bgmacris).

One plugin today — **[tandem](plugins/tandem)**: a Chrome browser **shared in real time** between you
and Claude Code. You drive it with the mouse and clear the captchas, logins and certificates; Claude
operates it over CDP and continues past the walls you clear. It also keeps a **human-readable memory of
each site** (routes, locators, recipes, gotchas) that you co-curate. The handoff is the point; the
memory makes the next visit start from what was learned (measured: it reads less of each page, it does
not make tasks cheaper — see the plugin README).

## Install

```
/plugin marketplace add bgmacris/quimera-ai
/plugin install tandem@quimera-ai
```

## Plugins

| Plugin | What it does |
|---|---|
| **[tandem](plugins/tandem)** | Shared human+Claude Chrome (CDP + Playwright MCP) with per-site navigation memory: human–AI handoff past captchas/logins, co-curated site memory (routes, locators, recipes), recon and reverse-engineering of site logic. Full docs in [`plugins/tandem`](plugins/tandem). |

## Adding a plugin

Each plugin lives under [`plugins/<name>`](plugins) with its own `.claude-plugin/plugin.json`; register
it with one entry in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json).
