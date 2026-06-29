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

The tool is public at https://github.com/appuruguru/faster-features. If it isn't
already on this machine, grab just the worker folder (no full clone needed):

```bash
npx degit appuruguru/faster-features/packages/ingest-worker ff-ingest
```

The widget is served by the Worker itself (`/widget.js`), so you don't copy the
widget file into the target app — the embed is a one-line `<script>` pointing at
the deployed Worker.

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

The Worker SERVES the widget at `INGEST_URL/widget.js`, so the embed is one line
that needs no config (it infers the ingest URL from its own origin). Add
`data-roadmap="/roadmap"` so a Roadmap link shows above the feedback button (see
Step 5).

- Plain HTML: one script tag before `</body>` in the main layout:
  ```html
  <script src="INGEST_URL/widget.js" data-roadmap="/roadmap"></script>
  ```
- React/Next (App Router): put `INGEST_URL` in a shared const (e.g.
  `app/lib/feedback.ts`), then load it in the root layout via `next/script`:
  ```tsx
  <Script src={`${FEEDBACK_WORKER_URL}/widget.js`} data-roadmap="/roadmap" strategy="afterInteractive" />
  ```
  Also add `feedback-worker` (the nested worker, if used) to `tsconfig.json`
  `exclude`.

Keep this change minimal: one script tag / one `<Script>` + one render site.

## Step 4 — GitHub automation (usually nothing to copy)

The Worker does the GitHub-side work itself: it assigns the owner on issue
creation (the notification) and handles the `build` label via a webhook it
registered during setup. So for the default `claude-web` and `copilot` runners,
**no files go into the target repo.**

Only if the user chose `claude-api` (fully automated CI builds): copy
`.github/workflows/build.yml` into the repo and add an `ANTHROPIC_API_KEY`
secret. See `docs/build-runners.md`.

## Step 5 — Public roadmap page (+ upvoting)

Add a roadmap page so the `data-roadmap` link from Step 3 has somewhere to go:
- Plain HTML: a `roadmap.html` with `<div id="ff-roadmap"></div>` +
  `<script src="INGEST_URL/roadmap.js"></script>` (see `examples/roadmap.html`).
- React/Next: a `/roadmap` route that renders `<div id="ff-roadmap" />` and loads
  `INGEST_URL/roadmap.js` via `next/script`.

Items appear only after the dev adds the `roadmap` label; the endpoint exposes
title + status only. Upvoting turns on automatically if the Worker has the VOTES
KV store (created in Step 2) — counts only, no emails or identities.

## Step 6 — Verify

Build the app, confirm the Feedback button renders, and submit a test from a
logged-out browser. Confirm a GitHub issue appears with the `feedback` label and
the configured owner is assigned (which fires a GitHub Mobile push).

## Hard rules

- The GitHub token lives only in the Worker, never in client code.
- End users must never need a GitHub account.
- Keep edits to the host app small and reversible.
