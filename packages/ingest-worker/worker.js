/**
 * faster-features — ingest Worker
 *
 * The single piece of "infrastructure" in the pipeline: a stateless Cloudflare
 * Worker that the repo owner deploys to their own free account. It holds the
 * GitHub token (never exposed to the browser) and turns an anonymous in-app
 * feedback POST into a triaged GitHub issue.
 *
 * Required secrets / vars (see wrangler.toml + docs/deploy-ingest.md):
 *   GITHUB_TOKEN     fine-scoped token with `issues: write` on the target repo
 *   GITHUB_REPO      "owner/name"
 *   ALLOWED_ORIGINS  comma-separated list of sites allowed to POST (CORS)
 *   SHARED_SECRET    (optional) value the widget must send in x-ff-key
 */

const MAX_MESSAGE = 5000;
const MAX_FIELD = 500;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, cors);
    }
    // Reject origins we don't recognize (when an allow-list is configured).
    if (!originAllowed(origin, env)) {
      return json({ error: "Origin not allowed" }, 403, cors);
    }
    // Optional shared secret to deter random POSTs to the public URL.
    if (env.SHARED_SECRET && request.headers.get("x-ff-key") !== env.SHARED_SECRET) {
      return json({ error: "Unauthorized" }, 401, cors);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400, cors);
    }

    // Honeypot: real users never fill this hidden field; bots often do.
    if (payload.hp) return json({ ok: true }, 200, cors);

    const message = String(payload.message || "").trim();
    if (!message) return json({ error: "Message is required" }, 400, cors);
    if (message.length > MAX_MESSAGE) {
      return json({ error: "Message too long" }, 400, cors);
    }

    const type = payload.type === "bug" ? "Bug report" : "Idea / feature request";
    const ctx = payload.context || {};
    const issue = buildIssue({ message, type, ctx });

    // Resolve which repo to file into. One Worker can serve many of YOUR repos:
    // the widget may send `repo: "owner/name"`, but only if it's allow-listed in
    // ALLOWED_REPOS. Otherwise fall back to the single GITHUB_REPO default.
    const targetRepo = resolveRepo(payload.repo, env);
    if (!targetRepo) {
      return json({ error: "Repo not allowed or worker misconfigured" }, 400, cors);
    }
    const [repoOwner, repoName] = targetRepo.split("/");

    const ghResp = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "faster-features-ingest",
        },
        body: JSON.stringify({
          title: issue.title,
          body: issue.body,
          labels: ["feedback", "pending-triage"],
        }),
      },
    );

    if (!ghResp.ok) {
      const detail = await ghResp.text();
      return json(
        { error: "Failed to create issue", status: ghResp.status, detail },
        502,
        cors,
      );
    }

    const created = await ghResp.json();
    return json({ ok: true, issue: created.number }, 201, cors);
  },
};

function buildIssue({ message, type, ctx }) {
  const firstLine = message.split("\n")[0].slice(0, 80).trim();
  const title = `[feedback] ${firstLine || "New feedback"}`;

  const clip = (v) => String(v ?? "").slice(0, MAX_FIELD);
  const contextLines = [
    ctx.page && `- **Page:** ${clip(ctx.page)}`,
    ctx.appVersion && `- **App version:** ${clip(ctx.appVersion)}`,
    ctx.userAgent && `- **User agent:** ${clip(ctx.userAgent)}`,
    ctx.user && `- **User:** ${clip(ctx.user)}`,
  ].filter(Boolean);

  const body = [
    `**Type:** ${type}`,
    ``,
    `### Feedback`,
    message,
    ``,
    `### Context`,
    contextLines.length ? contextLines.join("\n") : "_none provided_",
    ``,
    `---`,
    `_Submitted via the faster-features widget._`,
  ].join("\n");

  return { title, body };
}

function resolveRepo(requested, env) {
  const fallback = String(env.GITHUB_REPO || "").trim();
  const allow = (env.ALLOWED_REPOS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const isRepo = (r) => /^[^/\s]+\/[^/\s]+$/.test(r);

  requested = String(requested || "").trim();
  if (requested) {
    // A widget-supplied repo is only honored if it's explicitly allow-listed.
    if (isRepo(requested) && allow.includes(requested)) return requested;
    return ""; // requested something we don't permit
  }
  return isRepo(fallback) ? fallback : "";
}

function originAllowed(origin, env) {
  const allow = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length === 0) return true; // no allow-list configured = open
  if (allow.includes("*")) return true;
  return allow.includes(origin);
}

function corsHeaders(origin, env) {
  const allowed = originAllowed(origin, env) && origin ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-ff-key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
