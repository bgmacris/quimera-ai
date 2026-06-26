---
description: "Sniffer HTTP del Chrome de tandem via CDP: captura request+response bodies (incluyendo HttpOnly, CSRF tokens, APIs privadas). Subcomandos: start, show, clear, count."
allowed-tools: Bash(tandem-intercept *)
---
Sniffer HTTP tandem (CDP):

!`tandem-intercept $ARGUMENTS`

**Flujo típico de pentest:**
1. `/tandem:intercept start` — empieza a capturar (Ctrl-C para parar, o `--duration <s>`)
2. Navega / interactúa con la app en el Chrome compartido
3. `/tandem:intercept show --body` — muestra todo con bodies
4. `/tandem:intercept show --url /api/ --status 2xx --body` — filtra por ruta y status
5. `/tandem:intercept clear` — borra el log al terminar

⚠ El log puede contener credenciales y tokens — borra cuando termines.
