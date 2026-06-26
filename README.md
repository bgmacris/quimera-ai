# quimera

Marketplace de plugins de [Claude Code](https://code.claude.com) de [bgmacris](https://github.com/bgmacris).

## Uso

```
/plugin marketplace add bgmacris/quimera
/plugin install <plugin>@quimera
```

## Plugins

| Plugin | Descripción |
|---|---|
| **tandem** | Navegador Chrome compartido humano+Claude (CDP + Playwright MCP) con memoria de navegación por-sitio: supera muros anti-bot con reparto humano-IA, automatiza tests y extrae lógica de webs. Ver [`plugins/tandem`](plugins/tandem). |

Cada plugin vive en su subcarpeta de [`plugins/`](plugins). Para añadir uno nuevo: una carpeta en
`plugins/<nombre>` con su `.claude-plugin/plugin.json` y una entrada más en `.claude-plugin/marketplace.json`.
