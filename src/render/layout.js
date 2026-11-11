// Column layout for the map: Apps | Services & workers | Libraries | Data | Third-party.
// Order inside columns uses the barycenter heuristic to reduce edge crossings; data and
// third-party nodes are grouped by category. Shared by the SVG renderer and the browser viewer,
// so it must stay free of imports and Node APIs.

export const LAYOUT = { nodeW: 216, nodeH: 54, gapY: 12, colGap: 150, subColGap: 36, headerH: 24, groupGap: 16, pad: 40, titleH: 40 };

export const COLUMNS = [
  { key: 'apps', title: 'Apps' },
  { key: 'services', title: 'Services & workers' },
  { key: 'libraries', title: 'Libraries' },
  { key: 'data', title: 'Data' },
  { key: 'external', title: 'Third-party' },
];

const SERVICE_KIND_ORDER = { service: 0, function: 1, container: 2, worker: 3, cli: 4 };

export function layoutGraph(view, opts) {
  const L = Object.assign({}, LAYOUT, opts || {});
  const colIndex = new Map(COLUMNS.map((c, i) => [c.key, i]));
  const cols = new Map(COLUMNS.map((c) => [c.key, []]));
  for (const n of view.nodes) (cols.get(n.column) || cols.get('services')).push(n);

  // Adjacency (undirected) for barycenters.
  const adj = new Map(view.nodes.map((n) => [n.id, []]));
  for (const e of view.edges) {
    if (adj.has(e.from) && adj.has(e.to)) {
      adj.get(e.from).push(e.to);
      adj.get(e.to).push(e.from);
    }
  }
  const colOf = new Map();
  for (const [k, list] of cols) for (const n of list) colOf.set(n.id, k);

  // Initial order.
  cols.get('apps').sort(byName);
  cols.get('services').sort((a, b) => (SERVICE_KIND_ORDER[a.kind] || 9) - (SERVICE_KIND_ORDER[b.kind] || 9) || byName(a, b));
  cols.get('libraries').sort(byName);
  for (const k of ['data', 'external']) cols.get(k).sort((a, b) => String(a.category).localeCompare(String(b.category)) || byName(a, b));

  const pos = new Map();
  const refreshPos = () => {
    for (const [, list] of cols) list.forEach((n, i) => pos.set(n.id, list.length > 1 ? i / (list.length - 1) : 0.5));
  };
  refreshPos();
  const bary = (n) => {
    const ns = adj.get(n.id).filter((id) => colOf.get(id) !== colOf.get(n.id));
    if (!ns.length) return pos.get(n.id);
    return ns.reduce((s, id) => s + pos.get(id), 0) / ns.length;
  };
  const order = ['apps', 'services', 'libraries', 'data', 'external'];
  for (let iter = 0; iter < 8; iter++) {
    const seq = iter % 2 === 0 ? order : order.slice().reverse();
    for (const k of seq) {
      const list = cols.get(k);
      if (list.length < 2) continue;
      const b = new Map(list.map((n) => [n.id, bary(n)]));
      if (k === 'data' || k === 'external') {
        const groups = new Map();
        for (const n of list) {
          const g = n.category || 'other';
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g).push(n);
        }
        const gs = Array.from(groups.values()).map((members) => {
          members.sort((x, y) => b.get(x.id) - b.get(y.id) || byName(x, y));
          return { members, score: members.reduce((s, n) => s + b.get(n.id), 0) / members.length };
        });
        gs.sort((x, y) => x.score - y.score || String(x.members[0].category).localeCompare(String(y.members[0].category)));
        cols.set(k, gs.flatMap((g) => g.members));
      } else {
        list.sort((x, y) => b.get(x.id) - b.get(y.id) || byName(x, y));
      }
      refreshPos();
    }
  }

  // Wrap long columns into sub-columns.
  const total = view.nodes.length;
  const maxRows = Math.max(12, Math.min(20, Math.ceil(Math.sqrt(total) * 1.7)));
  const rowH = L.nodeH + L.gapY;
  const boxes = new Map();
  const groups = [];
  const columns = [];
  let x = L.pad;
  const colHeights = [];

  for (const c of COLUMNS) {
    const list = cols.get(c.key);
    if (!list.length) continue;
    const grouped = c.key === 'data' || c.key === 'external';
    // Build rows: each item is a node or a group header.
    const items = [];
    let prevCat = null;
    for (const n of list) {
      if (grouped && n.category !== prevCat) {
        items.push({ header: n.categoryLabel || n.category || 'Other', category: n.category });
        prevCat = n.category;
      }
      items.push({ node: n });
    }
    const heightOf = (it) => (it.header ? L.headerH + (L.groupGap / 2) : rowH);
    const maxH = maxRows * rowH;
    const sub = [[]];
    let h = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const ih = heightOf(it);
      // Keep a header with at least one node.
      const need = it.header ? ih + rowH : ih;
      if (h + need > maxH && sub[sub.length - 1].length) {
        sub.push([]);
        h = 0;
        if (!it.header && grouped) {
          // Continue the group under a repeated header.
          const lastHeader = findLastHeader(items, i);
          if (lastHeader) {
            sub[sub.length - 1].push({ header: lastHeader.header + ' (cont.)', category: lastHeader.category, cont: true });
            h += heightOf(lastHeader);
          }
        }
      }
      sub[sub.length - 1].push(it);
      h += ih;
    }
    const colX = x;
    const colW = sub.length * L.nodeW + (sub.length - 1) * L.subColGap;
    let colH = 0;
    sub.forEach((items2, si) => {
      let y = 0;
      const sx = colX + si * (L.nodeW + L.subColGap);
      for (const it of items2) {
        if (it.header) {
          if (y > 0) y += L.groupGap / 2;
          groups.push({ label: it.header, category: it.category, x: sx, y, w: L.nodeW, column: c.key });
          y += L.headerH;
        } else {
          boxes.set(it.node.id, { x: sx, y, w: L.nodeW, h: L.nodeH });
          y += rowH;
        }
      }
      colH = Math.max(colH, y - L.gapY);
    });
    columns.push({ key: c.key, title: c.title, x: colX, w: colW, h: colH, count: list.length });
    colHeights.push(colH);
    x += colW + L.colGap;
  }

  // Centre each column vertically under the title row.
  const contentH = Math.max(L.nodeH, ...colHeights, 0);
  const top = L.pad + L.titleH;
  for (const col of columns) {
    const dy = top + Math.round((contentH - col.h) / 2);
    col.y = dy;
    for (const [id, b] of boxes) if (colOf.get(id) === col.key) b.y += dy;
    for (const g of groups) if (g.column === col.key && !g.shifted) {
      g.y += dy;
      g.shifted = true;
    }
  }
  const width = Math.max(x - L.colGap + L.pad, 320);
  const height = top + contentH + L.pad;

  const edges = routeEdges(view.edges, boxes, colOf, colIndex);
  return { width, height, boxes, groups, columns, edges, L };
}

function findLastHeader(items, i) {
  for (let j = i - 1; j >= 0; j--) if (items[j].header) return items[j];
  return null;
}

function byName(a, b) {
  return String(a.name).localeCompare(String(b.name));
}

/** Bezier paths with ports spread along each node's sides, sorted to avoid crossings at the node. */
export function routeEdges(edges, boxes, colOf, colIndex) {
  const geo = [];
  for (const e of edges) {
    const a = boxes.get(e.from);
    const b = boxes.get(e.to);
    if (!a || !b) continue;
    let mode;
    if (b.x > a.x + 1) mode = 'right';
    else if (b.x < a.x - 1) mode = 'left';
    else mode = 'loop';
    geo.push({ e, a, b, mode });
  }
  const outPorts = new Map();
  const inPorts = new Map();
  const key = (id, side) => id + '|' + side;
  for (const g of geo) {
    const outSide = g.mode === 'left' ? 'L' : 'R';
    const inSide = g.mode === 'right' ? 'L' : 'R';
    push(outPorts, key(g.e.from, outSide), g);
    push(inPorts, key(g.e.to, inSide), g);
    g.outSide = outSide;
    g.inSide = inSide;
  }
  const spread = (map, which) => {
    for (const [, list] of map) {
      list.sort((p, q) => (which === 'out' ? p.b.y - q.b.y || p.b.x - q.b.x : p.a.y - q.a.y || p.a.x - q.a.x));
      const n = list.length;
      list.forEach((g, i) => {
        const box = which === 'out' ? g.a : g.b;
        const margin = Math.min(14, box.h / 4);
        const y = n === 1 ? box.y + box.h / 2 : box.y + margin + ((box.h - 2 * margin) * i) / (n - 1);
        if (which === 'out') g.sy = y;
        else g.ty = y;
      });
    }
  };
  spread(outPorts, 'out');
  spread(inPorts, 'in');
  const out = [];
  for (const g of geo) {
    const sx = g.outSide === 'R' ? g.a.x + g.a.w : g.a.x;
    const tx = g.inSide === 'L' ? g.b.x : g.b.x + g.b.w;
    const sy = g.sy;
    const ty = g.ty;
    let d;
    if (g.mode === 'loop') {
      const bulge = 46 + Math.min(80, Math.abs(ty - sy) * 0.15);
      d = 'M' + r(sx) + ' ' + r(sy) + ' C' + r(sx + bulge) + ' ' + r(sy) + ' ' + r(tx + bulge) + ' ' + r(ty) + ' ' + r(tx) + ' ' + r(ty);
    } else {
      const dir = g.mode === 'right' ? 1 : -1;
      const dx = Math.max(40, Math.abs(tx - sx) / 2);
      d = 'M' + r(sx) + ' ' + r(sy) + ' C' + r(sx + dir * dx) + ' ' + r(sy) + ' ' + r(tx - dir * dx) + ' ' + r(ty) + ' ' + r(tx) + ' ' + r(ty);
    }
    out.push({ id: g.e.id, from: g.e.from, to: g.e.to, d, sx, sy, tx, ty, mx: (sx + tx) / 2, my: (sy + ty) / 2, mode: g.mode });
  }
  return out;
}

function push(map, k, v) {
  if (!map.has(k)) map.set(k, []);
  map.get(k).push(v);
}

function r(n) {
  return Math.round(n * 10) / 10;
}
