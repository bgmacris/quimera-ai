# tandem upstream pin

| Field | Value |
|-------|-------|
| Repository | https://github.com/bgmacris/quimera-ai |
| Branch | `main` |
| Commit | `482925a7449ee12c86da0edae53b80ee807f7b17` |
| Date | fix(tandem): code review + privacy cleanup (post-publish) |

## Golden rule

**Never edit upstream core directly:**

- `scripts/`, `bin/`, `skills/`, `hooks/hooks.json`, `commands/`, `agents/`, `docs/`, `examples/`
- `.claude-plugin/`, `.mcp.json`

Fork-specific changes live only in:

- `adapters/` (Cursor + OpenCode + shared)
- `install.sh`
- `UPSTREAM.md`, `README.adapters.md`

## Sync from upstream

```bash
git remote add upstream https://github.com/bgmacris/quimera-ai.git  # once
git fetch upstream
git merge upstream/main   # resolve conflicts only in core; keep adapters/
# Update this file with the new commit SHA
./install.sh              # refresh local symlinks + tandem-env.sh
```

## After sync

1. Run upstream tests: `tests/smoke.sh` (from `plugins/tandem/`)
2. Re-run `./install.sh`
3. Smoke: `/tandem:browser-start` (Cursor) or `/browser-start` (OpenCode)
