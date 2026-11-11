// One self-contained HTML file: data, styles and code inline. No network requests, no CDN,
// so it works offline, in CI artifacts, and on locked-down machines.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { viewGraph } from '../graph/view.js';
import { toMermaid } from './mermaid.js';
import { THEMES } from './theme.js';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

// Browser bundle: these modules are written to work without imports once concatenated.
const SHARED = ['./theme.js', './icons.js', '../graph/view.js', './layout.js', './draw.js'];

let cached = null;
export function viewerBundle() {
  if (cached) return cached;
  const code = SHARED.map((rel) => stripModule(fs.readFileSync(here(rel), 'utf8'))).join('\n');
  const viewer = fs.readFileSync(here('./viewer/viewer.js'), 'utf8');
  const css = fs.readFileSync(here('./viewer/viewer.css'), 'utf8');
  cached = { js: `${code}\n${viewer}`, css };
  return cached;
}

/** Remove import lines and `export` keywords so modules can share one script scope. */
export function stripModule(src) {
  return src
    .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+(?=(async\s+)?function|const|let|class)/gm, '');
}

const LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3.5" width="18" height="4.5" rx="2.25" fill="var(--sm-app)"/><rect x="3" y="9.75" width="12" height="4.5" rx="2.25" fill="var(--sm-service)"/><rect x="3" y="16" width="15" height="4.5" rx="2.25" fill="var(--sm-data)"/><path d="M20 12v6.25" stroke="var(--sm-ink2)" stroke-width="1.6" stroke-linecap="round"/><circle cx="20" cy="11.2" r="1.6" fill="var(--sm-ink2)"/></svg>';

export function toHtml(graph) {
  const { js, css } = viewerBundle();
  const mermaid = {
    services: toMermaid(viewGraph(graph, { libraries: false })),
    everything: toMermaid(viewGraph(graph, { libraries: true })),
  };
  const data = JSON.stringify({ graph, mermaid }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const vars = (t) => Object.entries(t).map(([k, v]) => `--sm-${k}:${v};`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Stackmap ${graph.tool.version}">
<title>${escapeHtml(graph.project.name)} · Stackmap</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(LOGO.replace(/var\(--sm-app\)/g, '#2a78d6').replace(/var\(--sm-service\)/g, '#eb6834').replace(/var\(--sm-data\)/g, '#1baf7a').replace(/var\(--sm-ink2\)/g, '#52514e'))}">
<style>
:root{color-scheme:light;${vars(THEMES.light)}}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;${vars(THEMES.dark)}}}
:root[data-theme="dark"]{color-scheme:dark;${vars(THEMES.dark)}}
:root[data-theme="light"]{color-scheme:light}
${css}
</style>
</head>
<body>
<header class="bar">
  <div class="brand">${LOGO}<span>Stackmap</span><span class="sep">/</span><span class="proj" id="proj"></span></div>
  <div class="stats" id="stats"></div>
  <div class="spacer"></div>
  <label class="search"><span class="vh">Search the map</span><input id="q" type="search" placeholder="Search" autocomplete="off" spellcheck="false"><kbd>/</kbd></label>
  <div class="seg" id="viewseg" role="group" aria-label="View"><button data-view="services" aria-pressed="true" title="Fold internal libraries into the apps that use them">Services</button><button data-view="all" aria-pressed="false" title="Show internal libraries too">Everything</button></div>
  <button class="btn" id="theme" title="Toggle dark mode" aria-label="Toggle dark mode"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg></button>
  <details class="menu" id="exportmenu"><summary class="btn">Export</summary><div class="items">
    <button id="ex-svg">SVG image<small>For docs and slides</small></button>
    <button id="ex-png">PNG image<small>2× resolution</small></button>
    <button id="ex-mmd">Copy Mermaid<small>Renders on GitHub and GitLab</small></button>
    <button id="ex-json">JSON<small>The full graph with evidence</small></button>
  </div></details>
</header>
<main>
  <div id="stage" tabindex="-1">
    <div id="canvas"></div>
    <div class="empty" id="empty" hidden><div><h2>Nothing to map yet</h2><p>Stackmap found no apps, services or dependencies here.<br>Run it from the root of a project.</p></div></div>
    <div class="hint" id="hint" role="status"></div>
    <div class="legend" aria-label="Legend">
      <span class="item"><span class="sw" style="background:var(--sm-app)"></span>Apps</span>
      <span class="item"><span class="sw" style="background:var(--sm-service)"></span>Services</span>
      <span class="item"><span class="sw" style="background:var(--sm-worker)"></span>Workers</span>
      <span class="item"><span class="sw" style="background:var(--sm-data)"></span>Data</span>
      <span class="item"><span class="sw" style="background:var(--sm-external)"></span>Third-party</span>
      <span class="item"><span class="ln"></span>in code</span>
      <span class="item"><span class="ln dash"></span>declared only</span>
      <span class="item"><span class="ln dot"></span>inferred</span>
      <span class="item meta" id="meta"></span>
    </div>
    <div class="zoom"><button class="btn" id="zin" aria-label="Zoom in">+</button><button class="btn" id="zout" aria-label="Zoom out">−</button><button class="btn" id="zfit" aria-label="Fit to screen" title="Fit (F)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button></div>
  </div>
  <aside id="panel" hidden aria-live="polite"></aside>
</main>
<div class="toast" id="toast" role="status"></div>
<script type="application/json" id="sm-data">${data}</script>
<script>
${js}
</script>
</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
