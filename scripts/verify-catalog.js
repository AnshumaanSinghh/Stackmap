#!/usr/bin/env node
// Checks every exact package / image name in the catalog against its public registry.
//
//   node scripts/verify-catalog.js                 # everything
//   node scripts/verify-catalog.js --only npm,pypi # some ecosystems (plus `docker`)
//   node scripts/verify-catalog.js --id stripe,openai
//
// Zero dependencies (Node >= 20 global fetch). Polite by design: one fixed User-Agent, low
// per-host concurrency, crates.io paced at one request per second, and retries with backoff on
// 429/5xx. A registry that refuses us (403, persistent 429) is reported as a failure, never
// worked around.

import { TECHNOLOGIES } from '../src/catalog/data.js';
import { ECOSYSTEMS } from '../src/catalog/categories.js';

const USER_AGENT = 'stackmap-catalog-verify (+https://github.com/AnshumaanSinghh/Stackmap)';
const CONCURRENCY = 12;
const MAX_ATTEMPTS = 5;
const TIMEOUT_MS = 20_000;

// Names a registry genuinely cannot confirm. Keep this empty unless there is no public API.
// Format: '<ecosystem>:<name>' -> reason.
const ALLOW_UNVERIFIED = new Map([]);

// Images (stored without registry host) that live on a registry other than Docker Hub. When
// Docker Hub does not have them, they are checked through that registry's v2 API with an
// anonymous pull token, which is how `docker pull` itself reads public images.
const DOCKER_REGISTRY = new Map([
  ['mssql/server', 'mcr.microsoft.com'],
  ['azure-sql-edge', 'mcr.microsoft.com'],
  ['azure-storage/azurite', 'mcr.microsoft.com'],
  ['cosmosdb/linux/azure-cosmos-emulator', 'mcr.microsoft.com'],
  ['elasticsearch/elasticsearch', 'docker.elastic.co'],
  ['tursodatabase/libsql-server', 'ghcr.io'],
  ['chroma-core/chroma', 'ghcr.io'],
  ['plausible/community-edition', 'ghcr.io'],
  ['umami-software/umami', 'ghcr.io'],
  ['windmill-labs/windmill', 'ghcr.io'],
  ['keycloak/keycloak', 'quay.io'],
  ['datadoghq/agent', 'gcr.io'],
  ['dragonflydb/dragonfly', 'docker.dragonflydb.io'],
]);

// Per-host politeness: max parallel requests and minimum gap between request starts.
const HOST_LIMITS = {
  'crates.io': { max: 1, gapMs: 1000 },
  'hub.docker.com': { max: 2, gapMs: 200 },
  'search.maven.org': { max: 2, gapMs: 200 },
  'repo1.maven.org': { max: 2, gapMs: 100 },
  'hex.pm': { max: 2, gapMs: 300 },
  'rubygems.org': { max: 3, gapMs: 100 },
};
const DEFAULT_LIMIT = { max: 6, gapMs: 0 };

// ───────────────────────────── CLI ─────────────────────────────

function parseArgs(argv) {
  const opts = { only: null, ids: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? '';
    if (arg === '--only') opts.only = new Set(next().split(',').map((s) => s.trim()).filter(Boolean));
    else if (arg.startsWith('--only=')) opts.only = new Set(arg.slice(7).split(',').filter(Boolean));
    else if (arg === '--id') opts.ids = new Set(next().split(',').map((s) => s.trim()).filter(Boolean));
    else if (arg.startsWith('--id=')) opts.ids = new Set(arg.slice(5).split(',').filter(Boolean));
    else if (arg === '--verbose' || arg === '-v') opts.verbose = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/verify-catalog.js [--only npm,pypi,...,docker] [--id stripe,...] [--verbose]');
      process.exit(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}

// ───────────────────────────── HTTP ─────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostState = new Map();

async function withHostSlot(host, fn) {
  const limit = HOST_LIMITS[host] ?? DEFAULT_LIMIT;
  let state = hostState.get(host);
  if (!state) hostState.set(host, (state = { active: 0, queue: [], lastStart: 0 }));
  if (state.active >= limit.max) await new Promise((resolve) => state.queue.push(resolve));
  state.active++;
  try {
    const wait = state.lastStart + limit.gapMs - Date.now();
    state.lastStart = Math.max(Date.now(), state.lastStart + limit.gapMs);
    if (wait > 0) await sleep(wait);
    return await fn();
  } finally {
    state.active--;
    state.queue.shift()?.();
  }
}

// Returns { status, headers, body } — body is parsed JSON when `json` is set, else text.
async function request(url, { json = false, headers = {} } = {}) {
  const host = new URL(url).host;
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await withHostSlot(host, () =>
        fetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: json ? 'application/json' : '*/*', ...headers },
          redirect: 'follow',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
      );
      if (res.status === 429 || res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        await res.body?.cancel();
        if (attempt < MAX_ATTEMPTS) await sleep(backoff(attempt, res.headers.get('retry-after')));
        continue;
      }
      let body = null;
      if (res.ok) body = json ? await res.json().catch(() => null) : await res.text();
      else await res.body?.cancel();
      return { status: res.status, headers: res.headers, body };
    } catch (err) {
      lastError = err.name === 'TimeoutError' ? 'timeout' : err.message;
      if (attempt < MAX_ATTEMPTS) await sleep(backoff(attempt));
    }
  }
  return { status: 0, error: lastError };
}

function backoff(attempt, retryAfter) {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 60_000);
  return Math.min(1000 * 2 ** (attempt - 1), 30_000) + Math.floor(Math.random() * 400);
}

const ok = (detail = '') => ({ ok: true, detail });
const fail = (detail) => ({ ok: false, detail });
const fromStatus = (r, what = '') =>
  r.status === 200 ? ok(what) : fail(r.status ? `HTTP ${r.status}` : `network: ${r.error}`);

// ───────────────────────────── Registry checks ─────────────────────────────

const checkers = {
  async npm(name) {
    const encoded = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
    // The abbreviated document is small; a 200 means the package exists.
    return fromStatus(await request(`https://registry.npmjs.org/${encoded}`, {
      headers: { Accept: 'application/vnd.npm.install-v1+json' },
    }));
  },

  async pypi(name) {
    return fromStatus(await request(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, { json: true }));
  },

  async go(path) {
    const base = await goLatest(path);
    if (base.status === 200) return ok();
    if (base.status !== 404 && base.status !== 410) return fromStatus(base);
    // The prefix may only exist as a major-version module (.../v2 ... /vN); prefixes match those too.
    for (let from = 2; from <= 99; from += 8) {
      const majors = Array.from({ length: 8 }, (_, i) => from + i).filter((n) => n <= 99);
      const results = await Promise.all(majors.map((n) => goLatest(`${path}/v${n}`).then((r) => [n, r])));
      const hit = results.find(([, r]) => r.status === 200);
      if (hit) return ok(`as ${path}/v${hit[0]}`);
      const hardError = results.find(([, r]) => r.status !== 404 && r.status !== 410);
      if (hardError) return fromStatus(hardError[1]);
    }
    return fail(`HTTP ${base.status} (no /vN module either)`);
  },

  async cargo(name) {
    return fromStatus(await request(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`, { json: true }));
  },

  async gem(name) {
    return fromStatus(await request(`https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`, { json: true }));
  },

  async composer(name) {
    const [vendor, pkg] = name.split('/');
    return fromStatus(await request(`https://repo.packagist.org/p2/${vendor}/${pkg}.json`, { json: true }));
  },

  async maven(coord) {
    const [group, artifact] = coord.split(':');
    const query = artifact === '*' ? `g:"${group}"` : `g:"${group}" AND a:"${artifact}"`;
    const search = await request(
      `https://search.maven.org/solrsearch/select?q=${encodeURIComponent(query)}&rows=1&wt=json`,
      { json: true },
    );
    if (search.status === 200 && search.body?.response?.numFound > 0) return ok();
    // Maven Central's own repository layout is authoritative when the search index lags or errors.
    const groupPath = group.replaceAll('.', '/');
    const central = artifact === '*'
      ? await request(`https://repo1.maven.org/maven2/${groupPath}/`)
      : await request(`https://repo1.maven.org/maven2/${groupPath}/${artifact}/maven-metadata.xml`);
    if (central.status === 200) return ok('via repo1.maven.org');
    // AndroidX and other Google artifacts are published to Google's Maven repository, not Central.
    const google = await request(`https://dl.google.com/android/maven2/${groupPath}/group-index.xml`);
    if (google.status === 200 && (artifact === '*' || google.body.includes(`<${artifact} `))) return ok('via Google Maven');
    if (search.status !== 200) return fail(`search ${search.status ? `HTTP ${search.status}` : search.error}; not in repo1 or Google Maven`);
    return fail('numFound 0; not in repo1 or Google Maven');
  },

  async nuget(id) {
    return fromStatus(await request(`https://api.nuget.org/v3-flatcontainer/${id.toLowerCase()}/index.json`, { json: true }));
  },

  async hex(name) {
    return fromStatus(await request(`https://hex.pm/api/packages/${encodeURIComponent(name)}`, { json: true }));
  },

  async docker(image) {
    const parts = image.split('/');
    let hub = null;
    if (parts.length <= 2) {
      const [ns, repo] = parts.length === 1 ? ['library', parts[0]] : parts;
      hub = await request(`https://hub.docker.com/v2/repositories/${ns}/${repo}/`, { json: true });
      if (hub.status === 200) return ok();
    }
    const registry = DOCKER_REGISTRY.get(image);
    if (registry) {
      const r = await registryTags(registry, image);
      return r.status === 200 ? ok(`via ${registry}`) : fail(`${registry}: ${r.status ? `HTTP ${r.status}` : r.error}`);
    }
    return hub ? fromStatus(hub) : fail('not a Docker Hub path and no registry configured');
  },
};

function goEscape(path) {
  return path.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
}

function goLatest(path) {
  return request(`https://proxy.golang.org/${goEscape(path)}/@latest`, { json: true });
}

// Docker Registry HTTP API v2 with the standard anonymous bearer-token handshake.
async function registryTags(registry, repo) {
  const url = `https://${registry}/v2/${repo}/tags/list`;
  const first = await fetchOnce(url);
  if (first.status !== 401) return first;
  const challenge = first.headers?.get('www-authenticate') ?? '';
  const params = Object.fromEntries([...challenge.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  if (!params.realm) return first;
  const tokenUrl = new URL(params.realm);
  if (params.service) tokenUrl.searchParams.set('service', params.service);
  tokenUrl.searchParams.set('scope', params.scope ?? `repository:${repo}:pull`);
  const token = await request(tokenUrl.href, { json: true });
  const bearer = token.body?.token ?? token.body?.access_token;
  if (!bearer) return { status: token.status || 0, error: 'no anonymous token' };
  return fetchOnce(url, { Authorization: `Bearer ${bearer}` });
}

// 401 must reach the caller (it starts the token handshake), so this bypasses JSON parsing.
async function fetchOnce(url, headers = {}) {
  const r = await request(url, { headers: { Accept: 'application/json', ...headers } });
  return r;
}

// ───────────────────────────── Main ─────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const ecosystems = [...ECOSYSTEMS, 'docker'].filter((e) => !opts.only || opts.only.has(e));
  if (opts.only) {
    const unknown = [...opts.only].filter((e) => !ECOSYSTEMS.includes(e) && e !== 'docker');
    if (unknown.length) {
      console.error(`unknown ecosystem(s): ${unknown.join(', ')}`);
      process.exit(2);
    }
  }
  const entries = TECHNOLOGIES.filter((t) => !opts.ids || opts.ids.has(t.id));
  if (opts.ids) {
    const missing = [...opts.ids].filter((id) => !entries.some((t) => t.id === id));
    if (missing.length) console.warn(`warning: unknown id(s): ${missing.join(', ')}`);
  }

  // One task per distinct (ecosystem, name); wildcard prefixes cannot be looked up, except a
  // Maven 'group:*', which is checked as a group.
  const tasks = new Map();
  const stats = Object.fromEntries(ecosystems.map((e) => [e, { checked: 0, passed: 0, failed: 0, wildcard: 0, allowed: 0 }]));
  for (const t of entries) {
    for (const eco of ecosystems) {
      for (const name of t[eco] ?? []) {
        const key = `${eco}:${name}`;
        if (tasks.has(key)) { tasks.get(key).ids.push(t.id); continue; }
        const isWildcard = name.endsWith('*') && !(eco === 'maven' && name.endsWith(':*'));
        tasks.set(key, { eco, name, ids: [t.id], isWildcard });
      }
    }
  }

  const queue = [...tasks.values()];
  const failures = [];
  let done = 0;
  const total = queue.filter((q) => !q.isWildcard && !ALLOW_UNVERIFIED.has(`${q.eco}:${q.name}`)).length;
  const progress = process.stderr.isTTY
    ? () => process.stderr.write(`\r  verified ${done}/${total}`)
    : () => {};

  async function worker() {
    for (let task = queue.shift(); task; task = queue.shift()) {
      const s = stats[task.eco];
      if (task.isWildcard) { s.wildcard++; continue; }
      const allowReason = ALLOW_UNVERIFIED.get(`${task.eco}:${task.name}`);
      if (allowReason) { s.allowed++; continue; }
      s.checked++;
      let result;
      try {
        result = await checkers[task.eco](task.name);
      } catch (err) {
        result = fail(`error: ${err.message}`);
      }
      if (result.ok) {
        s.passed++;
        if (opts.verbose) console.log(`ok   ${task.eco.padEnd(8)} ${task.name}${result.detail ? `  (${result.detail})` : ''}`);
      } else {
        s.failed++;
        failures.push({ ...task, detail: result.detail });
      }
      done++;
      progress();
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (process.stderr.isTTY) process.stderr.write('\n');

  console.log('\nEcosystem  checked  passed  failed  wildcard  allowed');
  for (const eco of ecosystems) {
    const s = stats[eco];
    if (!s.checked && !s.wildcard && !s.allowed) continue;
    console.log(
      `${eco.padEnd(10)} ${String(s.checked).padStart(7)} ${String(s.passed).padStart(7)} ${String(s.failed).padStart(7)} ${String(s.wildcard).padStart(9)} ${String(s.allowed).padStart(8)}`,
    );
  }

  if (failures.length) {
    failures.sort((a, b) => a.eco.localeCompare(b.eco) || a.name.localeCompare(b.name));
    console.log(`\n${failures.length} name(s) not found:\n`);
    const w1 = Math.max(9, ...failures.map((f) => f.eco.length));
    const w2 = Math.max(4, ...failures.map((f) => f.name.length));
    console.log(`${'ecosystem'.padEnd(w1)}  ${'name'.padEnd(w2)}  ${'entry'.padEnd(24)}  reason`);
    for (const f of failures) {
      console.log(`${f.eco.padEnd(w1)}  ${f.name.padEnd(w2)}  ${f.ids.join(',').padEnd(24)}  ${f.detail}`);
    }
    process.exit(1);
  }
  console.log('\nAll names verified.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
