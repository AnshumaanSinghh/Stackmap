import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToml, TomlError } from '../src/parse/toml.js';
import { lineOf } from '../src/parse/lines.js';

/** Drop the newline after the opening backtick so the fixture's first line is line 1. */
const fixture = (s) => s.replace(/^\n/, '');

/** 1-based number of the first line at or after `from` that contains `needle`. */
function findLine(text, needle, from = 1) {
  const lines = text.split('\n');
  for (let i = from - 1; i < lines.length; i++) if (lines[i].includes(needle)) return i + 1;
  throw new Error(`fixture has no line containing ${JSON.stringify(needle)}`);
}

/** Assert that parsing throws a TomlError reported on `line`. */
function assertTomlError(text, line, pattern) {
  assert.throws(
    () => parseToml(text),
    (err) => {
      assert.ok(err instanceof TomlError, `expected TomlError, got ${err}`);
      assert.equal(err.line, line, `wrong line in: ${err.message}`);
      if (pattern) assert.match(err.message, pattern);
      return true;
    },
  );
}

describe('keys and comments', () => {
  test('bare, quoted and dotted keys', () => {
    const text = fixture(`
# a comment
bare_key = 1
bare-key = 2
1234 = 3
"quoted key" = 4
'literal "key"' = 5
"" = 6
site."google.com" = true
a . b . c = 7   # whitespace around dots
`);
    assert.deepEqual(parseToml(text), {
      bare_key: 1,
      'bare-key': 2,
      1234: 3,
      'quoted key': 4,
      'literal "key"': 5,
      '': 6,
      site: { 'google.com': true },
      a: { b: { c: 7 } },
    });
  });

  test('# inside strings is not a comment', () => {
    assert.deepEqual(parseToml('a = "x # y" # real comment\nb = \'#\''), { a: 'x # y', b: '#' });
  });

  test('lines of keys, including each part of a dotted key', () => {
    const v = parseToml('a = 1\n\nb.c = 2\nb.d = 3\n');
    assert.equal(lineOf(v, 'a'), 1);
    assert.equal(lineOf(v, 'b'), 3); // where b was first created
    assert.equal(lineOf(v.b, 'c'), 3);
    assert.equal(lineOf(v.b, 'd'), 4);
  });
});

describe('tables', () => {
  test('[table], nested and quoted header keys', () => {
    const text = fixture(`
[server]
host = "localhost"

[a.b."c d"]
x = 1

[ dog . "tater.man" ]
type = "pug"
`);
    const v = parseToml(text);
    assert.deepEqual(v, {
      server: { host: 'localhost' },
      a: { b: { 'c d': { x: 1 } } },
      dog: { 'tater.man': { type: 'pug' } },
    });
    assert.equal(lineOf(v, 'server'), 1);
    assert.equal(lineOf(v.server, 'host'), 2);
    assert.equal(lineOf(v.a.b, 'c d'), 4);
    assert.equal(lineOf(v.a.b['c d'], 'x'), 5);
    assert.equal(lineOf(v.dog, 'tater.man'), 7);
  });

  test('an implicitly created table can get its own header later', () => {
    const v = parseToml('[x.y.z]\nk = 1\n\n[x]\nm = 2');
    assert.deepEqual(v, { x: { y: { z: { k: 1 } }, m: 2 } });
    assert.equal(lineOf(v, 'x'), 4); // the explicit [x] header
    assert.equal(lineOf(v.x, 'y'), 1);
  });

  test('sub-tables of a table defined with dotted keys', () => {
    const v = parseToml('[fruit]\napple.color = "red"\n\n[fruit.apple.texture]\nsmooth = true');
    assert.deepEqual(v, { fruit: { apple: { color: 'red', texture: { smooth: true } } } });
  });

  test('[[array.of.tables]] with sub-tables', () => {
    const text = fixture(`
[[products]]
name = "Hammer"

[[products]]

[[products]]
name = "Nail"
[products.dimensions]
size = 2
[[products.variants]]
color = "grey"
`);
    const v = parseToml(text);
    assert.deepEqual(v, {
      products: [
        { name: 'Hammer' },
        {},
        { name: 'Nail', dimensions: { size: 2 }, variants: [{ color: 'grey' }] },
      ],
    });
    assert.equal(lineOf(v, 'products'), 1);
    assert.equal(lineOf(v.products, 0), 1);
    assert.equal(lineOf(v.products, 1), 4);
    assert.equal(lineOf(v.products, 2), 6);
    assert.equal(lineOf(v.products[2], 'dimensions'), 8);
    assert.equal(lineOf(v.products[2].variants, 0), 10);
  });
});

describe('strings', () => {
  test('basic strings and escapes', () => {
    const v = parseToml(String.raw`s = "tab\there \"quoted\" back\\slash \u00e9 \U0001F600 \n end"`);
    assert.equal(v.s, 'tab\there "quoted" back\\slash é 😀 \n end');
  });

  test('literal strings keep backslashes', () => {
    assert.equal(parseToml(String.raw`p = 'C:\Users\nodejs\templates'`).p, String.raw`C:\Users\nodejs\templates`);
  });

  test('multi-line basic strings: first newline trimmed, line-ending backslash', () => {
    const text = 'a = """\nRoses are red\nViolets are blue"""\nb = """\\\n    The quick \\\n    brown fox.\\\n    """\nc = 1';
    const v = parseToml(text);
    assert.equal(v.a, 'Roses are red\nViolets are blue');
    assert.equal(v.b, 'The quick brown fox.');
    assert.equal(lineOf(v, 'c'), 8); // line counting continues through multi-line strings
  });

  test('multi-line literal strings and quotes next to the delimiters', () => {
    const v = parseToml("re = '''\n\\d{2} apps\n'''\nq = \"\"\"say \"hi\"\"\"\"\nl = '''it''s'''");
    assert.equal(v.re, '\\d{2} apps\n');
    assert.equal(v.q, 'say "hi"');
    assert.equal(v.l, "it''s");
  });
});

describe('numbers, booleans and dates', () => {
  test('integers', () => {
    assert.deepEqual(parseToml('a = +99\nb = 42\nc = 0\nd = -17\ne = 1_000\nf = 5_349_221\ng = 0xDEAD_beef\nh = 0o755\ni = 0b1101'), {
      a: 99, b: 42, c: 0, d: -17, e: 1000, f: 5349221, g: 0xdeadbeef, h: 0o755, i: 13,
    });
  });

  test('integers too large for a JS number are kept as written', () => {
    assert.equal(parseToml('big = 9_223_372_036_854_775_807').big, '9_223_372_036_854_775_807');
  });

  test('floats, exponents, inf and nan', () => {
    const v = parseToml('a = +1.0\nb = 3.1415\nc = -0.01\nd = 5e+22\ne = 1e06\nf = -2E-2\ng = 6.626e-34\nh = 224_617.445_991\ni = inf\nj = -inf\nk = nan\nl = +nan');
    assert.equal(v.a, 1);
    assert.equal(v.b, 3.1415);
    assert.equal(v.c, -0.01);
    assert.equal(v.d, 5e22);
    assert.equal(v.e, 1e6);
    assert.equal(v.f, -0.02);
    assert.equal(v.g, 6.626e-34);
    assert.equal(v.h, 224617.445991);
    assert.equal(v.i, Infinity);
    assert.equal(v.j, -Infinity);
    assert.ok(Number.isNaN(v.k) && Number.isNaN(v.l));
  });

  test('booleans', () => {
    assert.deepEqual(parseToml('t = true\nf = false'), { t: true, f: false });
  });

  test('dates and times are kept as their original strings', () => {
    const text = 'odt1 = 1979-05-27T07:32:00Z\nodt2 = 1979-05-27T00:32:00.999999-07:00\nodt3 = 1979-05-27 07:32:00Z\nldt = 1979-05-27T07:32:00\nld = 1979-05-27 # comment\nlt = 07:32:00.5';
    assert.deepEqual(parseToml(text), {
      odt1: '1979-05-27T07:32:00Z',
      odt2: '1979-05-27T00:32:00.999999-07:00',
      odt3: '1979-05-27 07:32:00Z',
      ldt: '1979-05-27T07:32:00',
      ld: '1979-05-27',
      lt: '07:32:00.5',
    });
  });
});

describe('arrays and inline tables', () => {
  test('multi-line arrays with comments, trailing commas, nesting and mixed types', () => {
    const text = fixture(`
deps = [
  "fastapi>=0.110",  # web
  # a comment line
  "pydantic",
]
mixed = [1, "two", 3.0, [4, [5]], { six = 6 }, true]
empty = [ ]
`);
    const v = parseToml(text);
    assert.deepEqual(v, {
      deps: ['fastapi>=0.110', 'pydantic'],
      mixed: [1, 'two', 3, [4, [5]], { six: 6 }, true],
      empty: [],
    });
    assert.equal(lineOf(v.deps, 0), 2);
    assert.equal(lineOf(v.deps, 1), 4);
    assert.equal(lineOf(v, 'mixed'), 6);
  });

  test('inline tables, with dotted keys and nesting', () => {
    const v = parseToml('point = { x = 1, y = 2 }\nanimal = { type.name = "pug", tags = ["a"], owner = { name = "x" } }\nempty = {}');
    assert.deepEqual(v, {
      point: { x: 1, y: 2 },
      animal: { type: { name: 'pug' }, tags: ['a'], owner: { name: 'x' } },
      empty: {},
    });
    assert.equal(lineOf(v.point, 'y'), 1);
    assert.equal(lineOf(v.animal.type, 'name'), 2);
  });

  test('inline tables cannot be extended afterwards', () => {
    assertTomlError('a = { b = 1 }\na.c = 2', 2, /already defined/);
    assertTomlError('a = { b = 1 }\n[a.c]', 2, /not a table/);
    assertTomlError('a = { b = 1 }\n[a]', 2, /inline table/);
  });
});

describe('redefinitions and malformed input', () => {
  test('duplicate keys', () => {
    assertTomlError('name = "a"\nname = "b"', 2, /duplicate key "name"/);
    assertTomlError('[t]\nx = 1\n\nx = 2', 4, /duplicate key "x"/);
    assertTomlError('a.b = 1\na = 2', 2, /duplicate key "a"/);
    assertTomlError('a = 1\na.b = 2', 2, /cannot add keys to "a"/);
    assertTomlError('p = { x = 1, x = 2 }', 1, /duplicate key "x"/);
  });

  test('tables defined twice', () => {
    assertTomlError('[a]\nx = 1\n[b]\n[a]', 4, /defined more than once/);
    assertTomlError('[a]\nb.c = 1\n[a.b]', 3, /dotted keys/);
    assertTomlError('[a]\nb = 1\n[a.b]', 3, /already defined as a value/);
  });

  test('arrays of tables mixed with tables or static arrays', () => {
    assertTomlError('[[a]]\n[a]', 2, /array of tables/);
    assertTomlError('[a]\n[[a]]', 2, /conflicts/);
    assertTomlError('a = [1]\n[[a]]', 2, /cannot append/);
  });

  test('invalid values', () => {
    assertTomlError('a = 1\nb = 01', 2, /invalid value "01"/);
    assertTomlError('x = 1__0', 1, /invalid value/);
    assertTomlError('x = True', 1, /invalid value "True"/);
    assertTomlError('x = .5', 1, /invalid value/);
    assertTomlError('x = ', 1, /expected a value/);
    assertTomlError('x = bare', 1, /invalid value "bare"/);
  });

  test('unterminated strings, arrays and inline tables report where they start', () => {
    assertTomlError('a = 1\nb = "no end\nc = 2', 2, /unterminated string/);
    assertTomlError('a = """\nnever\nclosed', 1, /unterminated multi-line string/);
    assertTomlError('a = 1\nb = [\n  1,\n  2,\n', 2, /unterminated array/);
    assertTomlError('a = { x = 1', 1, /unterminated inline table/);
  });

  test('syntax errors', () => {
    assertTomlError('key value', 1, /expected "="/);
    assertTomlError('a = 1 b = 2', 1, /end of the line/);
    assertTomlError('[a\nx = 1', 1, /close the table header/);
    assertTomlError('[a]]\n', 1, /end of the line/);
    assertTomlError('s = "\\q"', 1, /invalid escape/);
    assertTomlError('arr = [1 2]', 1, /expected "," or "\]"/);
    assertTomlError('= 1', 1, /expected a key/);
  });

  test('TomlError is an Error with the line in its message', () => {
    try {
      parseToml('ok = 1\nbad');
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.equal(err.name, 'TomlError');
      assert.equal(err.line, 2);
      assert.match(err.message, /\(line 2\)$/);
    }
  });
});

describe('input handling', () => {
  test('Windows line endings and a byte order mark', () => {
    const v = parseToml('\ufeff[a]\r\nx = 1\r\ns = """\r\none\r\ntwo"""\r\ny = 2\r\n');
    assert.deepEqual(v, { a: { x: 1, s: 'one\ntwo', y: 2 } });
    assert.equal(lineOf(v.a, 'y'), 6);
  });

  test('empty input and comment-only input', () => {
    assert.deepEqual(parseToml(''), {});
    assert.deepEqual(parseToml('# nothing here\n\n'), {});
  });

  test('__proto__ is an ordinary key', () => {
    const v = parseToml('__proto__ = { polluted = true }\n[x]\n__proto__.y = 1');
    assert.deepEqual(Object.keys(v), ['__proto__', 'x']);
    assert.equal(Object.getPrototypeOf(v), Object.prototype);
    assert.equal({}.polluted, undefined);
  });
});

describe('real-world files', () => {
  test('pyproject.toml: PEP 621, optional dependencies and Poetry', () => {
    const text = fixture(`
[build-system]
requires = ["hatchling>=1.18"]
build-backend = "hatchling.build"

[project]
name = "acme-api"
version = "0.4.0"
requires-python = ">=3.10"
dependencies = [
    "fastapi[standard]>=0.110,<1.0",
    "sqlalchemy>=2.0",
    "redis>=5",   # cache
    "stripe",
]

[project.optional-dependencies]
dev = ["pytest>=8", "ruff"]
s3 = ["boto3>=1.34"]

[project.scripts]
acme = "acme.cli:main"

[tool.poetry.dependencies]
python = "^3.11"
celery = { version = "^5.3", extras = ["redis"] }
pkg = { version = "^1", extras = ["x"] }
psycopg = {extras = ["binary"], version = "^3.1"}
internal-lib = { path = "../lib", develop = true }

[tool.poetry.group.dev.dependencies]
mypy = "^1.8"

[tool.ruff.lint.per-file-ignores]
"__init__.py" = ["F401"]

[tool.pytest.ini_options]
addopts = "-ra -q"
markers = [
  "slow: marks tests as slow",
]
`);
    const v = parseToml(text);
    assert.deepEqual(v['build-system'].requires, ['hatchling>=1.18']);
    assert.equal(v.project.name, 'acme-api');
    assert.deepEqual(v.project.dependencies, ['fastapi[standard]>=0.110,<1.0', 'sqlalchemy>=2.0', 'redis>=5', 'stripe']);
    assert.deepEqual(v.project['optional-dependencies'], { dev: ['pytest>=8', 'ruff'], s3: ['boto3>=1.34'] });
    assert.equal(v.project.scripts.acme, 'acme.cli:main');

    const poetry = v.tool.poetry.dependencies;
    assert.equal(poetry.python, '^3.11');
    assert.deepEqual(poetry.celery, { version: '^5.3', extras: ['redis'] });
    assert.deepEqual(poetry.pkg, { version: '^1', extras: ['x'] });
    assert.deepEqual(poetry.psycopg, { extras: ['binary'], version: '^3.1' });
    assert.deepEqual(poetry['internal-lib'], { path: '../lib', develop: true });
    assert.deepEqual(v.tool.poetry.group.dev.dependencies, { mypy: '^1.8' });
    assert.deepEqual(v.tool.ruff.lint['per-file-ignores'], { '__init__.py': ['F401'] });
    assert.deepEqual(v.tool.pytest.ini_options.markers, ['slow: marks tests as slow']);

    assert.equal(lineOf(v, 'project'), findLine(text, '[project]'));
    assert.equal(lineOf(v.project, 'dependencies'), findLine(text, 'dependencies = ['));
    assert.equal(lineOf(v.project.dependencies, 2), findLine(text, '"redis>=5"'));
    assert.equal(lineOf(v.project, 'optional-dependencies'), findLine(text, '[project.optional-dependencies]'));
    assert.equal(lineOf(v.project['optional-dependencies'], 's3'), findLine(text, 's3 = '));
    assert.equal(lineOf(v, 'tool'), findLine(text, '[tool.poetry.dependencies]'));
    assert.equal(lineOf(v.tool.poetry, 'dependencies'), findLine(text, '[tool.poetry.dependencies]'));
    assert.equal(lineOf(poetry, 'pkg'), findLine(text, 'pkg = {'));
    assert.equal(lineOf(poetry.pkg, 'extras'), findLine(text, 'pkg = {'));
  });

  test('Cargo.toml: workspace, inline-table deps, [dependencies.x] and target deps', () => {
    const text = fixture(`
[workspace]
members = [
  "crates/core",
  "crates/cli",
]
resolver = "2"

[package]
name = "acme"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { version = "1.36", features = ["full"] }
sqlx = { version = "0.7", default-features = false, features = ["postgres", "runtime-tokio"] }
anyhow = "1"
acme-core = { path = "crates/core" }

[dependencies.serde]
version = "1.0"
features = ["derive"]

[dev-dependencies]
insta = "1"

[target.'cfg(unix)'.dependencies]
nix = "0.28"

[target."cfg(windows)".dependencies]
windows-sys = { version = "0.52" }

[[bin]]
name = "acme"
path = "src/main.rs"

[profile.release]
lto = true
opt-level = 3
`);
    const v = parseToml(text);
    assert.deepEqual(v.workspace, { members: ['crates/core', 'crates/cli'], resolver: '2' });
    assert.deepEqual(v.dependencies.tokio, { version: '1.36', features: ['full'] });
    assert.equal(v.dependencies.sqlx['default-features'], false);
    assert.equal(v.dependencies.anyhow, '1');
    assert.deepEqual(v.dependencies.serde, { version: '1.0', features: ['derive'] });
    assert.deepEqual(v.target['cfg(unix)'].dependencies, { nix: '0.28' });
    assert.deepEqual(v.target['cfg(windows)'].dependencies, { 'windows-sys': { version: '0.52' } });
    assert.deepEqual(v.bin, [{ name: 'acme', path: 'src/main.rs' }]);
    assert.deepEqual(v.profile.release, { lto: true, 'opt-level': 3 });

    assert.equal(lineOf(v.workspace.members, 1), findLine(text, '"crates/cli"'));
    assert.equal(lineOf(v.dependencies, 'tokio'), findLine(text, 'tokio = '));
    assert.equal(lineOf(v.dependencies, 'serde'), findLine(text, '[dependencies.serde]'));
    assert.equal(lineOf(v.dependencies.serde, 'features'), findLine(text, 'features = ["derive"]'));
    assert.equal(lineOf(v.target['cfg(unix)'], 'dependencies'), findLine(text, "[target.'cfg(unix)'"));
    assert.equal(lineOf(v.target['cfg(unix)'].dependencies, 'nix'), findLine(text, 'nix = '));
    assert.equal(lineOf(v.bin, 0), findLine(text, '[[bin]]'));
  });

  test('wrangler.toml: KV, D1, R2 and queue bindings', () => {
    const text = fixture(`
name = "edge-api"
main = "src/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[vars]
ENVIRONMENT = "production"

[[kv_namespaces]]
binding = "CACHE"
id = "0f2ac74b498b48028cb68387c421e279"

[[kv_namespaces]]
binding = "SESSIONS"
id = "a1b2c3"

[[d1_databases]]
binding = "DB"
database_name = "prod-db"
database_id = "c020574a-5623-407b-be0c-cd192bab9545"

[[r2_buckets]]
binding = "UPLOADS"
bucket_name = "user-uploads"

[[queues.producers]]
queue = "emails"
binding = "EMAIL_QUEUE"

[[queues.consumers]]
queue = "emails"
max_batch_size = 10

[durable_objects]
bindings = [{ name = "ROOMS", class_name = "ChatRoom" }]

[triggers]
crons = ["*/5 * * * *"]

[env.staging]
name = "edge-api-staging"
[[env.staging.kv_namespaces]]
binding = "CACHE"
id = "staging"
`);
    const v = parseToml(text);
    assert.equal(v.compatibility_date, '2024-09-23');
    assert.deepEqual(v.kv_namespaces.map((k) => k.binding), ['CACHE', 'SESSIONS']);
    assert.deepEqual(v.d1_databases, [{ binding: 'DB', database_name: 'prod-db', database_id: 'c020574a-5623-407b-be0c-cd192bab9545' }]);
    assert.deepEqual(v.r2_buckets, [{ binding: 'UPLOADS', bucket_name: 'user-uploads' }]);
    assert.deepEqual(v.queues, {
      producers: [{ queue: 'emails', binding: 'EMAIL_QUEUE' }],
      consumers: [{ queue: 'emails', max_batch_size: 10 }],
    });
    assert.deepEqual(v.durable_objects.bindings, [{ name: 'ROOMS', class_name: 'ChatRoom' }]);
    assert.deepEqual(v.triggers.crons, ['*/5 * * * *']);
    assert.deepEqual(v.env.staging, { name: 'edge-api-staging', kv_namespaces: [{ binding: 'CACHE', id: 'staging' }] });

    assert.equal(lineOf(v, 'kv_namespaces'), findLine(text, '[[kv_namespaces]]'));
    assert.equal(lineOf(v.kv_namespaces, 1), findLine(text, '[[kv_namespaces]]', findLine(text, 'binding = "CACHE"')));
    assert.equal(lineOf(v.kv_namespaces[1], 'binding'), findLine(text, 'binding = "SESSIONS"'));
    assert.equal(lineOf(v.d1_databases, 0), findLine(text, '[[d1_databases]]'));
    assert.equal(lineOf(v.d1_databases[0], 'database_name'), findLine(text, 'database_name'));
    assert.equal(lineOf(v.r2_buckets, 0), findLine(text, '[[r2_buckets]]'));
    assert.equal(lineOf(v, 'queues'), findLine(text, '[[queues.producers]]'));
    assert.equal(lineOf(v.queues.producers, 0), findLine(text, '[[queues.producers]]'));
    assert.equal(lineOf(v.queues.producers[0], 'binding'), findLine(text, 'binding = "EMAIL_QUEUE"'));
    assert.equal(lineOf(v.durable_objects.bindings[0], 'class_name'), findLine(text, 'class_name'));
  });

  test('fly.toml', () => {
    const text = fixture(`
app = 'acme-web'
primary_region = 'iad'

[build]
  dockerfile = 'Dockerfile'

[env]
  PORT = '8080'
  NODE_ENV = 'production'

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'stop'
  min_machines_running = 0
  processes = ['app']

  [[http_service.checks]]
    grace_period = "10s"
    interval = "30s"
    method = "GET"
    path = "/health"

[[mounts]]
  source = 'data'
  destination = '/data'

[[vm]]
  memory = '1gb'
  cpu_kind = 'shared'
  cpus = 1
`);
    const v = parseToml(text);
    assert.equal(v.app, 'acme-web');
    assert.deepEqual(v.env, { PORT: '8080', NODE_ENV: 'production' });
    assert.equal(v.http_service.internal_port, 8080);
    assert.equal(v.http_service.force_https, true);
    assert.deepEqual(v.http_service.processes, ['app']);
    assert.deepEqual(v.http_service.checks, [{ grace_period: '10s', interval: '30s', method: 'GET', path: '/health' }]);
    assert.deepEqual(v.mounts, [{ source: 'data', destination: '/data' }]);
    assert.deepEqual(v.vm, [{ memory: '1gb', cpu_kind: 'shared', cpus: 1 }]);
    assert.equal(lineOf(v.http_service, 'internal_port'), findLine(text, 'internal_port'));
    assert.equal(lineOf(v.http_service.checks, 0), findLine(text, '[[http_service.checks]]'));
    assert.equal(lineOf(v.mounts[0], 'destination'), findLine(text, 'destination'));
  });

  test('netlify.toml', () => {
    const text = fixture(`
[build]
  command = "npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "20"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"

[[plugins]]
  package = "@netlify/plugin-nextjs"

[context.production.environment]
  API_URL = "https://api.example.com"
`);
    const v = parseToml(text);
    assert.deepEqual(v.build, { command: 'npm run build', publish: 'dist', environment: { NODE_VERSION: '20' } });
    assert.deepEqual(v.redirects, [{ from: '/api/*', to: '/.netlify/functions/:splat', status: 200 }]);
    assert.deepEqual(v.headers, [{ for: '/*', values: { 'X-Frame-Options': 'DENY' } }]);
    assert.equal(v.plugins[0].package, '@netlify/plugin-nextjs');
    assert.equal(v.context.production.environment.API_URL, 'https://api.example.com');
    assert.equal(lineOf(v.headers[0], 'values'), findLine(text, '[headers.values]'));
    assert.equal(lineOf(v.plugins, 0), findLine(text, '[[plugins]]'));
  });
});
