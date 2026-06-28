#!/usr/bin/env node
/**
 * faster-features — one-command ingest setup.
 *
 *   npm run setup
 *
 * Automates everything scriptable: bundle the widgets, check deps + Cloudflare
 * auth, get a GitHub token (via `gh` if available), write config, upload
 * secrets, deploy, register the GitHub webhook, write the Worker URL back into
 * faster-features.config.yml, and print the one-line embed snippet.
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

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { shell: true, encoding: "utf8", ...opts });
}
function shInherit(cmd, args) {
  return spawnSync(cmd, args, { shell: true, stdio: "inherit" });
}
function openInBrowser(url) {
  const opener = platform === "win32" ? "start" : platform === "darwin" ? "open" : "xdg-open";
  sh(opener, [`"${url}"`]);
}
const log = (m) => console.log(`\n• ${m}`);
const uuid = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

async function main() {
  console.log("\n=== faster-features ingest setup ===");

  // 1. Bundle widgets into assets.js (so the Worker can serve /widget.js).
  log("Bundling widgets…");
  shInherit("node", ["bundle.mjs"]);

  // 2. wrangler available?
  if (sh("npx", ["wrangler", "--version"]).status !== 0) {
    log("Installing dependencies (wrangler)…");
    shInherit("npm", ["install"]);
  }

  // 3. Cloudflare auth (interactive unless CLOUDFLARE_API_TOKEN is set).
  if (process.env.CLOUDFLARE_API_TOKEN) {
    log("Using CLOUDFLARE_API_TOKEN from environment (non-interactive).");
  } else if (sh("npx", ["wrangler", "whoami"]).status !== 0) {
    log("Authorizing Cloudflare — a browser window will open. Click Allow.");
    shInherit("npx", ["wrangler", "login"]);
  } else {
    log("Cloudflare already authorized.");
  }

  // 4. Collect config.
  const repo = await ask("GitHub repo for this project (owner/name):");
  if (!/^[^/]+\/[^/]+$/.test(repo)) throw new Error(`"${repo}" is not owner/name`);
  const owner = await ask("GitHub login to notify (assigned to new issues):", repo.split("/")[0]);
  const origins = await ask("Allowed origins (comma-separated, or *):", "*");
  const runnerIn = (await ask("Build runner — claude-web / copilot / claude-api:", "claude-web")).toLowerCase();
  const buildRunner = ["claude-web", "copilot", "claude-api"].includes(runnerIn) ? runnerIn : "claude-web";
  const useSecret = (await ask("Add a shared secret to deter random POSTs? (y/N):", "n"))
    .toLowerCase().startsWith("y");
  const enableVotes = (await ask("Enable roadmap upvoting? Free KV, counts only — no PII. (y/N):", "n"))
    .toLowerCase().startsWith("y");

  // 5. GitHub token — prefer `gh`, fall back to a one-click page.
  let token = "";
  const ghTok = sh("gh", ["auth", "token"]);
  if (ghTok.status === 0 && ghTok.stdout.trim()) {
    const useGh = await ask("Found a GitHub CLI token. Use it? (Y/n):", "y");
    if (!useGh.toLowerCase().startsWith("n")) token = ghTok.stdout.trim();
  }
  if (!token) {
    const url =
      "https://github.com/settings/personal-access-tokens/new" +
      "?name=faster-features-ingest&description=Create+feedback+issues";
    log("Opening GitHub's fine-grained token page. Set:");
    console.log(`    Repository access : Only select repositories → ${repo}`);
    console.log("    Permissions       : Issues → Read and write, Webhooks → Read and write");
    openInBrowser(url);
    token = await ask("Paste the generated token:");
  }
  if (!token) throw new Error("A GitHub token is required.");

  const webhookSecret = uuid();
  let sharedSecret = "";
  if (useSecret) {
    sharedSecret = uuid();
    console.log(`    Shared secret (also pass to the widget as data-key):\n    ${sharedSecret}`);
  }

  // 6. Optionally create a KV namespace for roadmap upvotes.
  let kvBlock = "";
  if (enableVotes) {
    log("Creating KV namespace for votes…");
    const kv = sh("npx", ["wrangler", "kv", "namespace", "create", "VOTES"]);
    stdout.write(kv.stdout || "");
    const kvId = (kv.stdout.match(/id\s*=\s*"([0-9a-f]+)"/) || [])[1];
    if (kvId) kvBlock = `\n[[kv_namespaces]]\nbinding = "VOTES"\nid = "${kvId}"\n`;
    else log("Couldn't auto-detect the KV id — add the [[kv_namespaces]] block manually and re-deploy.");
  }

  // 7. Write wrangler.toml.
  log("Writing wrangler.toml…");
  const toml = [
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
  ].join("\n");
  await writeFile(wranglerToml, toml);

  // 8. Upload secrets (piped via stdin — non-interactive).
  log("Uploading secrets…");
  if (sh("npx", ["wrangler", "secret", "put", "GITHUB_TOKEN"], { input: token + "\n" }).status !== 0)
    throw new Error("Failed to set GITHUB_TOKEN secret.");
  sh("npx", ["wrangler", "secret", "put", "WEBHOOK_SECRET"], { input: webhookSecret + "\n" });
  if (sharedSecret)
    sh("npx", ["wrangler", "secret", "put", "SHARED_SECRET"], { input: sharedSecret + "\n" });

  // 9. Deploy and capture the URL.
  log("Deploying…");
  const deploy = sh("npx", ["wrangler", "deploy"]);
  stdout.write(deploy.stdout || "");
  if (deploy.status !== 0) {
    stdout.write(deploy.stderr || "");
    throw new Error("Deploy failed.");
  }
  const url = (deploy.stdout.match(/https:\/\/[^\s]+\.workers\.dev/) || [])[0];
  if (!url) throw new Error("Deployed, but couldn't detect the Worker URL.");

  // 10. Register the GitHub webhook (so labels drive the build with no in-repo file).
  log("Registering GitHub webhook…");
  try {
    const result = await registerWebhook(repo, token, webhookSecret, url);
    console.log(`    Webhook ${result}.`);
  } catch (e) {
    console.log(`    ⚠ Could not register webhook automatically: ${e.message}`);
    console.log(`    Add one manually: repo Settings → Webhooks → Add → ${url}/webhook,`);
    console.log(`    content type application/json, event "Issues", secret = the WEBHOOK_SECRET.`);
  }

  // 11. Write the URL back into faster-features.config.yml.
  if (existsSync(rootConfig)) {
    let cfg = await readFile(rootConfig, "utf8");
    cfg = cfg.replace(/^(\s*ingestUrl:).*$/m, `$1 ${url}`);
    cfg = cfg.replace(/^(\s*repo:).*$/m, `$1 ${repo}`);
    cfg = cfg.replace(/^(\s*owner:).*$/m, `$1 ${owner}`);
    cfg = cfg.replace(/^(\s*buildRunner:).*$/m, `$1 ${buildRunner}`);
    await writeFile(rootConfig, cfg);
  }

  // 12. Done — print the copy-paste snippet.
  console.log("\n✅ Done.\n");
  console.log("   Paste this one line into your app (before </body>):\n");
  console.log(`   <script src="${url}/widget.js"></script>\n`);
  console.log("   Public roadmap (optional), on any page:\n");
  console.log(`   <div id="ff-roadmap"></div>`);
  console.log(`   <script src="${url}/roadmap.js"></script>\n`);
  if (sharedSecret) {
    console.log(`   (Shared secret on: add data-key="${sharedSecret}" to the widget script.)\n`);
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
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "web",
      active: true,
      events: ["issues"],
      config: { url: hookUrl, content_type: "json", secret },
    }),
  });
  if (!resp.ok) throw new Error(`${resp.status} ${(await resp.text()).slice(0, 120)}`);
  return "created";
}

main()
  .catch((e) => {
    console.error(`\n✗ ${e.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
