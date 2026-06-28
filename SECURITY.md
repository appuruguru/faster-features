# Security & data handling

What this system stores, where, and how to keep it clean. Short version: **no
secrets live in this repo or in the browser, and no PII is collected by default.**

## Secrets — never in git, never in the client

| Secret           | Lives in                                  | Notes                                |
| ---------------- | ----------------------------------------- | ------------------------------------ |
| `GITHUB_TOKEN`   | Cloudflare Worker secret (`wrangler secret put`) | Fine-grained, Issues:write on one repo. |
| `SHARED_SECRET`  | Cloudflare Worker secret (optional)       | Deters random POSTs to the Worker.   |

- These are set on the Worker (CLI or the Cloudflare dashboard) and are **never**
  written to any file in this repo.
- `.gitignore` excludes `.dev.vars`, `.env`, `.env.*`, and `.wrangler/` so local
  secret files can't be committed by accident.
- The widget that ships to browsers holds **no** token — it only knows the public
  Worker URL.

## What actually gets stored in GitHub

A feedback issue contains:
- the user's typed message,
- the type (idea/bug),
- minimal context: **path only** (no query string), app version, and user-agent.

It does **not** include the page query string (which can carry tokens/reset
codes), cookies, or any identifier — unless the host app explicitly passes a
`user` value. Leave `user` unset to keep issues free of PII; only set it if you
intend to follow up with reporters and are comfortable with that id living in a
GitHub issue.

## Public roadmap

- Opt-in per item: nothing is public until you add the `roadmap` label.
- The public endpoint returns **title + status only** — never the body, the
  reporter, the context, or vote internals.

## Upvote storage

- Counts only, in Cloudflare KV. No identities, no emails, no IPs are stored.
- Double-voting is softly limited client-side (`localStorage`); it's a priority
  signal, not an audited ballot.

## No third parties

The Worker talks only to the GitHub API. There is no analytics, no tracking
pixel, and no other outbound call.

## Recommendations

- Keep this repo **private** (it's a personal/internal tool).
- Scope the GitHub token to a single repo with Issues:write only; rotate it if
  ever exposed (`wrangler secret put GITHUB_TOKEN` again).
- If you don't need upvoting, remove the `[[kv_namespaces]]` block — the Worker
  stores nothing then.
