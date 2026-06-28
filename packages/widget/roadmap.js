/**
 * faster-features — public roadmap widget (vanilla, zero-dependency)
 *
 * Shows end users which requests are Planned / In progress / Shipped, reading
 * from the ingest Worker's public GET endpoint. Only items the dev labels
 * `roadmap` appear, and only safe fields (title + status).
 *
 *   <div id="ff-roadmap"></div>
 *   <script src="roadmap.js"
 *           data-ingest-url="https://faster-features-ingest.you.workers.dev"
 *           data-repo="owner/name"        // optional, multi-repo workers
 *           data-mount="#ff-roadmap"></script>
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var cfg = window.FasterFeaturesRoadmap || {};
  function attr(n, d) {
    if (script && script.getAttribute(n) != null) return script.getAttribute(n);
    return d;
  }
  var ingestUrl = cfg.ingestUrl || attr("data-ingest-url", "");
  var repo = cfg.repo || attr("data-repo", "");
  var mountSel = cfg.mount || attr("data-mount", "#ff-roadmap");

  if (!ingestUrl) {
    console.warn("[faster-features] roadmap: no ingestUrl configured.");
    return;
  }

  var COLUMNS = [
    { key: "planned", title: "Planned" },
    { key: "in_progress", title: "In progress" },
    { key: "shipped", title: "Shipped" },
  ];

  injectStyles();
  var mount = document.querySelector(mountSel);
  if (!mount) {
    mount = document.createElement("div");
    document.body.appendChild(mount);
  }
  mount.innerHTML = '<div class="ffr-loading">Loading roadmap…</div>';

  var url = ingestUrl + (repo ? "?repo=" + encodeURIComponent(repo) : "");
  fetch(url)
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      render(data.items || []);
    })
    .catch(function () {
      mount.innerHTML = '<div class="ffr-loading">Roadmap unavailable right now.</div>';
    });

  function render(items) {
    var board = el("div", { class: "ffr-board" });
    COLUMNS.forEach(function (col) {
      var inCol = items.filter(function (i) { return i.status === col.key; });
      var cards = inCol.length
        ? inCol.map(function (i) {
            return el("div", { class: "ffr-card" }, [i.title]);
          })
        : [el("div", { class: "ffr-empty" }, ["Nothing here yet."])];
      board.appendChild(
        el("div", { class: "ffr-col" }, [
          el("div", { class: "ffr-col-head" }, [
            col.title,
            el("span", { class: "ffr-count" }, [String(inCol.length)]),
          ]),
        ].concat(cards)),
      );
    });
    mount.innerHTML = "";
    mount.appendChild(board);
  }

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
      ".ffr-board{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;font:14px system-ui,sans-serif}" +
      "@media(max-width:640px){.ffr-board{grid-template-columns:1fr}}" +
      ".ffr-col{background:#f6f6f7;border-radius:12px;padding:12px}" +
      ".ffr-col-head{display:flex;align-items:center;justify-content:space-between;font-weight:700;margin-bottom:10px}" +
      ".ffr-count{background:#e2e2e5;border-radius:999px;padding:1px 8px;font-size:12px;font-weight:600}" +
      ".ffr-card{background:#fff;border:1px solid #e5e5e8;border-radius:8px;padding:10px 12px;margin-bottom:8px;line-height:1.4}" +
      ".ffr-empty{color:#999;font-size:13px;padding:6px 2px}" +
      ".ffr-loading{color:#888;font:14px system-ui;padding:12px}" +
      "@media(prefers-color-scheme:dark){.ffr-col{background:#1f1f22}.ffr-count{background:#3a3a3c;color:#eee}.ffr-card{background:#2a2a2d;border-color:#3a3a3c;color:#f2f2f2}}";
    var s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  }
})();
