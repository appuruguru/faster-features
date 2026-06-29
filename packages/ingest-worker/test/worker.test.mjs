/**
 * Offline logic tests for the Worker. Mocks fetch / caches / KV so we can verify
 * routing, assign-on-create, roadmap mapping, voting, and webhook signature
 * handling without any Cloudflare or GitHub account.
 *
 *   node test/worker.test.mjs
 */
import assert from "node:assert";
import { createHmac } from "node:crypto";

let fetchCalls = [];
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

function makeKV() {
  const store = {};
  return {
    async get(k, opt) {
      const v = store[k];
      if (v == null) return null;
      return opt?.type === "json" ? JSON.parse(v) : v;
    },
    async put(k, v) { store[k] = v; },
  };
}

function ghResp(status, obj) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  };
}

// Route GitHub API calls by shape.
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  fetchCalls.push({ url, init });
  if (url.includes("/hooks") && (init.method || "GET") === "GET") return ghResp(200, []);
  if (url.includes("/issues?")) {
    return ghResp(200, [
      { number: 1, title: "[feedback] A", state: "open", labels: [{ name: "ff:backlog" }], updated_at: "x" },
      { number: 2, title: "B", state: "open", labels: [{ name: "ff:build" }], updated_at: "x" },
      { number: 3, title: "C", state: "closed", state_reason: "completed", labels: [{ name: "ff:roadmap" }], updated_at: "x" },
      { number: 4, title: "D", state: "closed", state_reason: "not_planned", labels: [], updated_at: "x" },
    ]);
  }
  if (url.endsWith("/issues") && init.method === "POST") return ghResp(201, { number: 7 });
  return ghResp(201, {}); // labels, hooks POST, comments, assignees, etc.
};

const { default: worker } = await import("../worker.js");

// Warm up once so the per-isolate bootstrap (labels + webhook) runs and won't
// pollute the per-test fetch-call assertions below.
await worker.fetch(new Request("https://w.example.com/", { method: "GET" }), {
  GITHUB_TOKEN: "t", GITHUB_REPO: "o/r", WEBHOOK_SECRET: "whsec",
});

const baseEnv = {
  GITHUB_TOKEN: "t", GITHUB_REPO: "o/r", OWNER: "me",
  BUILD_RUNNER: "claude-web", WEBHOOK_SECRET: "whsec",
  ALLOWED_ORIGINS: "*", ROADMAP_LABEL: "ff:roadmap",
};

const req = (method, path, { body, headers } = {}) =>
  new Request("https://w.example.com" + path, {
    method,
    headers: headers || {},
    body: body != null ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });

let passed = 0;
async function test(name, fn) {
  fetchCalls = [];
  try { await fn(); passed++; console.log("ok  -", name); }
  catch (e) { console.error("FAIL -", name, "\n    ", e.message); process.exitCode = 1; }
}

await test("GET /widget.js serves JS", async () => {
  const r = await worker.fetch(req("GET", "/widget.js"), baseEnv);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /javascript/);
  assert.match(await r.text(), /ff-btn/);
});

await test("OPTIONS returns 204", async () => {
  const r = await worker.fetch(req("OPTIONS", "/"), baseEnv);
  assert.equal(r.status, 204);
});

await test("POST / creates issue and assigns owner", async () => {
  const r = await worker.fetch(req("POST", "/", { body: { message: "hi", type: "idea" } }), baseEnv);
  assert.equal(r.status, 201);
  const create = fetchCalls.find((c) => c.url.endsWith("/issues") && c.init.method === "POST");
  assert.ok(create, "issue create call made");
  const sent = JSON.parse(create.init.body);
  assert.deepEqual(sent.assignees, ["me"]);
  assert.deepEqual(sent.labels, ["ff:feedback", "ff:pending-triage"]);
});

await test("POST / pings NOTIFY_WEBHOOK when set", async () => {
  const env = { ...baseEnv, NOTIFY_WEBHOOK: "https://discord.test/webhook" };
  const r = await worker.fetch(req("POST", "/", { body: { message: "hi", type: "idea" } }), env);
  assert.equal(r.status, 201);
  const ping = fetchCalls.find((c) => c.url === "https://discord.test/webhook");
  assert.ok(ping, "notification webhook called");
  assert.match(JSON.parse(ping.init.body).content, /New feedback/);
});

await test("POST / rejects empty message", async () => {
  const r = await worker.fetch(req("POST", "/", { body: { message: "" } }), baseEnv);
  assert.equal(r.status, 400);
  assert.equal(fetchCalls.length, 0);
});

await test("POST / honeypot silently accepts, no issue", async () => {
  const r = await worker.fetch(req("POST", "/", { body: { hp: "bot", message: "x" } }), baseEnv);
  assert.equal(r.status, 200);
  assert.equal(fetchCalls.length, 0);
});

await test("GET / roadmap maps statuses, excludes not_planned", async () => {
  const r = await worker.fetch(req("GET", "/"), baseEnv);
  assert.equal(r.status, 200);
  const { items, voting } = await r.json();
  assert.equal(voting, false);
  assert.equal(items.length, 3);
  assert.equal(items.find((i) => i.id === 1).status, "planned");
  assert.equal(items.find((i) => i.id === 2).status, "in_progress");
  assert.equal(items.find((i) => i.id === 3).status, "shipped");
  assert.equal(items.find((i) => i.id === 1).title, "A"); // [feedback] stripped
});

await test("POST /vote increments with KV", async () => {
  const env = { ...baseEnv, VOTES: makeKV() };
  let r = await worker.fetch(req("POST", "/vote", { body: { id: 2 } }), env);
  assert.deepEqual(await r.json(), { ok: true, id: 2, votes: 1 });
  r = await worker.fetch(req("POST", "/vote", { body: { id: 2 } }), env);
  assert.equal((await r.json()).votes, 2);
});

await test("POST /vote 501 without KV", async () => {
  const r = await worker.fetch(req("POST", "/vote", { body: { id: 2 } }), baseEnv);
  assert.equal(r.status, 501);
});

await test("roadmap exposes votes when KV present", async () => {
  const kv = makeKV();
  await kv.put("votes:o/r", JSON.stringify({ 2: 5 }));
  const r = await worker.fetch(req("GET", "/"), { ...baseEnv, VOTES: kv });
  const { items, voting } = await r.json();
  assert.equal(voting, true);
  assert.equal(items.find((i) => i.id === 2).votes, 5);
});

function sign(secret, body) {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

await test("POST /webhook build label triggers claude-web comment", async () => {
  const body = JSON.stringify({
    action: "labeled", label: { name: "ff:build" },
    issue: { number: 42 }, repository: { full_name: "o/r" },
  });
  const r = await worker.fetch(req("POST", "/webhook", {
    body,
    headers: { "x-github-event": "issues", "x-hub-signature-256": sign("whsec", body) },
  }), baseEnv);
  assert.equal(r.status, 200);
  const c = fetchCalls.find((x) => x.url.includes("/issues/42/comments"));
  assert.ok(c, "posted kickoff comment");
});

await test("POST /webhook rejects bad signature", async () => {
  const body = JSON.stringify({ action: "labeled", label: { name: "ff:build" }, issue: { number: 1 }, repository: { full_name: "o/r" } });
  const r = await worker.fetch(req("POST", "/webhook", {
    body,
    headers: { "x-github-event": "issues", "x-hub-signature-256": "sha256=deadbeef" },
  }), baseEnv);
  assert.equal(r.status, 401);
  assert.equal(fetchCalls.length, 0);
});

console.log(`\n${passed} passed.`);
