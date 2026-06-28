# Build runners

When you approve a request by adding the **`build`** label, the
`.github/workflows/build.yml` workflow routes it to the runner you picked in
`faster-features.config.yml` (`buildRunner:`). The pipeline's job is to hand off
a clean, triaged issue — you choose which AI writes the code, and whether it runs
on a subscription or an API key.

| Runner       | Trigger              | Auth / cost                         | Automated? |
| ------------ | -------------------- | ----------------------------------- | ---------- |
| `claude-web` | manual, from issue   | your Claude Pro/Max **subscription** | no (1 tap) |
| `copilot`    | `build` label        | Copilot **usage-based** billing     | yes        |
| `claude-api` | `build` label        | `ANTHROPIC_API_KEY` (pay-per-token) | yes        |

## `claude-web` (default — no API token, no per-token cost)

On `build`, the workflow posts a kickoff comment. You open
[Claude Code on the web](https://claude.ai/code) on your phone or browser, pick
the repo, and say *"Implement issue #N; keep it small; open a PR."* It runs on
**Anthropic's cloud using your subscription** — first-party, so it's
ToS-compliant, unlike using a subscription token in CI.

This is "manual" only in that you tap to start it — and that tap doubles as your
final approval. No secrets to configure.

## `copilot` (automated, usage-based)

On `build`, the workflow assigns **GitHub Copilot's coding agent** to the issue.
It branches, writes code on Actions runners, and opens a draft PR. Billed via
Copilot AI credits (usage-based as of 2026-06-01). Requires a paid Copilot plan
with the coding agent enabled.

## `claude-api` (automated, pay-per-token)

On `build`, the workflow runs the official
[`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action)
to implement the issue and open a PR. Add an `ANTHROPIC_API_KEY` repo secret.

> ⚠️ Do **not** try to feed a Claude subscription OAuth token to the Action.
> Since 2026-04-04 Anthropic prohibits subscription tokens outside Claude Code
> and Claude.ai; CI use requires an API key.

## Switching runners

Edit `buildRunner` in `faster-features.config.yml`. `build.yml` reads it at run
time — no other changes needed. The automated runners only act when selected, so
the default `claude-web` setup incurs zero automated cost.
