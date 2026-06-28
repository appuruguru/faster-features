# Troubleshooting

Real issues hit during setup, and how to fix them. (These come from an actual
from-scratch run on Windows/PowerShell.)

## `npm run setup` errors

### `"" is not owner/name` (the first prompt returns empty)
Fixed in current versions — if you see it, you're on an old copy of `setup.mjs`.
Re-grab it: `npx degit appuruguru/faster-features/packages/ingest-worker --force .`

### `In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN`
Wrangler's browser login (`wrangler login`) only works when you run wrangler by
hand — it does **not** work when a script runs wrangler. Setup uses a
**Cloudflare API token** instead. Create one (see below) and paste it when asked,
or export `CLOUDFLARE_API_TOKEN` before running.

### `A request to the Cloudflare API (/memberships) failed. [code: 10000]`
Your Cloudflare token can't list account memberships (a User-level call). Setup
now auto-detects your account ID from `wrangler whoami` and sets
`CLOUDFLARE_ACCOUNT_ID`, which avoids that call. Make sure your token has
**Account Settings: Read** so the account ID is readable.

### Cloudflare token: which permissions?
Use a **Custom token** with **Account** permissions:
- Workers Scripts: **Edit**
- Workers KV Storage: **Edit**
- Account Settings: **Read**

Do **not** use the "Edit Cloudflare Workers" *template* — it forces a Zone/site
selection that isn't needed for `*.workers.dev` deploys.

### `404` when creating labels or registering the webhook
The **GitHub token** can't reach your repo. Either:
- use a **classic** token with the **`repo`** scope, or
- a **fine-grained** token where you **selected the repo** under "Only select
  repositories" (required for private repos) with **Issues** + **Webhooks**
  read/write.

A fine-grained token without the repo selected returns `404` (not `403`).

### First deploy asks to register a `workers.dev` subdomain
A brand-new Cloudflare account must claim a `workers.dev` subdomain once. Do it in
the dashboard: **Workers & Pages → set up a subdomain**, then re-run.

## Warnings you can ignore

- **`npm warn deprecated …` / "N vulnerabilities"** after `npm install` — these
  are in wrangler's own tooling, not your app, and never ship to the Worker.
  **Do not run `npm audit fix --force`** — it can upgrade wrangler past breaking
  changes.
- **`▲ wrangler is out-of-date`** — harmless; the pinned version works.

## Windows / PowerShell

- If PowerShell blocks `npm`/`npx` with an execution-policy error:
  `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` (current session only).
- `gh` (GitHub CLI) installed in WSL is **not** on your Windows PATH — Windows
  PowerShell won't see it. That only means setup opens the token page instead of
  grabbing a token automatically.

## Verifying it works

```bash
# 1. Submit feedback straight to the Worker:
curl -X POST "https://<your-worker>.workers.dev/" -H "Content-Type: application/json" \
  -d '{"message":"test","type":"idea","context":{"page":"/"}}'
# -> {"ok":true,"issue":N}  and a new assigned issue in your repo

# 2. Public roadmap (after adding the `roadmap` label to an issue):
curl "https://<your-worker>.workers.dev/"
# -> {"items":[...],"voting":true|false}
```
