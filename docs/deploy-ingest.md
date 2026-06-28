# Deploy the ingest Worker

The ingest Worker is the only piece you host — and it's a free, stateless
Cloudflare Worker on **your** account. It holds your GitHub token so the browser
never sees it, and turns feedback POSTs into GitHub issues.

## Fast path: `npm run setup`

From `packages/ingest-worker`:

```bash
npm run setup
```

This automates everything scriptable — installing wrangler, configuring
`wrangler.toml`, uploading the token secret, deploying, and writing the Worker
URL back into `faster-features.config.yml`. It will ask for your repo
(`owner/name`) and allowed origins, and grab a GitHub token automatically if you
have the GitHub CLI (`gh`) authorized — otherwise it opens the token page for one
click + paste.

Two prompts stay interactive by design:

- **Cloudflare authorization** — a browser "Allow" click. Skip it entirely by
  exporting a `CLOUDFLARE_API_TOKEN` before running.
- **GitHub token approval** — invisible if `gh auth login` is done; otherwise one
  click on the pre-filled page the script opens.

Prefer to do it by hand? The manual steps are below.

## No-terminal path: Deploy to Cloudflare button

For adopters who'd rather never open a terminal, use Cloudflare's
[Deploy to Cloudflare button](https://developers.cloudflare.com/workers/platform/deploy-buttons/).
Add this to your fork's README (swap in your repo URL):

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR-USER/faster_features/tree/main/packages/ingest-worker)
```

Clicking it deploys the Worker to the adopter's **own** Cloudflare account in a
few browser clicks, prompting for `GITHUB_REPO`, `ALLOWED_ORIGINS`, and the
`GITHUB_TOKEN` secret on a setup page. Combined with the one-click GitHub token
page, this is a fully terminal-free setup.

> The Worker lives in its own `packages/ingest-worker` subdirectory (a Deploy
> button requirement — the app must be self-contained in that folder).

---

## Manual steps

### 1. Create a GitHub token

Create a **fine-grained personal access token** scoped to just the target repo:

- Repository access: **only this project's own repo** (the one with the code, so
  the AI has full context when it builds an approved request).
- Permissions: **Issues → Read and write**.

Copy the token. This is the only credential the Worker needs.

> Prefer a GitHub App for production multi-repo use, but a fine-grained PAT is
> the simplest path and stays scoped to one repo.

## 2. Deploy the Worker

From `packages/ingest-worker`:

```bash
npm install
npx wrangler login          # one-time, opens browser
# set non-secret vars in wrangler.toml first (GITHUB_REPO, ALLOWED_ORIGINS)
npx wrangler secret put GITHUB_TOKEN     # paste the token from step 1
npx wrangler secret put SHARED_SECRET    # optional; any random string
npx wrangler deploy
```

Wrangler prints your Worker URL, e.g.
`https://faster-features-ingest.your-subdomain.workers.dev`.

## 3. Configure

- Put the Worker URL in your widget's `data-ingest-url` (and in
  `faster-features.config.yml` → `ingestUrl`).
- Set `ALLOWED_ORIGINS` in `wrangler.toml` to the sites that may submit feedback
  (comma-separated). Use `*` only for quick testing.
- If you set `SHARED_SECRET`, pass the same value to the widget as `data-key`.

## 4. Test

```bash
curl -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -H "x-ff-key: $SHARED_SECRET" \
  -d '{"message":"test from curl","type":"idea","context":{"page":"/test"}}'
```

A new issue labeled `feedback`, `pending-triage` should appear in your repo.

## Notes on abuse

The Worker drops obvious bots via a honeypot field and enforces size limits and
an origin allow-list. For heavier protection, add a **Cloudflare Rate Limiting
rule** (free tier) on the Worker route, or a Turnstile challenge — both are
config in the Cloudflare dashboard, no code changes.
