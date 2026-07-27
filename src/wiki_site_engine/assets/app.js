
(function () {
  const DATA = window.SITE_DATA;
  const pagesById = {};
  DATA.pages.forEach((p) => (pagesById[p.id] = p));

  // plain adjacency (both directions) from the wikilink edges
  const adjacency = {};
  DATA.pages.forEach((p) => { adjacency[p.id] = new Set(); });
  DATA.edges.forEach((e) => { adjacency[e.source].add(e.target); adjacency[e.target].add(e.source); });

  const colorOf = (page) => {
    const cat = page.category;
    const v = getComputedStyle(document.documentElement).getPropertyValue("--" + cat);
    return (v && v.trim()) || getComputedStyle(document.documentElement).getPropertyValue("--default").trim();
  };

  function setListToggleIcon(listOpen) {
    const btn = document.getElementById("list-toggle");
    btn.textContent = listOpen ? "\u{1F578}" : "☰";
    btn.title = listOpen ? "Grafo" : "Elenco";
  }

  const HUB_DEGREE = 4;
  const MAX_LABEL_CHARS = 32;
  const truncateLabel = (s) => (s.length > MAX_LABEL_CHARS ? s.slice(0, MAX_LABEL_CHARS - 1).trimEnd() + "…" : s);
  let zoomLabelsShown = false;
  const labelOf = (p, zoomed) => (p.degree >= HUB_DEGREE || (zoomed !== undefined ? zoomed : zoomLabelsShown) ? truncateLabel(p.title) : "");
  const hubIds = new Set(DATA.pages.filter((p) => p.degree >= HUB_DEGREE).map((p) => p.id));
  const alwaysLabeled = new Set();

  const BASE_FONT = { color: "#d8dee9", size: 12, strokeWidth: 3, strokeColor: "#0f0e13", vadjust: -16 };

  const nodeBase = {};
  DATA.pages.forEach((p) => {
    const c = colorOf(p);
    const isHub = p.degree >= HUB_DEGREE;
    nodeBase[p.id] = {
      value: 1 + p.degree,
      color: { background: c, border: "#0f0e13" },
      title: p.title,
      shadow: { enabled: true, color: c, size: isHub ? 18 : 8 + Math.min(6, p.degree), x: 0, y: 0 },
    };
  });

  const nodesByWeight = DATA.pages.slice().sort((a, b) => a.degree - b.degree);
  const nodes = new vis.DataSet(
    nodesByWeight.map((p) => ({
      id: p.id,
      label: labelOf(p),
      value: nodeBase[p.id].value,
      color: nodeBase[p.id].color,
      shadow: nodeBase[p.id].shadow,
      font: BASE_FONT,
      title: nodeBase[p.id].title,
    }))
  );

  // coppie bidirezionali (A->B e B->A): tieni un solo edge visibile per coppia,
  // freccia doppia + tratto continuo; l'altro resta nel DataSet ma hidden (id/indici stabili)
  const pairSet = new Set(DATA.edges.map((e) => e.source + ">" + e.target));
  const edgeMeta = DATA.edges.map((e) => {
    const reciprocal = pairSet.has(e.target + ">" + e.source);
    const isPrimary = !reciprocal || String(e.source) < String(e.target);
    return {
      hidden: reciprocal && !isPrimary,
      dashes: !reciprocal,
      arrows: reciprocal
        ? { to: { enabled: true, scaleFactor: 0.25 }, from: { enabled: true, scaleFactor: 0.25 } }
        : { to: { enabled: true, scaleFactor: 0.25 } },
    };
  });

  const hubWeight = (e) => (hubIds.has(e.source) ? 1 : 0) + (hubIds.has(e.target) ? 1 : 0);
  const restEdgeStyle = (e) => {
    const w = hubWeight(e);
    return { width: 0.25 + w * 0.3, opacity: 0.06 + w * 0.06 };
  };

  const edges = new vis.DataSet(
    DATA.edges.map((e, i) => {
      const style = restEdgeStyle(e);
      const meta = edgeMeta[i];
      return {
        id: i,
        from: e.source,
        to: e.target,
        hidden: meta.hidden,
        dashes: meta.dashes,
        arrows: meta.arrows,
        color: { inherit: "both", opacity: style.opacity, highlight: "#7c6ff0" },
        width: style.width,
      };
    })
  );

  const network = new vis.Network(
    document.getElementById("graph"),
    { nodes, edges },
    {
      physics: {
        solver: "forceAtlas2Based",
        forceAtlas2Based: { gravitationalConstant: -60, springLength: 90, springConstant: 0.06, damping: 0.4 },
        stabilization: { iterations: 200 },
      },
      interaction: { hover: true, tooltipDelay: 1000000, hideEdgesOnZoom: true, hideEdgesOnDrag: true },
      nodes: { shape: "dot", scaling: { min: 7, max: 34 } },
      edges: { smooth: false, arrows: { to: { scaleFactor: 0.4 } } },
    }
  );

  // --- pulsing selection ring ---
  let pulseNodeId = null;
  let pulseStart = 0;
  function pulseLoop() {
    if (!pulseNodeId) return;
    network.redraw();
    requestAnimationFrame(pulseLoop);
  }
  function startPulse(id) {
    pulseNodeId = id;
    pulseStart = performance.now();
    requestAnimationFrame(pulseLoop);
  }
  function stopPulse() { pulseNodeId = null; }
  network.on("afterDrawing", (ctx) => {
    if (!pulseNodeId || !pagesById[pulseNodeId]) return;
    const pos = network.getPositions([pulseNodeId])[pulseNodeId];
    if (!pos) return;
    const t = ((performance.now() - pulseStart) % 1400) / 1400;
    const baseR = 8 + Math.sqrt(nodeBase[pulseNodeId].value) * 3;
    const radius = baseR + t * 20;
    const alpha = 1 - t;
    ctx.save();
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = colorOf(pagesById[pulseNodeId]);
    ctx.globalAlpha = alpha * 0.8;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  });

  // --- play badge on nodes linked to a video ---
  const videoNodeIds = DATA.pages.filter((p) => p.video).map((p) => p.id);
  network.on("afterDrawing", (ctx) => {
    if (!videoNodeIds.length) return;
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#7c6ff0";
    const positions = network.getPositions(videoNodeIds);
    videoNodeIds.forEach((id) => {
      const pos = positions[id];
      if (!pos) return;
      const nodeItem = nodes.get(id);
      if (nodeItem && nodeItem.hidden) return;
      const opacity = nodeItem && typeof nodeItem.opacity === "number" ? nodeItem.opacity : 1;
      if (opacity <= 0.02) return;
      const nodeBody = network.body.nodes[id];
      const r = (nodeBody && nodeBody.shape && nodeBody.shape.radius) || 3 + Math.sqrt(nodeBase[id].value) * 1.2;
      const bx = pos.x + r * 0.72;
      const by = pos.y - r * 0.72;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, 2 * Math.PI);
      ctx.fillStyle = "#0d1117";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(bx - 1.6, by - 2.2);
      ctx.lineTo(bx - 1.6, by + 2.2);
      ctx.lineTo(bx + 2.4, by);
      ctx.closePath();
      ctx.fillStyle = accentColor;
      ctx.fill();
      ctx.restore();
    });
  });

  // --- idle ambient glow on hub nodes ---
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const idleGlowPhase = {};
  hubIds.forEach((id) => { idleGlowPhase[id] = Math.random() * Math.PI * 2; });
  if (!reducedMotion) {
    network.on("afterDrawing", (ctx) => {
      if (pulseNodeId || exploringId) return;
      const ids = Array.from(hubIds);
      const positions = network.getPositions(ids);
      const t = performance.now() / 1800;
      ids.forEach((id) => {
        const pos = positions[id];
        if (!pos) return;
        const s = (Math.sin(t + idleGlowPhase[id]) + 1) / 2;
        const baseR = 8 + Math.sqrt(nodeBase[id].value) * 3;
        ctx.save();
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, baseR + 4 + s * 6, 0, 2 * Math.PI);
        ctx.strokeStyle = colorOf(pagesById[id]);
        ctx.globalAlpha = 0.1 + s * 0.16;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      });
    });
    setInterval(() => {
      if (pulseNodeId || exploringId || document.hidden) return;
      network.redraw();
    }, 130);
  }

  // radial tree from the hub-most page: each category is a branch on its own
  // angular sector, pages within a branch sit along the radius by degree
  function clusterByCategory() {
    const groups = {};
    DATA.pages.forEach((p) => { (groups[p.category] = groups[p.category] || []).push(p.id); });

    const keys = Object.keys(groups).sort((a, b) => {
      const ia = DATA.categories.indexOf(a);
      const ib = DATA.categories.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.localeCompare(b);
    });
    const weights = keys.map((key) => Math.sqrt(groups[key].length));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const MIN_R = 100;
    const MAX_R = 700;
    const ASPECT_X = 1.5;
    const GOLDEN = 0.6180339887;
    let angleCursor = -Math.PI / 2;
    keys.forEach((key, idx) => {
      const ids = groups[key].slice().sort((a, b) => (pagesById[b].degree || 0) - (pagesById[a].degree || 0));
      const weight = weights[idx];
      const angleWidth = (weight / totalWeight) * 2 * Math.PI;
      const sectorCenter = angleCursor + angleWidth / 2;
      angleCursor += angleWidth;
      const count = ids.length;
      ids.forEach((id, j) => {
        const frac = count > 1 ? j / (count - 1) : 0;
        const radius = MIN_R + frac * (MAX_R - MIN_R);
        const spread = angleWidth * 0.85 * frac;
        const jitter = ((j * GOLDEN) % 1) - 0.5;
        const angle = sectorCenter + jitter * spread;
        network.moveNode(id, radius * Math.cos(angle) * ASPECT_X, radius * Math.sin(angle));
      });
    });
  }

  function minSeparation(idA, idB) {
    const a = hubIds.has(idA) ? 100 : 22;
    const b = hubIds.has(idB) ? 100 : 22;
    return a + b;
  }
  function resolveOverlap(iterations) {
    const ids = DATA.pages.map((p) => p.id);
    const positions = network.getPositions(ids);
    for (let iter = 0; iter < iterations; iter++) {
      const moves = {};
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = positions[ids[i]], b = positions[ids[j]];
          if (!a || !b) continue;
          const minDist = minSeparation(ids[i], ids[j]);
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          if (dist < minDist) {
            const push = (minDist - dist) / 2;
            const ux = dx / dist, uy = dy / dist;
            moves[ids[i]] = moves[ids[i]] || { x: 0, y: 0 };
            moves[ids[j]] = moves[ids[j]] || { x: 0, y: 0 };
            moves[ids[i]].x -= ux * push;
            moves[ids[i]].y -= uy * push;
            moves[ids[j]].x += ux * push;
            moves[ids[j]].y += uy * push;
          }
        }
      }
      Object.keys(moves).forEach((id) => {
        positions[id].x += moves[id].x;
        positions[id].y += moves[id].y;
      });
    }
    ids.forEach((id) => network.moveNode(id, positions[id].x, positions[id].y));
  }

  let originalPositions = null;
  function applyLayoutForContainer() {
    if (!originalPositions) return;
    const ids = Object.keys(originalPositions);
    if (!ids.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    ids.forEach((id) => {
      const p = originalPositions[id];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    const graphW = Math.max(1, maxX - minX);
    const graphH = Math.max(1, maxY - minY);
    const container = document.getElementById("graph");
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const centerY = (minY + maxY) / 2;
    let stretchY = 1;
    if (ch > cw) {
      const containerRatio = cw / ch;
      const graphRatio = graphW / graphH;
      const needed = graphRatio / containerRatio;
      const DAMPING = 0.6;
      const MAX_STRETCH = 1.5;
      const eased = 1 + (needed - 1) * DAMPING;
      if (eased > 1.05) stretchY = Math.min(eased, MAX_STRETCH);
    }
    ids.forEach((id) => {
      const p = originalPositions[id];
      network.moveNode(id, p.x, centerY + (p.y - centerY) * stretchY);
    });
  }

  let basePositions = null;
  let graphReady = false;
  network.once("stabilizationIterationsDone", () => {
    network.setOptions({ physics: false });
    clusterByCategory();
    resolveOverlap(40);
    originalPositions = network.getPositions();
    applyLayoutForContainer();
    network.fit({ animation: false });
    document.getElementById("graph-wrap").classList.add("ready");
    basePositions = network.getPositions();
    graphReady = true;
    const initialId = decodeURIComponent(location.hash.slice(1));
    if (initialId && pagesById[initialId]) {
      showPage(initialId);
    }
  });

  let resizeDebounce = null;
  window.addEventListener("resize", () => {
    if (!graphReady || exploringId) return;
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      applyLayoutForContainer();
      network.fit({ animation: false });
      basePositions = network.getPositions();
    }, 200);
  });
  network.on("dragStart", (params) => {
    if (params.nodes.length > 0) network.setOptions({ physics: { enabled: true } });
  });
  network.on("dragEnd", () => { network.setOptions({ physics: { enabled: false } }); });

  const ZOOM_LABEL_THRESHOLD = 1.15;
  function refreshLabelVisibility() {
    if (exploringId) return;
    nodes.update(DATA.pages.map((p) => ({ id: p.id, label: labelOf(p) })));
  }
  network.on("zoom", (params) => {
    const shouldShow = params.scale >= ZOOM_LABEL_THRESHOLD;
    if (shouldShow !== zoomLabelsShown) {
      zoomLabelsShown = shouldShow;
      refreshLabelVisibility();
    }
  });

  const graphTooltip = document.getElementById("graph-tooltip");
  const graphWrapEl = document.getElementById("graph-wrap");
  const nodeActions = document.getElementById("node-actions");
  const nodeOpenBtn = document.getElementById("node-open-btn");
  const nodeVideoBtn = document.getElementById("node-video-btn");

  function hoverDim(id) {
    if (exploringId) return;
    const connected = new Set(network.getConnectedNodes(id));
    connected.add(id);
    nodes.update(DATA.pages.filter((p) => !connected.has(p.id)).map((p) => ({ id: p.id, opacity: 0.15 })));
    edges.update(
      DATA.edges
        .map((e, i) => (connected.has(e.source) && connected.has(e.target) ? null : { id: i, color: { inherit: "both", opacity: 0.02, highlight: "#7c6ff0" } }))
        .filter(Boolean)
    );
  }
  function hoverUndim() {
    if (exploringId) return;
    nodes.update(DATA.pages.map((p) => ({ id: p.id, opacity: 1 })));
    edges.update(DATA.edges.map((e, i) => ({ id: i, color: { inherit: "both", opacity: restEdgeStyle(e).opacity, highlight: "#7c6ff0" } })));
  }

  network.on("hoverNode", (params) => {
    if (exploringId && params.node !== exploringId && !network.getConnectedNodes(exploringId).includes(params.node)) return;
    const p = pagesById[params.node];
    if (!alwaysLabeled.has(params.node)) nodes.update({ id: params.node, label: p.title });
    hoverDim(params.node);
    graphTooltip.innerHTML =
      '<div class="tt-title">' + escapeHtml(p.title) + "</div>" +
      '<div class="tt-meta"><span class="tt-dot" style="background:' + colorOf(p) + '"></span>' +
      escapeHtml(p.category) + "</div>";
    graphTooltip.classList.remove("hidden");
  });
  network.on("blurNode", (params) => {
    if (!alwaysLabeled.has(params.node)) nodes.update({ id: params.node, label: exploringId ? "" : labelOf(pagesById[params.node]) });
    hoverUndim();
    graphTooltip.classList.add("hidden");
  });
  graphWrapEl.addEventListener("mousemove", (e) => {
    const rect = graphWrapEl.getBoundingClientRect();
    graphTooltip.style.left = (e.clientX - rect.left) + "px";
    graphTooltip.style.top = (e.clientY - rect.top) + "px";
  });

  // --- markdown rendering (minimal, no deps) ---
  function escapeHtml(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  function slugify(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function highlightMatch(text, q) {
    if (!q) return escapeHtml(text);
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    return escapeHtml(text.slice(0, idx)) + "<mark>" + escapeHtml(text.slice(idx, idx + q.length)) + "</mark>" + escapeHtml(text.slice(idx + q.length));
  }

  // placeholder markers use private-use unicode codepoints (never occur in real
  // wiki text) so the restore step can't collide with ordinary numbers in titles/
  // prose, e.g. a page called "Regola dei 2 secondi" - a plain " N " marker (as
  // used upstream) would misfire on that literal " 2 " and restore "undefined"
  const STASH_OPEN = "";
  const STASH_CLOSE = "";
  const stashRe = new RegExp(STASH_OPEN + "(\\d+)" + STASH_CLOSE, "g");

  function inline(text) {
    const codeStash = [];
    let s = text.replace(/`([^`]+)`/g, (m, code) => {
      codeStash.push("<code>" + code + "</code>");
      return STASH_OPEN + (codeStash.length - 1) + STASH_CLOSE;
    });
    s = s.replace(/\[\[([^\]|#]+?)\\?(?:\|([^\]]+))?\]\]/g, (m, target, label) => {
      const id = target.trim();
      const page = pagesById[id];
      const txt = label || (page ? page.title : id);
      if (!page) return txt;
      return '<a class="wikilink" data-id="' + id + '">' + txt + "</a>";
    });
    s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (m, txt, url) => {
      const iconMatch = txt.match(/^(\p{Emoji_Presentation}|▶|▸)\s*/u);
      const icon = iconMatch ? '<span class="link-icon">' + iconMatch[1] + "</span> " : "";
      const label = iconMatch ? txt.slice(iconMatch[0].length) : txt;
      return icon + '<a href="' + url + '" target="_blank">' + label + "</a>";
    });
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(stashRe, (m, i) => codeStash[Number(i)]);
    return s;
  }

  function splitTableRow(line) {
    const stash = [];
    const protectedLine = line.replace(/\[\[[^\]]*\]\]/g, (m) => {
      stash.push(m);
      return STASH_OPEN + (stash.length - 1) + STASH_CLOSE;
    });
    return protectedLine.trim().replace(/^\|/, "").replace(/\|$/, "").split("|")
      .map((c) => c.trim().replace(stashRe, (m, i) => stash[Number(i)]));
  }

  function renderMarkdown(md) {
    const src = escapeHtml(md).replace(/&lt;(\/?(?:ul|li))>/g, "<$1>");
    const lines = src.split("\n");
    const out = [];
    let i = 0;
    const usedSlugs = {};

    const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
    const isTableRow = (l) => /\|/.test(l);

    while (i < lines.length) {
      const line = lines[i];

      if (/^```/.test(line)) {
        const lang = line.replace(/^```\s*/, "").trim();
        const code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        if (lang === "mermaid") {
          out.push('<div class="mermaid-diagram" title="Apri a schermo intero"><pre class="mermaid">' + code.join("\n") + "</pre></div>");
        } else {
          out.push("<pre><code>" + code.join("\n") + "</code></pre>");
        }
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        const plain = heading[2].replace(/[*`]/g, "").trim();
        let slug = slugify(plain);
        if (slug) {
          if (usedSlugs[slug] != null) { usedSlugs[slug]++; slug += "-" + usedSlugs[slug]; }
          else usedSlugs[slug] = 0;
        }
        out.push("<h" + level + (slug ? ' id="' + slug + '"' : "") + ">" + inline(heading[2]) + "</h" + level + ">");
        i++;
        continue;
      }

      if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const headerCells = splitTableRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && isTableRow(lines[i]) && lines[i].trim() !== "") { rows.push(splitTableRow(lines[i])); i++; }
        let table = "<table><thead><tr>";
        table += headerCells.map((c) => "<th>" + inline(c) + "</th>").join("");
        table += "</tr></thead><tbody>";
        rows.forEach((r) => { table += "<tr>" + r.map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>"; });
        table += "</tbody></table>";
        out.push(table);
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        out.push("<blockquote>" + inline(quote.join(" ")) + "</blockquote>");
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(inline(lines[i].replace(/^\s*[-*+]\s+/, ""))); i++; }
        out.push("<ul>" + items.map((it) => "<li>" + it + "</li>").join("") + "</ul>");
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(inline(lines[i].replace(/^\s*\d+\.\s+/, ""))); i++; }
        out.push("<ol>" + items.map((it) => "<li>" + it + "</li>").join("") + "</ol>");
        continue;
      }

      if (/^\s*$/.test(line)) { i++; continue; }

      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

      const para = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|```|\s*>|\s*[-*+]\s|\s*\d+\.\s)/.test(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      out.push("<p>" + inline(para.join(" ")) + "</p>");
    }

    return out.join("\n");
  }

  // --- panel (centered modal) ---
  const panelMeta = document.getElementById("panel-meta");
  const panelBody = document.getElementById("panel-body");
  const panelEl = document.getElementById("panel");
  const panelBackdrop = document.getElementById("panel-backdrop");
  const panelBack = document.getElementById("panel-back");
  const panelForward = document.getElementById("panel-forward");
  const panelToc = document.getElementById("panel-toc");
  const panelTocBtn = document.getElementById("panel-toc-btn");
  let tocObserver = null;

  // pinch-to-zoom del testo della nota su touch: il viewport meta permette lo zoom
  // nativo di pagina, ma zoomerebbe tutto il pannello fisso (backdrop, toolbar), non
  // solo il testo. CSS "zoom" (non transform) è voluto: è un vero resize di layout,
  // quindi lo scroll verticale del pannello resta corretto a qualsiasi livello di zoom.
  const TEXT_ZOOM_MIN = 1;
  const TEXT_ZOOM_MAX = 2.2;
  const TEXT_ZOOM_SNAP_EPS = 0.06;
  let textZoom = 1;
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  function setTextZoom(z) {
    textZoom = Math.min(TEXT_ZOOM_MAX, Math.max(TEXT_ZOOM_MIN, z));
    if (Math.abs(textZoom - 1) < TEXT_ZOOM_SNAP_EPS) textZoom = 1;
    panelBody.style.zoom = textZoom;
  }
  function touchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }
  panelEl.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 2) {
        pinchStartDist = touchDist(e.touches);
        pinchStartZoom = textZoom;
      }
    },
    { passive: true }
  );
  panelEl.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length !== 2 || !pinchStartDist) return;
      e.preventDefault();
      setTextZoom(pinchStartZoom * (touchDist(e.touches) / pinchStartDist));
    },
    { passive: false }
  );
  panelEl.addEventListener("touchend", (e) => {
    if (e.touches.length < 2) pinchStartDist = 0;
  });

  const navHistory = [];
  let navPos = -1;

  let exploringId = null;

  let panelHistoryPushed = false;
  let reopenListOnClose = false;
  function syncPanelHistory(id) {
    if (!panelHistoryPushed) {
      // if the page was loaded directly with this hash (deep link / refresh with a
      // panel open), the current history entry already carries it - pushing another
      // copy on top means closePanel()'s history.back() lands on a twin entry with
      // the same hash still in the URL, so a later page refresh reopens the panel
      if (decodeURIComponent(location.hash.slice(1)) === id) return;
      history.pushState({ sitePanel: true }, "", "#" + id);
      panelHistoryPushed = true;
    } else {
      history.replaceState({ sitePanel: true }, "", "#" + id);
    }
  }

  function focusNode(id) {
    network.selectNodes([id]);
    highlightConnected(id);
    const connectedIds = network.getConnectedNodes(id).concat([id]);
    network.fit({ nodes: connectedIds, animation: false, minZoomLevel: 0.15, maxZoomLevel: 1.3 });
    network.moveTo({
      position: network.getPositions([id])[id],
      scale: network.getScale(),
      animation: { duration: 400 },
    });
    startPulse(id);
    exploringId = id;
    syncListSelection(id);
    nodeActions.classList.remove("hidden");
    nodeVideoBtn.classList.toggle("hidden", !pagesById[id].video);
  }

  function syncListSelection(id) {
    listResults.querySelectorAll("li.selected").forEach((el) => el.classList.remove("selected"));
    const li = listResults.querySelector('li[data-id="' + id + '"]');
    if (!li) return;
    li.classList.add("selected");
    const details = li.closest("details.cat-group");
    listResults.querySelectorAll("details.cat-group").forEach((d) => {
      if (d !== details && d.open) { d.open = false; groupOpenState[d.dataset.cat] = false; }
    });
    if (details && !details.open) { details.open = true; groupOpenState[details.dataset.cat] = true; }
    li.scrollIntoView({ block: "nearest" });
  }

  function previewNode(id) {
    if (!pagesById[id]) return;
    closePanel();
    focusNode(id);
  }

  function relatedPagesHtml(page) {
    const renderGroup = (label, ids) => {
      if (!ids || !ids.length) return "";
      return '<div class="related-group"><div class="related-label">' + escapeHtml(label) + '</div>' +
        ids.map((id) => {
          const related = pagesById[id];
          return related ? '<button type="button" class="related-chip" data-page-id="' + escapeHtml(id) + '">' + escapeHtml(related.title) + '</button>' : "";
        }).join("") + '</div>';
    };
    const outgoing = renderGroup("Collegamenti da questa pagina", page.outgoingIds);
    const incoming = renderGroup("Pagine che citano questa", page.incomingIds);
    return outgoing || incoming ? '<section class="related-pages"><h3>Collegamenti</h3>' + outgoing + incoming + '</section>' : "";
  }

  function showPage(id, opts) {
    const page = pagesById[id];
    if (!page) return;
    setTextZoom(1);
    const jumpQuery = (opts && opts.jumpQuery) || null;
    if (!(opts && opts.fromHistory)) {
      navHistory.length = navPos + 1;
      navHistory.push(id);
      navPos = navHistory.length - 1;
    }
    panelBack.classList.toggle("nav-hidden", navPos < 1);
    panelForward.classList.toggle("nav-hidden", navPos >= navHistory.length - 1);
    panelEl.classList.remove("hidden");
    panelBackdrop.classList.remove("hidden");
    const tags = (page.tags || [])
      .map((t) => '<span class="tag-chip" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + "</span>")
      .join("");
    const breadcrumb =
      '<div class="breadcrumb">' +
      '<span class="crumb-cat" data-category="' + escapeHtml(page.category) + '">' + escapeHtml(page.category) + "</span>" +
      "</div>";
    panelMeta.innerHTML =
      breadcrumb +
      "<h2>" + escapeHtml(page.title) + "</h2>" +
      '<div class="meta-row">' + page.incoming + " entrate · " + page.outgoing + " uscite</div>" +
      (tags ? '<div class="meta-row">' + tags + "</div>" : "");
    const videoBtnHtml = page.video
      ? '<a class="panel-video-btn" href="' + escapeHtml(page.video) + '" target="_blank" rel="noopener">&#9654; Guarda video</a>'
      : "";
    panelBody.innerHTML = videoBtnHtml + renderMarkdown(page.markdown || "") + relatedPagesHtml(page);
    enhanceVediAnche(panelBody);
    renderMermaidDiagrams(panelBody);
    if (!jumpQuery || !jumpToMatch(jumpQuery)) panelEl.scrollTop = 0;
    buildPanelToc();
    focusNode(id);
    syncPanelHistory(id);
  }

  // salta al primo punto del testo in cui compare la query di ricerca (evidenziandolo)
  // invece di scaricare il lettore in cima a una nota lunga. Ritorna se ha trovato un
  // match, così showPage() può ripiegare su scrollTop = 0.
  function jumpToMatch(query) {
    const prevMark = panelBody.querySelector("mark.search-jump");
    if (prevMark) {
      const parent = prevMark.parentNode;
      parent.replaceChild(document.createTextNode(prevMark.textContent), prevMark);
      parent.normalize();
    }
    const term = query.trim().split(/\s+/)[0];
    if (!term) return false;
    const termLower = term.toLowerCase();
    const walker = document.createTreeWalker(panelBody, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement && node.parentElement.closest("script,style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let target = null;
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.textContent.toLowerCase().indexOf(termLower);
      if (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + term.length);
        const mark = document.createElement("mark");
        mark.className = "search-jump";
        range.surroundContents(mark);
        target = mark;
        break;
      }
    }
    if (!target) return false;
    scrollPanelTo(target);
    return true;
  }

  function buildPanelToc() {
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
    closePanelToc();
    const headings = Array.from(panelBody.querySelectorAll("h2[id], h3[id]"));
    if (headings.length < 3) {
      panelTocBtn.classList.add("hidden");
      panelToc.innerHTML = "";
      return;
    }
    panelTocBtn.classList.remove("hidden");
    panelToc.innerHTML = headings
      .map((h) => '<a href="#' + h.id + '" class="toc-link toc-' + h.tagName.toLowerCase() + '" data-target="' + h.id + '">' + escapeHtml(h.textContent) + "</a>")
      .join("");
    tocObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const link = panelToc.querySelector('.toc-link[data-target="' + entry.target.id + '"]');
          if (!link) return;
          link.classList.toggle("active", entry.isIntersecting);
        });
      },
      { root: panelEl, rootMargin: "0px 0px -70% 0px", threshold: 0 }
    );
    headings.forEach((h) => tocObserver.observe(h));
  }

  function openPanelToc() {
    const btnRect = panelTocBtn.getBoundingClientRect();
    panelToc.style.top = btnRect.bottom + 6 + "px";
    panelToc.style.right = window.innerWidth - btnRect.right + "px";
    panelToc.classList.remove("hidden");
    panelTocBtn.classList.add("active");
  }
  function closePanelToc() {
    panelToc.classList.add("hidden");
    panelTocBtn.classList.remove("active");
  }
  panelTocBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (panelToc.classList.contains("hidden")) openPanelToc();
    else closePanelToc();
  });

  function scrollPanelTo(target) {
    const toolbarH = document.getElementById("panel-toolbar").offsetHeight;
    const targetTop = target.getBoundingClientRect().top - panelEl.getBoundingClientRect().top + panelEl.scrollTop;
    panelEl.scrollTo({ top: targetTop - toolbarH - 12, behavior: "smooth" });
  }
  panelToc.addEventListener("click", (e) => {
    const link = e.target.closest(".toc-link");
    if (!link) return;
    e.preventDefault();
    const target = panelBody.querySelector("#" + CSS.escape(link.dataset.target));
    if (target) scrollPanelTo(target);
    closePanelToc();
  });
  document.addEventListener("click", (e) => {
    if (!panelToc.classList.contains("hidden") && !panelToc.contains(e.target) && e.target !== panelTocBtn) closePanelToc();
  });

  // --- mermaid diagrams: render inline, click through to a fullscreen view ---
  if (window.mermaid) {
    const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    mermaid.initialize({ startOnLoad: false, theme: prefersLight ? "default" : "dark", securityLevel: "strict" });
  }

  const mermaidModal = document.getElementById("mermaid-modal");
  const mermaidModalBody = document.getElementById("mermaid-modal-body");

  function closeMermaidModal() {
    mermaidModal.classList.add("hidden");
    mermaidModalBody.innerHTML = "";
  }

  function openMermaidModal(svgEl) {
    const clone = svgEl.cloneNode(true);
    clone.removeAttribute("width");
    clone.removeAttribute("height");
    clone.style.width = "100%";
    clone.style.height = "auto";
    mermaidModalBody.innerHTML = "";
    mermaidModalBody.appendChild(clone);
    mermaidModal.classList.remove("hidden");
  }

  if (mermaidModal) {
    mermaidModal.addEventListener("click", closeMermaidModal);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !mermaidModal.classList.contains("hidden")) closeMermaidModal();
    });
    document.addEventListener("click", (e) => {
      const wrap = e.target.closest(".mermaid-diagram");
      if (!wrap) return;
      const svg = wrap.querySelector("svg");
      if (svg) openMermaidModal(svg);
    });
  }

  // renders any ```mermaid fences turned into .mermaid <pre> placeholders by
  // renderMarkdown() - safe to call repeatedly, mermaid marks nodes it has
  // already processed so re-running on unrelated content is a no-op
  function renderMermaidDiagrams(container) {
    if (!window.mermaid) return;
    const nodes = container.querySelectorAll(".mermaid-diagram > .mermaid");
    if (!nodes.length) return;
    mermaid.run({ nodes: Array.from(nodes) }).catch((err) => console.error("mermaid render failed", err));
  }

  // --- video links: play inline instead of leaving the site, without giving up the
  // option to pop the real page out - plain left-clicks open an embed modal; a
  // ctrl/cmd/middle-click (or the "Apri esternamente" link inside the modal) still
  // follows the real href like before
  function videoEmbedUrl(url) {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return null;
    }
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtube.com") {
      let id = u.searchParams.get("v");
      if (!id) {
        const m = u.pathname.match(/\/(embed|shorts)\/([^/?]+)/);
        if (m) id = m[2];
      }
      return id ? "https://www.youtube.com/embed/" + id + "?rel=0" : null;
    }
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return id ? "https://www.youtube.com/embed/" + id + "?rel=0" : null;
    }
    if (host === "drive.google.com") {
      const m = u.pathname.match(/\/file\/d\/([^/]+)/);
      return m ? "https://drive.google.com/file/d/" + m[1] + "/preview" : null;
    }
    return null;
  }

  const videoModal = document.getElementById("video-modal");
  const videoModalIframe = document.getElementById("video-modal-iframe");
  const videoModalExternal = document.getElementById("video-modal-external");

  function closeVideoModal() {
    videoModal.classList.add("hidden");
    videoModalIframe.src = "about:blank"; // stop playback
  }

  function openVideoModal(url) {
    const embed = videoEmbedUrl(url);
    if (!embed) {
      window.open(url, "_blank", "noopener");
      return;
    }
    videoModalExternal.href = url;
    videoModalIframe.src = embed;
    videoModal.classList.remove("hidden");
  }

  function isPlainLeftClick(e) {
    return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
  }

  if (videoModal) {
    document.getElementById("video-modal-close").addEventListener("click", closeVideoModal);
    videoModal.addEventListener("click", (e) => {
      if (e.target === videoModal) closeVideoModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !videoModal.classList.contains("hidden")) closeVideoModal();
    });
    document.addEventListener("click", (e) => {
      const a = e.target.closest("a.panel-video-btn, a.video-link");
      if (!a || !isPlainLeftClick(e)) return;
      e.preventDefault();
      openVideoModal(a.href);
    });
  }

  // "Vedi anche" -> clickable card grid
  function enhanceVediAnche(container) {
    const headings = container.querySelectorAll("h1,h2,h3,h4,h5,h6");
    let heading = null;
    headings.forEach((h) => { if (!heading && h.textContent.trim().toLowerCase() === "vedi anche") heading = h; });
    if (!heading) return;
    const list = heading.nextElementSibling;
    if (!list || list.tagName !== "UL") return;
    const ids = Array.from(list.querySelectorAll("a.wikilink[data-id]")).map((a) => a.dataset.id);
    if (!ids.length) return;
    const cards = ids
      .map((id) => pagesById[id])
      .filter(Boolean)
      .map(
        (p) =>
          '<div class="correlato-card" data-id="' + p.id + '">' +
          '<span class="correlato-dot" style="background:' + cssVar(p.category) + '"></span>' +
          '<div class="correlato-text"><div class="correlato-title">' + escapeHtml(p.title) + "</div>" +
          '<div class="correlato-cat">' + escapeHtml(p.category) + "</div>" +
          (p.excerpt ? '<div class="correlato-excerpt">' + escapeHtml(p.excerpt) + "</div>" : "") +
          "</div></div>"
      )
      .join("");
    const grid = document.createElement("div");
    grid.className = "correlati-grid";
    grid.innerHTML = cards;
    list.replaceWith(grid);
  }

  function bringNodesToFront(items) {
    const ids = items.map((it) => it.id);
    const positions = network.getPositions(ids);
    items.forEach((it) => {
      const pos = positions[it.id];
      if (pos) { it.x = pos.x; it.y = pos.y; }
    });
    nodes.remove(ids);
    nodes.add(items);
  }
  function bringToFront(dataset, items) {
    const ids = items.map((it) => it.id);
    dataset.remove(ids);
    dataset.add(items);
  }

  function groupKey(p) { return p.category; }
  function groupSortIndex(key) {
    const i = DATA.categories.indexOf(key);
    return i === -1 ? 99 : i;
  }

  function arrangeRadial(id, connected) {
    if (!basePositions) return;
    const center = network.getPositions([id])[id];
    const others = Array.from(connected)
      .filter((nid) => nid !== id)
      .sort((a, b) => {
        const ga = groupKey(pagesById[a]);
        const gb = groupKey(pagesById[b]);
        const gi = groupSortIndex(ga) - groupSortIndex(gb);
        if (gi !== 0) return gi || ga.localeCompare(gb);
        return pagesById[a].title.localeCompare(pagesById[b].title);
      });
    const n = others.length;
    if (n === 0) return;
    const radius = Math.min(650, Math.max(260, (n * 130) / (2 * Math.PI)));
    const DEAD_ZONE_CENTER = Math.PI / 2;
    const DEAD_ZONE_HALF = pagesById[id].video ? 0.62 : 0.4;
    const angleStart = DEAD_ZONE_CENTER + DEAD_ZONE_HALF;
    const usableSpan = 2 * Math.PI - DEAD_ZONE_HALF * 2;
    others.forEach((nid, idx) => {
      const t = n > 1 ? idx / (n - 1) : 0.5;
      const angle = angleStart + t * usableSpan;
      network.moveNode(nid, center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle));
    });
  }

  function restorePositions() {
    if (!basePositions) return;
    Object.keys(basePositions).forEach((nid) => { network.moveNode(nid, basePositions[nid].x, basePositions[nid].y); });
  }

  function highlightConnected(id) {
    restorePositions();
    const connected = new Set(network.getConnectedNodes(id));
    connected.add(id);
    alwaysLabeled.clear();
    connected.forEach((nid) => alwaysLabeled.add(nid));
    arrangeRadial(id, connected);

    const dimmed = [];
    const front = [];
    DATA.pages.forEach((p) => {
      const isOn = connected.has(p.id);
      const isSelected = p.id === id;
      const item = {
        id: p.id,
        value: nodeBase[p.id].value,
        color: nodeBase[p.id].color,
        shadow: nodeBase[p.id].shadow,
        title: nodeBase[p.id].title,
        opacity: isOn ? 1 : 0.1,
        label: isSelected ? p.title : isOn ? truncateLabel(p.title) : "",
        font: isSelected
          ? { color: "#ffffff", size: 15, strokeWidth: 4, strokeColor: "#7c6ff0", vadjust: -20 }
          : isOn
          ? BASE_FONT
          : { color: "rgba(216,222,233,0.12)", size: 12, vadjust: -16 },
      };
      (isOn ? front : dimmed).push(item);
    });
    nodes.update(dimmed);
    bringNodesToFront(front);

    const connectedEdgeIds = new Set(network.getConnectedEdges(id));
    const dimmedEdges = [];
    const frontEdges = [];
    DATA.edges.forEach((e, i) => {
      const isOn = connectedEdgeIds.has(i);
      const meta = edgeMeta[i];
      const item = {
        id: i,
        from: e.source,
        to: e.target,
        hidden: meta.hidden,
        arrows: meta.arrows,
        width: isOn ? 1.1 : 0.5,
        dashes: meta.dashes,
        color: isOn
          ? { opacity: 0.55, color: "#7c6ff0", highlight: "#7c6ff0" }
          : { opacity: 0.04, inherit: "both", highlight: "#7c6ff0" },
      };
      (isOn ? frontEdges : dimmedEdges).push(item);
    });
    edges.update(dimmedEdges);
    bringToFront(edges, frontEdges);
  }

  function resetHighlight() {
    stopPulse();
    network.setOptions({ physics: { enabled: false } });
    restorePositions();
    exploringId = null;
    alwaysLabeled.clear();
    nodeActions.classList.add("hidden");
    listResults.querySelectorAll("li.selected").forEach((el) => el.classList.remove("selected"));
    nodes.update(DATA.pages.map((p) => ({ id: p.id, opacity: 1, label: labelOf(p), font: BASE_FONT })));
    edges.update(
      DATA.edges.map((e, i) => {
        const style = restEdgeStyle(e);
        const meta = edgeMeta[i];
        return {
          id: i,
          width: style.width,
          hidden: meta.hidden,
          arrows: meta.arrows,
          dashes: meta.dashes,
          color: { inherit: "both", opacity: style.opacity, highlight: "#7c6ff0" },
        };
      })
    );
  }

  function restoreListIfNeeded() {
    if (!reopenListOnClose) return;
    reopenListOnClose = false;
    document.getElementById("list-panel").classList.add("list-open");
    setListToggleIcon(true);
  }

  function closePanel() {
    panelEl.classList.add("hidden");
    panelBackdrop.classList.add("hidden");
    panelToc.classList.add("hidden");
    panelTocBtn.classList.remove("active");
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
    if (panelHistoryPushed) {
      panelHistoryPushed = false;
      history.back();
    } else {
      history.replaceState(null, "", location.pathname + location.search);
    }
    restoreListIfNeeded();
  }

  window.addEventListener("popstate", () => {
    if (!panelEl.classList.contains("hidden")) {
      panelHistoryPushed = false;
      panelEl.classList.add("hidden");
      panelBackdrop.classList.add("hidden");
      panelToc.classList.add("hidden");
      if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
      restoreListIfNeeded();
    }
  });

  panelBody.addEventListener("click", (e) => {
    if (e.target.classList.contains("wikilink")) showPage(e.target.dataset.id);
    const card = e.target.closest(".correlato-card");
    if (card) showPage(card.dataset.id);
    const relatedChip = e.target.closest(".related-chip");
    if (relatedChip) showPage(relatedChip.dataset.pageId);
  });
  panelMeta.addEventListener("click", (e) => {
    const tagChip = e.target.closest(".tag-chip");
    if (tagChip) {
      searchInput.value = tagChip.dataset.tag;
      updateClearVisibility();
      applyFilters();
      reopenListOnClose = true;
      closePanel();
      return;
    }
    const crumbCat = e.target.closest(".crumb-cat");
    if (crumbCat) {
      activeCategories.clear();
      categoryFilterEl.querySelectorAll(".cat-chip.active").forEach((c) => c.classList.remove("active"));
      legendEl.querySelectorAll(".legend-row.active").forEach((r) => r.classList.remove("active"));
      activeCategories.add(crumbCat.dataset.category);
      const chip = categoryFilterEl.querySelector('.cat-chip[data-category="' + crumbCat.dataset.category + '"]');
      if (chip) chip.classList.add("active");
      const row = legendEl.querySelector('.legend-row[data-category="' + crumbCat.dataset.category + '"]');
      if (row) row.classList.add("active");
      applyFilters();
      reopenListOnClose = true;
      closePanel();
    }
  });
  panelBack.addEventListener("click", () => {
    if (navPos < 1) return;
    navPos--;
    showPage(navHistory[navPos], { fromHistory: true });
  });
  panelForward.addEventListener("click", () => {
    if (navPos >= navHistory.length - 1) return;
    navPos++;
    showPage(navHistory[navPos], { fromHistory: true });
  });
  document.getElementById("panel-close").addEventListener("click", closePanel);
  panelBackdrop.addEventListener("click", () => { if (!panelEl.classList.contains("hidden")) closePanel(); });

  const panelCopy = document.getElementById("panel-copy");
  let panelCopyResetTimer = null;
  panelCopy.addEventListener("click", () => {
    const id = navHistory[navPos];
    if (!id) return;
    const url = location.origin + location.pathname + location.search + "#" + id;
    const showFeedback = (ok) => {
      clearTimeout(panelCopyResetTimer);
      panelCopy.classList.remove("copied", "copy-error");
      panelCopy.classList.add(ok ? "copied" : "copy-error");
      panelCopy.innerHTML = ok ? "&#10003;" : "&#10007;";
      panelCopy.title = ok ? "Link copiato!" : "Copia non riuscita";
      panelCopyResetTimer = setTimeout(() => {
        panelCopy.classList.remove("copied", "copy-error");
        panelCopy.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
        panelCopy.title = "Copia link";
      }, 1600);
    };
    navigator.clipboard.writeText(url).then(() => showFeedback(true), () => showFeedback(false));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panelEl.classList.contains("hidden")) closePanel();
    if (e.key === "/" && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
    if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });

  function printWithCleanup(setup, cleanup) {
    const canvas = document.querySelector("#graph canvas");
    const parent = canvas && canvas.parentNode;
    const next = canvas && canvas.nextSibling;
    if (canvas) canvas.remove();
    setup();
    window.addEventListener(
      "afterprint",
      function onAfterPrint() {
        window.removeEventListener("afterprint", onAfterPrint);
        if (canvas && parent) parent.insertBefore(canvas, next);
        cleanup();
      },
      { once: true }
    );
    requestAnimationFrame(() => setTimeout(() => window.print(), 300));
  }

  const panelPrint = document.getElementById("panel-print");
  panelPrint.addEventListener("click", () => {
    document.body.setAttribute("data-print-target", "panel");
    printWithCleanup(() => {}, () => {});
  });

  function handleNodeClick(id) {
    if (id === exploringId) { showPage(id); return; }
    if (exploringId && !network.getConnectedNodes(exploringId).includes(id)) return;
    previewNode(id);
  }

  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const TAP_TOLERANCE_PX = 18;
  function nearestNodeWithinTolerance(domPos) {
    let bestId = null;
    let bestDist = TAP_TOLERANCE_PX;
    const ids = nodes.getIds().filter((id) => !nodes.get(id).hidden);
    const positions = network.getPositions(ids);
    ids.forEach((id) => {
      const pos = positions[id];
      if (!pos) return;
      const dom = network.canvasToDOM(pos);
      const dist = Math.hypot(dom.x - domPos.x, dom.y - domPos.y);
      if (dist < bestDist) { bestDist = dist; bestId = id; }
    });
    return bestId;
  }

  network.on("click", (params) => {
    if (params.nodes.length > 0) { handleNodeClick(params.nodes[0]); return; }
    if (isCoarsePointer) {
      const id = nearestNodeWithinTolerance(params.pointer.DOM);
      if (id) { handleNodeClick(id); return; }
    }
  });

  nodeOpenBtn.addEventListener("click", () => { if (exploringId) showPage(exploringId); });
  nodeVideoBtn.addEventListener("click", () => {
    const p = exploringId && pagesById[exploringId];
    if (p && p.video) openVideoModal(p.video);
  });

  document.getElementById("graph-reset").addEventListener("click", () => {
    network.unselectAll();
    resetHighlight();
    Object.keys(groupOpenState).forEach((cat) => (groupOpenState[cat] = false));
    listResults.querySelectorAll("details.cat-group[open]").forEach((d) => (d.open = false));
    network.fit({ animation: { duration: 400 } });
  });

  // --- search + grouped results list ---
  const searchForm = document.getElementById("search-form");
  const searchInput = document.getElementById("search");
  const searchBodyBtn = document.getElementById("search-body-toggle");

  function normalize(s) { return s.normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").toLowerCase(); }
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
      }
      prev = cur;
    }
    return prev[n];
  }
  const suggestVocab = (() => {
    const seen = new Map();
    DATA.pages.forEach((p) => {
      const nt = normalize(p.title);
      if (!seen.has(nt)) seen.set(nt, p.title);
      (p.tags || []).forEach((t) => {
        const nt2 = normalize(t);
        if (!seen.has(nt2)) seen.set(nt2, t);
      });
    });
    return Array.from(seen.values());
  })();
  function suggestFor(q) {
    const nq = normalize(q);
    if (!nq) return [];
    const maxDist = nq.length <= 4 ? 1 : nq.length <= 8 ? 2 : 3;
    const scored = [];
    suggestVocab.forEach((text) => {
      const nt = normalize(text);
      // substring match catches queries buried inside a compound word (e.g. "settanta"
      // inside "ultrasettantenni"), which edit distance alone would score as too far
      if (nq.length >= 4 && nt.includes(nq)) { scored.push({ text, dist: 0 }); return; }
      let best = levenshtein(nq, nt);
      nt.split(/\s+/).forEach((w) => { const d = levenshtein(nq, w); if (d < best) best = d; });
      if (best <= maxDist && best > 0) scored.push({ text, dist: best });
    });
    scored.sort((a, b) => a.dist - b.dist);
    const out = [];
    const seenText = new Set();
    for (const s of scored) {
      if (seenText.has(s.text)) continue;
      seenText.add(s.text);
      out.push(s.text);
      if (out.length >= 5) break;
    }
    return out;
  }

  const listResults = document.getElementById("list-results");
  const listCount = document.getElementById("list-count");

  const activeCategories = new Set();

  const plainTextCache = {};
  function plainTextOf(p) {
    if (plainTextCache[p.id] !== undefined) return plainTextCache[p.id];
    let s = p.markdown || "";
    s = s.replace(/```[\s\S]*?```/g, " ");
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
    s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
    s = s.replace(/\[\[([^\]]+)\]\]/g, "$1");
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    s = s.replace(/[#*_`>|]+/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    plainTextCache[p.id] = s;
    return s;
  }

  function snippetAround(text, q, radius) {
    radius = radius || 70;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text.slice(0, radius * 2);
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + q.length + radius);
    return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
  }

  const SEARCH_STOPWORDS = new Set([
    "mi", "ti", "si", "ci", "vi", "lo", "la", "le", "gli", "li", "un", "una", "uno",
    "il", "i", "e", "o", "a", "è",
    "di", "da", "in", "con", "su", "per", "tra", "fra",
    "al", "allo", "alla", "ai", "agli", "alle",
    "del", "dello", "della", "dei", "degli", "delle",
    "dal", "dallo", "dalla", "dai", "dagli", "dalle",
    "nel", "nello", "nella", "nei", "negli", "nelle",
    "sul", "sullo", "sulla", "sui", "sugli", "sulle",
    "che", "chi", "non",
  ]);

  // Italian words agree in gender/number ("smarrita" vs "smarrito" vs
  // "smarrimento") - stripping the last 2 chars of a long-enough token and
  // matching on that stem catches the shared root without a full stemmer
  function tokenStem(t) {
    return t.length >= 6 ? t.slice(0, t.length - 2) : t;
  }
  function tokenMatches(hay, token) {
    return hay.includes(token) || hay.includes(tokenStem(token));
  }
  const PROXIMITY_WINDOW = 120;
  function proximityMatch(textLower, tokens) {
    if (!tokens.length) return -1;
    const anchorKey = tokenStem(tokens[0]);
    let idx = textLower.indexOf(anchorKey);
    while (idx !== -1) {
      const start = Math.max(0, idx - PROXIMITY_WINDOW);
      const end = Math.min(textLower.length, idx + anchorKey.length + PROXIMITY_WINDOW);
      const slice = textLower.slice(start, end);
      if (tokens.every((t) => tokenMatches(slice, t))) return idx;
      idx = textLower.indexOf(anchorKey, idx + 1);
    }
    return -1;
  }

  function applyFilters() {
    network.unselectAll();
    resetHighlight();
    const q = searchInput.value.trim().toLowerCase();
    const searchBody = searchBodyBtn.getAttribute("aria-pressed") === "true";
    const qTokensRaw = q ? q.split(/\s+/).filter(Boolean) : [];
    const qTokensSignificant = qTokensRaw.filter((t) => t.length > 1 && !SEARCH_STOPWORDS.has(t));
    const qTokens = qTokensSignificant.length ? qTokensSignificant : qTokensRaw;
    const snippets = {};
    const visible = [];
    const categoryFacetCounts = {};
    const nodeUpdates = [];
    DATA.pages.forEach((p) => {
      const hay = (p.title + " " + (p.tags || []).join(" ") + " " + p.category).toLowerCase();
      let textMatch = !q || qTokens.every((t) => tokenMatches(hay, t));
      if (!textMatch && q && searchBody) {
        const plain = plainTextOf(p);
        const plainLower = plain.toLowerCase();
        const matchIdx = proximityMatch(plainLower, qTokens);
        if (matchIdx !== -1) {
          textMatch = true;
          snippets[p.id] = snippetAround(plain, qTokens[0]);
        }
      }
      const categoryMatch = activeCategories.size === 0 || activeCategories.has(p.category);
      const show = textMatch && categoryMatch;
      nodeUpdates.push({ id: p.id, hidden: !show });
      if (show) visible.push(p);
      if (textMatch) categoryFacetCounts[p.category] = (categoryFacetCounts[p.category] || 0) + 1;
    });
    nodes.update(nodeUpdates);
    updateFacetCounts(categoryFacetCounts);
    listCount.textContent = visible.length + " / " + DATA.pages.length + " pagine";

    const anyFilterActive = !!q || activeCategories.size > 0;
    if (anyFilterActive) {
      const visibleIds = new Set(visible.map((p) => p.id));
      const visibleEdgeCount = DATA.edges.reduce((n, e) => n + (visibleIds.has(e.source) && visibleIds.has(e.target) ? 1 : 0), 0);
      statsEl.textContent = visible.length + " pagine · " + visibleEdgeCount + " collegamenti";
    } else {
      statsEl.textContent = DATA.stats.pages + " pagine · " + DATA.stats.edges + " collegamenti";
    }

    if (graphReady) {
      if (q && visible.length) {
        network.fit({ nodes: visible.map((p) => p.id), animation: { duration: 400 }, minZoomLevel: 0.15, maxZoomLevel: 2 });
      } else if (!q) {
        network.fit({ animation: { duration: 400 } });
      }
    }

    const groups = {};
    visible.forEach((p) => { (groups[p.category] = groups[p.category] || []).push(p); });
    const groupNames = Object.keys(groups).sort();

    const pageItem = (p) => {
      const snippet = snippets[p.id];
      return (
        '<li data-id="' + p.id + '">' +
        '<div class="li-title">' + highlightMatch(p.title, q) + "</div>" +
        (snippet ? '<div class="li-snippet">' + highlightMatch(snippet, q) + "</div>" : "") +
        "</li>"
      );
    };

    const renderGroup = (cat, label, items, itemHtml) => {
      const wasOpen = groupOpenState[cat];
      const itemsHtml = items.map(itemHtml).join("");
      return (
        '<details class="cat-group"' + (wasOpen ? " open" : "") + ' data-cat="' + escapeHtml(cat) + '">' +
        '<summary>' + escapeHtml(label) + '<span class="li-cat">' + items.length + "</span></summary>" +
        '<ul class="cat-items">' + itemsHtml + "</ul>" +
        "</details>"
      );
    };

    let suggestionsHtml = "";
    if (q && visible.length === 0) {
      let suggestions = suggestFor(searchInput.value.trim());
      // vocab suggestions only look at titles/tags - if the query concept lives
      // only in a page's body (e.g. "smarrita" only appears in running text),
      // fall back to a stem-tolerant scan of the body text itself
      if (!suggestions.length) {
        const seenTitles = new Set();
        for (const p of DATA.pages) {
          const plainLower = plainTextOf(p).toLowerCase();
          if (qTokens.some((t) => tokenMatches(plainLower, t)) && !seenTitles.has(p.title)) {
            seenTitles.add(p.title);
            suggestions.push(p.title);
            if (suggestions.length >= 5) break;
          }
        }
      }
      suggestionsHtml =
        '<div class="search-suggestions">Nessun risultato per &laquo;' + escapeHtml(searchInput.value.trim()) + '&raquo;.' +
        (suggestions.length
          ? '<div class="sugg-label">Forse cercavi:</div><div class="chip-row">' +
            suggestions.map((s) => '<button type="button" class="sugg-chip" data-q="' + escapeHtml(s) + '">' + escapeHtml(s) + "</button>").join("") +
            "</div>"
          : "") +
        "</div>";
    }

    const cardsHtml = [];

    groupNames.forEach((cat) => {
      cardsHtml.push(renderGroup(cat, cat, groups[cat].slice().sort((a, b) => a.title.localeCompare(b.title)), pageItem));
    });

    const CARD_MIN_WIDTH = 340;
    const CARD_GAP = 14;
    const numCols = window.matchMedia("(max-width: 760px)").matches
      ? 1
      : Math.max(1, Math.floor((listResults.clientWidth + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)) || 1);
    const columns = Array.from({ length: numCols }, () => []);
    cardsHtml.forEach((html, i) => columns[i % numCols].push(html));
    const columnsHtml = columns.map((col) => '<div class="results-col">' + col.join("") + "</div>").join("");

    listResults.innerHTML = suggestionsHtml + columnsHtml;
  }

  function updateFacetCounts(categoryFacetCounts) {
    legendEl.querySelectorAll(".legend-row").forEach((row) => {
      const c = row.dataset.category;
      const n = categoryFacetCounts[c] || 0;
      row.querySelector(".legend-count").textContent = n;
      row.classList.toggle("chip-disabled", n === 0 && !activeCategories.has(c));
    });
    categoryFilterEl.querySelectorAll(".cat-chip").forEach((chip) => {
      const c = chip.dataset.category;
      const n = categoryFacetCounts[c] || 0;
      chip.querySelector(".chip-count").textContent = n;
      chip.classList.toggle("chip-disabled", n === 0 && !activeCategories.has(c));
    });
    const categoryBadge = categoryFilterEl.querySelector("summary .li-cat");
    if (categoryBadge) categoryBadge.textContent = DATA.categories.filter((c) => (categoryFacetCounts[c] || 0) > 0).length;
  }

  const groupOpenState = {};
  listResults.addEventListener("toggle", (e) => {
    const el = e.target;
    if (el.matches("details.cat-group")) groupOpenState[el.dataset.cat] = el.open;
  }, true);

  listResults.addEventListener("click", (e) => {
    const sugg = e.target.closest(".sugg-chip");
    if (sugg) {
      searchInput.value = sugg.dataset.q;
      updateClearVisibility();
      applyFilters();
      return;
    }
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    const q = searchInput.value.trim();
    reopenListOnClose = document.getElementById("list-panel").classList.contains("list-open");
    showPage(li.dataset.id, q ? { jumpQuery: q } : undefined);
    document.getElementById("list-panel").classList.remove("list-open");
    setListToggleIcon(false);
  });

  searchForm.addEventListener("submit", (e) => { e.preventDefault(); applyFilters(); });

  const searchClear = document.getElementById("search-clear");
  function updateClearVisibility() { searchClear.classList.toggle("visible", searchInput.value.length > 0); }
  searchInput.addEventListener("input", () => { updateClearVisibility(); });
  searchBodyBtn.addEventListener("click", () => {
    const pressed = searchBodyBtn.getAttribute("aria-pressed") === "true";
    searchBodyBtn.setAttribute("aria-pressed", String(!pressed));
    searchBodyBtn.classList.toggle("active", !pressed);
  });
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    updateClearVisibility();
    applyFilters();
    searchInput.focus();
  });
  updateClearVisibility();

  const listPanelEl = document.getElementById("list-panel");
  const listToggleBtn = document.getElementById("list-toggle");
  listToggleBtn.addEventListener("click", () => {
    const isOpen = listPanelEl.classList.toggle("list-open");
    setListToggleIcon(isOpen);
    if (isOpen) applyFilters();
    // switching graph into view: any fit computed while it was display:none (including
    // the initial stabilization fit, since list-open is the default landing view) sized
    // itself against a zero-width box - re-fit now that it's visible for real. This used
    // to defer to requestAnimationFrame to "wait for layout", but removing display:none
    // applies layout synchronously (clientWidth already reads correctly right above), and
    // rAF is throttled/paused while the tab isn't actively compositing (e.g. backgrounded),
    // which could silently drop this re-fit entirely - run it synchronously instead.
    if (!isOpen && graphReady) {
      applyLayoutForContainer();
      network.fit({ animation: false });
      basePositions = network.getPositions();
    }
  });

  // --- stats ---
  document.getElementById("stats").textContent = DATA.stats.pages + " pagine · " + DATA.stats.edges + " collegamenti";

  // --- legend (category-only) ---
  const legendEl = document.getElementById("legend");
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue("--" + name).trim();
  const categoryCounts = {};
  DATA.pages.forEach((p) => { categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1; });
  legendEl.innerHTML = DATA.categories
    .map(
      (c) =>
        '<div class="legend-row" data-category="' + escapeHtml(c) + '"><span class="legend-dot" style="background:' +
        cssVar(c) + '"></span>' + escapeHtml(c) +
        '<span class="legend-count">' + (categoryCounts[c] || 0) + "</span>" +
        "</div>"
    )
    .join("");

  function toggleCategory(cat) {
    if (activeCategories.has(cat)) activeCategories.delete(cat);
    else activeCategories.add(cat);
    legendEl.querySelectorAll('.legend-row[data-category="' + cat + '"]').forEach((r) => r.classList.toggle("active", activeCategories.has(cat)));
    categoryFilterEl.querySelectorAll('.cat-chip[data-category="' + cat + '"]').forEach((c) => c.classList.toggle("active", activeCategories.has(cat)));
    applyFilters();
  }

  legendEl.addEventListener("click", (e) => {
    const row = e.target.closest(".legend-row");
    if (!row) return;
    toggleCategory(row.dataset.category);
    document.getElementById("list-panel").classList.add("list-open");
    setListToggleIcon(true);
  });

  // --- category filter chips ---
  const categoryFilterEl = document.getElementById("category-filter");
  categoryFilterEl.innerHTML =
    '<details class="cat-group" open><summary>Categoria<span class="li-cat">' + DATA.categories.length + "</span></summary>" +
    '<div class="chip-row" style="padding:10px 14px 12px">' +
    DATA.categories
      .map((c) => '<span class="cat-chip" data-category="' + escapeHtml(c) + '">' + escapeHtml(c) + '<span class="chip-count">' + (DATA.stats.categoryCounts[c] || 0) + "</span></span>")
      .join("") +
    "</div></details>";

  categoryFilterEl.addEventListener("click", (e) => {
    const chip = e.target.closest(".cat-chip");
    if (!chip) return;
    toggleCategory(chip.dataset.category);
  });

  // --- percorsi ---
  const percorsiSection = document.getElementById("percorsi-section");
  const percorsiList = document.getElementById("percorsi-list");
  if (!DATA.percorsi || !DATA.percorsi.length) {
    percorsiSection.classList.add("hidden");
  } else {
    document.getElementById("percorsi-count").textContent = DATA.percorsi.length;
    percorsiList.innerHTML = DATA.percorsi
      .map(
        (pc) =>
          '<div class="percorso-item" data-id="' + escapeHtml(pc.id) + '"><strong>' + escapeHtml(pc.titolo) + "</strong>" +
          (pc.teaser ? "<span>" + escapeHtml(pc.teaser) + "</span>" : "") + "</div>"
      )
      .join("");
    percorsiList.addEventListener("click", (e) => {
      const item = e.target.closest(".percorso-item");
      if (!item) return;
      reopenListOnClose = document.getElementById("list-panel").classList.contains("list-open");
      showPage(item.dataset.id);
      document.getElementById("list-panel").classList.remove("list-open");
      setListToggleIcon(false);
    });
  }

  const statsEl = document.getElementById("stats");
  const topbarEl = document.getElementById("topbar");
  const mobileMq = window.matchMedia("(max-width: 760px)");

  const legendAccordion = document.createElement("details");
  legendAccordion.className = "cat-group legend-group";
  legendAccordion.open = true;
  const legendSummary = document.createElement("summary");
  legendSummary.innerHTML = 'Categoria (grafo)<span class="li-cat"></span>';
  legendAccordion.appendChild(legendSummary);

  const filtersSectionEl = document.getElementById("filters-section");
  function relocateLegend() {
    if (mobileMq.matches) {
      listPanelEl.insertBefore(statsEl, listPanelEl.firstChild);
      legendAccordion.appendChild(legendEl);
      filtersSectionEl.appendChild(legendAccordion);
    } else {
      topbarEl.appendChild(statsEl);
      graphWrapEl.insertBefore(legendEl, graphTooltip);
      legendAccordion.remove();
    }
  }
  relocateLegend();
  mobileMq.addEventListener("change", relocateLegend);

  // Start from the searchable list on every viewport; the graph remains
  // available as a secondary exploration view.
  listPanelEl.classList.add("list-open");
  setListToggleIcon(true);

  // first paint - runs after filters exist so it can also seed facet counts.
  applyFilters();


  let resizeRaf = null;
  window.addEventListener("resize", () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      applyFilters();
    });
  });

  document.getElementById("brand-home").addEventListener("click", () => {
    if (!panelEl.classList.contains("hidden")) closePanel();
    searchInput.value = "";
    searchBodyBtn.setAttribute("aria-pressed", "true");
    searchBodyBtn.classList.add("active");
    updateClearVisibility();
    activeCategories.clear();
    legendEl.querySelectorAll(".legend-row.active").forEach((r) => r.classList.remove("active"));
    categoryFilterEl.querySelectorAll(".cat-chip.active").forEach((c) => c.classList.remove("active"));
    Object.keys(groupOpenState).forEach((cat) => (groupOpenState[cat] = false));
    listPanelEl.classList.add("list-open");
    setListToggleIcon(true);
    applyFilters();
  });

  // --- keyboard navigation of the graph ---
  graphWrapEl.setAttribute("tabindex", "0");
  graphWrapEl.setAttribute("aria-label", "Grafo delle pagine. Frecce per navigare, invio per aprire, esc per uscire.");

  function initialKeyboardNode() {
    return DATA.pages.slice().sort((a, b) => b.degree - a.degree)[0].id;
  }

  function moveSelection(dx, dy) {
    if (!graphReady) return;
    if (!exploringId) { previewNode(initialKeyboardNode()); return; }
    const fromPos = network.getPositions([exploringId])[exploringId];
    const connected = network.getConnectedNodes(exploringId);
    if (!connected.length || !fromPos) return;
    const positions = network.getPositions(connected);
    let bestId = null;
    let bestScore = -Infinity;
    connected.forEach((id) => {
      const pos = positions[id];
      if (!pos) return;
      const vx = pos.x - fromPos.x;
      const vy = pos.y - fromPos.y;
      const dist = Math.hypot(vx, vy) || 0.001;
      const dot = (vx / dist) * dx + (vy / dist) * dy;
      if (dot <= 0.2) return;
      const score = dot / (1 + dist * 0.002);
      if (score > bestScore) { bestScore = score; bestId = id; }
    });
    if (bestId) previewNode(bestId);
  }

  const ARROW_DIRECTIONS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  graphWrapEl.addEventListener("keydown", (e) => {
    if (ARROW_DIRECTIONS[e.key]) {
      e.preventDefault();
      const [dx, dy] = ARROW_DIRECTIONS[e.key];
      moveSelection(dx, dy);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (exploringId) handleNodeClick(exploringId);
    } else if (e.key === "Escape" && exploringId) {
      network.unselectAll();
      resetHighlight();
      network.fit({ animation: { duration: 400 } });
    }
  });
})();

// supporto offline: mette in cache app shell + dati, il wiki si apre anche senza rete
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
