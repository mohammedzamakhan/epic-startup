# Session doctor log

## 2026-11-08 first run (manual, mining only, no LLM scoring)

167 session files. Top signals:

- PR review-comment loop is the most repeated job (about 72 `gh api` calls with
  ad-hoc jq). Added `pr-review-loop` skill and `fetch-pr-feedback.sh`.
- 8 + 4 Bash calls blocked on "shell expansion" or "variable can't be checked"
  approval prompts. Cause: `$VAR`, `$(...)` and unquoted globs in one-liners.
  Fix: scripts in files, quoted globs (noted in AGENTS.md).
- 7 Agent calls hit the concurrent subagent limit.
- 2 calls to the unavailable Grep tool. Use `rg` or `grep` through Bash.
- User corrections: stopped early on `npm run dev`; partial fix of PR comments.
  Saved as memory.

Baseline scores: none yet. Next run should score a sample with `rubrics/`.

## 2026-11-08 second run: Codex, Droid, Antigravity (mining only)

Scope: sessions whose cwd contains `epic` or `menuza`. Codex 87 of 107, Droid
163 of 167. Antigravity has 624 binary conversation files (unreadable) and 269
`brain` artifact folders.

- Droid: 24 sessions hit a usage limit or `model_usage_exhausted` during the
  Lieutenant fan-out. Workers fell back to `kimi-k3` or died.
- Droid: about 70 failed `Read` calls on guessed paths (`node_modules/...`,
  files from `~/epic-stack` while in `menuza`), 18+ "text to replace not found"
  `Edit` failures, 12 `Read` calls with string `offset`/`limit`.
- Codex corrections: Cloudflare env and deploy confusion (deploy on PR to main,
  `varlock-wrangler`), UI placement redone 3+ times, a change made in the wrong
  checkout, "just add the missing translations".
- Antigravity: 3 commits blocked by the Lingui pre-commit check.
- Changes: AGENTS.md gotchas (read paths, sibling checkouts, edit re-read,
  fan-out limits, Lingui, deploy triggers), `mine-other-agents.py`.
- Not changed (user-level, recommend only): Droid and Codex skill folders, Droid
  Lieutenant parallelism.
