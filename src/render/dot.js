// Graphviz DOT, for people who already have a Graphviz pipeline.

import { subtitleOf } from './draw.js';
import { THEMES, familyOf } from './theme.js';

const TITLES = { apps: 'Apps', services: 'Services & workers', libraries: 'Libraries', data: 'Data', external: 'Third-party' };

export function toDot(view, opts = {}) {
  const t = THEMES.light;
  const q = (s) => `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const lines = [`digraph ${q(opts.name ?? 'stackmap')} {`, '  rankdir=LR;', '  graph [fontname="Helvetica", fontsize=11, nodesep=0.35, ranksep=1.1];', '  node [shape=box, style="rounded,filled", fillcolor="white", fontname="Helvetica", fontsize=11, penwidth=1.6];', '  edge [color="#9b998f", arrowsize=0.7];'];
  for (const col of Object.keys(TITLES)) {
    const members = view.nodes.filter((n) => (n.column ?? 'services') === col);
    if (!members.length) continue;
    lines.push(`  subgraph ${q(`cluster_${col}`)} {`, `    label=${q(TITLES[col])}; color="#e1e0d9";`);
    for (const n of members) {
      const sub = subtitleOf(n);
      const shape = n.kind === 'datastore' ? 'cylinder' : 'box';
      lines.push(`    ${q(n.id)} [label=${q(sub ? `${n.name}\n${sub}` : n.name)}, color=${q(t[familyOf(n)])}, shape=${shape}];`);
    }
    lines.push('  }');
  }
  for (const e of view.edges) {
    const via = (e.via ?? []).filter((v) => !v.startsWith('$')).join(', ');
    const style = e.declaredOnly ? 'dashed' : e.confidence === 'inferred' ? 'dotted' : 'solid';
    lines.push(`  ${q(e.from)} -> ${q(e.to)} [style=${style}${via ? `, label=${q(via)}, fontsize=9` : ''}];`);
  }
  lines.push('}');
  return lines.join('\n');
}
