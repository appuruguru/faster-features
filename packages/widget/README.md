# faster-features widget

A zero-dependency in-app feedback button. Users submit feedback; it becomes a
triaged GitHub issue. **The user never needs a GitHub account**, and the widget
never holds a GitHub token (that lives in your [ingest Worker](../ingest-worker)).

## Vanilla JS (any site)

Add one script tag:

```html
<script
  src="https://your-cdn/widget.js"
  data-ingest-url="https://faster-features-ingest.you.workers.dev"
  data-app-version="1.4.2"
  data-user="optional-user-id-or-email"
  data-key="optional-shared-secret"
></script>
```

A floating **Feedback** button appears bottom-right. That's it.

You can also configure before the script loads:

```html
<script>
  window.FasterFeatures = {
    ingestUrl: "https://faster-features-ingest.you.workers.dev",
    appVersion: "1.4.2",
  };
</script>
```

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

### One Worker, many of your repos

Running a single Worker for several of your own projects? Set `ALLOWED_REPOS` on
the Worker, then give each app's widget a `data-repo`. The Worker only honors
repos on that allow-list, and its `GITHUB_TOKEN` must have Issues access to each.
