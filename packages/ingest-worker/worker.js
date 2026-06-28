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
    // Public read endpoint for the roadmap/status page. GET is open to any
    // origin (it only returns dev-curated, safe fields — no bodies, no PII).
    if (request.method === "GET") {
      return handleRoadmap(request, env);
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, cors);
    }
    // Public upvote endpoint for the roadmap. Optional: only active if a VOTES
    // KV namespace is bound. Stores a count per issue — no identities, no PII.
    if (new URL(request.url).pathname.replace(/\/$/, "").endsWith("/vote")) {
      return handleVote(request, env);
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

/**
 * GET handler: returns the public roadmap as JSON.
 *
 * Only issues the dev opts in (via the ROADMAP_LABEL, default "roadmap") are
 * shown, and only safe fields — title + derived status. Bodies, reporters, and
 * raw context are never exposed. Cached briefly to spare the GitHub API.
 */
async function handleRoadmap(request, env) {
  const openCors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "public, max-age=60",
  };

  const url = new URL(request.url);
  const repo = resolveRepo(url.searchParams.get("repo"), env);
  if (!repo) return json({ error: "Repo not allowed" }, 400, openCors);

  // Short edge cache so a busy page doesn't hammer the GitHub API.
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const label = (env.ROADMAP_LABEL || "roadmap").trim();
  const [owner, name] = repo.split("/");
  const api =
    `https://api.github.com/repos/${owner}/${name}/issues` +
    `?state=all&per_page=100&labels=${encodeURIComponent(label)}`;

  const resp = await fetch(api, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "faster-features-ingest",
    },
  });
  if (!resp.ok) {
    return json({ error: "Failed to load roadmap" }, 502, openCors);
  }

  const issues = await resp.json();
  // Vote counts (optional). One KV read for the whole map if VOTES is bound.
  const votes = env.VOTES ? await readVotes(env, repo) : null;

  const items = issues
    .filter((i) => !i.pull_request) // issues only
    .map((i) => {
      const names = (i.labels || []).map((l) => (l.name || l).toLowerCase());
      let status = "planned";
      if (i.state === "closed") {
        if (i.state_reason === "not_planned") return null; // skip declined
        status = "shipped";
      } else if (names.includes("build") || names.includes("in-progress")) {
        status = "in_progress";
      } else if (names.includes("backlog")) {
        status = "planned";
      }
      const item = {
        id: i.number,
        title: i.title.replace(/^\[feedback\]\s*/i, ""),
        status, // planned | in_progress | shipped
        updatedAt: i.updated_at,
      };
      if (votes) item.votes = votes[i.number] || 0; // present only when enabled
      return item;
    })
    .filter(Boolean);

  const out = json({ items, voting: !!env.VOTES }, 200, openCors);
  await cache.put(cacheKey, out.clone());
  return out;
}

const VOTES_KEY = (repo) => `votes:${repo}`;

async function readVotes(env, repo) {
  try {
    return (await env.VOTES.get(VOTES_KEY(repo), { type: "json" })) || {};
  } catch {
    return {};
  }
}

/**
 * POST /vote — increment the vote count for one roadmap issue.
 * Stores counts only (no identity). Best-effort dedup is done client-side via
 * localStorage; this endpoint just tallies. Open to any origin (public action).
 */
async function handleVote(request, env) {
  const openCors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (!env.VOTES) {
    return json({ error: "Voting not enabled" }, 501, openCors);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, openCors);
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ error: "Invalid id" }, 400, openCors);
  }
  const repo = resolveRepo(body.repo, env);
  if (!repo) return json({ error: "Repo not allowed" }, 400, openCors);

  const key = VOTES_KEY(repo);
  const map = (await readVotes(env, repo)) || {};
  map[id] = (map[id] || 0) + 1;
  await env.VOTES.put(key, JSON.stringify(map));

  return json({ ok: true, id, votes: map[id] }, 200, openCors);
}

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
