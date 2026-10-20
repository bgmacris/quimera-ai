---
description: "HTTP sniffer for tandem's Chrome via CDP, all tabs: captures request+response bodies (private APIs, CSRF tokens). Subcommands: start (background), stop, status, show, clear, count."
allowed-tools: Bash(tandem-intercept *)
---
tandem HTTP sniffer (CDP):

!`tandem-intercept $ARGUMENTS`

**Typical pentest flow:**
1. `/tandem:intercept start` — capture ALL tabs in the background (returns at once; `--duration <s>` to auto-stop)
2. Navigate / interact with the app in the shared Chrome
3. `/tandem:intercept stop`
4. `/tandem:intercept show --url /api/ --status 2xx --body` — filter by path and status
5. `/tandem:intercept clear` — clear the log when done

⚠ Credential headers (Authorization, Cookie, Set-Cookie, CSRF) are redacted in the log unless
`start --reveal`; bodies are kept. The log is 0600 — clear it when done.
