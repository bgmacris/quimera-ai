# quimera

A [Claude Code](https://code.claude.com) plugin marketplace by [bgmacris](https://github.com/bgmacris).

## Usage

```
/plugin marketplace add bgmacris/quimera
/plugin install <plugin>@quimera
```

## Plugins

| Plugin | Description |
|---|---|
| **tandem** | A shared Chrome browser (human + Claude) over CDP + Playwright MCP, with per-site navigation memory: clears anti-bot walls through human-AI handoff, automates tests, and reverse-engineers site logic. See [`plugins/tandem`](plugins/tandem). |

Each plugin lives in its own subfolder under [`plugins/`](plugins). To add a new one: a folder at
`plugins/<name>` with its `.claude-plugin/plugin.json`, plus one more entry in `.claude-plugin/marketplace.json`.
