---
description: "Captura la página actual del Chrome de tandem como PDF (si Chrome headless) o screenshot PNG full-page (en modo normal tandem). Guarda en ~/.claude/tandem/output/."
allowed-tools: Bash(tandem-pdf *)
---
Capturando página actual del Chrome de tandem:

!`tandem-pdf $ARGUMENTS`

La salida indica el formato y ruta: `pdf:/ruta/...` o `png:/ruta/...`.

Opciones: `--output <ruta>` ruta explícita · `--tab <n>` índice del tab · `--landscape` · `--png-only` salta intento PDF.
