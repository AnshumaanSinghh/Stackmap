// Node selectors, shared by rules, `hide`, `stackmap why` and the MCP server.
//   *                 every node
//   web               a node whose name, id, package name or path is "web" (case-insensitive)
//   apps/*            a path glob (units only)
//   kind:service      by kind: app service worker function cli mobile desktop library datastore external container
//   category:payments by category (technologies)
//   tech:stripe       by id
// A selector list is comma separated; a node matches when any selector matches.

import { globToRegExp } from '../scan/files.js';

export function matchesSelector(node, selector) {
  const s = String(selector).trim();
  if (!s) return false;
  if (s === '*') return true;
  const lower = s.toLowerCase();
  if (lower.startsWith('kind:')) return node.kind === lower.slice(5);
  if (lower.startsWith('category:')) return node.category === lower.slice(9);
  if (node.id.toLowerCase() === lower) return true;
  if (node.name?.toLowerCase() === lower) return true;
  if (node.packageName?.toLowerCase() === lower) return true;
  if (node.techId === lower) return true;
  if (node.path != null) {
    if (node.path.toLowerCase() === lower.replace(/^\.\//, '').replace(/\/$/, '')) return true;
    if (/[*?]/.test(s) && globToRegExp(s).test(node.path)) return true;
  }
  return false;
}

export function selectNodes(nodes, selectorList) {
  const parts = String(selectorList).split(',').map((x) => x.trim()).filter(Boolean);
  return nodes.filter((n) => parts.some((p) => matchesSelector(n, p)));
}

/** Best single match for a free-text query: exact name, then id, then substring. */
export function findNode(nodes, query) {
  const q = String(query).trim().toLowerCase();
  if (!q) return null;
  return (
    nodes.find((n) => n.name?.toLowerCase() === q) ??
    nodes.find((n) => n.id.toLowerCase() === q || n.techId === q || n.packageName?.toLowerCase() === q || n.path?.toLowerCase() === q) ??
    nodes.find((n) => n.name?.toLowerCase().includes(q)) ??
    nodes.find((n) => n.id.toLowerCase().includes(q)) ??
    null
  );
}
