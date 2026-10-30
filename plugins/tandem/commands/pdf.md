---
description: "Captures the tab you are looking at in tandem's Chrome as a PDF (default) or a full-page PNG (--png); a tab that shows a PDF is saved as the original document. Saves to ~/.claude/tandem/output/."
allowed-tools: Bash(tandem-pdf *)
---
Capturing the current page from tandem's Chrome:

!`tandem-pdf $ARGUMENTS`

Output indicates format and path: `pdf:/path/...`, `png:/path/...`, or `pdf-source:/path/...` when the tab
shows a PDF (the original document, not a print of Chrome's viewer).

Options: `--png` full-page screenshot (your window is not resized) · `--output <path>` · `--tab <n>` or
`--url <url>` (default: the visible, focused tab) · `--landscape` · `--no-bg` · `--text` (PDF tab: also a
`pdftotext -layout` copy, `text:/path/...`).
