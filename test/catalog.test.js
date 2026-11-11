import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TECHNOLOGIES } from '../src/catalog/data.js';
import { CATEGORIES, KINDS, KIND_CATEGORIES, ROLES, ECOSYSTEMS } from '../src/catalog/categories.js';

// Entries detected only from wrangler bindings (`durable_objects`, `vectorize`), which have no
// package, image, env, host or Terraform evidence of their own.
const BINDING_ONLY = new Set(['cloudflare-durable-objects', 'cloudflare-vectorize']);

const LIST_KEYS = [...ECOSYSTEMS, 'pyModules', 'docker', 'env', 'hosts', 'terraform', 'schemes', 'files'];
const MATCH_KEYS = LIST_KEYS.filter((k) => k !== 'pyModules');
const ALLOWED_KEYS = new Set(['id', 'name', 'kind', 'category', 'url', 'sql', 'role', 'backs', ...LIST_KEYS]);
// Keys whose values may end in a `*` prefix wildcard.
const WILDCARD_KEYS = new Set([...ECOSYSTEMS.filter((e) => e !== 'go'), 'docker', 'env']);
// Keys compared case-insensitively when looking for duplicates (the registries are case-insensitive).
const CASE_INSENSITIVE = new Set(['nuget', 'pypi', 'composer', 'docker', 'hosts']);

const FORMAT = {
  npm: /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*\*?$|^@[a-z0-9][a-z0-9._~-]*\/\*$/,
  pypi: /^[a-z0-9]+(-[a-z0-9]+)*(-\*)?$/, // PEP 503 normalised
  pyModules: /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/,
  go: /^[a-z0-9.-]+\.[a-z]+(\/[A-Za-z0-9._~!-]+)*$/,
  cargo: /^[A-Za-z0-9_-]+\*?$/,
  gem: /^[A-Za-z0-9._-]+\*?$/,
  composer: /^[a-z0-9]([_.-]?[a-z0-9]+)*\/([a-z0-9]([_.-]?[a-z0-9]+)*-?)?\*?$/,
  maven: /^[A-Za-z0-9._-]+:([A-Za-z0-9._-]+|\*)$/,
  nuget: /^[A-Za-z0-9_.-]+\*?$/,
  hex: /^[a-z][a-z0-9_]*$/,
  docker: /^[a-z0-9]+([._-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)*$/,
  env: /^[A-Z][A-Z0-9_]*\*?$/,
  hosts: /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/,
  terraform: /^[a-z][a-z0-9]*_[a-z0-9_]*$/,
  schemes: /^[a-z][a-z0-9+.-]*$/,
  files: /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/,
};

const byId = new Map(TECHNOLOGIES.map((t) => [t.id, t]));

test('catalog is a non-empty array of plain objects', () => {
  assert.ok(Array.isArray(TECHNOLOGIES));
  assert.ok(TECHNOLOGIES.length > 0);
  for (const t of TECHNOLOGIES) assert.equal(Object.getPrototypeOf(t), Object.prototype);
});

test('ids are unique lowercase kebab-case', () => {
  const seen = new Set();
  for (const t of TECHNOLOGIES) {
    assert.match(t.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `bad id ${t.id}`);
    assert.ok(!seen.has(t.id), `duplicate id ${t.id}`);
    seen.add(t.id);
  }
});

test('only known keys are used and names are non-empty', () => {
  for (const t of TECHNOLOGIES) {
    for (const key of Object.keys(t)) assert.ok(ALLOWED_KEYS.has(key), `${t.id}: unknown key ${key}`);
    assert.equal(typeof t.name, 'string', `${t.id}: name`);
    assert.ok(t.name.trim().length > 0, `${t.id}: empty name`);
  }
});

test('kind and category are valid together', () => {
  for (const t of TECHNOLOGIES) {
    assert.ok(KINDS.includes(t.kind), `${t.id}: bad kind ${t.kind}`);
    assert.ok(t.category in CATEGORIES, `${t.id}: unknown category ${t.category}`);
    assert.ok(KIND_CATEGORIES[t.kind].includes(t.category), `${t.id}: category ${t.category} not allowed for kind ${t.kind}`);
  }
});

test('role is required on frameworks, optional on clients, absent elsewhere', () => {
  for (const t of TECHNOLOGIES) {
    if (t.kind === 'framework') assert.ok(ROLES.includes(t.role), `${t.id}: framework needs a role from ROLES`);
    else if (t.kind === 'client') assert.ok(t.role === undefined || ROLES.includes(t.role), `${t.id}: bad role ${t.role}`);
    else assert.equal(t.role, undefined, `${t.id}: role only on framework/client`);
  }
});

test('backs is required on clients and points at "sql" or a datastore', () => {
  for (const t of TECHNOLOGIES) {
    if (t.kind !== 'client') {
      assert.equal(t.backs, undefined, `${t.id}: backs only on clients`);
      continue;
    }
    assert.equal(typeof t.backs, 'string', `${t.id}: client needs backs`);
    if (t.backs === 'sql') continue;
    const target = byId.get(t.backs);
    assert.ok(target, `${t.id}: backs unknown id ${t.backs}`);
    assert.equal(target.kind, 'datastore', `${t.id}: backs ${t.backs} which is not a datastore`);
  }
});

test('sql flag only on datastores, and only as true', () => {
  for (const t of TECHNOLOGIES) {
    if (t.sql === undefined) continue;
    assert.equal(t.kind, 'datastore', `${t.id}: sql only on datastores`);
    assert.equal(t.sql, true, `${t.id}: sql must be true when present`);
  }
});

test('files only on platforms', () => {
  for (const t of TECHNOLOGIES) {
    if (t.files !== undefined) assert.equal(t.kind, 'platform', `${t.id}: files only on platform kind`);
  }
});

test('match lists are arrays of well-formed, unique strings', () => {
  for (const t of TECHNOLOGIES) {
    for (const key of LIST_KEYS) {
      if (t[key] === undefined) continue;
      assert.ok(Array.isArray(t[key]) && t[key].length > 0, `${t.id}.${key}: must be a non-empty array`);
      const local = new Set();
      for (const value of t[key]) {
        assert.equal(typeof value, 'string', `${t.id}.${key}: non-string value`);
        assert.equal(value, value.trim(), `${t.id}.${key}: whitespace in "${value}"`);
        assert.match(value, FORMAT[key], `${t.id}.${key}: malformed "${value}"`);
        assert.ok(!local.has(value), `${t.id}.${key}: "${value}" listed twice`);
        local.add(value);
      }
    }
  }
});

test('wildcards are a single trailing * and only where supported', () => {
  for (const t of TECHNOLOGIES) {
    for (const key of LIST_KEYS) {
      for (const value of t[key] ?? []) {
        if (!value.includes('*')) continue;
        assert.ok(WILDCARD_KEYS.has(key), `${t.id}.${key}: wildcards not supported ("${value}")`);
        assert.ok(value.indexOf('*') === value.length - 1, `${t.id}.${key}: * must be trailing ("${value}")`);
        assert.ok(value.length > 1 && !value.endsWith('**'), `${t.id}.${key}: bare wildcard ("${value}")`);
      }
    }
  }
});

test('no exact name is claimed by two entries within a key', () => {
  for (const key of LIST_KEYS) {
    const owner = new Map();
    for (const t of TECHNOLOGIES) {
      for (const raw of t[key] ?? []) {
        const value = CASE_INSENSITIVE.has(key) ? raw.toLowerCase() : raw;
        const prev = owner.get(value);
        assert.ok(prev === undefined || prev === t.id, `${key} "${raw}" is on both ${prev} and ${t.id}`);
        owner.set(value, t.id);
      }
    }
  }
});

test('docker images carry no registry host or tag', () => {
  for (const t of TECHNOLOGIES) {
    for (const image of t.docker ?? []) {
      const first = image.split('/')[0];
      assert.ok(!first.includes('.') && !first.includes(':'), `${t.id}: strip the registry from "${image}"`);
      assert.ok(!image.includes(':') && !image.includes('@'), `${t.id}: no tag/digest in "${image}"`);
    }
  }
});

test('every entry has at least one match key (except binding-only Cloudflare products)', () => {
  for (const t of TECHNOLOGIES) {
    const has = MATCH_KEYS.some((k) => Array.isArray(t[k]) && t[k].length > 0);
    if (BINDING_ONLY.has(t.id)) continue;
    assert.ok(has, `${t.id}: no match keys`);
  }
  for (const id of BINDING_ONLY) assert.ok(byId.has(id), `binding-only id ${id} missing from catalog`);
});

test('pyModules only accompany pypi names', () => {
  for (const t of TECHNOLOGIES) {
    if (t.pyModules) assert.ok(t.pypi?.length, `${t.id}: pyModules without pypi`);
  }
});

test('urls are https', () => {
  for (const t of TECHNOLOGIES) {
    assert.equal(typeof t.url, 'string', `${t.id}: url missing`);
    const url = new URL(t.url);
    assert.equal(url.protocol, 'https:', `${t.id}: url must be https`);
  }
});
