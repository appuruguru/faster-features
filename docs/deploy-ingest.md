# Deploy the ingest Worker

The ingest Worker is the only piece you host — and it's a free, stateless
Cloudflare Worker on **your** account. It holds your GitHub token so the browser
never sees it, and turns feedback POSTs into GitHub issues.

## Fast path: `npm run setup`

From `packages/ingest-worker`:

```bash
npm run setup
```

> **Windows / PowerShell:** if PowerShell blocks `npm`/`npx` with an *execution
> policy* error, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`
> once in that window and retry (affects only that session).

This automates everything scriptable — installing wrangler, configuring
`wrangler.toml`, uploading the token secret, deploying, and writing the Worker
URL back into `faster-features.config.yml`. It will ask for your repo
(`owner/name`) and allowed origins, and grab a GitHub token automatically if you
have the GitHub CLI (`gh`) authorized — otherwise it opens the token page for one
click + paste.

You'll paste two tokens during setup (the script opens both pages for you):

- **Cloudflare API token** — created with the **"Edit Cloudflare Workers"**
  template. Wrangler needs a token for scripted/non-interactive use; the browser
  login only works when you run wrangler by hand. Set `CLOUDFLARE_API_TOKEN`
  beforehand to skip the prompt.
- **GitHub token** — fine-grained, **Issues** + **Webhooks** read/write on your
  repo (grabbed automatically if the GitHub CLI is authed).

Prefer to do it by hand? The manual steps are below.

## No-terminal path: Deploy to Cloudflare button

For adopters who'd rather never open a terminal, use Cloudflare's
[Deploy to Cloudflare button](https://developers.cloudflare.com/workers/platform/deploy-buttons/).
Add this to your fork's README (swap in your repo URL):

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/appuruguru/faster-features/tree/main/packages/ingest-worker)
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
- Permissions: **Issues → Read and write**, and **Webhooks → Read and write**
  (the latter lets setup register the label→build webhook for you).

Copy the token.

## 2. Deploy the Worker

From `packages/ingest-worker`:

```bash
npm install
npm run bundle              # inline widgets into assets.js
npx wrangler login          # one-time, opens browser
# set vars in wrangler.toml first (GITHUB_REPO, OWNER, BUILD_RUNNER, ALLOWED_ORIGINS)
npx wrangler secret put GITHUB_TOKEN     # paste the token from step 1
npx wrangler secret put WEBHOOK_SECRET   # any random string
npx wrangler secret put SHARED_SECRET    # optional
npx wrangler deploy
```

Wrangler prints your Worker URL, e.g.
`https://faster-features-ingest.your-subdomain.workers.dev`.

## 3. Register the webhook

So adding a `build` label kicks off the runner (no file in your repo):
repo **Settings → Webhooks → Add webhook** →
- Payload URL: `<WORKER_URL>/webhook`
- Content type: `application/json`
- Secret: the same `WEBHOOK_SECRET` you set above
- Events: **Issues**

(`npm run setup` does this step automatically.)

## 4. Embed + test

Paste one line into your app:

```html
<script src="<WORKER_URL>/widget.js"></script>
```

Or test the backend directly:

```bash
curl -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{"message":"test from curl","type":"idea","context":{"page":"/test"}}'
```

A new issue labeled `feedback`, `pending-triage` should appear in your repo, with
you assigned to it.

## Notes on abuse

The Worker drops obvious bots via a honeypot field and enforces size limits and
an origin allow-list. For heavier protection, add a **Cloudflare Rate Limiting
rule** (free tier) on the Worker route, or a Turnstile challenge — both are
config in the Cloudflare dashboard, no code changes.
