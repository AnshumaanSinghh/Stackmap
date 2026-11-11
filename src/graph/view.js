// Turns the full graph into what gets drawn. Shared by Node renderers and the browser viewer,
// so it must stay free of imports and Node APIs.
//
// "Services" view (default): internal libraries that other units depend on are folded into
// the apps and services that use them. If apps/web depends on packages/db, and packages/db
// uses PostgreSQL, the map draws web -> PostgreSQL "through db". Nothing is lost: the edge
// keeps the original evidence.

export function viewGraph(graph, opts) {
  const options = opts || {};
  const showLibraries = Boolean(options.libraries);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const dependents = new Map();
  for (const e of graph.edges) {
    if (e.kind === 'depends' && byId.get(e.to) && byId.get(e.to).kind === 'library') {
      dependents.set(e.to, (dependents.get(e.to) || 0) + 1);
    }
  }
  const hidden = new Set();
  if (!showLibraries) {
    const touched = new Set();
    for (const e of graph.edges) {
      touched.add(e.from);
      touched.add(e.to);
    }
    // Fold used libraries into their users; drop unconnected ones from this view.
    for (const n of graph.nodes) if (n.kind === 'library' && (dependents.get(n.id) || !touched.has(n.id))) hidden.add(n.id);
  }
  // Copy edges (and their arrays) so folding never writes back into the graph.
  const copy = (e) => Object.assign({}, e, { via: e.via.slice(), evidence: e.evidence.slice(), through: e.through ? e.through.slice() : undefined });
  if (hidden.size === 0) return { nodes: graph.nodes.slice(), edges: graph.edges.map(copy), hidden: 0 };

  const out = new Map();
  for (const e of graph.edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e);
  }
  const edges = new Map();
  for (const e of graph.edges) if (!hidden.has(e.from) && !hidden.has(e.to)) edges.set(e.id, copy(e));

  const rank = { inferred: 1, declared: 2, configured: 3, imported: 4 };
  for (const n of graph.nodes) {
    if (hidden.has(n.id)) continue;
    // Breadth-first through hidden libraries reachable from this visible node.
    // `entry` is the evidence for the first hop (this node -> the library it imports):
    // the line to change if the lifted connection is unwanted.
    const seen = new Set();
    const queue = [];
    for (const e of out.get(n.id) || []) if (e.kind === 'depends' && hidden.has(e.to) && !seen.has(e.to)) {
      seen.add(e.to);
      queue.push([e.to, e.evidence.slice(0, 2)]);
    }
    while (queue.length) {
      const item = queue.shift();
      const lib = item[0];
      const entry = item[1];
      const libName = byId.get(lib).name;
      for (const e of out.get(lib) || []) {
        if (hidden.has(e.to)) {
          if (e.kind === 'depends' && !seen.has(e.to)) {
            seen.add(e.to);
            queue.push([e.to, entry]);
          }
          continue;
        }
        if (e.to === n.id) continue;
        // Lift connections to infrastructure and backends only. A shared package importing
        // code from an app is a code-level detail, not an architectural connection.
        const target = byId.get(e.to);
        if (target && (target.column === 'apps' || target.column === 'libraries')) continue;
        const id = n.id + '->' + e.to;
        let lifted = edges.get(id);
        if (!lifted) {
          lifted = { id, from: n.id, to: e.to, kind: e.kind, via: e.via.slice(), through: [], confidence: e.confidence, declaredOnly: e.declaredOnly, evidence: e.evidence.slice(), evidenceCount: e.evidenceCount || e.evidence.length, lifted: true, entry };
          edges.set(id, lifted);
        } else {
          if (!lifted.through) lifted.through = [];
          if (rank[e.confidence] > rank[lifted.confidence]) lifted.confidence = e.confidence;
          lifted.declaredOnly = lifted.declaredOnly && e.declaredOnly;
          for (const v of e.via) if (lifted.via.indexOf(v) === -1) lifted.via.push(v);
          if (lifted.evidence.length < 6) for (const ev of e.evidence) if (lifted.evidence.length < 6 && !lifted.evidence.some((x) => x.file === ev.file && x.line === ev.line)) lifted.evidence.push(ev);
        }
        if (lifted.through && lifted.through.indexOf(libName) === -1) lifted.through.push(libName);
      }
    }
  }
  return { nodes: graph.nodes.filter((n) => !hidden.has(n.id)), edges: Array.from(edges.values()), hidden: hidden.size };
}

/** Everything connected to `id` (one hop), for focus mode and `stackmap why`. */
export function neighbours(view, id) {
  const ids = new Set([id]);
  for (const e of view.edges) {
    if (e.from === id) ids.add(e.to);
    if (e.to === id) ids.add(e.from);
  }
  return ids;
}

/** Nodes that (transitively) depend on `id`: what breaks if it goes down. */
export function impactOf(graph, id) {
  const incoming = new Map();
  for (const e of graph.edges) {
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to).push(e);
  }
  const seen = new Map();
  const queue = [[id, 0]];
  while (queue.length) {
    const [cur, depth] = queue.shift();
    for (const e of incoming.get(cur) || []) {
      if (seen.has(e.from) || e.from === id) continue;
      seen.set(e.from, { depth: depth + 1, via: cur, edge: e });
      queue.push([e.from, depth + 1]);
    }
  }
  return seen;
}
