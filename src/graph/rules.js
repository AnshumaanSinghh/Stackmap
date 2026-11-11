// Architecture rules, checked in CI. Rules live in .stackmap.json:
//
//   { "rules": [
//       { "deny": "kind:app -> category:database", "message": "Frontends go through the API" },
//       { "deny": "* -> category:analytics", "except": "web, marketing" },
//       { "require": "kind:service -> Sentry", "message": "Every service reports errors" }
//   ] }
//
// Rules are checked on the services view, so a frontend that reaches the database through an
// internal library still counts as reaching the database.

import { selectNodes } from './select.js';
import { viewGraph } from './view.js';

export function parseRule(rule) {
  const expr = rule.deny ?? rule.require;
  if (typeof expr !== 'string' || !expr.includes('->')) return { error: `Rule needs "deny" or "require" in the form "from -> to": ${JSON.stringify(rule)}` };
  const [from, to] = expr.split('->').map((x) => x.trim());
  if (!from || !to) return { error: `Rule has an empty side: ${expr}` };
  return { type: rule.deny ? 'deny' : 'require', from, to, except: rule.except ?? null, message: rule.message ?? null, expr, line: rule.line ?? 1, view: rule.view === 'everything' ? 'everything' : 'services' };
}

export function checkRules(graph, rules, opts = {}) {
  const violations = [];
  const errors = [];
  const views = {
    services: viewGraph(graph, { libraries: false }),
    everything: viewGraph(graph, { libraries: true }),
  };
  for (const raw of rules) {
    const r = parseRule(raw);
    if (r.error) {
      errors.push(r.error);
      continue;
    }
    const view = views[r.view];
    const exempt = new Set(r.except ? selectNodes(view.nodes, Array.isArray(r.except) ? r.except.join(',') : r.except).map((n) => n.id) : []);
    const froms = new Set(selectNodes(view.nodes, r.from).map((n) => n.id));
    const tos = new Set(selectNodes(view.nodes, r.to).map((n) => n.id));
    const byId = new Map(view.nodes.map((n) => [n.id, n]));
    if (r.type === 'deny') {
      for (const e of view.edges) {
        if (froms.has(e.from) && tos.has(e.to) && !exempt.has(e.from) && !exempt.has(e.to)) {
          violations.push({
            rule: r.expr,
            message: r.message ?? `${byId.get(e.from).name} must not use ${byId.get(e.to).name} (rule "deny ${r.expr}")`,
            from: byId.get(e.from).name,
            to: byId.get(e.to).name,
            through: e.through ?? [],
            // For a connection through a library, point at the line that imports the library.
            evidence: e.entry?.[0] ?? e.evidence?.[0] ?? null,
            configLine: r.line,
          });
        }
      }
    } else {
      for (const id of froms) {
        if (exempt.has(id)) continue;
        const ok = view.edges.some((e) => e.from === id && tos.has(e.to));
        if (!ok) {
          const n = byId.get(id);
          violations.push({
            rule: r.expr,
            message: r.message ?? `${n.name} must use ${r.to} (rule "require ${r.expr}")`,
            from: n.name,
            to: r.to,
            through: [],
            evidence: n.evidence?.[0] ?? null,
            configLine: r.line,
          });
        }
      }
    }
  }
  return { violations, errors, checked: rules.length - errors.length, ok: violations.length === 0 && errors.length === 0, strict: Boolean(opts.strict) };
}
