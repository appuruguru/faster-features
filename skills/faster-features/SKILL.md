---
name: faster-features
description: Integrate the faster-features feedback-to-feature pipeline into the current project. Use when the user asks to add a feedback widget, a feature-request box, a public roadmap, or wire up feedback-to-GitHub-issue automation. Adds an in-app widget, the ingest Worker, GitHub issue automation, and optionally a public roadmap with upvoting.
---

# Integrate faster-features

Set up the feedback-to-feature pipeline in the user's project: an in-app feedback
widget → a Cloudflare Worker → GitHub issues → notification → label → AI build,
plus an optional public roadmap with upvoting. End users never need a GitHub
account; no secret ever lives in client code.

## Step 0 — Get the package files

If the `faster_features` package isn't already in or beside this project, fetch it:

```bash
git clone https://github.com/YOUR-USER/faster_features /tmp/faster_features
```

Use its `packages/`, `.github/`, `docs/`, and `faster-features.config.yml` as the
source of the files you copy in. (Replace YOUR-USER with the published repo owner.)

## Step 1 — Understand the target project

- Identify the framework (React/Next/Vue/Svelte/plain HTML) to choose the widget
  form, and find the root layout / main template where a global widget belongs.
- Identify the GitHub repo this project lives in (`owner/name`) — issues file
  here, so the AI has full code context when it builds an approved request.

## Step 2 — Deploy the ingest Worker

Ask the user which they prefer (both are fine):
- **No terminal:** point them to the Deploy-to-Cloudflare button in
  `docs/deploy-ingest.md`. It provisions the Worker (and the upvote KV store)
  in the browser.
- **Terminal:** from `packages/ingest-worker`, run `npm run setup`. It handles
  Cloudflare auth, the GitHub token (via `gh` if present, else one click),
  config, secrets, KV for upvoting, deploy, and writes the Worker URL into
  `faster-features.config.yml`.

Capture the resulting Worker URL as `INGEST_URL`. Never put a GitHub token in app
code — it lives only in the Worker.

## Step 3 — Embed the feedback widget

- Plain HTML / non-React: add one script tag before `</body>` in the main layout:
  ```html
  <script src="<widget-host>/widget.js" data-ingest-url="INGEST_URL"></script>
  ```
- React/Next: copy `packages/widget/Feedback.tsx` into the components dir and
  render `<FeedbackWidget ingestUrl="INGEST_URL" />` once in the root layout.
  Ensure the `ff-*` styles are present (see `packages/widget/widget.js`) or
  restyle to match the app.

Keep this change minimal: a single script tag or one component + one render site.

## Step 4 — Add GitHub automation (once per repo)

Copy into the target repo:
- `.github/ISSUE_TEMPLATE/feedback.yml`
- `.github/workflows/notify.yml`, `backlog.yml`, `build.yml`
- `faster-features.config.yml` — fill `repo`, `owner`, `ingestUrl`, `buildRunner`.

Pick a build runner with the user (see `docs/build-runners.md`): default
`claude-web` needs no secrets; `claude-api` needs an `ANTHROPIC_API_KEY` secret.

## Step 5 — Optional public roadmap (+ upvoting)

If the user wants end users to see status, add a roadmap page using
`packages/widget/roadmap.js` (or `Roadmap.tsx`) pointed at `INGEST_URL`. Items
appear only after the dev adds the `roadmap` label; the endpoint exposes title +
status only. Upvoting turns on automatically if the Worker has the VOTES KV store
(created in Step 2); it stores counts only — no emails or identities.

## Step 6 — Verify

Build the app, confirm the Feedback button renders, and submit a test from a
logged-out browser. Confirm a GitHub issue appears with the `feedback` label and
the configured owner is assigned (which fires a GitHub Mobile push).

## Hard rules

- The GitHub token lives only in the Worker, never in client code.
- End users must never need a GitHub account.
- Keep edits to the host app small and reversible.
