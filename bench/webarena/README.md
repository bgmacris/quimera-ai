# tandem benchmark — WebArena-Verified

Measures what tandem's README only claimed in bytes: **does site memory raise task success, and at
what cost?** Scored by [WebArena-Verified](https://github.com/ServiceNow/webarena-verified)'s
deterministic evaluator (no LLM judge), which reads each task's `agent_response.json` + `network.har`.

Why WebArena-Verified: it is framework-agnostic (*"any tool with network traces"*), and one site has
many instances of the same task template — Shopping Admin: 182 tasks from 41 templates. Same template
= same procedure with other parameters = a tandem recipe. That lets us see memory amortize: instance 1
cold, instances 2..K with the profile learned on instance 1.

## Arms

| Arm | Observation | Memory |
|---|---|---|
| A | `browser_snapshot` (`browser_find` disabled) | none |
| B | `browser_find` first, snapshot when needed | none |
| C | as B + site profile (`sel:` locators) in the system prompt | profile written by the agent after each task |
| D | as C + recipes (`browser_run_code_unsafe` allowed) | profile + recipes |

Everything an arm changes is in `arms.mjs`. Same model, same MCP (tandem's launcher), same task text.

## Isolation (verified)

Each task is one `claude -p` with `--restricted` (no Bash/code tools, user/project settings ignored —
a differential check showed the user's `CLAUDE.md` is NOT loaded under `--restricted` and IS loaded
without it), `--strict-mcp-config` with only tandem's MCP, `--tools Write` (for the response file),
`--no-session-persistence`, and a per-task `--max-budget-usd`. The prompt goes on stdin.

## Run

```bash
# 1. Site (amd64 image; ~2.9 GB) — see webarena-verified docs for env start/reset.
docker run -d --name webarena-verified-shopping_admin -p 7780:80 -p 7781:8877 am1n3e/webarena-verified-shopping_admin
# 2. Rendered tasks for the site, then the pilot plan (10 templates × 4 instances, deterministic)
uvx webarena-verified agent-input-get --sites shopping_admin --config config.json --output tasks.json
node select.mjs tasks.json plan.json --templates 10 --instances 4
# 3. One arm at a time (each task: env reset → fresh Chrome → HAR recorder → claude -p)
node run.mjs --plan plan.json --arm A --out results --model sonnet \
  --header "X-M2-Admin-Auto-Login: admin:admin1234"
# 4. Score + aggregate
uvx webarena-verified eval-tasks --output-dir results/A --config config.json
node report.mjs results
```

`config.json` maps `__SHOPPING_ADMIN__` to the local URL (the credentials are the image's public
test defaults). `--resume` skips tasks that already have `metrics.json`.

## Honest limits

- **Simulated approval.** In C/D the agent's `profile-draft.md` is promoted to the profile after each
  task with no human review (`-p` has none). Real tandem gates that write behind a human prompt.
- **No human walls.** WebArena has no captchas/2FA, so the human-in-the-loop handoff — tandem's other
  differentiator — is not measured here.
- **Harness sensitivity.** Scores are comparable only within this harness (fixed model/prompt/budget).
- Observation bytes = bytes of tandem MCP tool results in the transcript; cost/turns come from
  Claude Code's own result record.
- Results (`results/`) contain transcripts and HARs of the local test env: keep them out of git.
