// Command-line interface. Zero dependencies: hand-rolled argument parsing and ANSI colour.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan, VERSION } from './graph/build.js';
import { viewGraph, impactOf } from './graph/view.js';
import { diffGraphs, diffToMarkdown } from './graph/diff.js';
import { checkRules } from './graph/rules.js';
import { findNode } from './graph/select.js';
import { CATEGORY_SINGULAR, KIND_LABELS } from './render/draw.js';
import { FORMATS, render } from './index.js';
import { updateReadme } from './readme.js';
import { exportRef } from './git.js';
import { startMcpServer } from './mcp.js';
import { loadConfig } from './config.js';
import { summaryText } from './summary.js';

const HELP = `
Stackmap ${VERSION}: architecture diagrams generated from your code.

Usage
  stackmap [path]                 Map the project and open the interactive map
  stackmap readme [path]          Keep a Mermaid diagram in README.md up to date
  stackmap diff <base> [path]     Architecture changes since a git ref (or a saved .json)
  stackmap check [path]           Enforce the rules in .stackmap.json (exits 1 on violations)
  stackmap why <name> [path]      Show why something is on the map, with file:line evidence
  stackmap mcp [path]             Run as an MCP server for AI coding agents (stdio)

Options
  -f, --format <fmt>    html (default), svg, mermaid, md, json, dot
  -o, --out <file>      Write output to a file ("-" for stdout)
      --libraries       Draw internal libraries instead of folding them into their users
      --no-open         Do not open the browser
      --config <file>   Config file (default: .stackmap.json)
      --json            Machine-readable output for diff, check and why
      --file <file>     readme: the Markdown file to update (default: README.md)
      --check           readme: fail if the diagram is out of date instead of writing it
      --head <ref>      diff: compare against this git ref instead of the working tree
  -q, --quiet           Only print errors
  -v, --version
  -h, --help

Examples
  npx stackmap-cli                         open the map of the current project
  npx stackmap-cli -f mermaid > arch.mmd   Mermaid text for docs
  npx stackmap-cli -f md -o STACK.md       an inventory with links to the code
  npx stackmap-cli diff origin/main        what this branch changes in the architecture
  npx stackmap-cli why stripe              where Stripe is used, line by line

Docs: https://github.com/AnshumaanSinghh/Stackmap
`;

const BOOL = new Set(['libraries', 'no-open', 'json', 'check', 'quiet', 'help', 'version', 'no-color', 'no-credit', 'strict']);
const ALIASES = { f: 'format', o: 'out', q: 'quiet', h: 'help', v: 'version' };
const COMMANDS = new Set(['map', 'readme', 'diff', 'check', 'why', 'mcp', 'help']);

export function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      opts._.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--') || (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a))) {
      let [k, v] = a.replace(/^--?/, '').split(/=(.*)/s);
      k = ALIASES[k] ?? k;
      if (BOOL.has(k)) {
        opts[k] = v === undefined ? true : v !== 'false';
      } else {
        if (v === undefined) {
          v = argv[i + 1];
          i++;
        }
        if (v === undefined) throw new UsageError(`Option --${k} needs a value`);
        opts[k] = v;
      }
    } else opts._.push(a);
  }
  return opts;
}

class UsageError extends Error {}

export async function main(argv = process.argv.slice(2), io = { out: process.stdout, err: process.stderr, env: process.env }) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    io.err.write(`stackmap: ${err.message}\n`);
    return 2;
  }
  const color = makeColor(io.out.isTTY && !opts['no-color'] && !io.env.NO_COLOR);
  if (opts.version) {
    io.out.write(`${VERSION}\n`);
    return 0;
  }
  let command = 'map';
  if (opts._.length && COMMANDS.has(opts._[0])) command = opts._.shift();
  if (opts.help || command === 'help') {
    io.out.write(HELP);
    return 0;
  }
  const log = (s = '') => !opts.quiet && io.err.write(`${s}\n`);
  try {
    switch (command) {
      case 'map':
        return await cmdMap(opts, io, color, log);
      case 'readme':
        return cmdReadme(opts, io, color, log);
      case 'diff':
        return cmdDiff(opts, io, color, log);
      case 'check':
        return cmdCheck(opts, io, color, log);
      case 'why':
        return cmdWhy(opts, io, color);
      case 'mcp':
        await startMcpServer({ root: path.resolve(opts._[0] ?? '.'), configFile: opts.config });
        return 0;
    }
  } catch (err) {
    if (err instanceof UsageError) {
      io.err.write(`stackmap: ${err.message}\n`);
      return 2;
    }
    io.err.write(`stackmap: ${err.message}\n`);
    if (io.env.STACKMAP_DEBUG) io.err.write(`${err.stack}\n`);
    return 1;
  }
  return 0;
}

function rootOf(opts, index = 0) {
  const dir = path.resolve(opts._[index] ?? '.');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new UsageError(`Not a directory: ${opts._[index]}`);
  return dir;
}

function doScan(root, opts) {
  return scan(root, { configFile: opts.config });
}

// ------------------------------------------------------------------ map

async function cmdMap(opts, io, c, log) {
  const root = rootOf(opts);
  const format = opts.format ?? (opts.out && extFormat(opts.out)) ?? 'html';
  if (!FORMATS.includes(format) && format !== 'mmd' && format !== 'markdown') throw new UsageError(`Unknown format "${format}". Use one of: ${FORMATS.join(', ')}`);
  const graph = doScan(root, opts);
  const output = render(graph, format, { libraries: opts.libraries, credit: !opts['no-credit'] });

  if (opts.out === '-' || (!opts.out && format !== 'html')) {
    io.out.write(output.endsWith('\n') ? output : `${output}\n`);
    if (format !== 'json') log(c.dim(`${summaryLine(graph)}`));
    return 0;
  }
  let file = opts.out;
  if (!file) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackmap-'));
    file = path.join(dir, `${slug(graph.project.name)}.html`);
  }
  fs.writeFileSync(file, output);
  if (!opts.quiet) io.err.write(terminalSummary(graph, c));
  const shown = path.relative(process.cwd(), file);
  log(`  ${c.bold('Map')}  ${shown.startsWith('..') ? file : shown}`);
  const shouldOpen = format === 'html' && !opts['no-open'] && !io.env.CI && io.out.isTTY;
  if (shouldOpen) {
    openFile(file);
    log(c.dim('       opened in your browser'));
  }
  log('');
  log(c.dim(`  Next: ${c.reset('npx stackmap-cli readme')} keeps an always-current diagram in your README`));
  log('');
  for (const w of graph.warnings.slice(0, 5)) log(c.yellow(`  warning: ${w}`));
  return 0;
}

function extFormat(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return { html: 'html', htm: 'html', svg: 'svg', mmd: 'mermaid', mermaid: 'mermaid', md: 'md', markdown: 'md', json: 'json', dot: 'dot', gv: 'dot' }[ext];
}

function summaryLine(graph) {
  const s = graph.summary;
  return `stackmap: ${summaryText(s, { sep: ", ", connections: true }) || "nothing found"} (${s.ms} ms)`;
}

export function terminalSummary(graph, c) {
  const view = viewGraph(graph, { libraries: false });
  const s = graph.summary;
  const lines = [];
  lines.push('');
  lines.push(`  ${c.bold('Stackmap')} ${c.dim('·')} ${c.bold(graph.project.name)}  ${c.dim(`${s.ms} ms · ${s.filesListed.toLocaleString('en-US')} files`)}`);
  lines.push('');
  const col = (title, nodes, fmt) => {
    if (!nodes.length) return;
    const names = nodes.map(fmt);
    const shown = names.slice(0, 8).join(c.dim(', '));
    lines.push(`  ${c.dim(title.padEnd(12))}${shown}${names.length > 8 ? c.dim(` +${names.length - 8} more`) : ''}`);
  };
  const withFw = (n) => (n.frameworks?.length ? `${n.name} ${c.dim(`(${n.frameworks[0]})`)}` : n.name);
  col('Apps', view.nodes.filter((n) => n.column === 'apps'), withFw);
  col('Services', view.nodes.filter((n) => n.column === 'services'), withFw);
  col('Libraries', view.nodes.filter((n) => n.column === 'libraries'), (n) => n.name);
  col('Data', view.nodes.filter((n) => n.column === 'data'), (n) => n.name);
  col('Third-party', view.nodes.filter((n) => n.column === 'external'), (n) => n.name);
  const units = view.nodes.filter((n) => n.column === 'apps' || n.column === 'services');
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  if (units.length && view.edges.length) {
    lines.push('');
    const width = Math.min(18, Math.max(...units.map((u) => u.name.length)));
    for (const u of units.slice(0, 14)) {
      const outs = view.edges.filter((e) => e.from === u.id).map((e) => {
        const t = byId.get(e.to);
        const via = (e.via ?? []).filter((v) => !v.startsWith('$'))[0];
        const name = via ? `${t.name} ${c.dim(`via ${via}`)}` : t.name;
        return e.declaredOnly ? c.dim(`${t.name}?`) : name;
      });
      if (!outs.length) continue;
      const shown = outs.slice(0, 7).join(c.dim(' · '));
      lines.push(`  ${c.bold(u.name.slice(0, width).padEnd(width))} ${c.dim('→')} ${shown}${outs.length > 7 ? c.dim(` +${outs.length - 7}`) : ''}`);
    }
  }
  if (!view.nodes.length) {
    lines.push(c.yellow('  Nothing found. Run Stackmap from the root of a project (where package.json, go.mod, pyproject.toml ... live).'));
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function openFile(file) {
  const cmd = process.platform === 'darwin' ? ['open', [file]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', file]] : ['xdg-open', [file]];
  try {
    const child = execFile(cmd[0], cmd[1], { stdio: 'ignore' }, () => {});
    child.unref?.();
  } catch {
    /* no browser available */
  }
}

// ------------------------------------------------------------------ readme

function cmdReadme(opts, io, c, log) {
  const root = rootOf(opts);
  const graph = doScan(root, opts);
  const res = updateReadme(root, graph, { file: opts.file, check: opts.check, libraries: opts.libraries });
  const rel = path.relative(process.cwd(), res.file) || res.file;
  if (opts.check) {
    if (res.status === 'unchanged') {
      log(c.green(`  ✓ ${rel}: architecture diagram is up to date`));
      return 0;
    }
    io.err.write(c.red(`  ✗ ${rel}: architecture diagram is out of date. Run: npx stackmap-cli readme\n`));
    return 1;
  }
  const msg = { updated: 'updated the diagram in', unchanged: 'diagram already up to date in', inserted: 'added an Architecture section to' }[res.status];
  log(`  ${c.green('✓')} ${msg} ${rel}`);
  if (res.status === 'inserted') log(c.dim('    Move the block anywhere; Stackmap keeps everything between the stackmap:start/end markers current.'));
  return 0;
}

// ------------------------------------------------------------------ diff

function loadSide(root, ref, opts) {
  if (ref.endsWith('.json') && fs.existsSync(ref)) return JSON.parse(fs.readFileSync(ref, 'utf8'));
  const exp = exportRef(root, ref);
  try {
    const g = scan(exp.dir, { configFile: opts.config, git: false });
    const head = scan(root, { configFile: opts.config, git: true }).project;
    g.project = { ...g.project, name: head.name, repoUrl: head.repoUrl, prefix: head.prefix, commit: null };
    return g;
  } finally {
    exp.cleanup();
  }
}

function cmdDiff(opts, io, c, log) {
  const baseRef = opts._[0];
  if (!baseRef) throw new UsageError('diff needs a base: a git ref (origin/main) or a stackmap .json file');
  const root = rootOf(opts, 1);
  const base = loadSide(root, baseRef, opts);
  const head = opts.head ? loadSide(root, opts.head, opts) : doScan(root, opts);
  const diff = diffGraphs(base, head, { libraries: opts.libraries });
  if (opts.json) {
    io.out.write(`${JSON.stringify({ changed: diff.changed, addedNodes: diff.addedNodes, removedNodes: diff.removedNodes, addedEdges: diff.addedEdges, removedEdges: diff.removedEdges, changedNodes: diff.changedNodes }, null, 2)}\n`);
  } else if (opts.format === 'md' || opts.format === 'markdown') {
    io.out.write(`${diffToMarkdown(diff)}\n`);
  } else {
    io.out.write(`${terminalDiff(diff, c, baseRef)}\n`);
  }
  if (opts.out && opts.out !== '-') fs.writeFileSync(opts.out, diffToMarkdown(diff));
  return 0;
}

function terminalDiff(diff, c, baseRef) {
  const lines = ['', `  ${c.bold('Stackmap diff')} ${c.dim(`against ${baseRef}`)}`, ''];
  if (!diff.changed) {
    lines.push(c.green('  No architecture changes.'));
    return lines.join('\n');
  }
  const nameOf = (id) => diff.head.view.nodes.find((n) => n.id === id)?.name ?? diff.base.view.nodes.find((n) => n.id === id)?.name ?? id;
  const where = (ev) => (ev ? c.dim(` ${ev.file}:${ev.line}`) : '');
  for (const n of diff.addedNodes) lines.push(`  ${c.green('+')} ${c.bold(n.name)} ${c.dim(`(${CATEGORY_SINGULAR[n.category] ?? KIND_LABELS[n.kind] ?? n.kind})`)}${where(n.evidence?.[0])}`);
  for (const n of diff.removedNodes) lines.push(`  ${c.red('-')} ${c.bold(n.name)} ${c.dim(`(${CATEGORY_SINGULAR[n.category] ?? KIND_LABELS[n.kind] ?? n.kind})`)}`);
  for (const e of diff.addedEdges) lines.push(`  ${c.green('+')} ${nameOf(e.from)} → ${nameOf(e.to)}${where(e.evidence?.[0])}`);
  for (const e of diff.removedEdges) lines.push(`  ${c.red('-')} ${nameOf(e.from)} → ${nameOf(e.to)}`);
  for (const ch of diff.changedNodes) lines.push(`  ${c.yellow('~')} ${ch.node.name}: ${ch.changes.join('; ')}`);
  return lines.join('\n');
}

// ------------------------------------------------------------------ check

function cmdCheck(opts, io, c, log) {
  const root = rootOf(opts);
  const graph = doScan(root, opts);
  const { config } = loadConfig(root, opts.config);
  if (!config.rules.length) {
    log(c.yellow('  No rules found. Add "rules" to .stackmap.json, for example:'));
    log(c.dim('    { "rules": [ { "deny": "kind:app -> category:database", "message": "Frontends go through the API" } ] }'));
    return opts.strict ? 1 : 0;
  }
  const res = checkRules(graph, config.rules);
  const gh = io.env.GITHUB_ACTIONS === 'true';
  if (opts.json) {
    io.out.write(`${JSON.stringify(res, null, 2)}\n`);
  } else {
    for (const e of res.errors) io.err.write(c.red(`  config error: ${e}\n`));
    for (const v of res.violations) {
      const loc = v.evidence ? `${v.evidence.file}:${v.evidence.line}` : '';
      io.out.write(`  ${c.red('✗')} ${v.message}${v.through.length ? c.dim(` (through ${v.through.join(', ')})`) : ''}${loc ? c.dim(`  ${loc}`) : ''}\n`);
      if (gh && v.evidence) io.out.write(`::error file=${v.evidence.file},line=${v.evidence.line},title=Stackmap rule::${v.message.replace(/\r?\n/g, ' ')}\n`);
    }
    if (res.ok) log(c.green(`  ✓ ${res.checked} architecture rule${res.checked === 1 ? '' : 's'} passed`));
    else log(c.red(`  ${res.violations.length} violation${res.violations.length === 1 ? '' : 's'} of ${res.checked} rule${res.checked === 1 ? '' : 's'}`));
  }
  return res.ok ? 0 : 1;
}

// ------------------------------------------------------------------ why

function cmdWhy(opts, io, c) {
  const query = opts._[0];
  if (!query) throw new UsageError('why needs a name, for example: stackmap why postgresql');
  const root = rootOf(opts, 1);
  const graph = doScan(root, opts);
  const view = viewGraph(graph, { libraries: true });
  const node = findNode(graph.nodes, query);
  if (!node) {
    io.err.write(`  Nothing called "${query}" on the map. Try one of: ${graph.nodes.slice(0, 12).map((n) => n.name).join(', ')}\n`);
    return 1;
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const inc = view.edges.filter((e) => e.to === node.id);
  const out = view.edges.filter((e) => e.from === node.id);
  if (opts.json) {
    io.out.write(`${JSON.stringify({ node, usedBy: inc, uses: out }, null, 2)}\n`);
    return 0;
  }
  const L = [];
  const kind = node.unit ? KIND_LABELS[node.kind] : CATEGORY_SINGULAR[node.category] ?? KIND_LABELS[node.kind];
  L.push('', `  ${c.bold(node.name)} ${c.dim(`· ${kind}${node.path ? ` · ${node.path}` : ''}`)}`, '');
  const ev = (e) => `      ${c.dim(`${e.file}:${e.line}`)}  ${e.text ? e.text : c.dim(e.why)}`;
  L.push(c.dim('  On the map because:'));
  for (const e of node.evidence) L.push(ev(e));
  if (node.evidenceCount > node.evidence.length) L.push(c.dim(`      … ${node.evidenceCount - node.evidence.length} more`));
  if (inc.length) {
    L.push('', c.dim(`  Used by ${inc.length}:`));
    for (const e of inc) {
      L.push(`    ${c.bold(byId.get(e.from)?.name ?? e.from)}${viaOf(e, c)}`);
      for (const x of e.evidence.slice(0, 3)) L.push(ev(x));
    }
  }
  if (out.length) {
    L.push('', c.dim(`  Uses ${out.length}:`));
    for (const e of out) L.push(`    ${c.bold(byId.get(e.to)?.name ?? e.to)}${viaOf(e, c)}${c.dim(e.evidence[0] ? `  ${e.evidence[0].file}:${e.evidence[0].line}` : '')}`);
  }
  if (!node.unit) {
    const imp = impactOf(graph, node.id);
    const names = [...imp.keys()].map((id) => byId.get(id)).filter((n) => n && n.kind !== 'library').map((n) => n.name);
    if (names.length) L.push('', c.dim(`  If ${node.name} is down, these depend on it: `) + names.join(', '));
  }
  L.push('');
  io.out.write(L.join('\n') + '\n');
  return 0;
}

function viaOf(e, c) {
  const bits = [...(e.via ?? []), ...(e.through ?? []).map((t) => `through ${t}`)];
  const conf = e.declaredOnly ? 'declared, never imported' : e.confidence;
  return c.dim(`  (${[...bits, conf].join(', ')})`);
}

// ------------------------------------------------------------------ util

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stackmap';
}

function makeColor(on) {
  const wrap = (a, b) => (s) => (on ? `\x1b[${a}m${s}\x1b[${b}m` : String(s));
  return { bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), green: wrap(32, 39), yellow: wrap(33, 39), reset: (s) => (on ? `\x1b[22m${s}\x1b[2m` : s) };
}
