import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, parseArgs } from '../src/cli.js';
import { createMcpHandler } from '../src/mcp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => path.join(here, 'fixtures', name);
const BIN = path.join(here, '..', 'bin', 'stackmap.js');

function capture() {
  let out = '';
  let err = '';
  return {
    io: { out: { write: (s) => (out += s), isTTY: false }, err: { write: (s) => (err += s) }, env: { CI: '1' } },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['why', 'stripe', '-f', 'json', '--libraries', '--out=x.md']), { _: ['why', 'stripe'], format: 'json', libraries: true, out: 'x.md' });
  assert.throws(() => parseArgs(['--format']), /needs a value/);
});

test('cli: mermaid to stdout', async () => {
  const c = capture();
  assert.equal(await main([fx('saas'), '-f', 'mermaid', '-q'], c.io), 0);
  assert.match(c.out, /^flowchart LR/);
});

test('cli: html to a file, no browser in CI', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackmap-cli-'));
  const out = path.join(dir, 'map.html');
  const c = capture();
  assert.equal(await main([fx('saas'), '-o', out], c.io), 0);
  assert.match(fs.readFileSync(out, 'utf8'), /<!doctype html>/);
  assert.match(c.err, /Stackmap/);
  assert.match(c.err, /api\s+→/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cli: why explains with file:line', async () => {
  const c = capture();
  assert.equal(await main(['why', 'stripe', fx('saas')], c.io), 0);
  assert.match(c.out, /Stripe/);
  assert.match(c.out, /apps\/api\/src\/server\.ts:\d+/);
  assert.match(c.out, /If Stripe is down/);
  const miss = capture();
  assert.equal(await main(['why', 'nope-not-here', fx('saas')], miss.io), 1);
});

test('cli: check exits 1 on violations and annotates in GitHub Actions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackmap-cli-'));
  fs.cpSync(fx('saas'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.stackmap.json'), JSON.stringify({ rules: [{ deny: 'kind:app -> category:database', message: 'Frontends go through the API' }] }));
  const c = capture();
  c.io.env.GITHUB_ACTIONS = 'true';
  assert.equal(await main(['check', dir], c.io), 1);
  assert.match(c.out, /::error file=apps\/web\/src\/app\/page\.tsx,line=4,title=Stackmap rule::Frontends go through the API/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cli: bad input', async () => {
  const c = capture();
  assert.equal(await main([fx('saas'), '-f', 'pdf'], c.io), 2);
  assert.equal(await main(['/definitely/not/here'], c.io), 2);
  assert.equal(await main(['--version'], c.io), 0);
});

test('cli: diff against a git ref in a real repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackmap-git-'));
  fs.cpSync(fx('saas'), dir, { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
  fs.writeFileSync(path.join(dir, 'apps/api/src/search.ts'), "import { MeiliSearch } from 'meilisearch';\nexport const m = new MeiliSearch({ host: process.env.MEILI_HOST });\n");
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'apps/api/package.json'), 'utf8'));
  pkg.dependencies.meilisearch = '^0.45.0';
  fs.writeFileSync(path.join(dir, 'apps/api/package.json'), JSON.stringify(pkg, null, 2));
  const out = execFileSync(process.execPath, [BIN, 'diff', 'HEAD', dir, '--no-color'], { encoding: 'utf8', env: { ...process.env, CI: '1' } });
  assert.match(out, /\+ Meilisearch/);
  assert.match(out, /\+ api → Meilisearch/);
  const md = execFileSync(process.execPath, [BIN, 'diff', 'HEAD', dir, '-f', 'md'], { encoding: 'utf8' });
  assert.match(md, /New data stores[\s\S]*Meilisearch/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mcp: initialize, list, call', () => {
  const handle = createMcpHandler({ root: fx('saas') });
  const init = handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'stackmap');
  assert.equal(handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const list = handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map((t) => t.name), ['stackmap_overview', 'stackmap_lookup', 'stackmap_impact', 'stackmap_diff', 'stackmap_check']);
  const overview = handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'stackmap_overview', arguments: {} } });
  assert.match(overview.result.content[0].text, /## Apps and services/);
  const lookup = handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'stackmap_lookup', arguments: { name: 'postgresql' } } });
  assert.match(lookup.result.content[0].text, /Used by:[\s\S]*db/);
  const impact = handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'stackmap_impact', arguments: { name: 'PostgreSQL' } } });
  assert.match(impact.result.content[0].text, /web[\s\S]*through db/);
  const bad = handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope' } });
  assert.equal(bad.error.code, -32602);
  assert.equal(handle({ jsonrpc: '2.0', id: 7, method: 'what' }).error.code, -32601);
});

test('mcp: stdio round trip through the real binary', async () => {
  const child = spawn(process.execPath, [BIN, 'mcp', fx('go-orders')], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'stackmap_lookup', arguments: { name: 'orders' } } })}\n`);
  child.stdin.end();
  await new Promise((r) => child.on('close', r));
  assert.equal(lines.length, 2);
  assert.match(lines[1].result.content[0].text, /# orders[\s\S]*Gin/);
});
