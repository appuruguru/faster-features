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
[In-app widget]          frontend code in your app; no account for users
      | POST
[Ingest Worker]          your free Cloudflare Worker; holds the GitHub token
      |
[GitHub Issue]           GitHub's native AI summarizes/labels it
      |
[GitHub Mobile push]     you're auto-assigned — no Discord, no server
      |
[You tap a label]        backlog ──► Project board
      |                   build   ──► AI runner
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
| [`packages/ingest-worker`](packages/ingest-worker) | Cloudflare Worker: feedback POST → GitHub issue.         |
| [`.github/`](.github)                           | Issue template + workflows: notify, backlog, build.          |
| [`faster-features.config.yml`](faster-features.config.yml) | One config file: repo, owner, ingest URL, build runner. |
| [`docs/`](docs)                                 | [Deploy the Worker](docs/deploy-ingest.md) · [Build runners](docs/build-runners.md) |
| [`examples/demo.html`](examples/demo.html)      | A page hosting the widget for end-to-end testing.            |

## Quickstart

1. **Copy** `.github/` and `faster-features.config.yml` into the repo that should
   receive feedback, and edit the config (`repo`, `owner`, `ingestUrl`).
2. **Deploy the ingest Worker** — terminal-free with the button, or `npm run setup`:

   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR-USER/faster_features/tree/main/packages/ingest-worker)

   <sub>(Swap `YOUR-USER` for your GitHub username after pushing this repo public — the button only works against a public repo URL.)</sub>
   Full guide: [docs/deploy-ingest.md](docs/deploy-ingest.md).
3. **Embed the widget** in your app → [packages/widget/README.md](packages/widget/README.md),
   pointing `data-ingest-url` at your Worker. One `<script>` tag, or the React
   component. Or just tell your AI assistant: "integrate faster-features" — see
   [AGENTS.md](AGENTS.md).
4. **Pick a build runner** (`buildRunner` in the config) →
   [docs/build-runners.md](docs/build-runners.md). Default `claude-web` needs no
   secrets and no per-token cost.

Now feedback flows: submit from the demo page, get a GitHub Mobile push, add
`build`, and watch a PR appear.

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
