---
description: Starts tandem's shared Chrome browser (dedicated profile, CDP on loopback).
allowed-tools: Bash(tandem-browser *)
---
Starting tandem's shared browser:

!`tandem-browser start`

If you see "Chrome ready", the window is available: you control it with the mouse and Claude operates it via CDP. If it fails, check status with `/tandem:browser-status`.

Note: if you had just stopped a previous browser, the **first** browser command may report
`Target page … has been closed` once — that is the (persistent) MCP reconnecting to the new
(ephemeral) Chrome, not an error in your setup. Just retry; the second command works.
