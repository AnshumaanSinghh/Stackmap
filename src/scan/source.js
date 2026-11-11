// One pass over a source file: which packages it imports, which env vars it reads,
// and which API hosts it calls. Regex based on purpose: fast, language-agnostic, good enough
// for architecture (we need "does this unit use X", not a full AST).

export const LANGUAGES = {
  js: { name: 'JavaScript', eco: 'npm' },
  ts: { name: 'TypeScript', eco: 'npm' },
  py: { name: 'Python', eco: 'pypi' },
  go: { name: 'Go', eco: 'go' },
  rs: { name: 'Rust', eco: 'cargo' },
  rb: { name: 'Ruby', eco: 'gem' },
  php: { name: 'PHP', eco: 'composer' },
  java: { name: 'Java', eco: 'maven' },
  kt: { name: 'Kotlin', eco: 'maven' },
  cs: { name: 'C#', eco: 'nuget' },
  ex: { name: 'Elixir', eco: 'hex' },
};

const EXT = {
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', vue: 'js', svelte: 'js', astro: 'js',
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  py: 'py',
  go: 'go',
  rs: 'rs',
  rb: 'rb', rake: 'rb',
  php: 'php',
  java: 'java',
  kt: 'kt', kts: 'kt',
  cs: 'cs',
  ex: 'ex', exs: 'ex',
};

export function languageOf(file) {
  // Skip declarations, bundles and protobuf output. Other generated code (registries,
  // routers) is kept: it often holds the real wiring between packages.
  if (/\.d\.ts$|\.min\.js$|\.bundle\.js$|-bundle\.js$|\.pb\.go$|_pb2\.py$|_pb2_grpc\.py$|\.g\.dart$/.test(file)) return null;
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  return EXT[ext] ?? null;
}

// Paths that are not production code: tests, fixtures, examples, scripts, stories, mocks, migrations.
const NON_RUNTIME_DIR = /(^|\/)(__tests__|__mocks__|__fixtures__|tests?|specs?|e2e|cypress|playwright|fixtures?|testdata|test-utils|mocks?|stories|storybook|\.storybook|examples?|samples?|benchmarks?|bench|scripts|migrations|seeds?|docs)(\/|$)/i;
const NON_RUNTIME_FILE = /(\.|_|-)(test|spec|stories|story|e2e|bench|mock|fixture)s?\.[a-z]+$|^test_[^/]*\.py$|_test\.(go|py|exs?)$|^conftest\.py$|Tests?\.(cs|java|kt)$|Spec\.(cs|java|kt|rb)$|_spec\.rb$/i;

// Tool configuration at any level: next.config.js, vite.config.ts, .eslintrc.cjs, jest.setup.ts ...
const CONFIG_FILE = /\.config\.[cm]?[jt]sx?$|^\.[\w.-]+\.[cm]?[jt]s$|^(gulpfile|gruntfile|jakefile|webpack|rollup|vite|vitest|babel|jest|karma|playwright|cypress|tsup|esbuild|postcss|tailwind|prettier|eslint|commitlint|lint-staged|metro)([.-][\w.-]*)?\.[cm]?[jt]s$|^(setup|noxfile|fabfile)\.py$/i;

/** Is this path (relative to its unit) production code? */
export function isRuntimePath(relToUnit) {
  const base = relToUnit.slice(relToUnit.lastIndexOf('/') + 1);
  return !NON_RUNTIME_DIR.test(relToUnit) && !NON_RUNTIME_FILE.test(base) && !CONFIG_FILE.test(base);
}

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram',
  'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
  'sys', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

/** "@scope/pkg/sub" -> "@scope/pkg", "pkg/sub" -> "pkg", relative/alias/builtin -> null */
export function npmPackageOf(spec) {
  if (!spec || /^[./~#]|^node:|^bun:|^virtual:|^data:|^https?:|^\$|^@\//.test(spec) || spec.includes('${')) return null;
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  if (!name || NODE_BUILTINS.has(name) || /[A-Z\s]/.test(name.replace(/^@[^/]+\//, '').slice(0, 1))) return null;
  if (spec.startsWith('@') && parts.length < 2) return null;
  return name;
}

const HOST_RE = /https?:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/gi;
const API_HOST = /^([\w-]+\.)*(api|apis|rest|graphql|hooks|webhooks?|ingest|events|upload|uploads|gateway|realtime|ws|wss|sdk|cdn-api)[\w-]*\./i;
const API_PATH = /^(:\d+)?\/(?:[\w.-]+\/)*?(api|apis|v\d+(\.\d+)?|graphql|rest|rpc|services|webhooks?|hooks|ingest|events?|collect|track|capture|batch|oauth2?|token|js|sdk)(\/|\?|$|#)|\.js(\?|$|['"`])/i;

const ENV_PATTERNS = {
  js: [
    /\bprocess\.env\.([A-Z_][A-Z0-9_]*)\b/g,
    /\bprocess\.env\[\s*['"`]([A-Z_][A-Z0-9_]*)['"`]\s*\]/g,
    /\bimport\.meta\.env\.([A-Z_][A-Z0-9_]*)\b/g,
    /\bDeno\.env\.get\(\s*['"`]([A-Z_][A-Z0-9_]*)['"`]/g,
    /\bBun\.env\.([A-Z_][A-Z0-9_]*)\b/g,
  ],
  py: [
    /\bos\.environ\s*\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g,
    /\b(?:os\.)?environ\.get\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
    /\bos\.getenv\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
    /\benv(?:\.(?:str|int|bool|list|url|db|cache|json|float))?\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
    /\bconfig\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
  ],
  go: [/\bos\.(?:Getenv|LookupEnv)\(\s*"([A-Z_][A-Z0-9_]*)"/g, /\bviper\.\w+\(\s*"([A-Z_][A-Z0-9_]*)"/g],
  rs: [/\b(?:std::)?env::var(?:_os)?\(\s*"([A-Z_][A-Z0-9_]*)"/g, /\b(?:option_)?env!\(\s*"([A-Z_][A-Z0-9_]*)"/g, /\bdotenv(?:y)?::var\(\s*"([A-Z_][A-Z0-9_]*)"/g],
  rb: [/\bENV\s*\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g, /\bENV\.fetch\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g, /\bENV\.key\?\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g],
  php: [/\benv\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g, /\bgetenv\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g, /\$_ENV\s*\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g],
  java: [/\bSystem\.getenv\(\s*"([A-Z_][A-Z0-9_]*)"/g],
  kt: [/\bSystem\.getenv\(\s*"([A-Z_][A-Z0-9_]*)"/g],
  cs: [/\bEnvironment\.GetEnvironmentVariable\(\s*"([A-Z_][A-Z0-9_]*)"/g],
  ex: [/\bSystem\.(?:get_env|fetch_env!?)\(\s*"([A-Z_][A-Z0-9_]*)"/g],
};
ENV_PATTERNS.ts = ENV_PATTERNS.js;

const JS_IMPORTS = [
  /\b(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"\n]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\brequire(?:\.resolve)?\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

/**
 * @returns {{ imports: Array<{name:string,line:number,text:string}>, env: Array<{name:string,line:number,text:string}>, hosts: Array<{host:string,line:number,text:string}>, relative: Array<{spec:string,line:number,text:string}> }}
 */
export function analyzeSource(text, lang) {
  const imports = [];
  const env = [];
  const hosts = [];
  const relative = [];
  const seenRel = new Set();
  const lines = text.split('\n');
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  const lineAt = (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const push = (arr, key, value, offset) => {
    const line = lineAt(offset);
    arr.push({ [key]: value, line, text: lines[line - 1] ?? '' });
  };

  if (lang === 'js' || lang === 'ts') {
    for (const re of JS_IMPORTS) {
      for (const m of text.matchAll(re)) {
        const name = npmPackageOf(m[1]);
        if (name) push(imports, 'name', name, m.index);
        else if (m[1].startsWith('../') || m[1].startsWith('./')) {
          if (!seenRel.has(m[1])) {
            seenRel.add(m[1]);
            push(relative, 'spec', m[1], m.index);
          }
        }
      }
    }
    for (const m of text.matchAll(/\{([^{}]{1,600})\}\s*=\s*process\.env\b/g)) {
      for (const k of m[1].split(',')) {
        const name = k.trim().split(/[:=\s]/)[0];
        if (/^[A-Z_][A-Z0-9_]*$/.test(name)) push(env, 'name', name, m.index);
      }
    }
  } else if (lang === 'py') {
    for (const m of text.matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)/gm)) {
      for (const part of m[1].split(',')) push(imports, 'name', part.trim().split(/\s+/)[0], m.index);
    }
    for (const m of text.matchAll(/^[ \t]*from[ \t]+([\w.]+)[ \t]+import\b/gm)) push(imports, 'name', m[1], m.index);
  } else if (lang === 'go') {
    for (const block of text.matchAll(/^import\s*\(([\s\S]*?)^\)/gm)) {
      for (const m of block[1].matchAll(/(?:^|\n)\s*(?:[\w.]+\s+)?"([^"]+)"/g)) {
        push(imports, 'name', m[1], block.index + block[0].indexOf(m[1]));
      }
    }
    for (const m of text.matchAll(/^import\s+(?:[\w.]+\s+)?"([^"]+)"/gm)) push(imports, 'name', m[1], m.index);
  } else if (lang === 'rs') {
    for (const m of text.matchAll(/^\s*(?:pub\s+)?use\s+(?:::)?([a-z_][a-z0-9_]*)::/gm)) {
      if (!['crate', 'self', 'super', 'std', 'core', 'alloc'].includes(m[1])) push(imports, 'name', m[1], m.index);
    }
    for (const m of text.matchAll(/^\s*extern\s+crate\s+([a-z_][a-z0-9_]*)/gm)) push(imports, 'name', m[1], m.index);
  }

  for (const re of ENV_PATTERNS[lang] ?? []) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) push(env, 'name', m[1], m.index);
  }

  for (const m of text.matchAll(HOST_RE)) {
    const host = m[1].toLowerCase();
    if (/\.(png|jpe?g|svg|gif|webp|css|js)$/.test(host)) continue;
    // Only URLs that look like calls count: an API-ish host, an API-ish path, or a script include.
    // A homepage or docs link ("https://openrouter.ai", "https://discord.com/developers") does not.
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 120);
    const pathPart = (rest.match(/^[^\s'"`)<>\\]*/) ?? [''])[0];
    if (!API_HOST.test(host) && !API_PATH.test(pathPart)) continue;
    push(hosts, 'host', host, m.index);
  }

  return { imports, env, hosts, relative };
}

/** Go stdlib imports have no dot in their first path element. */
export function isGoStdlib(path) {
  return !path.split('/')[0].includes('.');
}
