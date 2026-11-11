// What changed in the architecture between two scans: new services, new databases,
// new third-party APIs (where data may now be sent), new and removed connections.

import { blobUrl } from '../git.js';
import { CATEGORY_SINGULAR, KIND_LABELS } from '../render/draw.js';
import { toMermaid } from '../render/mermaid.js';
import { viewGraph } from './view.js';

export function diffGraphs(base, head, opts = {}) {
  const libraries = Boolean(opts.libraries);
  const b = viewGraph(base, { libraries });
  const h = viewGraph(head, { libraries });
  const bn = new Map(b.nodes.map((n) => [n.id, n]));
  const hn = new Map(h.nodes.map((n) => [n.id, n]));
  const be = new Map(b.edges.map((e) => [e.id, e]));
  const he = new Map(h.edges.map((e) => [e.id, e]));
  const addedNodes = h.nodes.filter((n) => !bn.has(n.id));
  const removedNodes = b.nodes.filter((n) => !hn.has(n.id));
  const addedEdges = h.edges.filter((e) => !be.has(e.id));
  const removedEdges = b.edges.filter((e) => !he.has(e.id));
  const changedNodes = [];
  for (const n of h.nodes) {
    const old = bn.get(n.id);
    if (!old) continue;
    const changes = [];
    if (old.kind !== n.kind) changes.push(`${KIND_LABELS[old.kind] ?? old.kind} → ${KIND_LABELS[n.kind] ?? n.kind}`);
    const fwAdded = (n.frameworks ?? []).filter((f) => !(old.frameworks ?? []).includes(f));
    const fwRemoved = (old.frameworks ?? []).filter((f) => !(n.frameworks ?? []).includes(f));
    if (fwAdded.length) changes.push(`+ ${fwAdded.join(', ')}`);
    if (fwRemoved.length) changes.push(`− ${fwRemoved.join(', ')}`);
    if (changes.length) changedNodes.push({ node: n, changes });
  }
  return {
    base: { project: base.project, view: b },
    head: { project: head.project, view: h },
    addedNodes,
    removedNodes,
    addedEdges,
    removedEdges,
    changedNodes,
    changed: Boolean(addedNodes.length || removedNodes.length || addedEdges.length || removedEdges.length || changedNodes.length),
  };
}

export const COMMENT_MARKER = '<!-- stackmap:pr-comment -->';

/** Markdown for a pull-request comment or a terminal (`plain: true`). */
export function diffToMarkdown(diff, opts = {}) {
  const p = diff.head.project;
  const nameOf = (id) => diff.head.view.nodes.find((n) => n.id === id)?.name ?? diff.base.view.nodes.find((n) => n.id === id)?.name ?? id;
  const link = (ev) => {
    if (!ev) return '';
    const url = blobUrl(p.repoUrl, p.commit, p.prefix, ev.file, ev.line);
    const label = `${ev.file}:${ev.line}`;
    return url ? `[\`${label}\`](${url})` : `\`${label}\``;
  };
  const lines = [];
  if (!opts.plain) lines.push(COMMENT_MARKER);
  lines.push(`### Stackmap: architecture changes`);
  lines.push('');
  if (!diff.changed) {
    lines.push('No architecture changes in this diff: same services, data stores, third-party APIs and connections.');
    return lines.join('\n');
  }
  const usersOf = (id) => [...new Set(diff.head.view.edges.filter((e) => e.to === id).map((e) => nameOf(e.from)))];

  const ext = diff.addedNodes.filter((n) => n.column === 'external');
  const data = diff.addedNodes.filter((n) => n.column === 'data');
  const parts = diff.addedNodes.filter((n) => n.column !== 'external' && n.column !== 'data');
  const section = (title, items) => {
    if (!items.length) return;
    lines.push(`**${title}**`, '', ...items, '');
  };
  section('New third-party services', ext.map((n) => `- **${n.name}** (${CATEGORY_SINGULAR[n.category] ?? n.category})${usersOf(n.id).length ? `, used by ${usersOf(n.id).join(', ')}` : ''} · ${link(n.evidence?.[0])}`));
  if (ext.length) {
    lines.push(`> Data may now be sent to ${ext.map((n) => n.name).join(', ')}. If personal data is involved, check your privacy policy and subprocessor list.`, '');
  }
  section('New data stores', data.map((n) => `- **${n.name}** (${CATEGORY_SINGULAR[n.category] ?? n.category})${usersOf(n.id).length ? `, used by ${usersOf(n.id).join(', ')}` : ''} · ${link(n.evidence?.[0])}`));
  section('New apps and services', parts.map((n) => `- **${n.name}** (${KIND_LABELS[n.kind] ?? n.kind}${n.frameworks?.length ? `, ${n.frameworks.join(', ')}` : ''})${n.path ? ` in \`${n.path}\`` : ''}`));
  const addedNodeIds = new Set(diff.addedNodes.map((n) => n.id));
  const newConn = diff.addedEdges.filter((e) => !addedNodeIds.has(e.to) || !ext.concat(data).some((n) => n.id === e.to));
  section('New connections', newConn.map((e) => `- ${nameOf(e.from)} → ${nameOf(e.to)}${viaText(e)} · ${link(e.evidence?.[0])}`));
  section('Removed', [
    ...diff.removedNodes.map((n) => `- **${n.name}** (${n.column === 'external' || n.column === 'data' ? CATEGORY_SINGULAR[n.category] ?? n.category : KIND_LABELS[n.kind] ?? n.kind}) is no longer used`),
    ...diff.removedEdges.filter((e) => !diff.removedNodes.some((n) => n.id === e.to || n.id === e.from)).map((e) => `- ${nameOf(e.from)} → ${nameOf(e.to)} no longer connected`),
  ]);
  section('Changed', diff.changedNodes.map((c) => `- **${c.node.name}**: ${c.changes.join('; ')}`));

  if (!opts.plain && opts.diagram !== false) {
    const sub = diffSubgraph(diff);
    if (sub.nodes.length && sub.nodes.length <= 60) {
      lines.push('<details><summary>Diagram of the change</summary>', '', '```mermaid', toMermaid(sub, { highlight: sub.highlight, collapseExternalOver: 0 }), '```', '', 'Green: added. Red: removed. Grey: unchanged neighbours.', '</details>', '');
    }
  }
  if (!opts.plain) lines.push(`<sub>Generated from the code by [Stackmap](https://github.com/AnshumaanSinghh/Stackmap). Every item links to the line that caused it.</sub>`);
  return lines.join('\n');
}

function viaText(e) {
  const via = (e.via ?? []).filter((v) => !v.startsWith('$'));
  const through = e.through ?? [];
  const bits = [...via.map((v) => `via ${v}`), ...through.slice(0, 1).map((t) => `through ${t}`)];
  return bits.length ? ` (${bits.join(', ')})` : '';
}

/** Changed nodes and edges plus their direct neighbours, for a focused diagram. */
export function diffSubgraph(diff) {
  const ids = new Set();
  for (const n of [...diff.addedNodes, ...diff.removedNodes]) ids.add(n.id);
  for (const e of [...diff.addedEdges, ...diff.removedEdges]) {
    ids.add(e.from);
    ids.add(e.to);
  }
  for (const c of diff.changedNodes) ids.add(c.node.id);
  const nodes = [];
  const seen = new Set();
  for (const n of [...diff.head.view.nodes, ...diff.base.view.nodes]) {
    if (ids.has(n.id) && !seen.has(n.id)) {
      seen.add(n.id);
      nodes.push(n);
    }
  }
  const edges = [...diff.addedEdges, ...diff.removedEdges, ...diff.head.view.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && !diff.addedEdges.includes(e))];
  const uniq = new Map(edges.map((e) => [e.id, e]));
  return {
    nodes,
    edges: [...uniq.values()],
    highlight: {
      added: new Set(diff.addedNodes.map((n) => n.id)),
      removed: new Set(diff.removedNodes.map((n) => n.id)),
      addedEdges: new Set(diff.addedEdges.map((e) => e.id)),
      removedEdges: new Set(diff.removedEdges.map((e) => e.id)),
    },
  };
}
