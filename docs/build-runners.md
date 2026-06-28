# Build runners

When you approve a request by adding the **`build`** label, what happens depends
on `BUILD_RUNNER` (set during setup). For the two defaults, the **Worker** reacts
to the label via its webhook — **nothing is needed in your repo**. Only the
`claude-api` runner uses a committed GitHub Action.

| Runner       | Handled by        | Repo file needed?      | Auth / cost                         |
| ------------ | ----------------- | ---------------------- | ----------------------------------- |
| `claude-web` | Worker (webhook)  | no                     | your Claude Pro/Max **subscription** |
| `copilot`    | Worker (webhook)  | no                     | Copilot **usage-based** billing     |
| `claude-api` | GitHub Action     | yes (`build.yml`)      | `ANTHROPIC_API_KEY` (pay-per-token) |

## `claude-web` (default — no API token, no per-token cost, no repo file)

On `build`, the Worker posts a kickoff comment. You open
[Claude Code on the web](https://claude.ai/code) on your phone or browser, pick
the repo, and say *"Implement issue #N; keep it small; open a PR."* It runs on
**Anthropic's cloud using your subscription** — first-party, so it's
ToS-compliant, unlike using a subscription token in CI. The tap doubles as your
final approval.

## `copilot` (automated, usage-based, no repo file)

On `build`, the Worker assigns **GitHub Copilot's coding agent** to the issue. It
branches, writes code on Actions runners, and opens a draft PR. Billed via
Copilot AI credits (usage-based as of 2026-06-01). Requires a paid Copilot plan
with the coding agent enabled.

## `claude-api` (automated, pay-per-token — the one that needs a repo file)

This runner runs *as* a GitHub Action, so copy `.github/workflows/build.yml` into
your repo and add an `ANTHROPIC_API_KEY` secret. On `build`, it runs the official
[`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action)
to implement the issue and open a PR.

> ⚠️ Do **not** feed a Claude subscription OAuth token to the Action. Since
> 2026-04-04 Anthropic prohibits subscription tokens outside Claude Code and
> Claude.ai; CI use requires an API key.

## Switching runners

Re-run `npm run setup` (or change `BUILD_RUNNER` in `wrangler.toml` and
`npx wrangler deploy`). For `claude-api`, also add `build.yml` + the API key.
