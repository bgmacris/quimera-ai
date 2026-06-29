---
description: "HTTP sniffer for tandem's Chrome via CDP: captures request+response bodies (including HttpOnly, CSRF tokens, private APIs). Subcommands: start, show, clear, count."
allowed-tools: Bash(tandem-intercept *)
---
tandem HTTP sniffer (CDP):

!`tandem-intercept $ARGUMENTS`

**Typical pentest flow:**
1. `/tandem:intercept start` — start capturing (Ctrl-C to stop, or `--duration <s>`)
2. Navigate / interact with the app in the shared Chrome
3. `/tandem:intercept show --body` — show all with bodies
4. `/tandem:intercept show --url /api/ --status 2xx --body` — filter by path and status
5. `/tandem:intercept clear` — clear the log when done

⚠ The log may contain credentials and tokens — clear when done.
