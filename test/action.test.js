import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../src/parse/yaml.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestText = fs.readFileSync(path.join(root, 'action.yml'), 'utf8');
const actionCode = fs.readFileSync(path.join(root, 'action', 'index.js'), 'utf8');

test('action.yml has no plain scalar that strict YAML parsers reject or truncate', () => {
  // GitHub's runner refuses the whole manifest when a plain (unquoted) value contains ": ",
  // and silently cuts a value at " #". Both must be quoted.
  const bad = [];
  manifestText.split('\n').forEach((line, i) => {
    const m = /^\s*(?:- )?[\w-]+:\s+(.*)$/.exec(line);
    if (!m) return;
    const value = m[1];
    if (/^["'|>]/.test(value) || value.startsWith('${{')) return;
    if (/: |:$| #/.test(value)) bad.push(`${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(bad, []);
});

test('action.yml declares exactly the inputs the action reads, and runs the shipped entry point', () => {
  const manifest = parseYaml(manifestText);
  assert.equal(manifest.runs.using, 'node24');
  assert.ok(fs.existsSync(path.join(root, manifest.runs.main)), `${manifest.runs.main} exists`);
  assert.ok(manifest.name && manifest.description && manifest.branding?.icon, 'Marketplace needs name, description and branding');
  const declared = Object.keys(manifest.inputs).sort();
  const read = [...new Set([...actionCode.matchAll(/\b(?:input|bool)\('([a-z-]+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(declared, read);
});
