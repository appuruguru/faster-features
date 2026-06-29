/**
 * faster-features — ingest Worker (self-contained)
 *
 * The single piece of "infrastructure": a stateless Cloudflare Worker the repo
 * owner deploys to their own free account. It does ALL the work so nothing needs
 * to be committed to the target repo:
 *
 *   GET  /widget.js   serve the feedback widget (so the embed is a one-liner)
 *   GET  /roadmap.js  serve the public roadmap widget
 *   GET  /            public roadmap data (title + status only)
 *   POST /            create a feedback issue (and assign the owner → mobile push)
 *   POST /vote        upvote a roadmap item (optional; needs VOTES KV)
 *   POST /webhook     GitHub webhook: on the `build` label, kick off the runner
 *
 * Required:
 *   GITHUB_TOKEN     secret — fine-grained, Issues:write (+ Webhooks:write to
 *                    auto-register the hook during setup)
 *   GITHUB_REPO      "owner/name"
 *   OWNER            github login assigned to new issues (fires their push)
 * Optional:
 *   ALLOWED_ORIGINS  comma list of sites allowed to POST feedback ("*" = any)
 *   SHARED_SECRET    secret — value the widget must send as x-ff-key
 *   WEBHOOK_SECRET   secret — verifies GitHub webhook payloads
 *   BUILD_RUNNER     "claude-web" (default) | "copilot" | "claude-api"
 *   ROADMAP_LABEL    label that opts an item onto the public roadmap (def "roadmap")
 *   ALLOWED_REPOS    comma list — lets one Worker serve several repos
 *   VOTES            KV namespace binding — enables upvoting when present
 */
import { WIDGET_JS, ROADMAP_JS } from "./assets.js";

const MAX_MESSAGE = 5000;
const MAX_FIELD = 500;
const enc = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const origin = request.headers.get("Origin") || "";

    // Embeddable assets — public, any origin, cached.
    if (request.method === "GET" && path === "/widget.js") return serveJs(WIDGET_JS);
    if (request.method === "GET" && path === "/roadmap.js") return serveJs(ROADMAP_JS);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    // First real request bootstraps the repo (labels + webhook) so BOTH the
    // terminal setup and the no-terminal Deploy button end up fully wired.
    await ensureBootstrap(env, url.origin);

    // GitHub webhook (server-to-server; signature-verified).
    if (request.method === "POST" && path === "/webhook") return handleWebhook(request, env);

    // Public roadmap data.
    if (request.method === "GET") return handleRoadmap(request, env);

    // Upvote.
    if (request.method === "POST" && path === "/vote") return handleVote(request, env);

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, corsHeaders(origin, env));
    }

    // Feedback submission (POST /).
    return handleFeedback(request, env, origin);
  },
};

// ---------------------------------------------------------------------------
// Feedback intake
// ---------------------------------------------------------------------------

async function handleFeedback(request, env, origin) {
  const cors = corsHeaders(origin, env);

  if (!originAllowed(origin, env)) return json({ error: "Origin not allowed" }, 403, cors);
  if (env.SHARED_SECRET && request.headers.get("x-ff-key") !== env.SHARED_SECRET) {
    return json({ error: "Unauthorized" }, 401, cors);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, cors);
  }

  if (payload.hp) return json({ ok: true }, 200, cors); // honeypot

  const message = String(payload.message || "").trim();
  if (!message) return json({ error: "Message is required" }, 400, cors);
  if (message.length > MAX_MESSAGE) return json({ error: "Message too long" }, 400, cors);

  const type = payload.type === "bug" ? "Bug report" : "Idea / feature request";
  const issue = buildIssue({ message, type, ctx: payload.context || {} });

  const repo = resolveRepo(payload.repo, env);
  if (!repo) return json({ error: "Repo not allowed or worker misconfigured" }, 400, cors);
  const [owner, name] = repo.split("/");

  const bodyObj = {
    title: issue.title,
    body: issue.body,
    labels: ["feedback", "pending-triage"],
  };
  // Assigning the owner is what fires their GitHub Mobile push — no workflow needed.
  if (env.OWNER) bodyObj.assignees = [env.OWNER];

  const resp = await gh(env, `/repos/${owner}/${name}/issues`, "POST", bodyObj);
  if (!resp.ok) {
    return json({ error: "Failed to create issue", status: resp.status }, 502, cors);
  }
  const created = await resp.json();
  // Optional: ping a Discord (or any) webhook so you actually get notified —
  // GitHub suppresses the self-assignment push when the Worker uses your token.
  if (env.NOTIFY_WEBHOOK) await notify(env, created, type);
  return json({ ok: true, issue: created.number }, 201, cors);
}

async function notify(env, issue, type) {
  try {
    await fetch(env.NOTIFY_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `🆕 **New feedback** (${type})\n${issue.title}\n${issue.html_url}`,
      }),
    });
  } catch {
    // Notifications are best-effort; never fail the feedback submission.
  }
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

// ---------------------------------------------------------------------------
// GitHub webhook → build routing
// ---------------------------------------------------------------------------

async function handleWebhook(request, env) {
  const body = await request.text();
  const sig = request.headers.get("x-hub-signature-256") || "";
  if (!env.WEBHOOK_SECRET || !(await verifySignature(env.WEBHOOK_SECRET, body, sig))) {
    return json({ error: "Bad signature" }, 401, {});
  }
  if (request.headers.get("x-github-event") !== "issues") {
    return json({ ok: true, ignored: true }, 200, {});
  }

  let p;
  try {
    p = JSON.parse(body);
  } catch {
    return json({ error: "Invalid JSON" }, 400, {});
  }
  if (p.action !== "labeled") return json({ ok: true }, 200, {});

  const label = ((p.label && p.label.name) || "").toLowerCase();
  const issueNo = p.issue && p.issue.number;
  const repo = p.repository && p.repository.full_name;
  if (label === "build" && issueNo && repo) {
    await handleBuild(env, repo, issueNo);
  }
  return json({ ok: true }, 200, {});
}

async function handleBuild(env, repo, issueNo) {
  const runner = env.BUILD_RUNNER || "claude-web";
  if (runner === "copilot") {
    await gh(env, `/repos/${repo}/issues/${issueNo}/assignees`, "POST", {
      assignees: ["copilot-swe-agent"],
    });
    await comment(env, repo, issueNo,
      "🤖 Assigned to **GitHub Copilot coding agent** — it will open a draft PR.");
  } else if (runner === "claude-web") {
    await comment(env, repo, issueNo, [
      "🟢 **Approved for build.** Kick it off on your subscription — no API token:",
      "",
      "1. Open **Claude Code on the web** (https://claude.ai/code).",
      `2. Select the \`${repo}\` repo.`,
      `3. Say: *"Implement issue #${issueNo}. Keep it small and focused; open a PR."*`,
    ].join("\n"));
  }
  // claude-api is handled by the optional GitHub Action, not the Worker.
}

function comment(env, repo, issueNo, bodyText) {
  return gh(env, `/repos/${repo}/issues/${issueNo}/comments`, "POST", { body: bodyText });
}

// ---------------------------------------------------------------------------
// Public roadmap + upvoting
// ---------------------------------------------------------------------------

async function handleRoadmap(request, env) {
  const openCors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "public, max-age=60",
  };
  const url = new URL(request.url);
  const repo = resolveRepo(url.searchParams.get("repo"), env);
  if (!repo) return json({ error: "Repo not allowed" }, 400, openCors);

  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const label = (env.ROADMAP_LABEL || "roadmap").trim();
  const resp = await gh(
    env,
    `/repos/${repo}/issues?state=all&per_page=100&labels=${encodeURIComponent(label)}`,
    "GET",
  );
  if (!resp.ok) return json({ error: "Failed to load roadmap" }, 502, openCors);

  const issues = await resp.json();
  const votes = env.VOTES ? await readVotes(env, repo) : null;

  const items = issues
    .filter((i) => !i.pull_request)
    .map((i) => {
      const names = (i.labels || []).map((l) => (l.name || l).toLowerCase());
      let status = "planned";
      if (i.state === "closed") {
        if (i.state_reason === "not_planned") return null;
        status = "shipped";
      } else if (names.includes("build") || names.includes("in-progress")) {
        status = "in_progress";
      } else if (names.includes("backlog")) {
        status = "planned";
      }
      const item = {
        id: i.number,
        title: i.title.replace(/^\[feedback\]\s*/i, ""),
        status,
        updatedAt: i.updated_at,
      };
      if (votes) item.votes = votes[i.number] || 0;
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

async function handleVote(request, env) {
  const openCors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (!env.VOTES) return json({ error: "Voting not enabled" }, 501, openCors);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, openCors);
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid id" }, 400, openCors);
  const repo = resolveRepo(body.repo, env);
  if (!repo) return json({ error: "Repo not allowed" }, 400, openCors);

  const map = (await readVotes(env, repo)) || {};
  map[id] = (map[id] || 0) + 1;
  await env.VOTES.put(VOTES_KEY(repo), JSON.stringify(map));
  return json({ ok: true, id, votes: map[id] }, 200, openCors);
}

// ---------------------------------------------------------------------------
// One-time bootstrap: create labels + register the webhook (idempotent)
// ---------------------------------------------------------------------------

let bootstrapped = false; // per-isolate guard

const BOOTSTRAP_LABELS = [
  { name: "feedback", color: "0e8a16", description: "Incoming user feedback" },
  { name: "pending-triage", color: "fbca04", description: "Awaiting your review" },
  { name: "backlog", color: "c5def5", description: "Shelved on the roadmap as Planned" },
  { name: "build", color: "1d76db", description: "Approved - kicks off the AI build" },
  { name: "roadmap", color: "5319e7", description: "Show on the public roadmap" },
  { name: "in-progress", color: "d93f0b", description: "Being worked on" },
];

async function ensureBootstrap(env, origin) {
  if (bootstrapped) return;
  bootstrapped = true;
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return;
  try {
    // If KV is available, persist the flag so it runs once ever, not per isolate.
    const flagKey = `bootstrap:${env.GITHUB_REPO}`;
    if (env.VOTES && (await env.VOTES.get(flagKey))) return;
    await bootstrap(env, origin);
    if (env.VOTES) await env.VOTES.put(flagKey, "1");
  } catch {
    // Best-effort + idempotent; a later cold start retries.
  }
}

async function bootstrap(env, origin) {
  const repo = env.GITHUB_REPO;
  for (const label of BOOTSTRAP_LABELS) {
    await gh(env, `/repos/${repo}/labels`, "POST", label); // 422 if it exists — fine
  }
  if (env.WEBHOOK_SECRET) {
    const hookUrl = origin + "/webhook";
    const list = await gh(env, `/repos/${repo}/hooks`, "GET");
    if (list.ok) {
      const hooks = await list.json();
      if (hooks.some?.((h) => h.config && h.config.url === hookUrl)) return;
    }
    await gh(env, `/repos/${repo}/hooks`, "POST", {
      name: "web",
      active: true,
      events: ["issues"],
      config: { url: hookUrl, content_type: "json", secret: env.WEBHOOK_SECRET },
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gh(env, pathOrUrl, method, bodyObj) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `https://api.github.com${pathOrUrl}`;
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "faster-features-ingest",
    },
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
  });
}

async function verifySignature(secret, body, sigHeader) {
  if (!sigHeader.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual("sha256=" + hex, sigHeader);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function resolveRepo(requested, env) {
  const fallback = String(env.GITHUB_REPO || "").trim();
  const allow = (env.ALLOWED_REPOS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const isRepo = (r) => /^[^/\s]+\/[^/\s]+$/.test(r);
  requested = String(requested || "").trim();
  if (requested) {
    if (isRepo(requested) && allow.includes(requested)) return requested;
    return "";
  }
  return isRepo(fallback) ? fallback : "";
}

function originAllowed(origin, env) {
  const allow = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length === 0) return true;
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

function serveJs(src) {
  return new Response(src, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
