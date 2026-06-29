# faster-features widget

A zero-dependency in-app feedback button. Users submit feedback; it becomes a
triaged GitHub issue. **The user never needs a GitHub account**, and the widget
never holds a GitHub token (that lives in your [ingest Worker](../ingest-worker)).

## Vanilla JS — one line, no config

The Worker serves the widget and the widget infers its ingest URL from where it
was loaded, so the embed is a single line (this is what `npm run setup` prints):

```html
<script src="https://faster-features-ingest.you.workers.dev/widget.js"></script>
```

A floating **Feedback** button appears bottom-right. That's it — nothing else to
host or configure.

Optional attributes if you want them:

```html
<script
  src="https://faster-features-ingest.you.workers.dev/widget.js"
  data-app-version="1.4.2"
  data-user="optional-user-id-or-email"
  data-key="optional-shared-secret"
></script>
```

(You can still self-host `widget.js` and set `data-ingest-url` explicitly if you
prefer serving it from your own assets.)

## React

```tsx
import { FeedbackWidget } from "faster-features/widget/Feedback";

<FeedbackWidget
  ingestUrl="https://faster-features-ingest.you.workers.dev"
  appVersion="1.4.2"
  user={currentUser?.email}
/>;
```

The React component uses the same CSS class names as `widget.js`. Either load
those styles, or restyle the `ff-*` classes to match your app.

## What gets sent

```json
{
  "message": "I wish I could export as CSV",
  "type": "idea",
  "context": {
    "page": "/dashboard",
    "appVersion": "1.4.2",
    "userAgent": "...",
    "user": "optional"
  }
}
```

`context` is collected silently so the user just types and hits Send. A hidden
honeypot field (`hp`) helps the Worker drop obvious bots.

## Config reference

| Option       | Script attr        | Required | Notes                                  |
| ------------ | ------------------ | -------- | -------------------------------------- |
| `ingestUrl`  | `data-ingest-url`  | yes      | Your deployed ingest Worker URL.       |
| `appVersion` | `data-app-version` | no       | Helps you reproduce reported bugs.     |
| `user`       | `data-user`        | no       | Lets you close the loop with reporters.|
| `key`        | `data-key`         | no       | Shared secret, sent as `x-ff-key`.     |
| `label`      | `data-label`       | no       | Button text (default `Feedback`).      |
| `repo`       | `data-repo`        | no       | Target `owner/name` when one Worker serves multiple repos (must be in the Worker's `ALLOWED_REPOS`). |
| `roadmap`    | `data-roadmap`     | no       | Path/URL to your roadmap page (e.g. `/roadmap`). Shows a small **Roadmap** link stacked above the feedback button. |

### One Worker, many of your repos

Running a single Worker for several of your own projects? Set `ALLOWED_REPOS` on
the Worker, then give each app's widget a `data-repo`. The Worker only honors
repos on that allow-list, and its `GITHUB_TOKEN` must have Issues access to each.

## Public roadmap (close the loop with users)

Show end users what's **Planned / In progress / Shipped** so they see their
feedback going somewhere. Add a roadmap page to your site:

```html
<div id="ff-roadmap"></div>
<script src="https://faster-features-ingest.you.workers.dev/roadmap.js"></script>
```

Or in React:

```tsx
import { Roadmap } from "faster-features/widget/Roadmap";

<Roadmap ingestUrl="https://faster-features-ingest.you.workers.dev" />;
```

**Ready-made page template:** copy [`examples/roadmap.html`](../../examples/roadmap.html)
— a styled, standalone roadmap page (light/dark) where you just swap in your
Worker URL. (And [`examples/demo.html`](../../examples/demo.html) is a page with the
feedback button for testing.)

**Visibility is opt-in and safe by default.** An item appears only after you add
the `ff:roadmap` label to its issue, and the public endpoint returns **only the
title and a status** — never the body, the reporter, or any submitted context.
The column is derived automatically:

| Issue state                          | Column        |
| ------------------------------------ | ------------- |
| `ff:backlog` label                   | Planned       |
| `ff:build` / `ff:in-progress` label  | In progress   |
| closed (completed)                   | Shipped       |
| closed as not planned                | hidden        |

The endpoint is cached ~60s at the edge, so a busy page won't hit GitHub limits.

### Upvoting (optional, no PII)

Let users upvote so you know what to build first. Enable it during
`npm run setup` (answer yes to "roadmap upvoting") — it creates a free Cloudflare
KV store that holds **only a count per item**, no identities or emails. The
roadmap then shows ▲ buttons and sorts each column by votes.

- Double-voting is softly prevented via the browser's `localStorage` — it's a
  prioritization signal, not a ballot, so it's best-effort by design.
- If you don't enable it, the roadmap works exactly the same, just without votes
  (the widget hides the buttons automatically based on the endpoint's response).
- Note the KV free tier allows ~1,000 writes/day; plenty for a normal roadmap.
