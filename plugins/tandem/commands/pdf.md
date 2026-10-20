---
description: "Captures the tab you are looking at in tandem's Chrome as a PDF (default) or a full-page PNG (--png). Saves to ~/.claude/tandem/output/."
allowed-tools: Bash(tandem-pdf *)
---
Capturing the current page from tandem's Chrome:

!`tandem-pdf $ARGUMENTS`

Output indicates format and path: `pdf:/path/...` or `png:/path/...`.

Options: `--png` full-page screenshot (your window is not resized) · `--output <path>` · `--tab <n>`
(default: the visible, focused tab) · `--landscape` · `--no-bg`.
