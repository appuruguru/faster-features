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

Just **two steps** — nothing is copied into your app repo (the Worker does the
GitHub-side work via a webhook it registers itself):

1. **Deploy the ingest Worker** — terminal (`cd packages/ingest-worker && npm run
   setup`) or the no-terminal button. It asks for your repo + owner, deploys, and
   prints your one-line embed snippet. Full guide:
   [docs/deploy-ingest.md](docs/deploy-ingest.md).

   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/appuruguru/faster-features/tree/main/packages/ingest-worker)

   <sub>(The button needs a public repo URL; the terminal path works with a private repo.)</sub>

2. **Paste the one line** setup prints into your app, before `</body>`:
   ```html
   <script src="https://your-worker.workers.dev/widget.js"></script>
   ```
   Or let AI do it: the [`/faster-features` skill](skills/README.md) in Claude
   Code, or point any agent at [AGENTS.md](AGENTS.md).

Now feedback flows: submit from the [demo page](examples/demo.html), get a GitHub
Mobile push, add `build`, and the Worker kicks off your AI runner. *(Only the
opt-in `claude-api` runner needs the `build.yml` workflow in your repo — the
default `claude-web` and `copilot` runners don't.)*

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
`claude-web` runner: it runs on your existing subscription with one manual tap
(which doubles as your approval), keeping everything else free.
