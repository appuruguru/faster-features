# Integrating faster-features (instructions for AI coding agents)

If a developer asks you to "add faster-features," "add a feedback widget," or
"wire up feedback-to-feature," follow these steps in **their** project. This file
is written so an AI assistant (Claude Code, Cursor, etc.) can do the integration
end to end.

## What you are installing

A pipeline: in-app feedback widget → a Cloudflare Worker → GitHub issues →
notification → label → AI build. The host app only needs the **widget**; the
Worker and GitHub automation are set up once per repo.

## Steps

1. **Detect the stack.** Look for a framework (React/Next/Vue/plain HTML) to
   decide which widget form to use.

2. **Add the widget.**
   - Plain HTML / non-React: copy `packages/widget/widget.js` into the target
     app's own static assets, then add one script tag before `</body>`:
     ```html
     <script src="/assets/widget.js"
             data-ingest-url="$INGEST_URL"
             data-app-version="$APP_VERSION"></script>
     ```
     (This is a private tool — serve the file from the app itself, not a public CDN.)
   - React/Next: copy `packages/widget/Feedback.tsx` into the project's
     components and render `<FeedbackWidget ingestUrl="$INGEST_URL" />` in the
     root layout. Ensure the `ff-*` CSS (see `packages/widget/widget.js`) is
     available, or restyle to match the app.

3. **Set `$INGEST_URL`.** Ask the developer for their deployed Worker URL. If
   they don't have one, point them to `docs/deploy-ingest.md` (button or
   `npm run setup`) — do NOT hardcode a token anywhere in the app.

4. **No repo files needed for the default.** The Worker handles notifications
   (assign-on-create) and the build label (via a webhook it registers during
   setup). Do **not** copy workflow files for `claude-web` or `copilot`. The
   issue template and `faster-features.config.yml` are optional conveniences.

5. **Pick a build runner.** Default `claude-web` needs no secrets and no repo
   files. `copilot` likewise. Only `claude-api` requires copying
   `.github/workflows/build.yml` and adding an `ANTHROPIC_API_KEY` secret. See
   `docs/build-runners.md`.

6. **Verify.** Build the app, confirm the Feedback button renders, and submit a
   test from a logged-out browser — a GitHub issue should appear.

7. **Optional — public roadmap.** If the developer wants users to see request
   status, add a roadmap page using `packages/widget/roadmap.js` (or
   `Roadmap.tsx`) pointed at the same `$INGEST_URL`. Items appear only once the
   dev adds the `ff:roadmap` label; the endpoint exposes title + status only.

## Hard rules

- Never put the GitHub token in client code — it lives only in the Worker.
- Keep the widget change small: a script tag or one component + one render site.
- The end user must never need a GitHub account.
