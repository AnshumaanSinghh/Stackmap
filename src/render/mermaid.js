// Mermaid flowchart. GitHub, GitLab, Notion and most docs tools render it natively, so the
// diagram can live in a README as text and be diffed like code.

import { CATEGORY_SINGULAR, KIND_LABELS } from './draw.js';
import { THEMES, familyOf } from './theme.js';

const COLUMN_TITLES = { apps: 'Apps', services: 'Services & workers', libraries: 'Libraries', data: 'Data', external: 'Third-party' };
const ORDER = ['apps', 'services', 'libraries', 'data', 'external'];

/**
 * @param {{nodes:any[], edges:any[]}} view
 * @param {{ direction?: 'LR'|'TB', collapseExternalOver?: number, highlight?: { added?: Set<string>, removed?: Set<string>, addedEdges?: Set<string>, removedEdges?: Set<string> } }} [opts]
 */
export function toMermaid(view, opts = {}) {
  const direction = opts.direction ?? 'LR';
  let { nodes, edges } = collapseExternal(view, opts.collapseExternalOver ?? 14);
  const ids = new Map();
  const used = new Set();
  for (const n of nodes) {
    let base = 'n_' + String(n.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32);
    if (base === 'n_') base = 'n_node';
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}_${i}`;
    used.add(id);
    ids.set(n.id, id);
  }
  const lines = [`flowchart ${direction}`];
  for (const col of ORDER) {
    const members = nodes.filter((n) => (n.column ?? 'services') === col);
    if (!members.length) continue;
    lines.push(`  subgraph ${col}["${COLUMN_TITLES[col]}"]`);
    if (direction === 'LR') lines.push('    direction TB');
    for (const n of members) lines.push(`    ${ids.get(n.id)}${shape(n)}`);
    lines.push('  end');
  }
  const hl = opts.highlight ?? {};
  let linkIndex = 0;
  const addedLinks = [];
  const removedLinks = [];
  for (const e of edges) {
    const a = ids.get(e.from);
    const b = ids.get(e.to);
    if (!a || !b) continue;
    const label = edgeLabel(e);
    const arrow = e.declaredOnly || e.confidence === 'inferred' ? '-.->' : '-->';
    lines.push(`  ${a} ${arrow}${label ? `|"${esc(label)}"|` : ''} ${b}`);
    if (hl.addedEdges?.has(e.id)) addedLinks.push(linkIndex);
    if (hl.removedEdges?.has(e.id)) removedLinks.push(linkIndex);
    linkIndex++;
  }
  const t = THEMES.light;
  const fam = { app: t.app, service: t.service, data: t.data, worker: t.worker, external: t.external, neutral: t.neutral };
  for (const [k, color] of Object.entries(fam)) lines.push(`  classDef ${k} stroke:${color},stroke-width:2px`);
  lines.push('  classDef added stroke:#0ca30c,stroke-width:3px');
  lines.push('  classDef removed stroke:#d03b3b,stroke-width:3px,stroke-dasharray:6 4');
  const byFam = new Map();
  for (const n of nodes) {
    let cls = familyOf(n);
    if (hl.added?.has(n.id)) cls = 'added';
    if (hl.removed?.has(n.id)) cls = 'removed';
    if (!byFam.has(cls)) byFam.set(cls, []);
    byFam.get(cls).push(ids.get(n.id));
  }
  for (const [cls, list] of byFam) lines.push(`  class ${list.join(',')} ${cls}`);
  if (addedLinks.length) lines.push(`  linkStyle ${addedLinks.join(',')} stroke:#0ca30c,stroke-width:2.5px`);
  if (removedLinks.length) lines.push(`  linkStyle ${removedLinks.join(',')} stroke:#d03b3b,stroke-width:2.5px`);
  return lines.join('\n');
}

function edgeLabel(e) {
  const via = (e.via ?? []).filter((v) => !v.startsWith('$'));
  return via.slice(0, 2).join(', ');
}

function shape(n) {
  const sub = n.unit ? (n.frameworks ?? []).slice(0, 2).join(' · ') : n.container ? n.image ?? (n.frameworks ?? [])[0] ?? '' : n.custom ? n.description ?? '' : '';
  const text = esc(n.name) + (sub ? `<br/><small>${esc(sub)}</small>` : '');
  const q = `"${text}"`;
  if (n.collapsed) return `[["${esc(n.name)}"]]`;
  switch (n.kind) {
    case 'app':
    case 'mobile':
    case 'desktop':
      return `(${q})`;
    case 'worker':
      return `[/${q}/]`;
    case 'library':
    case 'cli':
      return `[[${q}]]`;
    case 'datastore':
      return n.category === 'queue' ? `>${q}]` : `[(${q})]`;
    case 'external':
      return n.column === 'data' ? `[(${q})]` : `([${q}])`;
    default:
      return `[${q}]`;
  }
}

function esc(s) {
  return String(s ?? '').replace(/"/g, '#quot;').replace(/[<>]/g, (c) => (c === '<' ? '#lt;' : '#gt;'));
}

/** Fold third-party nodes into one node per category when there are too many to read. */
export function collapseExternal(view, threshold) {
  const external = view.nodes.filter((n) => n.column === 'external');
  if (!threshold || external.length <= threshold) return view;
  const byCat = new Map();
  for (const n of external) {
    if (!byCat.has(n.category)) byCat.set(n.category, []);
    byCat.get(n.category).push(n);
  }
  const replace = new Map();
  const nodes = view.nodes.filter((n) => n.column !== 'external');
  for (const [cat, members] of byCat) {
    if (members.length === 1) {
      nodes.push(members[0]);
      continue;
    }
    const id = `group:${cat}`;
    const names = members.map((m) => m.name).sort();
    const label = `${CATEGORY_SINGULAR[cat] ?? cat} ×${members.length}: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ', …' : ''}`;
    nodes.push({ id, name: label, kind: 'external', category: cat, column: 'external', collapsed: true });
    for (const m of members) replace.set(m.id, id);
  }
  const edges = new Map();
  for (const e of view.edges) {
    const from = replace.get(e.from) ?? e.from;
    const to = replace.get(e.to) ?? e.to;
    const id = `${from}->${to}`;
    if (!edges.has(id)) edges.set(id, { ...e, id, from, to, via: replace.has(e.to) ? [] : e.via });
    else {
      const x = edges.get(id);
      x.declaredOnly = x.declaredOnly && e.declaredOnly;
      if (x.confidence === 'inferred') x.confidence = e.confidence;
    }
  }
  return { nodes, edges: [...edges.values()] };
}

export { KIND_LABELS };
