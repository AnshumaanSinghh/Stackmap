// The interactive viewer. Runs in the browser, inlined into one self-contained HTML file
// together with view.js, layout.js, theme.js, icons.js and draw.js (no network, no CDN).
(function () {
  'use strict';
  var DATA = JSON.parse(document.getElementById('sm-data').textContent);
  var graph = DATA.graph;
  var project = graph.project;
  var byIdAll = new Map(graph.nodes.map(function (n) { return [n.id, n]; }));
  var hasLibraries = graph.nodes.some(function (n) { return n.kind === 'library'; });

  var $ = function (sel) { return document.querySelector(sel); };
  var stage = $('#stage');
  var canvas = $('#canvas');
  var panel = $('#panel');
  var search = $('#q');

  var state = { libraries: false, selected: null, selectedEdge: null, hover: null, query: '', x: 0, y: 0, k: 1 };
  var view, layout, svg, byId;

  // ------------------------------------------------------------------ theme
  var root = document.documentElement;
  function storedTheme() { try { return localStorage.getItem('stackmap-theme'); } catch (e) { return null; } }
  function currentTheme() {
    var t = root.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  var saved = storedTheme();
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  $('#theme').addEventListener('click', function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('stackmap-theme', next); } catch (e) { /* private mode */ }
  });

  // ------------------------------------------------------------------ header
  var s = graph.summary;
  $('#proj').textContent = project.name;
  document.title = project.name + ' · Stackmap';
  var bits = [];
  if (s.apps) bits.push(plural(s.apps, 'app'));
  if (s.services) bits.push(plural(s.services, 'service'));
  if (s.workers) bits.push(plural(s.workers, 'worker'));
  if (s.datastores) bits.push(plural(s.datastores, 'data store'));
  if (s.external) bits.push(s.external + ' third-party');
  $('#stats').textContent = bits.join(' · ');
  if (!hasLibraries) $('#viewseg').hidden = true;
  $('#meta').textContent = 'Stackmap ' + graph.tool.version + (project.commit ? ' · ' + project.commit.slice(0, 7) : '') + ' · ' + graph.summary.ms + ' ms';

  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  // ------------------------------------------------------------------ render
  function render() {
    view = viewGraph(graph, { libraries: state.libraries });
    byId = new Map(view.nodes.map(function (n) { return [n.id, n]; }));
    layout = layoutGraph(view);
    canvas.innerHTML = drawSvg(view, layout, { mode: 'external', interactive: true });
    svg = canvas.querySelector('svg');
    $('#empty').hidden = view.nodes.length > 0;
    if (state.selected && !byId.has(state.selected)) state.selected = null;
    applyHighlight();
  }

  function applyHighlight() {
    if (!svg) return;
    var focus = state.selected || state.hover;
    var keep = null;
    var hiEdges = new Set();
    if (state.selectedEdge) {
      var se = view.edges.find(function (e) { return e.id === state.selectedEdge; });
      if (se) {
        keep = new Set([se.from, se.to]);
        hiEdges.add(se.id);
      }
    } else if (focus) {
      keep = neighbours(view, focus);
      view.edges.forEach(function (e) { if (e.from === focus || e.to === focus) hiEdges.add(e.id); });
    }
    var q = state.query.trim().toLowerCase();
    svg.querySelectorAll('.sm-node').forEach(function (el) {
      var id = el.getAttribute('data-id');
      var n = byId.get(id);
      var match = q && matches(n, q);
      el.classList.toggle('sm-dim', Boolean((keep && !keep.has(id)) || (q && !match && !keep)));
      el.classList.toggle('sm-sel', id === state.selected);
      el.classList.toggle('sm-match', Boolean(match && !keep));
    });
    svg.querySelectorAll('.sm-edge').forEach(function (el) {
      var id = el.getAttribute('data-id');
      var on = hiEdges.has(id);
      el.classList.toggle('sm-hi', on);
      el.classList.toggle('sm-dim', Boolean((keep && !on) || (q && !keep)));
    });
  }

  function matches(n, q) {
    if (!n) return false;
    var hay = [n.name, n.path, n.packageName, n.category, n.categoryLabel, n.kind, n.image].concat(n.frameworks || [], n.platforms || []).join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  // ------------------------------------------------------------------ pan & zoom
  function apply() { canvas.style.transform = 'translate(' + state.x + 'px,' + state.y + 'px) scale(' + state.k + ')'; }
  function fit() {
    if (!layout) return;
    var r = stage.getBoundingClientRect();
    var k = Math.min(r.width / layout.width, r.height / layout.height, 1.4) * 0.96;
    state.k = Math.max(0.08, k);
    state.x = (r.width - layout.width * state.k) / 2;
    state.y = Math.max(0, (r.height - layout.height * state.k) / 2);
    apply();
  }
  function zoomAt(factor, cx, cy) {
    var k = Math.min(4, Math.max(0.08, state.k * factor));
    factor = k / state.k;
    state.x = cx - (cx - state.x) * factor;
    state.y = cy - (cy - state.y) * factor;
    state.k = k;
    apply();
  }
  function centerOn(id) {
    var b = layout.boxes.get(id);
    if (!b) return;
    var r = stage.getBoundingClientRect();
    if (state.k < 0.7) state.k = 0.9;
    state.x = r.width / 2 - (b.x + b.w / 2) * state.k;
    state.y = r.height / 2 - (b.y + b.h / 2) * state.k;
    apply();
  }

  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = stage.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
    } else {
      state.x -= e.deltaX;
      apply();
    }
  }, { passive: false });

  var pointers = new Map();
  var drag = null;
  var pinch = null;
  stage.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      var p = Array.from(pointers.values());
      pinch = { d: dist(p[0], p[1]), k: state.k };
      drag = null;
    } else {
      drag = { x: e.clientX, y: e.clientY, ox: state.x, oy: state.y, moved: false, target: e.target };
    }
  });
  window.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      var p = Array.from(pointers.values());
      var r = stage.getBoundingClientRect();
      var cx = (p[0].x + p[1].x) / 2 - r.left;
      var cy = (p[0].y + p[1].y) / 2 - r.top;
      zoomAt((pinch.k * dist(p[0], p[1])) / pinch.d / state.k, cx, cy);
      return;
    }
    if (!drag) return;
    var dx = e.clientX - drag.x;
    var dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true;
      stage.classList.add('panning');
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    if (drag.moved) {
      state.x = drag.ox + dx;
      state.y = drag.oy + dy;
      apply();
    }
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && !drag.moved && e.type === 'pointerup') click(drag.target);
    if (pointers.size === 0) {
      drag = null;
      stage.classList.remove('panning');
    }
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) || 1; }

  function click(target) {
    var nodeEl = target.closest && target.closest('.sm-node');
    var edgeEl = target.closest && (target.closest('.sm-hit') || target.closest('.sm-edge'));
    if (nodeEl) selectNode(nodeEl.getAttribute('data-id'));
    else if (edgeEl) selectEdge(edgeEl.getAttribute('data-id'));
    else clearSelection();
  }

  stage.addEventListener('mouseover', function (e) {
    var el = e.target.closest && e.target.closest('.sm-node');
    var id = el ? el.getAttribute('data-id') : null;
    if (id !== state.hover) {
      state.hover = id;
      if (!state.selected && !state.selectedEdge) applyHighlight();
    }
  });
  stage.addEventListener('mouseleave', function () {
    state.hover = null;
    if (!state.selected) applyHighlight();
  });
  stage.addEventListener('keydown', function (e) {
    var el = e.target.closest && e.target.closest('.sm-node');
    if (el && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      selectNode(el.getAttribute('data-id'));
    }
  });

  // ------------------------------------------------------------------ selection & panel
  function selectNode(id, opts) {
    state.selected = id;
    state.selectedEdge = null;
    applyHighlight();
    showNode(byId.get(id) || byIdAll.get(id));
    if (opts && opts.center) centerOn(id);
  }
  function selectEdge(id) {
    state.selected = null;
    state.selectedEdge = id;
    applyHighlight();
    showEdge(view.edges.find(function (e) { return e.id === id; }));
  }
  function clearSelection() {
    state.selected = null;
    state.selectedEdge = null;
    panel.hidden = true;
    applyHighlight();
  }

  var CONF = {
    imported: ['in code', 'Imported or called in source code.'],
    configured: ['configured', 'Wired up in configuration: env vars, docker-compose, infrastructure or ORM config.'],
    declared: ['declared', 'Declared in a package manifest.'],
    inferred: ['inferred', 'Inferred from naming, such as an API_URL env var. Check before relying on it.'],
  };

  function esc(t) { return escapeXml(t); }
  function srcUrl(ev) {
    if (!project.repoUrl) return null;
    var ref = project.commit || 'HEAD';
    var p = [project.prefix, ev.file].filter(Boolean).join('/');
    if (/gitlab/.test(project.repoUrl)) return project.repoUrl + '/-/blob/' + ref + '/' + p + '#L' + ev.line;
    if (/bitbucket/.test(project.repoUrl)) return project.repoUrl + '/src/' + ref + '/' + p + '#lines-' + ev.line;
    return project.repoUrl + '/blob/' + ref + '/' + p + '#L' + ev.line;
  }
  function evidenceList(list, total) {
    if (!list || !list.length) return '<p class="more">No evidence recorded.</p>';
    var html = '<ul class="ev">' + list.map(function (ev) {
      var url = srcUrl(ev);
      var loc = esc(ev.file) + ':' + ev.line;
      return '<li><div class="why">' + esc(ev.why) + '</div><div class="loc">' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + loc + '</a>' : loc) + '</div>' + (ev.text ? '<pre>' + esc(ev.text) + '</pre>' : '') + '</li>';
    }).join('') + '</ul>';
    if (total && total > list.length) html += '<div class="more">and ' + (total - list.length) + ' more place' + (total - list.length === 1 ? '' : 's') + '</div>';
    return html;
  }
  function iconBox(n) {
    var fam = familyOf(n);
    return '<div class="p-icon" style="background:color-mix(in srgb,var(--sm-' + fam + ') 15%,transparent);stroke:var(--sm-' + fam + ')"><svg viewBox="0 0 24 24">' + iconFor(n) + '</svg></div>';
  }
  function kindLabel(n) {
    if (n.unit) return (KIND_LABELS[n.kind] || n.kind) + (n.language ? ' · ' + n.language : '');
    if (n.container) return 'Container' + (n.image ? ' · ' + n.image : '');
    return (CATEGORY_SINGULAR[n.category] || KIND_LABELS[n.kind] || '') + (n.kind === 'datastore' ? ' · data store' : n.kind === 'external' ? ' · third-party' : '');
  }
  function relRow(e, otherId, dir) {
    var other = byId.get(otherId) || byIdAll.get(otherId);
    if (!other) return '';
    var c = CONF[e.confidence] || CONF.declared;
    var via = (e.via || []).filter(function (v) { return v.charAt(0) !== '$'; });
    var envs = (e.via || []).filter(function (v) { return v.charAt(0) === '$'; });
    var chips = '<span class="chip c-' + e.confidence + '">' + (e.declaredOnly ? 'declared only' : c[0]) + '</span>' +
      via.map(function (v) { return '<span class="chip">via ' + esc(v) + '</span>'; }).join('') +
      (e.through || []).slice(0, 2).map(function (t) { return '<span class="chip">through ' + esc(t) + '</span>'; }).join('') +
      envs.slice(0, 2).map(function (v) { return '<span class="chip mono">' + esc(v) + '</span>'; }).join('');
    return '<li><details><summary><span class="name">' + esc(other.name) + '</span>' + chips + '<button class="go" data-go="' + esc(otherId) + '">open</button></summary><div class="body">' +
      (e.declaredOnly ? '<div class="note">Declared in a manifest, but no runtime import was found. It may be unused.</div>' : '') +
      evidenceList(e.evidence, e.evidenceCount) + '</div></details></li>';
  }
  function showNode(n) {
    if (!n) return;
    var out = view.edges.filter(function (e) { return e.from === n.id; });
    var inc = view.edges.filter(function (e) { return e.to === n.id; });
    var h = '<div class="p-head">' + iconBox(n) + '<div><div class="p-title">' + esc(n.name) + '</div><div class="p-kind">' + esc(kindLabel(n)) + '</div></div><button class="btn p-close" aria-label="Close" data-close>✕</button></div>';
    if (n.description) h += '<p class="p-desc">' + esc(n.description) + '</p>';
    if (n.path) h += '<div class="mono" style="color:var(--sm-ink2)">' + esc(n.path) + (n.packageName && n.packageName !== n.name ? ' · ' + esc(n.packageName) : '') + '</div>';
    var chips = (n.frameworks || []).map(function (f) { return '<span class="chip">' + esc(f) + '</span>'; }).concat((n.platforms || []).map(function (p) { return '<span class="chip">deploys: ' + esc(p) + '</span>'; }));
    if (chips.length) h += '<div class="chips">' + chips.join('') + '</div>';
    if (n.url) h += '<div style="margin-top:6px"><a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.url.replace(/^https?:\/\//, '')) + '</a></div>';
    if (out.length) h += '<h3>' + (n.unit || n.container ? 'Talks to' : 'Depends on') + ' · ' + out.length + '</h3><ul class="rel">' + out.map(function (e) { return relRow(e, e.to); }).join('') + '</ul>';
    if (inc.length) h += '<h3>Used by · ' + inc.length + '</h3><ul class="rel">' + inc.map(function (e) { return relRow(e, e.from); }).join('') + '</ul>';
    if (!n.unit) {
      var imp = impactOf(graph, n.id);
      var names = [];
      imp.forEach(function (v, id) { var x = byIdAll.get(id); if (x && x.kind !== 'library') names.push(x.name); });
      if (names.length) h += '<h3>If ' + esc(n.name) + ' is down</h3><div class="note">' + names.length + ' part' + (names.length === 1 ? '' : 's') + ' of the system depend on it, directly or through other parts: ' + names.slice(0, 12).map(esc).join(', ') + (names.length > 12 ? ', …' : '') + '</div>';
    }
    h += '<h3>Why it is on the map</h3>' + evidenceList(n.evidence, n.evidenceCount);
    if (n.env && n.env.length) h += '<h3>Reads env vars · ' + n.env.length + '</h3><div class="env">' + n.env.map(function (v) { return '<code>' + esc(v) + '</code>'; }).join('') + '</div>';
    openPanel(h);
  }
  function showEdge(e) {
    if (!e) return;
    var a = byId.get(e.from);
    var b = byId.get(e.to);
    var c = CONF[e.confidence] || CONF.declared;
    var h = '<div class="p-head"><div><div class="p-title">' + esc(a.name) + ' → ' + esc(b.name) + '</div><div class="p-kind">' + esc(e.kind) + '</div></div><button class="btn p-close" aria-label="Close" data-close>✕</button></div>';
    h += '<div class="chips"><span class="chip c-' + e.confidence + '">' + c[0] + '</span>' + (e.via || []).map(function (v) { return '<span class="chip">' + esc(v) + '</span>'; }).join('') + '</div>';
    h += '<div class="note">' + c[1] + (e.declaredOnly ? ' No runtime import was found, so it may be unused.' : '') + '</div>';
    if (e.through && e.through.length) h += '<div class="note">Through internal ' + (e.through.length === 1 ? 'library' : 'libraries') + ': ' + e.through.map(esc).join(', ') + '. Switch to “Everything” to see them.</div>';
    h += '<h3>Evidence</h3>' + evidenceList(e.evidence, e.evidenceCount);
    openPanel(h);
  }
  function openPanel(html) {
    panel.innerHTML = html;
    panel.hidden = false;
    panel.scrollTop = 0;
  }
  panel.addEventListener('click', function (e) {
    var go = e.target.closest('[data-go]');
    if (go) {
      e.preventDefault();
      selectNode(go.getAttribute('data-go'), { center: true });
      return;
    }
    if (e.target.closest('[data-close]')) clearSelection();
  });

  // ------------------------------------------------------------------ controls
  search.addEventListener('input', function () {
    state.query = search.value;
    applyHighlight();
  });
  search.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var q = search.value.trim().toLowerCase();
      var hit = view.nodes.find(function (n) { return n.name.toLowerCase() === q; }) || view.nodes.find(function (n) { return matches(n, q); });
      if (hit) {
        search.blur();
        state.query = '';
        search.value = '';
        selectNode(hit.id, { center: true });
      }
    } else if (e.key === 'Escape') {
      search.value = '';
      state.query = '';
      search.blur();
      applyHighlight();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.target === search) return;
    if (e.key === '/') { e.preventDefault(); search.focus(); }
    else if (e.key === 'Escape') clearSelection();
    else if (e.key === 'f' || e.key === '0') fit();
    else if (e.key === '+' || e.key === '=') zoomCenter(1.25);
    else if (e.key === '-') zoomCenter(0.8);
  });
  function zoomCenter(f) { var r = stage.getBoundingClientRect(); zoomAt(f, r.width / 2, r.height / 2); }
  $('#zin').addEventListener('click', function () { zoomCenter(1.25); });
  $('#zout').addEventListener('click', function () { zoomCenter(0.8); });
  $('#zfit').addEventListener('click', fit);
  document.querySelectorAll('#viewseg button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.libraries = b.getAttribute('data-view') === 'all';
      document.querySelectorAll('#viewseg button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      render();
      fit();
      hint(state.libraries ? 'Showing internal libraries' : 'Libraries folded into the apps that use them');
    });
  });

  // ------------------------------------------------------------------ export
  function download(name, type, data) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function fileBase() { return String(project.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-stackmap'; }
  function standaloneSvg() {
    return drawSvg(view, layout, { mode: currentTheme(), legend: true, title: project.name, subtitle: $('#stats').textContent });
  }
  function closeMenu() { $('#exportmenu').removeAttribute('open'); }
  $('#ex-svg').addEventListener('click', function () { download(fileBase() + '.svg', 'image/svg+xml', standaloneSvg()); closeMenu(); });
  $('#ex-png').addEventListener('click', function () {
    var markup = standaloneSvg();
    var img = new Image();
    var w = Number(markup.match(/width="(\d+)"/)[1]);
    var h = Number(markup.match(/height="(\d+)"/)[1]);
    img.onload = function () {
      var scale = Math.min(2, 8000 / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      var ctx = c.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      c.toBlob(function (blob) { download(fileBase() + '.png', 'image/png', blob); });
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
    closeMenu();
  });
  $('#ex-mmd').addEventListener('click', function () {
    var text = state.libraries ? DATA.mermaid.everything : DATA.mermaid.services;
    var done = function () { toast('Mermaid copied. Paste it into a ```mermaid block'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { download(fileBase() + '.mmd', 'text/plain', text); });
    else download(fileBase() + '.mmd', 'text/plain', text);
    closeMenu();
  });
  $('#ex-json').addEventListener('click', function () { download(fileBase() + '.json', 'application/json', JSON.stringify(graph, null, 2)); closeMenu(); });
  document.addEventListener('click', function (e) { if (!e.target.closest('#exportmenu')) closeMenu(); });

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  var hintTimer;
  function hint(msg) {
    var t = $('#hint');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  // ------------------------------------------------------------------ start
  render();
  fit();
  window.addEventListener('resize', function () { fit(); });
  var start = location.hash.slice(1);
  if (start) {
    var target = graph.nodes.find(function (n) { return n.name === decodeURIComponent(start) || n.id === decodeURIComponent(start); });
    if (target && byId.has(target.id)) selectNode(target.id, { center: true });
  }
})();
