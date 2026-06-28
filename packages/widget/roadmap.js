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

  var voteUrl = ingestUrl.replace(/\/$/, "") + "/vote";
  var url = ingestUrl + (repo ? "?repo=" + encodeURIComponent(repo) : "");
  fetch(url)
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      render(data.items || [], !!data.voting);
    })
    .catch(function () {
      mount.innerHTML = '<div class="ffr-loading">Roadmap unavailable right now.</div>';
    });

  function votedKey(id) {
    return "ffv:" + (repo || "default") + ":" + id;
  }

  function render(items, voting) {
    var board = el("div", { class: "ffr-board" });
    COLUMNS.forEach(function (col) {
      var inCol = items.filter(function (i) { return i.status === col.key; });
      // Highest-voted first so priority is obvious at a glance.
      if (voting) inCol.sort(function (a, b) { return (b.votes || 0) - (a.votes || 0); });
      var cards = inCol.length
        ? inCol.map(function (i) { return card(i, voting); })
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

  function card(item, voting) {
    var title = el("div", { class: "ffr-card-title" }, [item.title]);
    if (!voting) return el("div", { class: "ffr-card" }, [title]);

    var already = false;
    try { already = !!localStorage.getItem(votedKey(item.id)); } catch (e) {}
    var count = el("span", { class: "ffr-vote-count" }, [String(item.votes || 0)]);
    var btn = el("button", {
      class: "ffr-vote" + (already ? " ffr-vote--on" : ""),
      type: "button",
      title: "Upvote",
    }, ["▲", count]);
    if (already) btn.disabled = true;

    btn.addEventListener("click", function () {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.classList.add("ffr-vote--on");
      count.textContent = String((item.votes || 0) + 1); // optimistic
      try { localStorage.setItem(votedKey(item.id), "1"); } catch (e) {}
      fetch(voteUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, repo: repo }),
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d && typeof d.votes === "number") count.textContent = String(d.votes); })
        .catch(function () {});
    });

    return el("div", { class: "ffr-card" }, [title, btn]);
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
      ".ffr-card{display:flex;align-items:flex-start;gap:8px;background:#fff;border:1px solid #e5e5e8;border-radius:8px;padding:10px 12px;margin-bottom:8px;line-height:1.4}" +
      ".ffr-card-title{flex:1}" +
      ".ffr-vote{display:flex;flex-direction:column;align-items:center;min-width:38px;border:1px solid #ddd;border-radius:8px;background:#fafafa;color:#444;cursor:pointer;font:600 11px system-ui;padding:4px 0;line-height:1.2}" +
      ".ffr-vote:hover{border-color:#aaa}" +
      ".ffr-vote--on{background:#111;color:#fff;border-color:#111;cursor:default}" +
      ".ffr-vote-count{font-size:13px}" +
      ".ffr-empty{color:#999;font-size:13px;padding:6px 2px}" +
      ".ffr-loading{color:#888;font:14px system-ui;padding:12px}" +
      "@media(prefers-color-scheme:dark){.ffr-col{background:#1f1f22}.ffr-count{background:#3a3a3c;color:#eee}.ffr-card{background:#2a2a2d;border-color:#3a3a3c;color:#f2f2f2}.ffr-vote{background:#3a3a3c;border-color:#4a4a4c;color:#eee}.ffr-vote--on{background:#f2f2f2;color:#111}}";
    var s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  }
})();
