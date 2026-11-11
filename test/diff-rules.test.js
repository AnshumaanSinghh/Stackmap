import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan, diffGraphs, diffToMarkdown, checkRules, updateReadme } from '../src/index.js';
import { COMMENT_MARKER } from '../src/graph/diff.js';

const fx = (name) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name);

function copyFixture(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackmap-test-'));
  fs.cpSync(fx(name), dir, { recursive: true });
  return dir;
}

test('diff reports a new third-party API, new connection and removal', () => {
  const dir = copyFixture('saas');
  try {
    const base = scan(dir, { git: false });
    fs.writeFileSync(path.join(dir, 'apps/web/src/lib/ai.ts'), "import Anthropic from '@anthropic-ai/sdk';\nexport const c = new Anthropic();\n");
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'apps/web/package.json'), 'utf8'));
    pkg.dependencies['@anthropic-ai/sdk'] = '^0.33.0';
    delete pkg.dependencies['posthog-js'];
    fs.writeFileSync(path.join(dir, 'apps/web/package.json'), JSON.stringify(pkg, null, 2));
    fs.writeFileSync(path.join(dir, 'apps/web/src/app/page.tsx'), "export default function Page() { return null; }\n");
    const head = scan(dir, { git: false });
    const d = diffGraphs(base, head);
    assert.equal(d.changed, true);
    assert.ok(d.addedNodes.some((n) => n.name === 'Anthropic'));
    assert.ok(d.removedNodes.some((n) => n.name === 'PostHog'));
    const md = diffToMarkdown(d);
    assert.ok(md.startsWith(COMMENT_MARKER));
    assert.match(md, /New third-party services[\s\S]*\*\*Anthropic\*\*/);
    assert.match(md, /Data may now be sent to Anthropic/);
    assert.match(md, /```mermaid/);
    assert.match(md, /\*\*PostHog\*\* \(Analytics\) is no longer used/);
    const plain = diffToMarkdown(d, { plain: true });
    assert.ok(!plain.includes(COMMENT_MARKER));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('diff of identical scans is empty', () => {
  const a = scan(fx('saas'), { git: false });
  const d = diffGraphs(a, a);
  assert.equal(d.changed, false);
  assert.match(diffToMarkdown(d), /No architecture changes/);
});

test('rules: deny sees through internal libraries, except and require work', () => {
  const g = scan(fx('saas'), { git: false });
  const res = checkRules(g, [
    { deny: 'kind:app -> category:database', message: 'Frontends go through the API' },
    { deny: '* -> category:ai', except: 'api' },
    { require: 'kind:service -> Sentry' },
    { require: 'kind:worker -> Sentry', message: 'Workers must report errors' },
    { deny: 'nonsense' },
  ]);
  assert.equal(res.errors.length, 1);
  const msgs = res.violations.map((v) => v.message);
  assert.ok(msgs.includes('Frontends go through the API'));
  const v = res.violations.find((x) => x.message === 'Frontends go through the API');
  assert.deepEqual(v.through, ['db']);
  assert.ok(v.evidence?.file);
  assert.ok(!msgs.some((m) => /OpenAI/.test(m)), 'api is exempt from the AI rule');
  assert.ok(msgs.includes('Workers must report errors'));
  assert.ok(!msgs.some((m) => /^api must use Sentry/.test(m)));
  assert.equal(res.ok, false);
});

test('readme: inserts, updates in place, and detects drift', () => {
  const dir = copyFixture('saas');
  try {
    const g = scan(dir, { git: false });
    fs.writeFileSync(path.join(dir, 'README.md'), '# Acme\n\nHello.\n');
    assert.equal(updateReadme(dir, g).status, 'inserted');
    const first = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
    assert.match(first, /# Acme\n\nHello\.\n\n## Architecture\n\n<!-- stackmap:start -->\n```mermaid\nflowchart LR/);
    assert.equal(updateReadme(dir, g).status, 'unchanged');
    assert.equal(updateReadme(dir, g, { check: true }).status, 'unchanged');
    fs.writeFileSync(path.join(dir, 'README.md'), first.replace('flowchart LR', 'flowchart LR\n  stale'));
    assert.equal(updateReadme(dir, g, { check: true }).status, 'updated', 'check reports drift');
    assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /stale/, 'check does not write');
    assert.equal(updateReadme(dir, g).status, 'updated');
    assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), first);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('config: custom nodes, edges, labels and hide', () => {
  const dir = copyFixture('saas');
  try {
    fs.writeFileSync(
      path.join(dir, '.stackmap.json'),
      JSON.stringify({
        labels: { web: 'Dashboard' },
        hide: ['category:observability'],
        nodes: [{ id: 'legacy-billing', name: 'Legacy billing', kind: 'external', category: 'payments' }],
        edges: [{ from: 'api', to: 'legacy-billing', label: 'SOAP' }],
      }),
    );
    const g = scan(dir, { git: false });
    assert.ok(g.nodes.find((n) => n.name === 'Dashboard'));
    assert.ok(!g.nodes.find((n) => n.name === 'Sentry'));
    const legacy = g.nodes.find((n) => n.name === 'Legacy billing');
    assert.equal(legacy.column, 'external');
    const e = g.edges.find((x) => x.to === legacy.id);
    assert.deepEqual(e.via, ['SOAP']);
    assert.equal(e.evidence[0].file, '.stackmap.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
