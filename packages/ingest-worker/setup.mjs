#!/usr/bin/env node
/**
 * faster-features — one-command ingest setup.
 *
 *   npm run setup
 *
 * Collects all answers first (so readline owns stdin cleanly), then deploys:
 * bundle, Cloudflare auth, secrets, KV, deploy, labels, webhook, and prints the
 * one-line embed snippet.
 *
 * Two steps stay interactive by design (security): authorizing Cloudflare
 * (browser "Allow", unless CLOUDFLARE_API_TOKEN is set) and approving a GitHub
 * token.
 */
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, platform } from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const rootConfig = join(here, "..", "..", "faster-features.config.yml");
const wranglerToml = join(here, "wrangler.toml");

const rl = createInterface({ input: stdin, output: stdout });
const ask = (q, def) =>
  rl.question(def ? `${q} [${def}] ` : `${q} `).then((a) => a.trim() || def || "");

// Pass a single command string (not an args array) to avoid Node's DEP0190
// warning about args + shell. Our values go into files/stdin, never shell args.
function run(cmdline, opts = {}) {
  return spawnSync(cmdline, { shell: true, encoding: "utf8", ...opts });
}
const sh = (cmd, args = [], opts = {}) => run([cmd, ...args].join(" "), opts);
// Inherit stdout/stderr but NOT stdin (so child processes don't steal readline).
const shOut = (cmd, args = []) => run([cmd, ...args].join(" "), { stdio: ["ignore", "inherit", "inherit"] });
// Full inherit — only for genuinely interactive children, run after prompts.
const shTTY = (cmd, args = []) => run([cmd, ...args].join(" "), { stdio: "inherit" });

function openInBrowser(url) {
  if (platform === "win32") run(`start "" "${url}"`, { stdio: "ignore" });
  else if (platform === "darwin") run(`open "${url}"`, { stdio: "ignore" });
  else run(`xdg-open "${url}"`, { stdio: "ignore" });
}
const log = (m) => console.log(`\n• ${m}`);
const uuid = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

async function main() {
  console.log("\n=== faster-features ingest setup ===\n");

  // ---- 1. Collect ALL input first (nothing touches stdin until rl.close) ----
  const repo = await ask("GitHub repo for this project (owner/name):");
  if (!/^[^/]+\/[^/]+$/.test(repo)) throw new Error(`"${repo}" is not owner/name`);
  const owner = await ask("GitHub login to notify (assigned to new issues):", repo.split("/")[0]);
  const origins = await ask("Allowed origins (comma-separated, or *):", "*");
  const runnerIn = (await ask("Build runner — claude-web / copilot / claude-api:", "claude-web")).toLowerCase();
  const buildRunner = ["claude-web", "copilot", "claude-api"].includes(runnerIn) ? runnerIn : "claude-web";
  const useSecret = (await ask("Add a shared secret to deter random POSTs? (y/N):", "n")).toLowerCase().startsWith("y");
  const enableVotes = (await ask("Enable roadmap upvoting? Free KV, counts only — no PII. (y/N):", "n")).toLowerCase().startsWith("y");

  // GitHub token — prefer `gh` (pipe, doesn't touch our stdin), else one-click page.
  let token = "";
  const ghTok = sh("gh", ["auth", "token"]);
  if (ghTok.status === 0 && ghTok.stdout.trim()) {
    const useGh = await ask("Found a GitHub CLI token. Use it? (Y/n):", "y");
    if (!useGh.toLowerCase().startsWith("n")) token = ghTok.stdout.trim();
  }
  if (!token) {
    const url = "https://github.com/settings/personal-access-tokens/new?name=faster-features-ingest";
    log("Opening GitHub's fine-grained token page. Set:");
    console.log(`    Repository access : Only select repositories -> ${repo}`);
    console.log("    Permissions       : Issues = Read/write, Webhooks = Read/write");
    openInBrowser(url);
    token = await ask("Paste the generated token:");
  }
  if (!token) throw new Error("A GitHub token is required.");

  // Cloudflare API token — wrangler requires this for non-interactive (scripted)
  // use; its browser OAuth login does NOT work when wrangler is run from a script.
  let cfToken = process.env.CLOUDFLARE_API_TOKEN || "";
  if (!cfToken) {
    log("Opening the Cloudflare API token page.");
    console.log("    Create Token → use the 'Edit Cloudflare Workers' template → Continue → Create → copy it.");
    openInBrowser("https://dash.cloudflare.com/profile/api-tokens");
    cfToken = await ask("Paste the Cloudflare API token:");
  }
  if (!cfToken) throw new Error("A Cloudflare API token is required.");

  rl.close(); // done with stdin

  // Every wrangler call runs with the token in its environment.
  const wenv = { ...process.env, CLOUDFLARE_API_TOKEN: cfToken };

  // ---- 2. Bundle widgets into assets.js (no-op for standalone copies) ----
  log("Bundling widgets…");
  shOut("node", ["bundle.mjs"]);

  // ---- 3. Ensure wrangler ----
  if (sh("npx", ["wrangler", "--version"]).status !== 0) {
    log("Installing dependencies (wrangler)…");
    shOut("npm", ["install"]);
  }

  // ---- 4. Validate token + capture account id. Setting CLOUDFLARE_ACCOUNT_ID
  //          lets wrangler skip the /memberships lookup, which needs a broader
  //          User-level permission the token usually doesn't have. ----
  log("Checking Cloudflare token…");
  const who = sh("npx", ["wrangler", "whoami"], { env: wenv });
  const acctId = ((who.stdout || "") + (who.stderr || "")).match(/\b[0-9a-f]{32}\b/);
  if (acctId) {
    wenv.CLOUDFLARE_ACCOUNT_ID = acctId[0];
  } else {
    stdout.write((who.stdout || "") + (who.stderr || ""));
    throw new Error("Couldn't read your Cloudflare account id — does the token have Account Settings: Read?");
  }

  const webhookSecret = uuid();
  let sharedSecret = "";
  if (useSecret) {
    sharedSecret = uuid();
    console.log(`    Shared secret (also pass to the widget as data-key):\n    ${sharedSecret}`);
  }

  // ---- 5. Optional KV namespace for upvotes ----
  let kvBlock = "";
  if (enableVotes) {
    log("Setting up KV namespace for votes…");
    let kvId = "";
    // Reuse an existing namespace so re-runs don't pile up duplicates.
    const list = sh("npx", ["wrangler", "kv", "namespace", "list"], { env: wenv });
    const arr = (list.stdout || "").match(/\[\s*{[\s\S]*}\s*\]/);
    if (arr) {
      try {
        const found = JSON.parse(arr[0]).find((n) => /VOTES$/.test(n.title || ""));
        if (found) kvId = found.id;
      } catch {}
    }
    if (!kvId) {
      const kv = sh("npx", ["wrangler", "kv", "namespace", "create", "VOTES"], { env: wenv });
      const kvOut = (kv.stdout || "") + (kv.stderr || "");
      stdout.write(kvOut);
      kvId = (kvOut.match(/"?id"?\s*[:=]\s*"([0-9a-f]{8,})"/) || [])[1] || "";
    }
    if (kvId) kvBlock = `\n[[kv_namespaces]]\nbinding = "VOTES"\nid = "${kvId}"\n`;
    else log("Couldn't determine the KV id — voting stays off; add the [[kv_namespaces]] block later and redeploy.");
  }

  // ---- 6. Write wrangler.toml ----
  log("Writing wrangler.toml…");
  await writeFile(wranglerToml, [
    `name = "faster-features-ingest"`,
    `main = "worker.js"`,
    `compatibility_date = "2026-01-01"`,
    ``,
    `[vars]`,
    `GITHUB_REPO = "${repo}"`,
    `OWNER = "${owner}"`,
    `BUILD_RUNNER = "${buildRunner}"`,
    `ALLOWED_ORIGINS = "${origins}"`,
    `ROADMAP_LABEL = "roadmap"`,
    kvBlock,
  ].join("\n"));

  // ---- 7. Deploy first (so the Worker exists before we set secrets) ----
  log("Deploying…");
  const deploy = sh("npx", ["wrangler", "deploy"], { env: wenv });
  stdout.write((deploy.stdout || "") + (deploy.stderr || ""));
  if (deploy.status !== 0) throw new Error("Deploy failed (see output above).");
  const url = (deploy.stdout.match(/https:\/\/[^\s]+\.workers\.dev/) || [])[0];
  if (!url) throw new Error("Deployed, but couldn't detect the Worker URL.");

  // ---- 8. Secrets (the Worker now exists; secrets apply live, no redeploy) ----
  log("Uploading secrets…");
  const putSecret = (name, val) => {
    const r = sh("npx", ["wrangler", "secret", "put", name], { input: val + "\n", env: wenv });
    if (r.status !== 0) {
      stdout.write((r.stdout || "") + (r.stderr || ""));
      throw new Error(`Failed to set ${name} secret (see output above).`);
    }
  };
  putSecret("GITHUB_TOKEN", token);
  putSecret("WEBHOOK_SECRET", webhookSecret);
  if (sharedSecret) putSecret("SHARED_SECRET", sharedSecret);

  // ---- 9. Labels + webhook (idempotent) ----
  log("Creating labels…");
  await createLabels(repo, token);
  log("Registering GitHub webhook…");
  try {
    console.log(`    Webhook ${await registerWebhook(repo, token, webhookSecret, url)}.`);
  } catch (e) {
    console.log(`    ⚠ Could not register webhook: ${e.message}`);
    console.log(`    Add manually: ${repo} Settings → Webhooks → ${url}/webhook, JSON, event Issues, secret = WEBHOOK_SECRET.`);
  }

  // ---- 10. Write URL back into faster-features.config.yml if present ----
  if (existsSync(rootConfig)) {
    let cfg = await readFile(rootConfig, "utf8");
    cfg = cfg.replace(/^(\s*ingestUrl:).*$/m, `$1 ${url}`);
    cfg = cfg.replace(/^(\s*repo:).*$/m, `$1 ${repo}`);
    cfg = cfg.replace(/^(\s*owner:).*$/m, `$1 ${owner}`);
    cfg = cfg.replace(/^(\s*buildRunner:).*$/m, `$1 ${buildRunner}`);
    await writeFile(rootConfig, cfg);
  }

  // ---- 11. Done ----
  console.log("\n✅ Done.\n");
  console.log("   Paste this one line into your app (before </body>):\n");
  console.log(`   <script src="${url}/widget.js"></script>\n`);
  console.log("   Optional public roadmap, on any page:");
  console.log(`   <div id="ff-roadmap"></div>`);
  console.log(`   <script src="${url}/roadmap.js"></script>\n`);
  if (sharedSecret) console.log(`   (Add data-key="${sharedSecret}" to the widget script.)\n`);
}

const LABELS = [
  { name: "feedback", color: "0e8a16", description: "Incoming user feedback" },
  { name: "pending-triage", color: "fbca04", description: "Awaiting your review" },
  { name: "backlog", color: "c5def5", description: "Shelved on the roadmap as Planned" },
  { name: "build", color: "1d76db", description: "Approved - kicks off the AI build" },
  { name: "roadmap", color: "5319e7", description: "Show on the public roadmap" },
  { name: "in-progress", color: "d93f0b", description: "Being worked on" },
];

async function createLabels(repo, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "faster-features-setup",
    "Content-Type": "application/json",
  };
  for (const label of LABELS) {
    const resp = await fetch(`https://api.github.com/repos/${repo}/labels`, {
      method: "POST", headers, body: JSON.stringify(label),
    });
    if (!resp.ok && resp.status !== 422) console.log(`    ⚠ label ${label.name}: ${resp.status}`);
  }
}

async function registerWebhook(repo, token, secret, workerUrl) {
  const api = `https://api.github.com/repos/${repo}/hooks`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "faster-features-setup",
    "Content-Type": "application/json",
  };
  const hookUrl = workerUrl.replace(/\/$/, "") + "/webhook";
  const list = await fetch(api, { headers });
  if (list.ok) {
    const hooks = await list.json();
    if (hooks.some((h) => h.config && h.config.url === hookUrl)) return "already present";
  }
  const resp = await fetch(api, {
    method: "POST", headers,
    body: JSON.stringify({ name: "web", active: true, events: ["issues"], config: { url: hookUrl, content_type: "json", secret } }),
  });
  if (!resp.ok) throw new Error(`${resp.status} ${(await resp.text()).slice(0, 120)}`);
  return "created";
}

main()
  .catch((e) => { console.error(`\n✗ ${e.message}\n`); process.exitCode = 1; })
  .finally(() => { try { rl.close(); } catch {} });
