# faster-features

Turn in-app user feedback into shipped features, fast.

A user clicks **Feedback** in your app → it becomes a triaged GitHub issue →
your phone buzzes → you tap **backlog** or **build** → an AI writes the code and
opens a PR. Feedback in, features out.

Designed around two rules:

1. **Free and off your infrastructure** — everything rides on free tiers
   (GitHub, Cloudflare Workers free tier). The *only* cost is the AI that writes
   the code, on your subscription or API key, and only when you approve a build.
2. **End users never touch GitHub** — no account, no idea a pipeline exists. They
   type feedback and hit Send.

## The flow

```
[In-app widget]          one <script> line in your app; no account for users
      | POST
[Ingest Worker]          your free Cloudflare Worker; holds the token, does it all
      |                  (creates issue, assigns you, serves the widget, handles labels)
[GitHub Issue]           created + you're assigned → GitHub Mobile push
      |
[You add a label]        build ──► Worker kicks off your AI runner (via webhook)
      v
[AI writes code → PR]     Claude (sub or API) or Copilot — you pick. The one paid step.

       ┌─────────────────────────────────────────────────────────┐
       │ Public roadmap widget reads issues back out (opt-in,     │
       │ title + status only) so users see Planned/In progress/   │
       │ Shipped — closing the loop on their feedback.            │
       └─────────────────────────────────────────────────────────┘
```

## What's in here

| Piece                                          | What it is                                                    |
| ---------------------------------------------- | ------------------------------------------------------------ |
| [`packages/widget`](packages/widget)           | Drop-in feedback button **and** public roadmap (vanilla JS + React). No token. |
| [`packages/ingest-worker`](packages/ingest-worker) | Cloudflare Worker: issue creation, notify, roadmap, votes, webhook builds, serves the widgets. |
| [`.github/`](.github)                           | Issue template + an **optional** `build.yml` (only for the `claude-api` runner). |
| [`faster-features.config.yml`](faster-features.config.yml) | One config file: repo, owner, ingest URL, build runner. |
| [`docs/`](docs)                                 | [Deploy the Worker](docs/deploy-ingest.md) · [Build runners](docs/build-runners.md) |
| [`SECURITY.md`](SECURITY.md)                    | What's stored where; no secrets in git, no PII by default.    |
| [`examples/demo.html`](examples/demo.html)      | A page hosting the widget for end-to-end testing.            |

## Quickstart

There are **two jobs**: deploy the Worker once (a few steps), then drop one line
into your app. Nothing else gets copied into your app repo — the Worker registers
its own webhook and creates the labels.

**Prerequisites:** a GitHub repo for your app, a free [Cloudflare](https://dash.cloudflare.com)
account, and [Node.js](https://nodejs.org) installed.

### Job 1 — Deploy the ingest Worker (once per app)

Grab just the worker folder (no full clone) and run setup:

```bash
npx degit appuruguru/faster-features/packages/ingest-worker ff-ingest
cd ff-ingest
npm install
npm run setup
```

> **Windows / PowerShell:** these commands work as-is. If PowerShell blocks
> `npm`/`npx` with an *execution policy* error, run this once in that window and
> retry (it only affects the current session):
> ```powershell
> Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
> ```

`npm run setup` walks you through it and does the rest automatically:
- **Prompts** for your app repo (`owner/name`), the GitHub login to notify, and a build runner.
- **GitHub token** — opens the token page; paste a token that can access **your app repo**:
  - *Simplest:* a **classic** token with the **`repo`** scope (covers issues, labels, and webhooks).
  - *Locked-down:* a **fine-grained** token where you **select your repo** under "Only select repositories" (this step is easy to miss and is required for private repos) with **Issues: Read/write** + **Webhooks: Read/write**.
  - (If the GitHub CLI is authed, it's grabbed automatically.)
- **Cloudflare API token** — opens the token page; create a **Custom token** with these **Account** permissions: **Workers Scripts: Edit**, **Workers KV Storage: Edit**, **Account Settings: Read**. (Avoid the "Edit Cloudflare Workers" *template* — it forces a Zone/site selection you don't need for `*.workers.dev`.) Wrangler needs an API token for scripted setup; its browser login only works when you run wrangler by hand.
- Then it **deploys, creates the labels, registers the webhook**, and **prints your embed snippet**.

See [docs/troubleshooting.md](docs/troubleshooting.md) if any step errors.

> Prefer no terminal? Use the button below. It deploys the Worker and provisions
> KV/vars in the browser, **but** Cloudflare's button doesn't set secrets — after
> it deploys you must add `GITHUB_TOKEN` and `WEBHOOK_SECRET` in the Worker's
> **Settings → Variables and Secrets**. (The CLI path above sets them for you.)
>
> [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/appuruguru/faster-features/tree/main/packages/ingest-worker)

### Job 2 — Add one line to your app

Paste the snippet `setup` printed, before `</body>`:

```html
<script src="https://your-worker.workers.dev/widget.js"></script>
```

That's it — a Feedback button appears, submissions become triaged issues in your
repo, you get a GitHub Mobile push, and adding the `ff:build` label kicks off your
AI runner. *(Only the opt-in `claude-api` runner needs `build.yml` in your repo —
the default `claude-manual` and `copilot` runners don't.)*

> **Labels:** the pipeline's labels are all prefixed **`ff:`** (`ff:feedback`,
> `ff:build`, `ff:roadmap`, …) so they're clearly faster-features' own and don't
> get confused with GitHub's stock labels (`bug`, `enhancement`, …). They're
> created automatically — you never make them by hand.

## Cost

| Step                         | Cost                                            |
| ---------------------------- | ----------------------------------------------- |
| Widget + ingest + issues     | Free (Cloudflare + GitHub free tiers)           |
| Notifications                | Free (GitHub Mobile)                            |
| Backlog board                | Free (GitHub Projects)                          |
| **AI build**                 | Your Claude subscription, or pay-per-token API  |

## A note on what's possible

A *fully free and fully automated* build step isn't possible without violating a
provider's terms — Anthropic restricts subscription tokens to first-party apps,
so automated CI builds need a paid API key. The honest sweet spot is the default
`claude-manual` runner: it runs on your existing subscription with one manual tap
(which doubles as your approval), keeping everything else free.
