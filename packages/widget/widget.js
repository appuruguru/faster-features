/**
 * faster-features — feedback widget (vanilla, zero-dependency)
 *
 * Drop-in: add one script tag to any page.
 *
 *   <script src="widget.js"
 *           data-ingest-url="https://faster-features-ingest.you.workers.dev"
 *           data-app-version="1.4.2"
 *           data-key="optional-shared-secret"
 *           data-user="optional-user-id-or-email"></script>
 *
 * Or configure programmatically before the script loads:
 *   window.FasterFeatures = { ingestUrl: "...", appVersion: "...", user: "..." };
 *
 * The widget POSTs feedback to the ingest Worker. It never sees a GitHub token,
 * and the end user never needs a GitHub account.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var cfg = window.FasterFeatures || {};
  function attr(name, fallback) {
    if (script && script.getAttribute(name) != null) return script.getAttribute(name);
    return fallback;
  }

  // When the script is served by the Worker itself, default the ingest URL to
  // the script's own origin — so the embed can be a single line with no config.
  var scriptOrigin = "";
  try { if (script && script.src) scriptOrigin = new URL(script.src).origin; } catch (e) {}
  var ingestUrl = cfg.ingestUrl || attr("data-ingest-url", "") || scriptOrigin;
  var sharedKey = cfg.key || attr("data-key", "");
  var appVersion = cfg.appVersion || attr("data-app-version", "");
  var user = cfg.user || attr("data-user", "");
  var label = cfg.label || attr("data-label", "Feedback");
  // Optional: target repo when one shared Worker serves multiple repos.
  var repo = cfg.repo || attr("data-repo", "");
  // Optional: show a "Roadmap" link above the button, pointing at this path/URL.
  var roadmap = cfg.roadmap || attr("data-roadmap", "");

  if (!ingestUrl) {
    console.warn("[faster-features] No ingestUrl configured; widget disabled.");
    return;
  }

  injectStyles();

  var state = { type: "idea", sending: false };
  var refs = {};

  var button = el("button", { class: "ff-btn", type: "button" }, [label]);
  button.addEventListener("click", openModal);

  // Stack the (optional) roadmap link above the feedback button, bottom-right.
  var launcher = el("div", { class: "ff-launcher" });
  if (roadmap) {
    launcher.appendChild(el("a", { class: "ff-roadmap-link", href: roadmap }, ["Roadmap"]));
  }
  launcher.appendChild(button);
  document.body.appendChild(launcher);

  function openModal() {
    if (refs.overlay) return;
    var overlay = el("div", { class: "ff-overlay" });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });

    var typeIdea = tab("Idea", "idea");
    var typeBug = tab("Bug", "bug");

    var textarea = el("textarea", {
      class: "ff-textarea",
      rows: "5",
      placeholder: "What would make this better?",
    });

    // Honeypot — hidden from humans, tempting to bots.
    var honeypot = el("input", {
      class: "ff-hp", type: "text", tabindex: "-1", autocomplete: "off",
      "aria-hidden": "true",
    });

    var error = el("div", { class: "ff-error" });
    var submit = el("button", { class: "ff-submit", type: "button" }, ["Send"]);
    submit.addEventListener("click", function () {
      send(textarea.value, honeypot.value, error, submit);
    });

    var panel = el("div", { class: "ff-panel", role: "dialog", "aria-modal": "true" }, [
      el("div", { class: "ff-header" }, [
        el("span", { class: "ff-title" }, ["Send feedback"]),
        closeX(),
      ]),
      el("div", { class: "ff-types" }, [typeIdea, typeBug]),
      textarea,
      honeypot,
      error,
      submit,
    ]);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    refs = { overlay: overlay, textarea: textarea };
    textarea.focus();
    document.addEventListener("keydown", onEsc);
  }

  function tab(text, value) {
    var t = el("button", { class: "ff-type" + (state.type === value ? " ff-type--on" : ""), type: "button" }, [text]);
    t.addEventListener("click", function () {
      state.type = value;
      var all = document.querySelectorAll(".ff-type");
      for (var i = 0; i < all.length; i++) all[i].classList.remove("ff-type--on");
      t.classList.add("ff-type--on");
    });
    return t;
  }

  function send(message, hp, error, submit) {
    error.textContent = "";
    message = (message || "").trim();
    if (!message) {
      error.textContent = "Please enter some feedback.";
      return;
    }
    if (state.sending) return;
    state.sending = true;
    submit.disabled = true;
    submit.textContent = "Sending…";

    var headers = { "Content-Type": "application/json" };
    if (sharedKey) headers["x-ff-key"] = sharedKey;

    fetch(ingestUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        message: message,
        type: state.type,
        hp: hp || "",
        repo: repo,
        context: {
          // Path only — never the query string, which can carry tokens/PII.
          page: location.pathname,
          appVersion: appVersion,
          userAgent: navigator.userAgent,
          user: user, // only set if the host app explicitly passes one
        },
      }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function () {
        showThanks();
      })
      .catch(function () {
        state.sending = false;
        submit.disabled = false;
        submit.textContent = "Send";
        error.textContent = "Couldn't send right now. Please try again.";
      });
  }

  function showThanks() {
    if (!refs.overlay) return;
    var panel = refs.overlay.querySelector(".ff-panel");
    panel.innerHTML = "";
    panel.appendChild(
      el("div", { class: "ff-thanks" }, [
        el("div", { class: "ff-thanks-mark" }, ["✓"]),
        el("div", { class: "ff-thanks-text" }, ["Thanks! Your feedback was sent."]),
      ]),
    );
    setTimeout(closeModal, 1600);
  }

  function closeModal() {
    if (refs.overlay) refs.overlay.remove();
    refs = {};
    state.sending = false;
    state.type = "idea";
    document.removeEventListener("keydown", onEsc);
  }

  function onEsc(e) {
    if (e.key === "Escape") closeModal();
  }

  function closeX() {
    var x = el("button", { class: "ff-x", type: "button", "aria-label": "Close" }, ["×"]);
    x.addEventListener("click", closeModal);
    return x;
  }

  // --- tiny DOM helper ---
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (children) for (var i = 0; i < children.length; i++) {
      var c = children[i];
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function injectStyles() {
    var css =
      ".ff-launcher{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:8px}" +
      ".ff-btn{padding:10px 16px;border:none;border-radius:999px;background:#111;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}" +
      ".ff-btn:hover{background:#000}" +
      ".ff-roadmap-link{font:600 14px system-ui,sans-serif;color:#fff;background:rgba(17,17,17,.7);padding:10px 16px;border-radius:999px;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.25)}" +
      ".ff-roadmap-link:hover{background:#000}" +
      ".ff-overlay{position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}" +
      ".ff-panel{width:min(420px,92vw);background:#fff;color:#111;border-radius:14px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:14px system-ui,sans-serif}" +
      ".ff-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}" +
      ".ff-title{font-weight:700;font-size:16px}" +
      ".ff-x{border:none;background:none;font-size:22px;line-height:1;cursor:pointer;color:#888}" +
      ".ff-types{display:flex;gap:8px;margin-bottom:10px}" +
      ".ff-type{flex:1;padding:8px;border:1px solid #ddd;border-radius:8px;background:#fafafa;cursor:pointer;font:600 13px system-ui}" +
      ".ff-type--on{background:#111;color:#fff;border-color:#111}" +
      ".ff-textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ddd;border-radius:8px;font:14px system-ui;resize:vertical}" +
      ".ff-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}" +
      ".ff-error{color:#c0392b;font-size:13px;min-height:16px;margin:6px 0}" +
      ".ff-submit{width:100%;padding:11px;border:none;border-radius:8px;background:#111;color:#fff;font:600 14px system-ui;cursor:pointer}" +
      ".ff-submit:disabled{opacity:.6;cursor:default}" +
      ".ff-thanks{text-align:center;padding:24px 8px}" +
      ".ff-thanks-mark{width:44px;height:44px;border-radius:999px;background:#1aa251;color:#fff;font-size:24px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px}" +
      ".ff-thanks-text{font-weight:600}" +
      "@media(prefers-color-scheme:dark){.ff-panel{background:#1c1c1e;color:#f2f2f2}.ff-textarea,.ff-type{background:#2c2c2e;color:#f2f2f2;border-color:#3a3a3c}.ff-type--on{background:#f2f2f2;color:#111}}";
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }
})();
