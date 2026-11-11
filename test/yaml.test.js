import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, parseYamlAll, YamlError } from '../src/parse/yaml.js';
import { lineOf } from '../src/parse/lines.js';

/** Drop the newline after the opening backtick so the fixture's first line is line 1. */
const fixture = (s) => s.replace(/^\n/, '');

/** 1-based number of the first line at or after `from` that contains `needle`. */
function findLine(text, needle, from = 1) {
  const lines = text.split('\n');
  for (let i = from - 1; i < lines.length; i++) if (lines[i].includes(needle)) return i + 1;
  throw new Error(`fixture has no line containing ${JSON.stringify(needle)}`);
}

/** Assert that parsing throws a YamlError reported on `line`. */
function assertYamlError(text, line, pattern) {
  assert.throws(
    () => parseYaml(text),
    (err) => {
      assert.ok(err instanceof YamlError, `expected YamlError, got ${err}`);
      assert.equal(err.line, line, `wrong line in: ${err.message}`);
      if (pattern) assert.match(err.message, pattern);
      return true;
    },
  );
}

describe('scalars', () => {
  test('plain strings keep inner spaces and lose trailing ones', () => {
    assert.deepEqual(parseYaml('a: hello world   \nb: x'), { a: 'hello world', b: 'x' });
  });

  test('null: null, Null, NULL, ~ and empty values', () => {
    assert.deepEqual(parseYaml('a: null\nb: Null\nc: NULL\nd: ~\ne:\nf: ""'), {
      a: null, b: null, c: null, d: null, e: null, f: '',
    });
  });

  test('only true/false are booleans; yes/no/on/off stay strings (YAML 1.2)', () => {
    const v = parseYaml('a: true\nb: True\nc: TRUE\nd: false\ne: False\nf: FALSE\ng: yes\nh: no\ni: on\nj: off\nk: y\nl: n');
    assert.deepEqual(v, {
      a: true, b: true, c: true, d: false, e: false, f: false,
      g: 'yes', h: 'no', i: 'on', j: 'off', k: 'y', l: 'n',
    });
  });

  test('integers: decimal, signed, hex and octal', () => {
    assert.deepEqual(parseYaml('a: 0\nb: 12\nc: -3\nd: +7\ne: 0x1F\nf: 0o17'), { a: 0, b: 12, c: -3, d: 7, e: 31, f: 15 });
  });

  test('floats, including exponents, .inf and .nan', () => {
    const v = parseYaml('a: 1.5\nb: -2.5e3\nc: 1e3\nd: .5\ne: .inf\nf: -.Inf\ng: +.INF\nh: .nan\ni: 3.10');
    assert.equal(v.a, 1.5);
    assert.equal(v.b, -2500);
    assert.equal(v.c, 1000);
    assert.equal(v.d, 0.5);
    assert.equal(v.e, Infinity);
    assert.equal(v.f, -Infinity);
    assert.equal(v.g, Infinity);
    assert.ok(Number.isNaN(v.h));
    assert.equal(v.i, 3.1); // core schema: an unquoted 3.10 is a float
  });

  test('things that only look like numbers stay strings', () => {
    const v = parseYaml('a: 1.2.3\nb: 08\nc: 0755\nd: 5432:5432\ne: 1_000\nf: 12345678901234567890\ng: 0x\nh: -x\ni: 1.0.0-beta');
    assert.deepEqual(v, {
      a: '1.2.3', b: '08', c: '0755', d: '5432:5432', e: '1_000',
      f: '12345678901234567890', // too big to be exact as a number
      g: '0x', h: '-x', i: '1.0.0-beta',
    });
  });

  test("single-quoted: '' is a quote, nothing else is special", () => {
    assert.deepEqual(parseYaml("a: 'it''s'\nb: '# not a comment'\nc: ''\nd: 'C:\\temp\\n'"), {
      a: "it's", b: '# not a comment', c: '', d: 'C:\\temp\\n',
    });
  });

  test('double-quoted escapes', () => {
    const v = parseYaml(String.raw`a: "line\nnext\ttab \"q\" back\\slash \u00e9 \x41 \U0001F600 \/"`);
    assert.equal(v.a, 'line\nnext\ttab "q" back\\slash é A 😀 /');
  });

  test('an unknown escape in double quotes is kept as written (e.g. Windows paths)', () => {
    assert.equal(parseYaml(String.raw`p: "C:\path\dir"`).p, String.raw`C:\path\dir`);
  });

  test('multi-line plain scalars fold into one line', () => {
    const text = fixture(`
description: This is
  a long

  description
next: 1
`);
    assert.deepEqual(parseYaml(text), { description: 'This is a long\ndescription', next: 1 });
  });

  test('multi-line plain scalars in sequence items and compact mappings', () => {
    const text = fixture(`
- npm ci
  --prefer-offline
- run: echo one
    two
  name: step
`);
    assert.deepEqual(parseYaml(text), ['npm ci --prefer-offline', { run: 'echo one two', name: 'step' }]);
  });

  test('multi-line quoted scalars fold; an escaped line break joins without a space', () => {
    assert.equal(parseYaml('a: "one\n  two\n\n  three"').a, 'one two\nthree');
    assert.equal(parseYaml("a: 'one\n  two'").a, 'one two');
    assert.equal(parseYaml('a: "abc\\\n     def"').a, 'abcdef');
  });

  test('non-breaking spaces are content, not trimmed whitespace', () => {
    assert.equal(parseYaml('a: Suggestions\u00a0').a, 'Suggestions\u00a0');
  });
});

describe('keys', () => {
  test('quoted keys', () => {
    assert.deepEqual(parseYaml(`"a key": 1\n'b: c': 2\n"8080:80": 3\n"esc\\"aped": 4`), {
      'a key': 1, 'b: c': 2, '8080:80': 3, 'esc"aped': 4,
    });
  });

  test('keys with spaces, dots, slashes; values with colons that are not followed by a space', () => {
    const text = fixture(`
key with spaces: 1
traefik.http.routers.x.rule: Host(\`a.example.com\`) && PathPrefix(\`/api\`)
nginx.ingress.kubernetes.io/rewrite-target: /$1
image: postgres:16-alpine
url: http://user:pass@db:5432/app
ports: 127.0.0.1:8080:80
C#: language
`);
    assert.deepEqual(parseYaml(text), {
      'key with spaces': 1,
      'traefik.http.routers.x.rule': 'Host(`a.example.com`) && PathPrefix(`/api`)',
      'nginx.ingress.kubernetes.io/rewrite-target': '/$1',
      image: 'postgres:16-alpine',
      url: 'http://user:pass@db:5432/app',
      ports: '127.0.0.1:8080:80',
      'C#': 'language',
    });
  });

  test('plain keys are kept as written (on, 1, true are strings)', () => {
    assert.deepEqual(Object.keys(parseYaml('on: push\n1: a\ntrue: b\n~: c')), ['1', 'on', 'true', '~']);
  });

  test('a later duplicate key wins', () => {
    const v = parseYaml('a: 1\nb: 2\na: 3');
    assert.deepEqual(v, { a: 3, b: 2 });
    assert.equal(lineOf(v, 'a'), 3);
  });

  test('__proto__ is an ordinary key', () => {
    const v = parseYaml('__proto__: {polluted: true}\nx: 1');
    assert.deepEqual(Object.keys(v), ['__proto__', 'x']);
    assert.equal(Object.getPrototypeOf(v), Object.prototype);
    assert.equal({}.polluted, undefined);
  });
});

describe('comments', () => {
  test('full-line, indented and trailing comments are ignored', () => {
    const text = fixture(`
# top comment
a: 1 # trailing
  # indented comment
b:
  # inside a mapping
  c: 2   # after spaces
list:
  - x # item comment
  # between items
  - y
`);
    assert.deepEqual(parseYaml(text), { a: 1, b: { c: 2 }, list: ['x', 'y'] });
  });

  test('# inside quotes, in URLs, and without a space before it is not a comment', () => {
    const v = parseYaml('a: "x # y"\nb: \'p # q\'\nc: http://host/page#anchor\nd: a#b\ne: a #b');
    assert.deepEqual(v, { a: 'x # y', b: 'p # q', c: 'http://host/page#anchor', d: 'a#b', e: 'a' });
  });

  test('a comment after a block scalar header or a flow collection', () => {
    assert.deepEqual(parseYaml('a: | # note\n  text\nb: [1, 2] # note\nc: {x: 1} # note'), {
      a: 'text\n', b: [1, 2], c: { x: 1 },
    });
  });
});

describe('block collections', () => {
  test('arbitrary indentation widths', () => {
    const text = fixture(`
a:
    b:
       c: 1
       d: 2
    e:
     - 1
     - 2
f: 3
`);
    assert.deepEqual(parseYaml(text), { a: { b: { c: 1, d: 2 }, e: [1, 2] }, f: 3 });
  });

  test('sequences of mappings, compact and indented forms', () => {
    const text = fixture(`
compact:
  - name: a
    value: 1
  -   name: b
      value: 2
indented:
  -
    name: c
    value: 3
  - # comment
    name: d
`);
    assert.deepEqual(parseYaml(text), {
      compact: [{ name: 'a', value: 1 }, { name: 'b', value: 2 }],
      indented: [{ name: 'c', value: 3 }, { name: 'd' }],
    });
  });

  test('a sequence at the same indentation as its key', () => {
    const text = fixture(`
steps:
- uses: actions/checkout@v4
- name: build
  with:
    args:
    - one
    - two
  env: {}
after: true
`);
    assert.deepEqual(parseYaml(text), {
      steps: [{ uses: 'actions/checkout@v4' }, { name: 'build', with: { args: ['one', 'two'] }, env: {} }],
      after: true,
    });
  });

  test('nested sequences on one line', () => {
    assert.deepEqual(parseYaml('- - a\n  - b\n- - - c\n-\n- d'), [['a', 'b'], [['c']], null, 'd']);
  });

  test('empty values are null', () => {
    assert.deepEqual(parseYaml('a:\nb:\n  c:\nd: 1'), { a: null, b: { c: null }, d: 1 });
  });

  test('a root sequence and a root scalar', () => {
    assert.deepEqual(parseYaml('- 1\n- two'), [1, 'two']);
    assert.equal(parseYaml('just text'), 'just text');
    assert.equal(parseYaml('42'), 42);
  });

  test('lines of mapping keys and sequence items', () => {
    const text = fixture(`
a: 1
b:
  - x

  - y: 1
    z: 2
c:
  d: e
`);
    const v = parseYaml(text);
    assert.equal(lineOf(v, 'a'), 1);
    assert.equal(lineOf(v, 'b'), 2);
    assert.equal(lineOf(v.b, 0), 3);
    assert.equal(lineOf(v.b, 1), 5);
    assert.equal(lineOf(v.b[1], 'y'), 5);
    assert.equal(lineOf(v.b[1], 'z'), 6);
    assert.equal(lineOf(v, 'c'), 7);
    assert.equal(lineOf(v.c, 'd'), 8);
    assert.equal(lineOf(v, 'missing'), undefined);
  });
});

describe('block scalars', () => {
  test('literal | keeps line breaks and ends with one newline', () => {
    assert.deepEqual(parseYaml('a: |\n  line 1\n    indented\n\n  line 3\n\nb: 1'), {
      a: 'line 1\n  indented\n\nline 3\n',
      b: 1,
    });
  });

  test('chomping: |- strips, |+ keeps, | clips', () => {
    const text = 'clip: |\n  x\n\nstrip: |-\n  x\n\nkeep: |+\n  x\n\nend: 1';
    assert.deepEqual(parseYaml(text), { clip: 'x\n', strip: 'x', keep: 'x\n\n', end: 1 });
  });

  test('folded > joins lines with spaces, keeps blank lines and more-indented lines', () => {
    const text = fixture(`
a: >
  one
  two

  three
    code line
  four
b: >-
  x
  y
c: >+
  z

d: 1
`);
    assert.deepEqual(parseYaml(text), {
      a: 'one two\nthree\n  code line\nfour\n',
      b: 'x y',
      c: 'z\n\n',
      d: 1,
    });
  });

  test('explicit indentation indicator keeps leading spaces', () => {
    assert.equal(parseYaml('a: |2\n    indented\n  normal\n').a, '  indented\nnormal\n');
    assert.equal(parseYaml('a: >-2\n    x\n').a, '  x');
  });

  test('# and : inside a block scalar are content', () => {
    assert.equal(parseYaml('run: |\n  echo "a: b" # not a comment\n  key: value\n').run, 'echo "a: b" # not a comment\nkey: value\n');
  });

  test('whitespace-only lines deeper than the content keep their extra spaces', () => {
    assert.equal(parseYaml('a: |\n  x\n    \n  y\n').a, 'x\n  \ny\n');
  });

  test('empty block scalars and block scalars in sequences', () => {
    assert.deepEqual(parseYaml('a: |\nb: >\n'), { a: '', b: '' });
    assert.deepEqual(parseYaml('- |\n  one\n- >-\n  two\n  three\n'), ['one\n', 'two three']);
  });
});

describe('flow collections', () => {
  test('sequences and mappings, nested', () => {
    const v = parseYaml('command: ["npm", "run", "dev"]\nenvironment: { A: 1, B: "two", C: [x, {y: z}] }');
    assert.deepEqual(v, { command: ['npm', 'run', 'dev'], environment: { A: 1, B: 'two', C: ['x', { y: 'z' }] } });
  });

  test('spanning several lines, with comments and trailing commas', () => {
    const text = fixture(`
args: [
  "--port", 3000, # the port
  --verbose,
  [nested,
   list],
]
env: {
  NODE_ENV: production,
  "QUOTED": 'yes',
}
`);
    const v = parseYaml(text);
    assert.deepEqual(v, {
      args: ['--port', 3000, '--verbose', ['nested', 'list']],
      env: { NODE_ENV: 'production', QUOTED: 'yes' },
    });
    assert.equal(lineOf(v.args, 0), 2);
    assert.equal(lineOf(v.args, 2), 3);
    assert.equal(lineOf(v.args, 3), 4);
    assert.equal(lineOf(v.env, 'QUOTED'), 9);
  });

  test('empty collections, URLs and JSON-style pairs', () => {
    assert.deepEqual(parseYaml('a: []\nb: {}\nc: [http://x.com/a#b, "p:q"]\nd: {"k":1}\ne: [a: 1, b]'), {
      a: [], b: {}, c: ['http://x.com/a#b', 'p:q'], d: { k: 1 }, e: [{ a: 1 }, 'b'],
    });
  });

  test('a document that is plain JSON', () => {
    assert.deepEqual(parseYaml('{\n  "name": "x",\n  "list": [1, 2.5, true, null]\n}'), {
      name: 'x', list: [1, 2.5, true, null],
    });
  });
});

describe('anchors, aliases and merge keys', () => {
  test('an alias is the anchored value itself', () => {
    const v = parseYaml('base: &b {x: 1}\ncopy: *b\nn: &n 5\nm: *n\nlist: [*n, *b]');
    assert.equal(v.copy, v.base);
    assert.equal(v.m, 5);
    assert.deepEqual(v.list, [5, { x: 1 }]);
  });

  test('<< merges keys; explicit keys win wherever they appear', () => {
    const text = fixture(`
base: &base
  image: node:20
  restart: always
  env: prod
service:
  restart: "no"
  <<: *base
  env: dev
`);
    const v = parseYaml(text);
    assert.deepEqual(v.service, { restart: 'no', image: 'node:20', env: 'dev' });
    assert.equal(lineOf(v.service, 'restart'), 6);
    assert.equal(lineOf(v.service, 'image'), 7); // merged: the line of <<
    assert.equal(lineOf(v.service, 'env'), 8);
    assert.deepEqual(v.base, { image: 'node:20', restart: 'always', env: 'prod' }); // untouched
  });

  test('<< with a list: earlier mappings win', () => {
    const v = parseYaml('a: &a {x: 1, y: 1}\nb: &b {y: 2, z: 2}\nc:\n  <<: [*a, *b]\n  w: 0');
    assert.deepEqual(v.c, { x: 1, y: 1, z: 2, w: 0 });
    assert.equal(lineOf(v.c, 'z'), 4);
  });

  test('<< inside a flow mapping', () => {
    assert.deepEqual(parseYaml('a: &a {x: 1}\nb: { <<: *a, y: 2 }').b, { x: 1, y: 2 });
  });

  test('an unknown alias is an error', () => {
    assertYamlError('a: 1\nb: *nope', 2, /unknown alias "\*nope"/);
  });

  test('anchors do not carry over to the next document', () => {
    assert.throws(() => parseYamlAll('a: &x 1\n---\nb: *x'), (err) => err instanceof YamlError && err.line === 3);
  });
});

describe('tags', () => {
  test('tags are ignored but their values are kept; !!str keeps text', () => {
    const text = fixture(`
a: !!str 123
b: !!str true
c: !Ref MyBucket
d: !Sub |
  arn:aws:s3:::\${Bucket}
e: !reset []
f: !override
  - 8080:80
g: !GetAtt [Role, Arn]
h: !!map
  k: v
`);
    assert.deepEqual(parseYaml(text), {
      a: '123',
      b: 'true',
      c: 'MyBucket',
      d: 'arn:aws:s3:::${Bucket}\n',
      e: [],
      f: ['8080:80'],
      g: ['Role', 'Arn'],
      h: { k: 'v' },
    });
  });
});

describe('documents', () => {
  test('parseYamlAll splits on ---, honours ... and skips %YAML', () => {
    const text = fixture(`
%YAML 1.2
---
a: 1
...
---
# empty document
---
- b
---
`);
    assert.deepEqual(parseYamlAll(text), [{ a: 1 }, null, ['b'], null]);
  });

  test('parseYaml returns only the first document', () => {
    assert.deepEqual(parseYaml('a: 1\n---\nb: [unclosed'), { a: 1 });
  });

  test('content on the --- line', () => {
    assert.deepEqual(parseYamlAll('--- |\n  text\n--- !!map\nk: v\n--- >-\n  folded\n  text'), [
      'text\n', { k: 'v' }, 'folded text',
    ]);
  });

  test('empty input', () => {
    assert.equal(parseYaml(''), null);
    assert.equal(parseYaml('# only a comment\n'), null);
    assert.deepEqual(parseYamlAll(''), []);
    assert.deepEqual(parseYamlAll('\n# comment\n'), []);
  });

  test('line numbers count from the top of the file, not the document', () => {
    const docs = parseYamlAll('a: 1\n---\nb: 2\n---\nc:\n  - 3');
    assert.equal(lineOf(docs[1], 'b'), 3);
    assert.equal(lineOf(docs[2].c, 0), 6);
  });
});

describe('input handling', () => {
  test('Windows line endings', () => {
    const v = parseYaml('a: 1\r\nb:\r\n  - x\r\nc: |\r\n  one\r\n  two\r\n');
    assert.deepEqual(v, { a: 1, b: ['x'], c: 'one\ntwo\n' });
    assert.equal(lineOf(v.b, 0), 3);
  });

  test('a byte order mark', () => {
    assert.deepEqual(parseYaml('\ufeffa: 1'), { a: 1 });
  });
});

describe('errors', () => {
  test('tabs in indentation', () => {
    assertYamlError('a:\n\tb: 1', 2, /tab/);
    assertYamlError('list:\n  - a\n \t- b', 3, /tab/);
  });

  test('tabs elsewhere are fine', () => {
    assert.deepEqual(parseYaml('a:\tvalue\nb: "x\ty"\nc: |\n  \tindented by tab\n'), {
      a: 'value', b: 'x\ty', c: '\tindented by tab\n',
    });
  });

  test('unterminated quoted string reports the line it starts on', () => {
    assertYamlError('a: 1\nb: "never closed\nc: 3\n', 2, /unterminated double-quoted/);
    assertYamlError("a: 'never closed", 1, /unterminated single-quoted/);
  });

  test('unterminated flow collection reports the opening line', () => {
    assertYamlError('a: 1\nb: [1, 2\nc: 3\n', 2, /unterminated flow collection/);
  });

  test('bad indentation', () => {
    assertYamlError('a:\n    b: 1\n  c: 2', 3, /bad indentation/);
    assertYamlError('- a: 1\n b: 2', 2, /bad indentation/);
  });

  test('misplaced block sequence and stray content', () => {
    assertYamlError('key: - a', 1, /own line/);
    assertYamlError('a: 1\n- b', 2, /sequence item/);
    assertYamlError('- a\nb: 1', 2, /after the end of the document/);
    assertYamlError('a: 1\nplain line', 2, /mapping key/);
  });

  test('malformed block scalar header and trailing text after a value', () => {
    assertYamlError('a: |x\n  text', 1, /block scalar header/);
    assertYamlError('a: "x" y', 1, /unexpected text/);
    assertYamlError('a: [1] 2', 1, /unexpected text/);
  });

  test('explicit "? " keys are reported as unsupported', () => {
    assertYamlError('? a\n: b', 1, /not supported/);
  });

  test('Helm-style templates fail with a hint', () => {
    assertYamlError('{{- if .Values.enabled }}\napiVersion: v1\n{{- end }}', 1, /template/);
  });

  test('YamlError is an Error with a line number in the message', () => {
    try {
      parseYaml('a:\n\tb');
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.equal(err.name, 'YamlError');
      assert.match(err.message, /\(line 2\)$/);
    }
  });
});

describe('real-world files', () => {
  test('docker-compose with x- anchors, merges, healthchecks and both env styles', () => {
    const text = fixture(`
version: "3.9"

x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"

x-app: &app
  build:
    context: .
    dockerfile: Dockerfile
  restart: unless-stopped
  logging: *default-logging
  environment: &app-env
    NODE_ENV: production
    DATABASE_URL: postgres://app:secret@db:5432/app?sslmode=disable

services:
  web:
    <<: *app
    command: ["npm", "run", "start"]
    ports:
      - "3000:3000"
      - "127.0.0.1:9229:9229"
    environment:
      <<: *app-env
      PORT: 3000
    depends_on:
      - db
      - redis

  worker:
    <<: *app
    command: npm run worker
    environment:
      - QUEUE=default
      - REDIS_URL=redis://redis:6379/0
      - EMPTY=
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret # change me
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $\${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: "redis:7"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]

volumes:
  db-data:
`);
    const v = parseYaml(text);
    const { web, worker, db, redis } = v.services;

    assert.equal(v.version, '3.9');
    assert.deepEqual(web.build, { context: '.', dockerfile: 'Dockerfile' });
    assert.equal(web.restart, 'unless-stopped');
    assert.deepEqual(web.logging, { driver: 'json-file', options: { 'max-size': '10m' } });
    assert.deepEqual(web.command, ['npm', 'run', 'start']);
    assert.deepEqual(web.ports, ['3000:3000', '127.0.0.1:9229:9229']);
    assert.deepEqual(web.environment, {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://app:secret@db:5432/app?sslmode=disable',
      PORT: 3000,
    });
    assert.deepEqual(web.depends_on, ['db', 'redis']);

    assert.equal(worker.command, 'npm run worker');
    assert.deepEqual(worker.environment, ['QUEUE=default', 'REDIS_URL=redis://redis:6379/0', 'EMPTY=']);
    assert.deepEqual(worker.depends_on, {
      db: { condition: 'service_healthy' },
      redis: { condition: 'service_started' },
    });

    assert.equal(db.image, 'postgres:16-alpine');
    assert.equal(db.environment.POSTGRES_PASSWORD, 'secret');
    assert.deepEqual(db.healthcheck, {
      test: ['CMD-SHELL', 'pg_isready -U $${POSTGRES_USER}'],
      interval: '10s',
      timeout: '5s',
      retries: 5,
    });
    assert.equal(redis.image, 'redis:7');
    assert.deepEqual(v.volumes, { 'db-data': null });

    // Evidence lines
    assert.equal(lineOf(v.services, 'web'), findLine(text, '  web:'));
    assert.equal(lineOf(web, 'image'), undefined);
    assert.equal(lineOf(web, 'restart'), findLine(text, '<<: *app')); // merged from x-app
    assert.equal(lineOf(web, 'command'), findLine(text, 'command: ["npm"'));
    assert.equal(lineOf(web.ports, 1), findLine(text, '127.0.0.1:9229'));
    assert.equal(lineOf(web.environment, 'NODE_ENV'), findLine(text, '<<: *app-env'));
    assert.equal(lineOf(web.environment, 'PORT'), findLine(text, 'PORT: 3000'));
    assert.equal(lineOf(worker.environment, 1), findLine(text, 'REDIS_URL='));
    assert.equal(lineOf(worker.depends_on, 'redis'), findLine(text, '      redis:', findLine(text, '  worker:')));
    assert.equal(lineOf(db, 'image'), findLine(text, 'postgres:16-alpine'));
    assert.equal(lineOf(db.healthcheck.test, 1), findLine(text, 'pg_isready'));
  });

  test('Kubernetes multi-document file (Deployment + Service)', () => {
    const text = fixture(`
# Generated manifest
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  labels:
    app.kubernetes.io/name: api
  annotations:
    prometheus.io/scrape: "true"
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
      - name: api
        image: ghcr.io/acme/api:1.4.2
        args: ["--port=8080", "--log-level", "info"]
        ports:
        - containerPort: 8080
          name: http
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: api-secrets
              key: database-url
        - name: REDIS_HOST
          value: redis.default.svc.cluster.local
        resources:
          limits: {cpu: 500m, memory: 512Mi}
---
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  type: ClusterIP
  selector:
    app: api
  ports:
    - port: 80
      targetPort: http
      protocol: TCP
---
`);
    const docs = parseYamlAll(text);
    assert.equal(docs.length, 3);
    const [deployment, service, empty] = docs;
    assert.equal(empty, null);

    assert.equal(deployment.kind, 'Deployment');
    assert.equal(deployment.metadata.labels['app.kubernetes.io/name'], 'api');
    assert.equal(deployment.metadata.annotations['prometheus.io/scrape'], 'true');
    assert.equal(deployment.spec.replicas, 3);
    const [container] = deployment.spec.template.spec.containers;
    assert.equal(container.image, 'ghcr.io/acme/api:1.4.2');
    assert.deepEqual(container.args, ['--port=8080', '--log-level', 'info']);
    assert.deepEqual(container.ports, [{ containerPort: 8080, name: 'http' }]);
    assert.deepEqual(container.env[0].valueFrom, { secretKeyRef: { name: 'api-secrets', key: 'database-url' } });
    assert.equal(container.env[1].value, 'redis.default.svc.cluster.local');
    assert.deepEqual(container.resources.limits, { cpu: '500m', memory: '512Mi' });

    assert.equal(service.kind, 'Service');
    assert.deepEqual(service.spec.ports, [{ port: 80, targetPort: 'http', protocol: 'TCP' }]);

    assert.equal(lineOf(deployment, 'kind'), findLine(text, 'kind: Deployment'));
    assert.equal(lineOf(deployment.spec.template.spec.containers, 0), findLine(text, '- name: api'));
    assert.equal(lineOf(container, 'image'), findLine(text, 'image: ghcr.io'));
    assert.equal(lineOf(container.env, 1), findLine(text, '- name: REDIS_HOST'));
    assert.equal(lineOf(service, 'kind'), findLine(text, 'kind: Service'));
    assert.equal(lineOf(service.spec.ports, 0), findLine(text, '- port: 80'));
  });

  test('GitHub Actions workflow with on:, expressions and a run: | script', () => {
    const text = fixture(`
name: CI

on:
  push:
    branches: [main, 'release/**']
    paths-ignore:
      - '**.md'
  pull_request:
  workflow_dispatch:
    inputs:
      debug:
        type: boolean
        default: false

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: 20

jobs:
  test:
    runs-on: \${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
        node: [18, 20]
    services:
      postgres:
        image: postgres:16
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node }}
          cache: npm
      - name: Test
        if: github.event_name == 'push' && !cancelled()
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/test
        run: |
          # comments in scripts are content
          echo "key: value"   # not a YAML comment
          npm ci
          npm test -- --reporter=dot
      - run: >-
          echo folded
          command
`);
    const v = parseYaml(text);
    assert.deepEqual(Object.keys(v), ['name', 'on', 'concurrency', 'env', 'jobs']);
    assert.deepEqual(v.on.push, { branches: ['main', 'release/**'], 'paths-ignore': ['**.md'] });
    assert.equal(v.on.pull_request, null);
    assert.equal(v.on.workflow_dispatch.inputs.debug.default, false);
    assert.equal(v.concurrency.group, '${{ github.workflow }}-${{ github.ref }}');

    const job = v.jobs.test;
    assert.equal(job['runs-on'], '${{ matrix.os }}');
    assert.deepEqual(job.strategy.matrix, { os: ['ubuntu-latest', 'macos-latest'], node: [18, 20] });
    assert.deepEqual(job.services.postgres.ports, ['5432:5432']);
    assert.equal(job.steps.length, 4);
    assert.deepEqual(job.steps[1].with, { 'node-version': '${{ matrix.node }}', cache: 'npm' });
    assert.equal(job.steps[2].if, "github.event_name == 'push' && !cancelled()");
    assert.equal(
      job.steps[2].run,
      '# comments in scripts are content\necho "key: value"   # not a YAML comment\nnpm ci\nnpm test -- --reporter=dot\n',
    );
    assert.equal(job.steps[3].run, 'echo folded command');

    assert.equal(lineOf(v, 'on'), findLine(text, 'on:'));
    assert.equal(lineOf(job.steps, 0), findLine(text, 'actions/checkout'));
    assert.equal(lineOf(job.steps, 2), findLine(text, '- name: Test'));
    assert.equal(lineOf(job.steps[2], 'run'), findLine(text, 'run: |'));
    assert.equal(lineOf(job.services, 'postgres'), findLine(text, 'postgres:', findLine(text, 'services:')));
  });

  test('pnpm-workspace.yaml with globs, negations and catalogs', () => {
    const text = fixture(`
packages:
  - 'apps/*'
  - "packages/**"
  - tooling/*
  - '!**/test/**'

catalog:
  react: ^18.3.1
  "@types/node": 20.11.0
  zod: 3.23.8

onlyBuiltDependencies:
  - esbuild
`);
    const v = parseYaml(text);
    assert.deepEqual(v.packages, ['apps/*', 'packages/**', 'tooling/*', '!**/test/**']);
    assert.deepEqual(v.catalog, { react: '^18.3.1', '@types/node': '20.11.0', zod: '3.23.8' });
    assert.deepEqual(v.onlyBuiltDependencies, ['esbuild']);
    assert.equal(lineOf(v.packages, 3), 5);
    assert.equal(lineOf(v.catalog, '@types/node'), 9);
  });

  test('render.yaml blueprint', () => {
    const text = fixture(`
services:
  - type: web
    name: api
    runtime: node
    buildCommand: npm ci && npm run build
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: main-db
          property: connectionString
      - fromGroup: shared
databases:
  - name: main-db
    plan: basic-256mb
`);
    const v = parseYaml(text);
    assert.equal(v.services[0].buildCommand, 'npm ci && npm run build');
    assert.deepEqual(v.services[0].envVars[0].fromDatabase, { name: 'main-db', property: 'connectionString' });
    assert.deepEqual(v.services[0].envVars[1], { fromGroup: 'shared' });
    assert.equal(lineOf(v.databases, 0), 13);
  });
});

describe('performance', () => {
  test('a 5,000-line compose-style file parses in well under 100 ms', () => {
    const parts = ['x-base: &base\n  restart: always\n  logging: {driver: json-file}\nservices:\n'];
    for (let i = 0; parts.join('').split('\n').length < 5000 && i < 1000; i++) {
      parts.push(
        `  svc${i}:\n    <<: *base\n    image: "registry.example.com/team/svc${i}:1.${i}.0"\n` +
          `    command: ["node", "server.js", "--port", "${3000 + i}"]\n` +
          `    environment:\n      - NODE_ENV=production\n      - INDEX=${i}\n` +
          `    healthcheck:\n      test: |\n        curl -f http://localhost:${3000 + i}/health # probe\n` +
          `      interval: 10s\n    depends_on:\n      db: {condition: service_healthy}\n`,
      );
    }
    const text = parts.join('');
    assert.ok(text.split('\n').length >= 5000);
    parseYaml(text); // warm up the JIT
    const start = performance.now();
    const v = parseYaml(text);
    const elapsed = performance.now() - start;
    assert.equal(v.services.svc0.restart, 'always');
    assert.ok(elapsed < 100, `took ${elapsed.toFixed(1)} ms`);
  });
});
