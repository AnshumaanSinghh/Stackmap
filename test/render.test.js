import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { scan, render, viewGraph, layoutGraph, toMermaid } from '../src/index.js';
import { viewerBundle, stripModule } from '../src/render/html.js';

const fx = (name) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name);
const g = scan(fx('saas'), { git: false });

test('layout places every node once, without overlaps', () => {
  const view = viewGraph(g);
  const layout = layoutGraph(view);
  assert.equal(layout.boxes.size, view.nodes.length);
  const boxes = [...layout.boxes.values()];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, 'boxes overlap');
    }
  }
  assert.equal(layout.edges.length, view.edges.length);
  for (const e of layout.edges) assert.match(e.d, /^M[\d.-]+ [\d.-]+ C/);
});

test('svg is well-formed and themed for light and dark', () => {
  const svg = render(g, 'svg');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /prefers-color-scheme:dark/);
  assert.match(svg, /PostgreSQL/);
  assert.equal((svg.match(/<g class="sm-node sm-f-/g) || []).length, viewGraph(g).nodes.length);
  assert.ok(!/undefined|NaN/.test(svg), 'no undefined or NaN in markup');
});

test('mermaid is deterministic and GitHub-safe', () => {
  const a = render(g, 'mermaid');
  const b = render(scan(fx('saas'), { git: false }), 'mermaid');
  assert.equal(a, b);
  assert.match(a, /^flowchart LR/);
  assert.match(a, /subgraph data\["Data"\]/);
  assert.match(a, /\[\("PostgreSQL"\)\]/, 'databases are cylinders');
  assert.ok(!/\bend\[/.test(a), 'no node id collides with the "end" keyword');
  for (const line of a.split('\n')) assert.ok(!/["]{2}/.test(line.replace(/\|"[^"]*"\|/g, '')), `stray quotes: ${line}`);
});

test('mermaid folds many third-party services by category', () => {
  const nodes = Array.from({ length: 20 }, (_, i) => ({ id: `tech:x${i}`, name: `X${i}`, kind: 'external', category: i < 12 ? 'integrations' : 'ai', column: 'external' }));
  nodes.push({ id: 'unit:a', name: 'a', kind: 'service', column: 'services', unit: true });
  const edges = nodes.slice(0, 20).map((n) => ({ id: `unit:a->${n.id}`, from: 'unit:a', to: n.id, via: [], confidence: 'imported', kind: 'uses' }));
  const m = toMermaid({ nodes, edges }, { collapseExternalOver: 14 });
  assert.match(m, /Integration ×12/);
  assert.match(m, /AI ×8/);
});

test('markdown inventory has the sections and declared-only list', () => {
  const md = render(g, 'md');
  assert.match(md, /^# acme architecture/m);
  assert.match(md, /## Apps and services/);
  assert.match(md, /## Data/);
  assert.match(md, /## Third-party services/);
  assert.match(md, /## Declared but never imported[\s\S]*Resend/);
  assert.match(md, /## Environment variables[\s\S]*`STRIPE_SECRET_KEY`/);
});

test('json and dot', () => {
  const json = JSON.parse(render(g, 'json'));
  assert.equal(json.schema, 'stackmap/1');
  const dot = render(g, 'dot');
  assert.match(dot, /^digraph "acme" \{/);
  assert.match(dot, /cluster_data/);
});

test('html is self-contained and its script runs', () => {
  const html = render(g, 'html');
  assert.ok(!/<script[^>]+src=/.test(html), 'no external scripts');
  assert.ok(!/<link[^>]+stylesheet/.test(html), 'no external styles');
  assert.ok(!/https?:\/\/(cdn|unpkg|fonts)/.test(html));
  const data = html.match(/<script type="application\/json" id="sm-data">([\s\S]*?)<\/script>/)[1];
  const parsed = JSON.parse(data);
  assert.equal(parsed.graph.nodes.length, g.nodes.length);
  assert.match(parsed.mermaid.services, /^flowchart/);
  // The shared modules must compile as one classic script.
  const { js } = viewerBundle();
  assert.doesNotThrow(() => new vm.Script(js));
});

test('stripModule removes imports and exports only', () => {
  const src = "import { a } from './a.js';\nimport {\n  b,\n} from './b.js';\nexport function f() {}\nexport const x = 1;\nconst y = 'export const z';\n";
  const out = stripModule(src);
  assert.ok(!out.includes('import'));
  assert.match(out, /^function f\(\) \{\}/m);
  assert.match(out, /^const x = 1;/m);
  assert.match(out, /'export const z'/);
});

test('viewer bundle draws the map in a DOM-less sandbox', () => {
  const { js } = viewerBundle();
  const shared = js.slice(0, js.indexOf('// The interactive viewer.'));
  const ctx = vm.createContext({ Map, Set, Math, JSON, String, Number, Object, Array });
  vm.runInContext(`${shared}\nthis.out = drawSvg(viewGraph(G, {}), layoutGraph(viewGraph(G, {})), { mode: 'external', interactive: true });`, Object.assign(ctx, { G: g }));
  assert.match(ctx.out, /class="sm-hit"/);
  assert.match(ctx.out, /tabindex="0"/);
});
