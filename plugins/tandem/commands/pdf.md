---
description: "Captures the current page in tandem's Chrome as a PDF (if headless Chrome) or full-page PNG screenshot (in normal tandem mode). Saves to ~/.claude/tandem/output/."
allowed-tools: Bash(tandem-pdf *)
---
Capturing current page from tandem's Chrome:

!`tandem-pdf $ARGUMENTS`

Output indicates format and path: `pdf:/path/...` or `png:/path/...`.

Options: `--output <path>` explicit path · `--tab <n>` tab index · `--landscape` · `--png-only` skip PDF attempt.
