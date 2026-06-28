#!/usr/bin/env node
/**
 * faster-features — one-command ingest setup.
 *
 *   npm run setup
 *
 * Automates everything scriptable: dependency check, Cloudflare auth check,
 * GitHub token acquisition (via `gh` if available), wrangler.toml config,
 * secret upload, deploy, and writing the Worker URL back into
 * faster-features.config.yml.
 *
 * Two steps stay interactive by design (security): authorizing Cloudflare
 * (browser "Allow", unless CLOUDFLARE_API_TOKEN is set) and approving a GitHub
 * token. The script makes both as painless as possible.
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

async function main() {
  console.log("\n=== faster-features ingest setup ===");

  // 1. wrangler available?
  log("Checking for wrangler…");
  if (sh("npx", ["wrangler", "--version"]).status !== 0) {
    log("Installing dependencies (wrangler)…");
    shInherit("npm", ["install"]);
  }

  // 2. Cloudflare auth (interactive unless CLOUDFLARE_API_TOKEN is set).
  if (process.env.CLOUDFLARE_API_TOKEN) {
    log("Using CLOUDFLARE_API_TOKEN from environment (non-interactive).");
  } else if (sh("npx", ["wrangler", "whoami"]).status !== 0) {
    log("Authorizing Cloudflare — a browser window will open. Click Allow.");
    shInherit("npx", ["wrangler", "login"]);
  } else {
    log("Cloudflare already authorized.");
  }

  // 3. Collect config.
  const repo = await ask("GitHub repo for this project (owner/name):");
  if (!/^[^/]+\/[^/]+$/.test(repo)) throw new Error(`"${repo}" is not owner/name`);
  const origins = await ask(
    "Allowed origins (comma-separated sites that may send feedback, or *):",
    "*",
  );
  const useSecret = (await ask("Add a shared secret to deter random POSTs? (y/N):", "n"))
    .toLowerCase()
    .startsWith("y");
  const enableVotes = (await ask("Enable roadmap upvoting? Creates a free KV store, counts only — no PII. (y/N):", "n"))
    .toLowerCase()
    .startsWith("y");

  // 4. GitHub token — prefer `gh`, fall back to a one-click page.
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
    console.log("    Permissions       : Issues → Read and write");
    openInBrowser(url);
    token = await ask("Paste the generated token:");
  }
  if (!token) throw new Error("A GitHub token is required.");

  let sharedSecret = "";
  if (useSecret) {
    sharedSecret =
      globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    console.log(`    Generated shared secret (also pass to the widget as data-key):\n    ${sharedSecret}`);
  }

  // 5. Optionally create a KV namespace for roadmap upvotes.
  let kvBlock = "";
  if (enableVotes) {
    log("Creating KV namespace for votes…");
    const kv = sh("npx", ["wrangler", "kv", "namespace", "create", "VOTES"]);
    stdout.write(kv.stdout || "");
    const kvId = (kv.stdout.match(/id\s*=\s*"([0-9a-f]+)"/) || [])[1];
    if (kvId) {
      kvBlock = `\n[[kv_namespaces]]\nbinding = "VOTES"\nid = "${kvId}"\n`;
    } else {
      log("Couldn't auto-detect the KV id. Add the [[kv_namespaces]] block to wrangler.toml manually, then re-deploy.");
    }
  }

  // 6. Write wrangler.toml [vars] (+ KV binding if enabled).
  log("Writing wrangler.toml…");
  const toml = [
    `name = "faster-features-ingest"`,
    `main = "worker.js"`,
    `compatibility_date = "2026-01-01"`,
    ``,
    `[vars]`,
    `GITHUB_REPO = "${repo}"`,
    `ALLOWED_ORIGINS = "${origins}"`,
    `ROADMAP_LABEL = "roadmap"`,
    kvBlock,
  ].join("\n");
  await writeFile(wranglerToml, toml);

  // 7. Upload secrets (value piped via stdin — non-interactive).
  log("Uploading GITHUB_TOKEN secret…");
  if (sh("npx", ["wrangler", "secret", "put", "GITHUB_TOKEN"], { input: token + "\n" }).status !== 0)
    throw new Error("Failed to set GITHUB_TOKEN secret.");
  if (sharedSecret) {
    log("Uploading SHARED_SECRET secret…");
    sh("npx", ["wrangler", "secret", "put", "SHARED_SECRET"], { input: sharedSecret + "\n" });
  }

  // 8. Deploy and capture the URL.
  log("Deploying…");
  const deploy = sh("npx", ["wrangler", "deploy"]);
  stdout.write(deploy.stdout || "");
  if (deploy.status !== 0) {
    stdout.write(deploy.stderr || "");
    throw new Error("Deploy failed.");
  }
  const url = (deploy.stdout.match(/https:\/\/[^\s]+\.workers\.dev/) || [])[0];

  // 9. Write the URL back into faster-features.config.yml.
  if (url && existsSync(rootConfig)) {
    log(`Writing ingestUrl into faster-features.config.yml…`);
    let cfg = await readFile(rootConfig, "utf8");
    cfg = cfg.replace(/^(\s*ingestUrl:).*$/m, `$1 ${url}`);
    cfg = cfg.replace(/^(\s*repo:).*$/m, `$1 ${repo}`);
    await writeFile(rootConfig, cfg);
  }

  console.log("\n✅ Done.");
  if (url) {
    console.log(`\n   Worker URL: ${url}`);
    console.log("   Point the widget's data-ingest-url at that.");
  }
  if (sharedSecret) console.log(`   Widget data-key: ${sharedSecret}`);
  console.log("");
}

main()
  .catch((e) => {
    console.error(`\n✗ ${e.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
