#!/usr/bin/env node
// Builds site/index.html (the GitHub Pages landing page) from site/gallery/index.json.
//   node scripts/build-site.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES } from '../src/render/theme.js';
import { createCatalog } from '../src/catalog/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, '..', 'site');
const gallery = JSON.parse(fs.readFileSync(path.join(site, 'gallery', 'index.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
const techCount = createCatalog().entries.length;
const REPO = 'https://github.com/AnshumaanSinghh/Stackmap';
const URL = 'https://anshumaansinghh.github.io/Stackmap/';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const vars = (t) => Object.entries(t).map(([k, v]) => `--sm-${k}:${v};`).join('');
const roundDown = (n) => Math.floor(n / 50) * 50;

const LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3.5" width="18" height="4.5" rx="2.25" fill="var(--sm-app)"/><rect x="3" y="9.75" width="12" height="4.5" rx="2.25" fill="var(--sm-service)"/><rect x="3" y="16" width="15" height="4.5" rx="2.25" fill="var(--sm-data)"/><path d="M20 12v6.25" stroke="var(--sm-muted)" stroke-width="1.6" stroke-linecap="round"/><circle cx="20" cy="11.2" r="1.6" fill="var(--sm-muted)"/></svg>';

const card = (g) => {
  const c = g.counts;
  const bits = [c.apps && `${c.apps} app${c.apps > 1 ? 's' : ''}`, c.services && `${c.services} service${c.services > 1 ? 's' : ''}`, c.workers && `${c.workers} worker${c.workers > 1 ? 's' : ''}`, `${c.datastores} data`, `${c.external} third-party`].filter(Boolean).join(' · ');
  return `<a class="card" href="gallery/${g.slug}.html">
  <div class="thumb"><img src="gallery/${g.slug}.svg" alt="Architecture map of ${esc(g.title)}" loading="lazy"></div>
  <div class="card-body">
    <div class="card-title"><strong>${esc(g.title)}</strong><span>${esc(g.repo)}</span></div>
    <p>${esc(g.blurb)}</p>
    <div class="meta">${esc(bits)} · ${(g.ms / 1000).toFixed(1)} s</div>
  </div>
</a>`;
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stackmap · Architecture diagrams drawn from your code</title>
<meta name="description" content="Stackmap maps every service, database, queue and third-party API in your codebase, and links each one to the line of code that proves it. One command, zero dependencies, nothing uploaded.">
<link rel="canonical" href="${URL}">
<meta property="og:type" content="website">
<meta property="og:title" content="Stackmap: the architecture diagram that draws itself">
<meta property="og:description" content="Every service, database, queue and third-party API in your repo, on one map, with a link to the code behind each box. npx stackmap-cli">
<meta property="og:url" content="${URL}">
<meta property="og:image" content="${URL}og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${URL}og.png">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<style>
:root{color-scheme:light;${vars(THEMES.light)}--accent:#2a78d6;--code:#f2f1ed}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;${vars(THEMES.dark)}--accent:#5598e7;--code:#232322}}
:root[data-theme="dark"]{color-scheme:dark;${vars(THEMES.dark)}--accent:#5598e7;--code:#232322}
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--sm-page);color:var(--sm-ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
code,pre,kbd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
nav{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--sm-page) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--sm-hairline)}
nav .wrap{display:flex;align-items:center;gap:20px;height:58px}
.brand{display:flex;align-items:center;gap:8px;font-weight:750;color:var(--sm-ink);font-size:17px}
.brand svg{width:24px;height:24px}
nav .links{margin-left:auto;display:flex;gap:18px;align-items:center;font-size:14.5px}
nav .links a{color:var(--sm-ink2)}
.btn{display:inline-flex;align-items:center;gap:8px;height:42px;padding:0 16px;border-radius:10px;border:1px solid var(--sm-border);background:var(--sm-card);color:var(--sm-ink);font-weight:600;font-size:15px;cursor:pointer}
.btn:hover{text-decoration:none;border-color:var(--sm-axis)}
.btn.primary{background:var(--sm-ink);color:var(--sm-page);border-color:var(--sm-ink)}
.btn svg{width:18px;height:18px}
nav .btn{height:34px;font-size:14px}
header.hero{padding:72px 0 32px;text-align:center}
.eyebrow{display:inline-block;font-size:13px;font-weight:600;color:var(--sm-ink2);border:1px solid var(--sm-hairline);background:var(--sm-card);border-radius:999px;padding:4px 12px;margin-bottom:22px}
h1{font-size:clamp(36px,6vw,64px);line-height:1.04;letter-spacing:-.035em;margin:0 auto 18px;max-width:15ch}
.lede{font-size:clamp(17px,2.2vw,20px);color:var(--sm-ink2);max-width:60ch;margin:0 auto 30px}
.cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;align-items:center}
.cmd{display:inline-flex;align-items:center;gap:12px;height:48px;padding:0 8px 0 18px;border-radius:12px;background:var(--sm-ink);color:var(--sm-page);font:600 16px ui-monospace,SFMono-Regular,Menlo,monospace}
.cmd .dollar{opacity:.5}
.cmd button{height:34px;border-radius:8px;border:0;padding:0 12px;background:color-mix(in srgb,var(--sm-page) 16%,transparent);color:inherit;font:600 13px system-ui;cursor:pointer}
.facts{display:flex;gap:10px 22px;justify-content:center;flex-wrap:wrap;margin-top:20px;color:var(--sm-muted);font-size:14px}
.facts span::before{content:"✓ ";color:var(--sm-data);font-weight:700}
.window{margin:44px auto 0;border:1px solid var(--sm-border);border-radius:14px;overflow:hidden;background:var(--sm-card);box-shadow:0 30px 80px -30px rgba(0,0,0,.35)}
.window .chrome{display:flex;align-items:center;gap:7px;padding:10px 14px;border-bottom:1px solid var(--sm-hairline);font-size:13px;color:var(--sm-muted)}
.window .chrome i{width:11px;height:11px;border-radius:50%;background:var(--sm-hairline);display:inline-block}
.window .chrome span{margin-left:8px}
.window .chrome a{margin-left:auto;font-size:13px}
.window iframe{display:block;width:100%;height:min(72vh,660px);border:0;background:var(--sm-surface)}
section{padding:80px 0;border-top:1px solid var(--sm-hairline)}
h2{font-size:clamp(28px,4vw,40px);letter-spacing:-.025em;line-height:1.1;margin:0 0 14px}
.sub{color:var(--sm-ink2);font-size:18px;max-width:62ch;margin:0 0 36px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}
.feature{background:var(--sm-card);border:1px solid var(--sm-hairline);border-radius:14px;padding:22px}
.feature h3{margin:0 0 8px;font-size:18px;letter-spacing:-.01em}
.feature p{margin:0 0 14px;color:var(--sm-ink2);font-size:15px}
.feature pre{margin:0;background:var(--code);border-radius:9px;padding:10px 12px;font-size:13px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px;vertical-align:0}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:18px}
.card{display:flex;flex-direction:column;background:var(--sm-card);border:1px solid var(--sm-hairline);border-radius:14px;overflow:hidden;color:var(--sm-ink);transition:transform .15s,border-color .15s}
.card:hover{text-decoration:none;transform:translateY(-2px);border-color:var(--sm-axis)}
.thumb{aspect-ratio:16/9;background:#fcfcfb;border-bottom:1px solid var(--sm-hairline);display:grid;place-items:center;overflow:hidden;padding:10px}
.thumb img{max-width:100%;max-height:100%;object-fit:contain}
.card-body{padding:16px 18px 18px}
.card-title{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:6px}
.card-title strong{font-size:17px}
.card-title span{font:12.5px ui-monospace,monospace;color:var(--sm-muted)}
.card p{margin:0 0 12px;color:var(--sm-ink2);font-size:14.5px}
.card .meta{font-size:13px;color:var(--sm-muted)}
table{width:100%;border-collapse:collapse;font-size:15px;background:var(--sm-card);border:1px solid var(--sm-hairline);border-radius:14px;overflow:hidden}
th,td{padding:12px 14px;border-bottom:1px solid var(--sm-hairline);text-align:center}
th:first-child,td:first-child{text-align:left}
thead th{font-size:13px;color:var(--sm-ink2);font-weight:650;background:var(--sm-surface)}
tbody tr:last-child td{border-bottom:0}
td.y{color:var(--sm-data);font-weight:700}
td.n{color:var(--sm-muted)}
td.us{background:color-mix(in srgb,var(--sm-app) 7%,transparent)}
.table-scroll{overflow-x:auto;border-radius:14px}
.steps{counter-reset:s;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
.step{position:relative;padding:22px;border-radius:14px;border:1px solid var(--sm-hairline);background:var(--sm-card)}
.step::before{counter-increment:s;content:counter(s);display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--sm-ink);color:var(--sm-page);font-weight:700;font-size:14px;margin-bottom:12px}
.step h3{margin:0 0 6px;font-size:17px}
.step p{margin:0;color:var(--sm-ink2);font-size:15px}
.legend{display:flex;gap:14px 22px;flex-wrap:wrap;margin:22px 0 0;color:var(--sm-ink2);font-size:14px}
footer{border-top:1px solid var(--sm-hairline);padding:36px 0 48px;color:var(--sm-muted);font-size:14px}
footer .wrap{display:flex;gap:18px;flex-wrap:wrap;justify-content:space-between}
.toggle{width:34px;padding:0;justify-content:center}
@media (max-width:640px){nav .links a.hide-sm{display:none}header.hero{padding-top:48px}.window iframe{height:520px}section{padding:56px 0}}
</style>
</head>
<body>
<nav><div class="wrap">
  <a class="brand" href="#">${LOGO}Stackmap</a>
  <div class="links">
    <a class="hide-sm" href="#gallery">Gallery</a>
    <a class="hide-sm" href="#features">Features</a>
    <a class="hide-sm" href="${REPO}/tree/main/docs">Docs</a>
    <button class="btn toggle" id="theme" aria-label="Toggle dark mode"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg></button>
    <a class="btn" href="${REPO}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8L12 2.5z"/></svg>Star on GitHub</a>
  </div>
</div></nav>

<header class="hero"><div class="wrap">
  <span class="eyebrow">Open source · MIT · zero dependencies</span>
  <h1>The architecture diagram that draws itself.</h1>
  <p class="lede">Stackmap reads your code and maps every service, database, queue and third-party API, then links each box and arrow to the exact line that proves it. One command. No AI, no account, nothing uploaded.</p>
  <div class="cta">
    <div class="cmd"><span><span class="dollar">$</span> npx stackmap-cli</span><button id="copy" type="button">Copy</button></div>
    <a class="btn" href="#gallery">See real maps</a>
  </div>
  <div class="facts"><span>9 languages</span><span>${roundDown(techCount)}+ technologies</span><span>Under a second on most repos</span><span>Works offline</span></div>
  <div class="window">
    <div class="chrome"><i></i><i></i><i></i><span>Plane, mapped by Stackmap. Click any box.</span><a href="gallery/plane.html">Open full screen</a></div>
    <iframe src="gallery/plane.html" title="Interactive architecture map of the Plane repository" loading="lazy"></iframe>
  </div>
</div></header>

<section id="features"><div class="wrap">
  <h2>Everything your system talks to, with receipts</h2>
  <p class="sub">The real architecture lives in manifests, compose files, env templates, infrastructure code and imports. Stackmap reads all of it, so the map matches the code you ship today.</p>
  <div class="grid">
    <div class="feature"><h3>Every box has a receipt</h3><p>Click a database and see every service that uses it, through which ORM, with the import lines and a link to them on GitHub. AI-drawn diagrams guess; Stackmap only draws what it can prove.</p><pre>$ npx stackmap-cli why stripe</pre></div>
    <div class="feature"><h3>A README diagram that never goes stale</h3><p>Keep a Mermaid diagram between two markers in your README. GitHub renders it natively, and CI fails when the code and the diagram disagree.</p><pre>$ npx stackmap-cli readme --check</pre></div>
    <div class="feature"><h3>Architecture review on every pull request</h3><p>The GitHub Action comments when a pull request adds a database, a service-to-service call or a new third-party API, with a diagram of just the change.</p><pre>- uses: AnshumaanSinghh/Stackmap@v1</pre></div>
    <div class="feature"><h3>Rules your CI enforces</h3><p>"Frontends never touch the database." "Only the API calls AI providers." Write it once in <code>.stackmap.json</code>; violations are annotated on the line that caused them.</p><pre>{ "deny": "kind:app -> category:database" }</pre></div>
    <div class="feature"><h3>A map for your AI agent</h3><p>An MCP server gives Claude Code, Cursor and other agents the system's shape before they edit it: what uses what, what breaks if it changes.</p><pre>$ claude mcp add stackmap -- npx -y stackmap-cli mcp</pre></div>
    <div class="feature"><h3>Private by design</h3><p>Runs locally, makes no network requests, never reads <code>.env</code> files and never stores values. The HTML map is one self-contained file you can attach anywhere.</p><pre>$ npx stackmap-cli -f md -o STACK.md</pre></div>
  </div>
  <div class="legend">
    <span><span class="dot" style="background:var(--sm-app)"></span>Apps</span>
    <span><span class="dot" style="background:var(--sm-service)"></span>Services</span>
    <span><span class="dot" style="background:var(--sm-worker)"></span>Workers</span>
    <span><span class="dot" style="background:var(--sm-data)"></span>Data stores</span>
    <span><span class="dot" style="background:var(--sm-external)"></span>Third-party APIs</span>
    <span>Solid: used in code · Dashed: declared but never imported · Dotted: inferred</span>
  </div>
</div></section>

<section id="gallery"><div class="wrap">
  <h2>Maps of real open-source projects</h2>
  <p class="sub">Generated by Stackmap from each project's public code, with no hand edits. Open one and click around: every box links to the line on GitHub that put it there.</p>
  <div class="cards">
${gallery.map(card).join('\n')}
  </div>
</div></section>

<section id="how"><div class="wrap">
  <h2>How it works</h2>
  <p class="sub">Deterministic static analysis. Same code in, same map out.</p>
  <div class="steps">
    <div class="step"><h3>Find the units</h3><p>Every folder with a manifest (package.json, pyproject.toml, go.mod, Cargo.toml, Gemfile, pom.xml ...) is an app, service, worker or library.</p></div>
    <div class="step"><h3>Read the code once</h3><p>Imports, env vars read and API hosts called, in nine languages. Tests, scripts and tool config are skipped.</p></div>
    <div class="step"><h3>Match the catalog</h3><p>${roundDown(techCount)}+ technologies, each name verified against its registry: SDKs, drivers, Docker images, env vars, hosts and Terraform types.</p></div>
    <div class="step"><h3>Read the infrastructure</h3><p>docker-compose, Kubernetes, Terraform, Wrangler, Render, ORM config and <code>.env.example</code> files wire the boxes together.</p></div>
  </div>
</div></section>

<section id="compare"><div class="wrap">
  <h2>How it compares</h2>
  <p class="sub">Stackmap answers the question new teammates, reviewers and auditors ask: what is this system made of, and what does it talk to?</p>
  <div class="table-scroll"><table>
    <thead><tr><th></th><th>Stackmap</th><th>Hand-drawn</th><th>Diagrams as code</th><th>AI generators</th><th>Import graphs</th></tr></thead>
    <tbody>
      <tr><td>Draws itself from the code</td><td class="y us">✓</td><td class="n">✗</td><td class="n">✗</td><td class="y">✓</td><td class="y">✓</td></tr>
      <tr><td>Services, databases, queues, third-party APIs</td><td class="y us">✓</td><td class="y">✓</td><td class="y">✓</td><td>partly</td><td class="n">files only</td></tr>
      <tr><td>Every box links to the code behind it</td><td class="y us">✓</td><td class="n">✗</td><td class="n">✗</td><td class="n">✗</td><td class="y">✓</td></tr>
      <tr><td>Deterministic</td><td class="y us">✓</td><td>n/a</td><td class="y">✓</td><td class="n">✗</td><td class="y">✓</td></tr>
      <tr><td>Code stays on your machine</td><td class="y us">✓</td><td class="y">✓</td><td class="y">✓</td><td>usually not</td><td class="y">✓</td></tr>
      <tr><td>Comments architecture changes on PRs</td><td class="y us">✓</td><td class="n">✗</td><td class="n">✗</td><td class="n">✗</td><td class="n">✗</td></tr>
    </tbody>
  </table></div>
  <p style="margin-top:36px"><a class="btn primary" href="${REPO}">Get started on GitHub</a></p>
</div></section>

<footer><div class="wrap">
  <span>Stackmap ${esc(pkg.version)} · MIT · made by <a href="https://github.com/AnshumaanSinghh">Anshumaan Singh</a></span>
  <span><a href="${REPO}">GitHub</a> · <a href="https://www.npmjs.com/package/stackmap-cli">npm</a> · <a href="${REPO}/issues/new/choose">Report an issue</a></span>
</div></footer>

<script>
(function () {
  var root = document.documentElement;
  try { var t = localStorage.getItem('stackmap-theme'); if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); } catch (e) {}
  document.getElementById('theme').addEventListener('click', function () {
    var dark = root.getAttribute('data-theme') ? root.getAttribute('data-theme') === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', dark ? 'light' : 'dark');
    try { localStorage.setItem('stackmap-theme', dark ? 'light' : 'dark'); } catch (e) {}
  });
  var copy = document.getElementById('copy');
  copy.addEventListener('click', function () {
    var done = function () { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy'; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText('npx stackmap-cli').then(done, done); else done();
  });
})();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(site, 'index.html'), html);
fs.writeFileSync(path.join(site, 'favicon.svg'), LOGO.replace('aria-hidden="true"', 'xmlns="http://www.w3.org/2000/svg"').replace(/var\(--sm-app\)/g, '#2a78d6').replace(/var\(--sm-service\)/g, '#eb6834').replace(/var\(--sm-data\)/g, '#1baf7a').replace(/var\(--sm-muted\)/g, '#898781'));
fs.writeFileSync(path.join(site, '.nojekyll'), '');
console.log(`site/index.html written (${gallery.length} gallery maps, ${techCount} technologies)`);
