/* ═══════════════════════════════════════════════════════════════
   CTS Agent Usage Dashboard — pure vanilla JS, no dependencies.
   Loads every developer's data/*.json, aggregates, and renders.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const CFG = window.DASHBOARD_CONFIG || {};
  const PALETTE = ["#6f8cff", "#29c499", "#9a6bff", "#ffb454", "#ff6b9a", "#4fd1ff", "#c0e152", "#ff8a5b"];

  let DEVS = [];        // raw per-developer records
  let SESSIONS = [];    // flattened sessions with dev context
  const state = { pod: "", role: "", dev: "", type: "", search: "" };

  // ── helpers ──
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const colorFor = (key) => { let h = 0; for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) % PALETTE.length; return PALETTE[h]; };
  const initials = (name) => String(name || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const fmt = (n) => (n ?? 0).toLocaleString();

  // ── 1. Discover the list of data files ──
  async function discoverFiles() {
    // Try the GitHub API (auto-discovers all data/*.json — new devs show up automatically)
    if (CFG.githubRepo && CFG.githubRepo.indexOf("/") > 0) {
      const api = `https://api.github.com/repos/${CFG.githubRepo}/contents/${CFG.dataDir}?ref=${CFG.githubBranch}`;
      try {
        const r = await fetch(api, { headers: { Accept: "application/vnd.github+json" } });
        if (r.ok) {
          const items = await r.json();
          const files = items.filter((i) => i.type === "file" && i.name.endsWith(".json") && i.name !== "manifest.json").map((i) => i.name);
          if (files.length) return files;
        }
      } catch (_) { /* fall through to manifest */ }
    }
    // Fallback: manifest.json (used when opening locally or if API is blocked)
    try {
      const r = await fetch("data/manifest.json");
      if (r.ok) { const m = await r.json(); return (m.files || []).filter((f) => f !== "manifest.json"); }
    } catch (_) { /* ignore */ }
    return [];
  }

  // ── 2. Load every developer file ──
  async function loadData() {
    const files = await discoverFiles();
    const loaded = [];
    await Promise.all(files.map(async (f) => {
      try {
        const r = await fetch(`data/${f}`);
        if (!r.ok) return;
        const d = await r.json();
        if (d && Array.isArray(d.sessions)) loaded.push(d);
      } catch (_) { /* skip bad file */ }
    }));
    DEVS = loaded;
    SESSIONS = [];
    for (const dev of DEVS) {
      for (const s of dev.sessions) {
        SESSIONS.push({
          developer_id: dev.developer_id,
          developer_name: dev.developer_name || dev.developer_id,
          pod_name: dev.pod_name || "unknown",
          dev_role: dev.dev_role || "unknown",
          session_type: s.session_type || "general",
          story_id: s.story_id || null,
          agent_name: s.agent_name || "Default Chat",
          framework: s.framework || "unknown",
          lines_added: s.lines_added || 0,
          files: s.files || 0,
          duration_seconds: s.duration_seconds || 0,
          regeneration_count: s.regeneration_count || 0,
          timestamp: s.timestamp || null,
        });
      }
    }
    return files.length;
  }

  // ── 3. Filtering ──
  function applyFilters() {
    const q = state.search.trim().toLowerCase();
    return SESSIONS.filter((s) =>
      (!state.pod || s.pod_name === state.pod) &&
      (!state.role || s.dev_role === state.role) &&
      (!state.dev || s.developer_id === state.dev) &&
      (!state.type || s.session_type === state.type) &&
      (!q || s.developer_name.toLowerCase().includes(q) || String(s.story_id || "").includes(q) || s.agent_name.toLowerCase().includes(q))
    );
  }

  // ── 4. Renderers ──
  function renderKpis(rows) {
    const total = rows.length;
    const story = rows.filter((r) => r.session_type === "story").length;
    const general = total - story;
    const devs = new Set(rows.map((r) => r.developer_id)).size;
    const pods = new Set(rows.map((r) => r.pod_name)).size;
    const stories = new Set(rows.filter((r) => r.story_id).map((r) => r.story_id)).size;
    const cards = [
      { label: "Total sessions", value: fmt(total), sub: "all AI usage", accent: "#6f8cff" },
      { label: "Story sessions", value: fmt(story), sub: total ? Math.round((story / total) * 100) + "% of total" : "—", accent: "#4f7bff" },
      { label: "General sessions", value: fmt(general), sub: total ? Math.round((general / total) * 100) + "% of total" : "—", accent: "#29c499" },
      { label: "User stories", value: fmt(stories), sub: "developed with AI", accent: "#9a6bff" },
      { label: "Developers", value: fmt(devs), sub: pods + " pod" + (pods === 1 ? "" : "s"), accent: "#ffb454" },
    ];
    $("kpis").innerHTML = cards.map((c) =>
      `<div class="kpi" style="--accent:${c.accent}">
        <div class="kpi-label">${c.label}</div>
        <div class="kpi-value">${c.value}</div>
        <div class="kpi-sub">${esc(c.sub)}</div>
      </div>`).join("");
  }

  function renderStackedBars(el, groups) {
    const max = Math.max(1, ...groups.map((g) => g.story + g.general));
    el.innerHTML = groups.length ? groups.map((g) => {
      const t = g.story + g.general;
      const sw = (g.story / max) * 100, gw = (g.general / max) * 100;
      return `<div class="bar-row">
        <div class="bar-label" title="${esc(g.label)}">${esc(g.label)}</div>
        <div class="bar-track">
          <div class="bar-fill story" style="width:${sw}%"></div>
          <div class="bar-fill general" style="width:${gw}%"></div>
        </div>
        <div class="bar-val">${t}</div>
      </div>`;
    }).join("") : `<div class="empty">No data</div>`;
  }

  function renderSoloBars(el, items) {
    const max = Math.max(1, ...items.map((i) => i.value));
    el.innerHTML = items.length ? items.map((i) =>
      `<div class="bar-row">
        <div class="bar-label" title="${esc(i.label)}">${esc(i.label)}</div>
        <div class="bar-track"><div class="bar-fill solo" style="width:${(i.value / max) * 100}%"></div></div>
        <div class="bar-val">${i.value}</div>
      </div>`).join("") : `<div class="empty">No data</div>`;
  }

  function renderDonut(rows) {
    const story = rows.filter((r) => r.session_type === "story").length;
    const general = rows.length - story;
    const total = rows.length || 1;
    const storyDeg = (story / total) * 360;
    $("typeDonut").style.background =
      `conic-gradient(var(--story) 0deg ${storyDeg}deg, var(--general) ${storyDeg}deg 360deg)`;
    $("typeDonut").setAttribute("data-total", total === 1 && rows.length === 0 ? "0" : rows.length);
    $("typeLegend").innerHTML = [
      { k: "Story", v: story, c: "var(--story)" },
      { k: "General", v: general, c: "var(--general)" },
    ].map((x) => `<div class="legend-item">
        <span class="legend-dot" style="background:${x.c}"></span>${x.k}
        <span class="lg-val">${x.v}</span>
        <span class="lg-pct">(${Math.round((x.v / total) * 100)}%)</span>
      </div>`).join("");
  }

  function renderDevTable(rows) {
    const byDev = {};
    for (const r of rows) {
      const d = (byDev[r.developer_id] = byDev[r.developer_id] || {
        name: r.developer_name, pod: r.pod_name, role: r.dev_role,
        total: 0, story: 0, general: 0, lines: 0, stories: new Set(),
      });
      d.total++; d[r.session_type === "story" ? "story" : "general"]++;
      d.lines += r.lines_added; if (r.story_id) d.stories.add(r.story_id);
    }
    const list = Object.values(byDev).map((d) => ({ ...d, stories: d.stories.size }))
      .sort((a, b) => b.total - a.total);
    $("devCount").textContent = list.length + " developer" + (list.length === 1 ? "" : "s");
    $("devTableBody").innerHTML = list.length ? list.map((d) =>
      `<tr>
        <td><div class="dev-cell"><span class="avatar" style="background:${colorFor(d.name)}">${esc(initials(d.name))}</span>${esc(d.name)}</div></td>
        <td>${esc(d.pod)}</td>
        <td><span class="pill ${d.role.toLowerCase() === "qa" ? "qa" : "dev"}">${esc(d.role)}</span></td>
        <td class="num">${d.total}</td>
        <td class="num">${d.story}</td>
        <td class="num">${d.general}</td>
        <td class="num">${d.stories}</td>
        <td class="num">${fmt(d.lines)}</td>
      </tr>`).join("") : `<tr><td colspan="8" class="empty">No matching developers</td></tr>`;
  }

  function renderStoryTable(rows) {
    const seen = new Set();
    const stories = [];
    for (const r of rows) {
      if (!r.story_id || seen.has(r.story_id)) continue;
      seen.add(r.story_id);
      stories.push(r);
    }
    stories.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    $("storyCount").textContent = stories.length + " stor" + (stories.length === 1 ? "y" : "ies");
    $("storyTableBody").innerHTML = stories.length ? stories.map((s) =>
      `<tr>
        <td><span class="story-link">#${esc(s.story_id)}</span></td>
        <td><div class="dev-cell"><span class="avatar" style="background:${colorFor(s.developer_name)}">${esc(initials(s.developer_name))}</span>${esc(s.developer_name)}</div></td>
        <td>${esc(s.pod_name)}</td>
        <td>${esc(s.agent_name)}</td>
        <td>${esc(s.framework)}</td>
        <td>${s.timestamp ? new Date(s.timestamp).toLocaleDateString() : "—"}</td>
      </tr>`).join("") : `<tr><td colspan="6" class="empty">No stories yet</td></tr>`;
  }

  function render() {
    const rows = applyFilters();
    renderKpis(rows);

    // sessions per developer (stacked)
    const devGroups = {};
    for (const r of rows) {
      const g = (devGroups[r.developer_id] = devGroups[r.developer_id] || { label: r.developer_name, story: 0, general: 0 });
      g[r.session_type === "story" ? "story" : "general"]++;
    }
    renderStackedBars($("devBars"), Object.values(devGroups).sort((a, b) => (b.story + b.general) - (a.story + a.general)).slice(0, 10));

    // sessions by pod (stacked)
    const podGroups = {};
    for (const r of rows) {
      const g = (podGroups[r.pod_name] = podGroups[r.pod_name] || { label: r.pod_name, story: 0, general: 0 });
      g[r.session_type === "story" ? "story" : "general"]++;
    }
    renderStackedBars($("podBars"), Object.values(podGroups).sort((a, b) => (b.story + b.general) - (a.story + a.general)));

    renderDonut(rows);

    // top agents
    const agentCount = {};
    for (const r of rows) agentCount[r.agent_name] = (agentCount[r.agent_name] || 0) + 1;
    renderSoloBars($("agentBars"), Object.entries(agentCount).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8));

    renderDevTable(rows);
    renderStoryTable(rows);
  }

  // ── 5. Filter population & wiring ──
  function populateFilters() {
    // Canonical pod list — the dashboard always shows these, in this order.
    // Any unexpected pod value found in data is appended after them.
    const POD_ORDER = ["UFH-1", "UFH-2", "UFH-3", "UFH-4", "UFH-5", "Apollo", "other Team"];
    const dataPods = new Set(SESSIONS.map((s) => s.pod_name));
    const extraPods = [...dataPods].filter((p) => p && !POD_ORDER.includes(p)).sort();
    const pods = [...POD_ORDER, ...extraPods];
    // Canonical role list — always show Dev and QA, plus any other value in data.
    const ROLE_ORDER = ["Dev", "QA"];
    const dataRoles = new Set(SESSIONS.map((s) => s.dev_role));
    const extraRoles = [...dataRoles].filter((r) => r && !ROLE_ORDER.includes(r)).sort();
    const roles = [...ROLE_ORDER, ...extraRoles];
    const devs = [...new Map(SESSIONS.map((s) => [s.developer_id, s.developer_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    $("podFilter").innerHTML = `<option value="">All pods</option>` + pods.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
    $("roleFilter").innerHTML = `<option value="">All roles</option>` + roles.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("");
    $("devFilter").innerHTML = `<option value="">All developers</option>` + devs.map(([id, nm]) => `<option value="${esc(id)}">${esc(nm)}</option>`).join("");
  }

  function wire() {
    $("podFilter").onchange = (e) => { state.pod = e.target.value; render(); };
    $("roleFilter").onchange = (e) => { state.role = e.target.value; render(); };
    $("devFilter").onchange = (e) => { state.dev = e.target.value; render(); };
    $("typeFilter").onchange = (e) => { state.type = e.target.value; render(); };
    $("searchInput").oninput = (e) => { state.search = e.target.value; render(); };
    $("refreshBtn").onclick = init;
  }

  // ── 6. Boot ──
  async function init() {
    $("lastUpdated").textContent = "Loading…";
    const count = await loadData();
    populateFilters();
    render();
    $("lastUpdated").textContent = count
      ? `${DEVS.length} developer file${DEVS.length === 1 ? "" : "s"} · ${new Date().toLocaleString()}`
      : "No data files found — check config.js / data folder";
  }

  // ── 7. Password gate ──
  // SHA-256 of the access password. Plaintext is NOT stored. This is a casual
  // view-gate for a static site (a determined viewer can bypass client-side
  // checks) — it stops accidental/unauthorized casual access, not a nation-state.
  const PASSWORD_HASH = "31f1b83bbd722b0649f33335ca58f0d823a46358d13613bf3b4191a58f7933b8";
  const SESSION_KEY = "cts-dash-unlocked";

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function unlock() {
    $("loginGate").style.display = "none";
    $("appRoot").hidden = false;
    wire();
    init();
  }

  function setupGate() {
    // Already unlocked this browser session?
    if (sessionStorage.getItem(SESSION_KEY) === PASSWORD_HASH) { unlock(); return; }
    const form = $("loginForm");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const entered = $("loginPwd").value;
      const h = await sha256(entered);
      if (h === PASSWORD_HASH) {
        sessionStorage.setItem(SESSION_KEY, PASSWORD_HASH);
        unlock();
      } else {
        $("loginError").hidden = false;
        $("loginPwd").value = "";
        $("loginPwd").focus();
      }
    });
    $("loginPwd").focus();
  }

  document.addEventListener("DOMContentLoaded", setupGate);
})();
