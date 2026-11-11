// Draws a laid-out view as SVG markup. Used for `--format svg` and, in the browser, by the
// interactive viewer (which then adds pan, zoom and selection on top of the same markup).

import { THEMES, FAMILIES, familyOf } from './theme.js';
import { iconFor } from './icons.js';

export const KIND_LABELS = {
  app: 'App', mobile: 'Mobile app', desktop: 'Desktop app', service: 'Service', container: 'Container',
  function: 'Function', worker: 'Worker', cli: 'CLI', library: 'Library', datastore: 'Data store', external: 'Third-party API',
};

export const CATEGORY_SINGULAR = {
  database: 'Database', cache: 'Cache', queue: 'Queue / stream', storage: 'Object storage', search: 'Search', vector: 'Vector database',
  auth: 'Auth', payments: 'Payments', email: 'Email', messaging: 'Messaging', ai: 'AI', observability: 'Monitoring',
  analytics: 'Analytics', cms: 'CMS', flags: 'Feature flags', realtime: 'Realtime', workflow: 'Jobs & workflows',
  cloud: 'Cloud API', integrations: 'Integration',
};

const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function subtitleOf(node) {
  if (node.unit) {
    const fw = (node.frameworks || []).slice(0, 2).join(' · ');
    return fw || [KIND_LABELS[node.kind], node.language].filter(Boolean).join(' · ');
  }
  if (node.container) return node.image || (node.frameworks || [])[0] || 'Container';
  if (node.custom) return node.description || CATEGORY_SINGULAR[node.category] || KIND_LABELS[node.kind] || '';
  return CATEGORY_SINGULAR[node.category] || KIND_LABELS[node.kind] || '';
}

export function escapeXml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fit(text, px, charW) {
  const max = Math.max(4, Math.floor(px / charW));
  const s = String(text || '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** CSS used by the map. `mode`: 'auto' (follows OS), 'light', 'dark', or 'external' (variables come from the page). */
export function mapCss(mode) {
  const vars = (t) => Object.entries(t).map(([k, v]) => '--sm-' + k + ':' + v + ';').join('');
  let css = '';
  if (mode === 'light' || mode === 'dark') css += '.sm-map{' + vars(THEMES[mode]) + '}';
  else if (mode !== 'external') css += '.sm-map{' + vars(THEMES.light) + '}@media (prefers-color-scheme:dark){.sm-map{' + vars(THEMES.dark) + '}}';
  css +=
    '.sm-map{font-family:' + FONT + '}' +
    '.sm-bg{fill:var(--sm-surface)}' +
    '.sm-col-title{fill:var(--sm-muted);font-size:11px;font-weight:650;letter-spacing:.08em}' +
    '.sm-group{fill:var(--sm-muted);font-size:10.5px;font-weight:600;letter-spacing:.03em}' +
    '.sm-group-line{stroke:var(--sm-hairline);stroke-width:1}' +
    '.sm-edge{fill:none;stroke:var(--sm-edge);stroke-width:1.4;marker-end:url(#sm-arrow)}' +
    '.sm-edge.sm-c-inferred{stroke-dasharray:1.5 4;stroke-linecap:round}' +
    '.sm-edge.sm-declared{stroke-dasharray:5 4}' +
    '.sm-arrow{fill:var(--sm-edge)}' +
    '.sm-arrow-hi{fill:var(--sm-edgeHi)}' +
    '.sm-card{fill:var(--sm-card);stroke:var(--sm-border);stroke-width:1}' +
    '.sm-accent{fill:var(--f)}' +
    '.sm-icon-bg{fill:var(--f);fill-opacity:.15}' +
    '.sm-icon{stroke:var(--f);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.sm-name{fill:var(--sm-ink);font-size:13px;font-weight:600}' +
    '.sm-sub{fill:var(--sm-ink2);font-size:11px}' +
    '.sm-legend{fill:var(--sm-ink2);font-size:11px}' +
    '.sm-credit{fill:var(--sm-muted);font-size:10.5px}' +
    '.sm-title{fill:var(--sm-ink);font-size:15px;font-weight:650}' +
    '.sm-subtitle{fill:var(--sm-muted);font-size:11.5px}' +
    FAMILIES.map((f) => '.sm-f-' + f.key + '{--f:var(--sm-' + f.key + ')}').join('');
  return css;
}

/**
 * @param {{nodes:any[], edges:any[]}} view
 * @param {ReturnType<import('./layout.js').layoutGraph>} layout
 * @param {{ mode?: string, interactive?: boolean, legend?: boolean, credit?: boolean, title?: string, subtitle?: string }} [opts]
 */
export function drawSvg(view, layout, opts) {
  const o = opts || {};
  const L = layout.L;
  const legendH = o.legend ? 44 : 0;
  const headH = o.title ? 34 : 0;
  const W = Math.round(layout.width);
  const H = Math.round(layout.height + legendH + headH);
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const edgeById = new Map(view.edges.map((e) => [e.id, e]));
  const parts = [];
  const label = o.title ? o.title + ' architecture' : 'Architecture map';
  parts.push(
    '<svg xmlns="http://www.w3.org/2000/svg" class="sm-map" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + escapeXml(label) + '">'
  );
  parts.push('<title>' + escapeXml(label) + '</title>');
  parts.push('<style>' + mapCss(o.mode || 'auto') + '</style>');
  parts.push(
    '<defs>' +
      '<marker id="sm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="sm-arrow" d="M0 1.2L9 5 0 8.8z"/></marker>' +
      '<marker id="sm-arrow-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="sm-arrow-hi" d="M0 1.2L9 5 0 8.8z"/></marker>' +
      '</defs>'
  );
  parts.push('<rect class="sm-bg" x="0" y="0" width="' + W + '" height="' + H + '"/>');
  if (o.title) {
    parts.push('<text class="sm-title" x="' + L.pad + '" y="' + (L.pad + 2) + '">' + escapeXml(o.title) + '</text>');
    if (o.subtitle) parts.push('<text class="sm-subtitle" x="' + L.pad + '" y="' + (L.pad + 20) + '">' + escapeXml(o.subtitle) + '</text>');
  }
  parts.push('<g transform="translate(0,' + headH + ')">');

  for (const c of layout.columns) {
    parts.push('<text class="sm-col-title" x="' + c.x + '" y="' + (L.pad + 14) + '">' + escapeXml(c.title.toUpperCase()) + ' · ' + c.count + '</text>');
  }
  for (const g of layout.groups) {
    const ty = g.y + 13;
    parts.push('<text class="sm-group" x="' + g.x + '" y="' + ty + '">' + escapeXml(g.label) + '</text>');
    parts.push('<line class="sm-group-line" x1="' + g.x + '" x2="' + (g.x + g.w) + '" y1="' + (g.y + L.headerH - 5) + '" y2="' + (g.y + L.headerH - 5) + '"/>');
  }

  parts.push('<g class="sm-edges">');
  for (const ge of layout.edges) {
    const e = edgeById.get(ge.id);
    const cls = 'sm-edge sm-c-' + e.confidence + (e.declaredOnly ? ' sm-declared' : '');
    const tip = (byId.get(e.from) || {}).name + ' → ' + (byId.get(e.to) || {}).name + (e.via && e.via.length ? ' (' + e.via.join(', ') + ')' : '');
    if (o.interactive) {
      parts.push('<path class="sm-hit" d="' + ge.d + '" data-id="' + escapeXml(e.id) + '" fill="none" stroke="transparent" stroke-width="12"/>');
    }
    parts.push('<path class="' + cls + '" d="' + ge.d + '" data-id="' + escapeXml(e.id) + '" data-from="' + escapeXml(e.from) + '" data-to="' + escapeXml(e.to) + '"><title>' + escapeXml(tip) + '</title></path>');
  }
  parts.push('</g><g class="sm-nodes">');

  const textW = L.nodeW - 58;
  for (const n of view.nodes) {
    const b = layout.boxes.get(n.id);
    if (!b) continue;
    const fam = familyOf(n);
    const sub = subtitleOf(n);
    parts.push(
      '<g class="sm-node sm-f-' + fam + '" data-id="' + escapeXml(n.id) + '" transform="translate(' + b.x + ',' + b.y + ')"' + (o.interactive ? ' tabindex="0" role="button" aria-label="' + escapeXml(n.name + ', ' + sub) + '"' : '') + '>' +
        '<title>' + escapeXml(n.name + (sub ? ' — ' + sub : '')) + '</title>' +
        '<rect class="sm-card" width="' + b.w + '" height="' + b.h + '" rx="10"/>' +
        '<rect class="sm-accent" x="0" y="10" width="3.5" height="' + (b.h - 20) + '" rx="1.75"/>' +
        '<rect class="sm-icon-bg" x="12" y="' + (b.h / 2 - 15) + '" width="30" height="30" rx="8"/>' +
        '<g class="sm-icon" transform="translate(17,' + (b.h / 2 - 10) + ') scale(0.8333)">' + iconFor(n) + '</g>' +
        '<text class="sm-name" x="52" y="' + (sub ? b.h / 2 - 3 : b.h / 2 + 4.5) + '">' + escapeXml(fit(n.name, textW, 7.3)) + '</text>' +
        (sub ? '<text class="sm-sub" x="52" y="' + (b.h / 2 + 13) + '">' + escapeXml(fit(sub, textW, 6.1)) + '</text>' : '') +
        '</g>'
    );
  }
  parts.push('</g>');
  parts.push('</g>');

  if (o.legend) {
    const y = H - legendH + 16;
    let x = L.pad;
    const used = new Set(view.nodes.map(familyOf));
    for (const f of FAMILIES) {
      if (!used.has(f.key)) continue;
      parts.push('<g class="sm-f-' + f.key + '"><rect class="sm-accent" x="' + x + '" y="' + (y - 9) + '" width="10" height="10" rx="2.5"/></g>');
      parts.push('<text class="sm-legend" x="' + (x + 15) + '" y="' + y + '">' + escapeXml(f.label) + '</text>');
      x += 26 + f.label.length * 6.4;
    }
    x += 14;
    const lines = [['sm-edge sm-c-imported', 'used in code'], ['sm-edge sm-c-declared sm-declared', 'declared, no import found'], ['sm-edge sm-c-inferred', 'inferred']];
    for (const [cls, text] of lines) {
      parts.push('<path class="' + cls + '" d="M' + x + ' ' + (y - 4) + 'h26" style="marker-end:none"/>');
      parts.push('<text class="sm-legend" x="' + (x + 33) + '" y="' + y + '">' + escapeXml(text) + '</text>');
      x += 50 + text.length * 6.2;
    }
    if (o.credit !== false) {
      parts.push('<text class="sm-credit" x="' + (W - L.pad) + '" y="' + y + '" text-anchor="end">Made with Stackmap</text>');
    }
  }
  parts.push('</svg>');
  return parts.join('');
}
