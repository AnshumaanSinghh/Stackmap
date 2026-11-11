// MCP server over stdio (JSON-RPC 2.0, newline-delimited). Gives AI coding agents a map of the
// system they are editing: which services exist, what each one talks to, and the exact lines
// that prove it. Rescans on demand, so answers follow the agent's edits.

import { createInterface } from 'node:readline';
import { scan, VERSION } from './graph/build.js';
import { viewGraph, impactOf } from './graph/view.js';
import { diffGraphs, diffToMarkdown } from './graph/diff.js';
import { checkRules } from './graph/rules.js';
import { findNode } from './graph/select.js';
import { CATEGORY_SINGULAR, KIND_LABELS } from './render/draw.js';
import { toMarkdown } from './render/markdown.js';
import { loadConfig } from './config.js';
import { exportRef } from './git.js';

export const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS =
  'Stackmap maps the architecture of the project from its code: apps, services, workers, databases, queues, ' +
  'storage and third-party APIs, and which of them talk to each other. Every fact carries file:line evidence. ' +
  'Call stackmap_overview first to understand the system. Use stackmap_lookup before changing how a service talks ' +
  'to a database or API, stackmap_impact to see what breaks if something changes, and stackmap_diff to review ' +
  'architecture changes on a branch. Cite the file:line evidence when you explain the architecture.';

const TOOLS = [
  {
    name: 'stackmap_overview',
    title: 'Architecture overview',
    description: 'The whole system at a glance: every app, service and worker, what each talks to (databases, queues, third-party APIs, other services), deploy targets and env vars, with file:line evidence. Start here.',
    inputSchema: { type: 'object', properties: { libraries: { type: 'boolean', description: 'Also list internal libraries (default: folded into the apps that use them).' } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'stackmap_lookup',
    title: 'Look up a component',
    description: 'Details for one component: a service, app, database, queue or API (e.g. "web", "postgresql", "stripe"). Returns what it is, who uses it, what it uses, and the code locations that prove each link.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Name, id, package name or path of the component.' } }, required: ['name'] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'stackmap_impact',
    title: 'Impact of a change',
    description: 'Everything that depends on a component, directly or through other parts: what could break if it changes or goes down.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'stackmap_diff',
    title: 'Architecture diff',
    description: 'Architecture changes between a git ref (e.g. "main", "origin/main", "HEAD~1") and the working tree: new or removed services, data stores, third-party APIs and connections.',
    inputSchema: { type: 'object', properties: { base: { type: 'string', description: 'Git ref to compare against.' } }, required: ['base'] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'stackmap_check',
    title: 'Check architecture rules',
    description: 'Check the architecture rules in .stackmap.json (for example "frontends must not talk to the database"). Returns each violation with the code location.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export function createMcpHandler({ root, configFile }) {
  const state = { protocolVersion: SUPPORTED_PROTOCOLS[0] };
  let cache = null;
  const graph = () => {
    if (cache && Date.now() - cache.at < 3000) return cache.graph;
    cache = { at: Date.now(), graph: scan(root, { configFile }) };
    return cache.graph;
  };
  const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });

  const tools = {
    stackmap_overview(args) {
      const g = graph();
      return text(toMarkdown(g, viewGraph(g, { libraries: Boolean(args?.libraries) }), { mermaid: false }));
    },
    stackmap_lookup(args) {
      const g = graph();
      const n = findNode(g.nodes, args?.name ?? '');
      if (!n) return text(`No component called "${args?.name}". Known: ${g.nodes.map((x) => x.name).join(', ')}`, true);
      return text(describeNode(g, n));
    },
    stackmap_impact(args) {
      const g = graph();
      const n = findNode(g.nodes, args?.name ?? '');
      if (!n) return text(`No component called "${args?.name}".`, true);
      const imp = impactOf(g, n.id);
      const byId = new Map(g.nodes.map((x) => [x.id, x]));
      if (!imp.size) return text(`Nothing depends on ${n.name}.`);
      const rows = [...imp].sort((a, b) => a[1].depth - b[1].depth).map(([id, v]) => {
        const x = byId.get(id);
        const ev = v.edge.evidence?.[0];
        return `- ${x.name} (${KIND_LABELS[x.kind] ?? x.kind}${v.depth > 1 ? `, through ${byId.get(v.via)?.name}` : ', directly'})${ev ? ` — ${ev.file}:${ev.line}` : ''}`;
      });
      return text(`${imp.size} component(s) depend on ${n.name}:\n${rows.join('\n')}`);
    },
    stackmap_diff(args) {
      const base = String(args?.base ?? '');
      if (!base) return text('Give a git ref as "base".', true);
      const exp = exportRef(root, base);
      try {
        const b = scan(exp.dir, { configFile, git: false });
        const d = diffGraphs(b, graph());
        return text(diffToMarkdown(d, { plain: true }));
      } finally {
        exp.cleanup();
      }
    },
    stackmap_check() {
      const { config } = loadConfig(root, configFile);
      if (!config.rules.length) return text('No rules in .stackmap.json. Example: {"rules":[{"deny":"kind:app -> category:database","message":"Frontends go through the API"}]}');
      const res = checkRules(graph(), config.rules);
      if (res.ok) return text(`All ${res.checked} rule(s) pass.`);
      return text([...res.errors.map((e) => `Config error: ${e}`), ...res.violations.map((v) => `- ${v.message}${v.evidence ? ` (${v.evidence.file}:${v.evidence.line})` : ''}`)].join('\n'), true);
    },
  };

  return function handle(msg) {
    const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
    const error = (code, message) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return msg?.id !== undefined ? error(-32600, 'Invalid request') : null;
    const isNotification = msg.id === undefined || msg.id === null;
    switch (msg.method) {
      case 'initialize': {
        const requested = msg.params?.protocolVersion;
        state.protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0];
        return reply({
          protocolVersion: state.protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'stackmap', title: 'Stackmap', version: VERSION },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        const fn = tools[msg.params?.name];
        if (!fn) return error(-32602, `Unknown tool: ${msg.params?.name}`);
        try {
          return reply(fn(msg.params?.arguments ?? {}));
        } catch (err) {
          return reply(text(`Stackmap failed: ${err.message}`, true));
        }
      }
      default:
        if (isNotification) return null;
        return error(-32601, `Method not found: ${msg.method}`);
    }
  };
}

function describeNode(g, n) {
  const view = viewGraph(g, { libraries: true });
  const byId = new Map(g.nodes.map((x) => [x.id, x]));
  const L = [];
  const kind = n.unit ? KIND_LABELS[n.kind] : CATEGORY_SINGULAR[n.category] ?? KIND_LABELS[n.kind];
  L.push(`# ${n.name}`, `${kind}${n.path ? ` at ${n.path}` : ''}${n.language ? ` · ${n.language}` : ''}`);
  if (n.description) L.push(n.description);
  if (n.frameworks?.length) L.push(`Frameworks: ${n.frameworks.join(', ')}`);
  if (n.platforms?.length) L.push(`Deploys with: ${n.platforms.join(', ')}`);
  L.push('', 'Evidence:');
  for (const e of n.evidence) L.push(`- ${e.file}:${e.line} (${e.why})${e.text ? `: ${e.text}` : ''}`);
  const fmt = (e, other) => {
    const via = [...(e.via ?? []), ...(e.through ?? []).map((t) => `through ${t}`)];
    const ev = e.evidence.slice(0, 3).map((x) => `${x.file}:${x.line}`).join(', ');
    return `- ${byId.get(other)?.name ?? other}${via.length ? ` (${via.join(', ')})` : ''} [${e.declaredOnly ? 'declared, never imported' : e.confidence}] ${ev}`;
  };
  const out = view.edges.filter((e) => e.from === n.id);
  const inc = view.edges.filter((e) => e.to === n.id);
  if (out.length) L.push('', 'Uses:', ...out.map((e) => fmt(e, e.to)));
  if (inc.length) L.push('', 'Used by:', ...inc.map((e) => fmt(e, e.from)));
  if (n.env?.length) L.push('', `Reads env vars: ${n.env.join(', ')}`);
  return L.join('\n');
}

export async function startMcpServer({ root, configFile, input = process.stdin, output = process.stdout }) {
  const handle = createMcpHandler({ root, configFile });
  const rl = createInterface({ input, crlfDelay: Infinity });
  const send = (obj) => output.write(`${JSON.stringify(obj)}\n`);
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    const batch = Array.isArray(msg) ? msg : [msg];
    for (const m of batch) {
      const res = handle(m);
      if (res) send(res);
    }
  }
}
