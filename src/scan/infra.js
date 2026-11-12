// Infrastructure files: env examples, docker-compose, Kubernetes, Terraform, Dockerfiles,
// platform configs and database configuration hints. Values from env files are never kept:
// only the variable name, the URL scheme and the host name are used.

import { parseToml } from '../parse/toml.js';
import { parseYaml, parseYamlAll } from '../parse/yaml.js';
import { lineOf } from '../parse/lines.js';
import { baseOf, dirOf, findLine, readText } from './files.js';

// ------------------------------------------------------------------ env examples

/** .env.example, .env.sample, .env.local.example, example.env, env.example ... never a real .env */
export function isEnvExample(file) {
  const b = baseOf(file).toLowerCase();
  if (/^\.env(\.[\w-]+)*\.(example|sample|template|dist|defaults?|tmpl|tpl)$/.test(b)) return true;
  if (/^\.env\.(example|sample|template)(\.[\w-]+)*$/.test(b)) return true;
  if (/^(example|sample|template)\.env$/.test(b) || b === 'env.example' || b === 'env.sample') return true;
  return false;
}

/** Parse "postgres://u:p@db:5432/x" -> { scheme: 'postgres', host: 'db' }. */
export function parseUrlish(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().replace(/^['"]|['"]$/g, '').replace(/^jdbc:/i, '');
  const m = v.match(/^([a-z][a-z0-9+.-]*):\/\/(?:[^@/\s]*@)?(\[[^\]]+\]|[^:/?#\s,]+)?/i);
  if (!m) return null;
  return { scheme: m[1].toLowerCase(), host: (m[2] ?? '').toLowerCase().replace(/^\$\{.*\}$/, '') };
}

export function readEnvExample(root, file) {
  const text = readText(root, file, 512 * 1024);
  if (text == null) return [];
  const out = [];
  text.split('\n').forEach((raw, i) => {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/);
    if (!m) return;
    const value = m[2].replace(/\s+#.*$/, '');
    const url = parseUrlish(value);
    out.push({ name: m[1], line: i + 1, scheme: url?.scheme ?? null, host: url?.host ?? null, file, keyText: `${m[1]}=` });
    // Laravel: DB_CONNECTION=pgsql
    if (m[1] === 'DB_CONNECTION') out.at(-1).dbConnection = value.trim().replace(/^['"]|['"]$/g, '');
  });
  return out;
}

// ------------------------------------------------------------------ docker compose

export function isComposeFile(file) {
  const b = baseOf(file);
  if (/(^|\/)\.devcontainer\//.test(file)) return false;
  if (!/^(docker-|podman-)?compose([.-][\w.-]+)?\.ya?ml$/i.test(b)) return false;
  // Test and CI compose files describe test infrastructure, not the system.
  return !/[.-](test|tests|testing|e2e|ci|integration|perf|bench)([.-]|\.ya?ml$)/i.test(b);
}

export function readCompose(root, file) {
  const text = readText(root, file);
  if (text == null) return null;
  const doc = parseYaml(text);
  const services = doc?.services;
  if (!services || typeof services !== 'object') return { file, services: [] };
  const dir = dirOf(file);
  const out = [];
  for (const [name, svc] of Object.entries(services)) {
    if (!svc || typeof svc !== 'object') continue;
    const line = lineOf(services, name) ?? 1;
    const s = { name, line, file, image: null, imageLine: line, build: null, dependsOn: [], env: [], links: [], command: '', profiles: null };
    if (Array.isArray(svc.profiles) && svc.profiles.length) s.profiles = svc.profiles.map(String);
    if (typeof svc.command === 'string') s.command = svc.command;
    else if (Array.isArray(svc.command)) s.command = svc.command.join(' ');
    if (typeof svc.entrypoint === 'string') s.command = `${svc.entrypoint} ${s.command}`;
    if (typeof svc.image === 'string') {
      s.image = svc.image;
      s.imageLine = lineOf(svc, 'image') ?? line;
    }
    if (svc.build != null) {
      const ctx = typeof svc.build === 'string' ? svc.build : svc.build.context ?? '.';
      const dockerfile = typeof svc.build === 'object' ? svc.build.dockerfile ?? null : null;
      s.build = { context: ctx, dockerfile, line: lineOf(svc, 'build') ?? line, composeDir: dir };
    }
    if (Array.isArray(svc.depends_on)) {
      svc.depends_on.forEach((d, i) => typeof d === 'string' && s.dependsOn.push({ name: d, line: lineOf(svc.depends_on, i) ?? line }));
    } else if (svc.depends_on && typeof svc.depends_on === 'object') {
      for (const d of Object.keys(svc.depends_on)) s.dependsOn.push({ name: d, line: lineOf(svc.depends_on, d) ?? line });
    }
    if (Array.isArray(svc.links)) {
      svc.links.forEach((l, i) => typeof l === 'string' && s.links.push({ name: l.split(':')[0], line: lineOf(svc.links, i) ?? line }));
    }
    const env = svc.environment;
    const addEnv = (k, v, l) => {
      const url = parseUrlish(String(v ?? ''));
      s.env.push({ name: k, line: l, scheme: url?.scheme ?? null, host: url?.host ?? null, file, rawHost: hostLike(v) });
    };
    if (Array.isArray(env)) {
      env.forEach((e, i) => {
        if (typeof e !== 'string') return;
        const eq = e.indexOf('=');
        addEnv(eq === -1 ? e : e.slice(0, eq), eq === -1 ? '' : e.slice(eq + 1), lineOf(env, i) ?? line);
      });
    } else if (env && typeof env === 'object') {
      for (const [k, v] of Object.entries(env)) addEnv(k, v, lineOf(env, k) ?? line);
    }
    out.push(s);
  }
  return { file, services: out };
}

// "db:5432" or "redis" as a bare host value (REDIS_HOST=redis)
function hostLike(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^([a-z][a-z0-9_-]*)(?::\d+)?$/i);
  return m ? m[1].toLowerCase() : null;
}

// ------------------------------------------------------------------ Kubernetes

const K8S_PATH = /(^|\/)(k8s|kube|kubernetes|manifests?|deploy(ment)?s?|helm|charts?|kustomize|overlays|base|infra|ops|argocd|gitops)(\/|$)/i;

export function maybeK8s(file) {
  return /\.ya?ml$/i.test(file) && K8S_PATH.test(file) && !/(^|\/)templates\//.test(file);
}

const WORKLOADS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'Pod', 'ReplicaSet']);

export function readK8s(root, file) {
  const text = readText(root, file, 512 * 1024);
  if (text == null || !/^\s*kind:\s*(Deployment|StatefulSet|DaemonSet|Job|CronJob|Pod)\b/m.test(text)) return [];
  let docs;
  try {
    docs = parseYamlAll(text);
  } catch {
    return [];
  }
  const out = [];
  for (const doc of docs) {
    if (!doc || typeof doc !== 'object' || !WORKLOADS.has(doc.kind)) continue;
    const name = doc.metadata?.name;
    if (typeof name !== 'string') continue;
    const podSpec = doc.kind === 'CronJob' ? doc.spec?.jobTemplate?.spec?.template?.spec : doc.kind === 'Pod' ? doc.spec : doc.spec?.template?.spec;
    const containers = [...(podSpec?.containers ?? [])];
    const w = { name, kind: doc.kind, file, line: findLine(text, new RegExp(`^\\s*name:\\s*['"]?${escapeRe(name)}['"]?\\s*$`)) || 1, images: [], env: [] };
    for (const c of containers) {
      if (typeof c?.image === 'string') w.images.push({ image: c.image, line: findLine(text, (l) => l.includes(c.image)) || w.line });
      for (const e of c?.env ?? []) {
        if (typeof e?.name !== 'string') continue;
        const url = parseUrlish(typeof e.value === 'string' ? e.value : '');
        w.env.push({ name: e.name, line: findLine(text, new RegExp(`name:\\s*['"]?${escapeRe(e.name)}['"]?\\s*$`)) || w.line, scheme: url?.scheme ?? null, host: url?.host ?? null, file });
      }
    }
    out.push(w);
  }
  return out;
}

// ------------------------------------------------------------------ Terraform

export function readTerraform(root, file) {
  const text = readText(root, file, 1024 * 1024);
  if (text == null) return [];
  const out = [];
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    const m = l.match(/^\s*resource\s+"([a-z0-9_]+)"\s+"([^"]+)"/);
    if (m) out.push({ type: m[1], name: m[2], line: i + 1, text: l });
  });
  return out;
}

// ------------------------------------------------------------------ Dockerfile

export function isDockerfile(file) {
  const b = baseOf(file);
  return /^Dockerfile([.-][\w.-]+)?$/i.test(b) || /\.Dockerfile$/i.test(b) || /^Containerfile$/.test(b);
}

export function readDockerfile(root, file) {
  const text = readText(root, file, 256 * 1024);
  if (text == null) return { file, from: [] };
  const from = [];
  text.split('\n').forEach((l, i) => {
    const m = l.match(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/i);
    if (m) from.push({ image: m[1], line: i + 1, text: l });
  });
  return { file, from };
}

// ------------------------------------------------------------------ Cloudflare Wrangler bindings

const WRANGLER_BINDINGS = [
  ['kv_namespaces', 'cloudflare-kv'],
  ['d1_databases', 'cloudflare-d1'],
  ['r2_buckets', 'cloudflare-r2'],
  ['vectorize', 'cloudflare-vectorize'],
  ['hyperdrive', 'postgresql'],
  ['durable_objects', 'cloudflare-durable-objects'],
  ['ai', 'cloudflare-workers-ai'],
];

export function readWrangler(root, file) {
  const text = readText(root, file, 256 * 1024);
  if (text == null) return [];
  let doc;
  try {
    doc = file.endsWith('.toml') ? parseToml(text) : JSON.parse(stripJsonComments(text));
  } catch {
    return [];
  }
  const out = [];
  for (const [key, techId] of WRANGLER_BINDINGS) {
    const v = doc[key];
    if (v == null || (Array.isArray(v) && v.length === 0)) continue;
    const line = findLine(text, new RegExp(`(\\[\\[?\\s*${key}\\b|"${key}"\\s*:|^\\s*${key}\\s*=)`)) || 1;
    out.push({ techId, line, file, text: text.split('\n')[line - 1] ?? key });
  }
  const queues = doc.queues;
  if (queues && (queues.producers?.length || queues.consumers?.length)) {
    const line = findLine(text, /queues/) || 1;
    out.push({ techId: 'cloudflare-queues', line, file, text: text.split('\n')[line - 1] ?? 'queues' });
  }
  return out;
}

export function stripJsonComments(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n';
        i++;
      }
      i++;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

// ------------------------------------------------------------------ Render blueprint

export function readRenderYaml(root, file) {
  const text = readText(root, file);
  if (text == null) return { services: [], databases: [] };
  let doc;
  try {
    doc = parseYaml(text);
  } catch {
    return { services: [], databases: [] };
  }
  const services = [];
  (doc?.services ?? []).forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    services.push({ name: s.name, type: s.type, rootDir: s.rootDir ?? null, line: lineOf(doc.services, i) ?? 1, file });
  });
  const databases = [];
  (doc?.databases ?? []).forEach((d, i) => {
    if (d && typeof d === 'object') databases.push({ name: d.name, line: lineOf(doc.databases, i) ?? 1, file });
  });
  return { services, databases };
}

// ------------------------------------------------------------------ database config hints
// Each hint says "code in this directory talks to <database> through <client>".

const PRISMA_PROVIDERS = { postgresql: 'postgresql', postgres: 'postgresql', mysql: 'mysql', sqlite: 'sqlite', sqlserver: 'mssql', mongodb: 'mongodb', cockroachdb: 'cockroachdb' };
const DRIZZLE_DIALECTS = { postgresql: 'postgresql', pg: 'postgresql', mysql: 'mysql', mysql2: 'mysql', sqlite: 'sqlite', turso: 'turso', singlestore: 'singlestore', gel: 'gel' };
const DJANGO_ENGINES = { postgresql: 'postgresql', postgresql_psycopg2: 'postgresql', postgis: 'postgresql', mysql: 'mysql', sqlite3: 'sqlite', oracle: 'oracle' };
const RAILS_ADAPTERS = { postgresql: 'postgresql', postgis: 'postgresql', mysql2: 'mysql', trilogy: 'mysql', sqlite3: 'sqlite', sqlserver: 'mssql' };
const JDBC = { postgresql: 'postgresql', mysql: 'mysql', mariadb: 'mariadb', sqlserver: 'mssql', oracle: 'oracle', h2: 'h2', sqlite: 'sqlite' };
export const LARAVEL_CONNECTIONS = { pgsql: 'postgresql', mysql: 'mysql', mariadb: 'mariadb', sqlite: 'sqlite', sqlsrv: 'mssql' };

export function isDbConfigFile(file) {
  const b = baseOf(file);
  return (
    b.endsWith('.prisma') ||
    /^drizzle\.config\.(ts|js|mjs|cjs|json)$/.test(b) ||
    (/settings/.test(file) && b.endsWith('.py')) ||
    b === 'database.yml' ||
    /^application(-[\w]+)?\.(properties|ya?ml)$/.test(b) ||
    (b === 'database.php' && /config\//.test(file)) ||
    b === 'ormconfig.json' || b === 'knexfile.js' || b === 'knexfile.ts'
  );
}

export function readDbHints(root, file) {
  const text = readText(root, file, 512 * 1024);
  if (text == null) return [];
  const b = baseOf(file);
  const hints = [];
  const add = (tech, via, re) => {
    const line = findLine(text, re) || 1;
    hints.push({ tech, via, file, line, text: text.split('\n')[line - 1] ?? '' });
  };
  if (b.endsWith('.prisma')) {
    const m = text.match(/datasource\s+\w+\s*\{[\s\S]*?provider\s*=\s*"(\w+)"/);
    if (m && PRISMA_PROVIDERS[m[1]]) {
      const line = text.slice(0, m.index + m[0].length).split('\n').length;
      hints.push({ tech: PRISMA_PROVIDERS[m[1]], via: 'Prisma', file, line, text: text.split('\n')[line - 1] ?? '' });
    }
  } else if (b.startsWith('drizzle.config')) {
    const m = text.match(/(?:dialect|driver)\s*:\s*['"](\w+)['"]/);
    if (m && DRIZZLE_DIALECTS[m[1]]) add(DRIZZLE_DIALECTS[m[1]], 'Drizzle', /(dialect|driver)\s*:/);
  } else if (b.endsWith('.py')) {
    const m = text.match(/django\.(?:contrib\.gis\.)?db\.backends\.(\w+)/);
    if (m && DJANGO_ENGINES[m[1]]) add(DJANGO_ENGINES[m[1]], 'Django ORM', /django\.(contrib\.gis\.)?db\.backends\./);
    else if (/dj_database_url|DATABASES\s*=/.test(text) && /postgres/.test(text)) add('postgresql', 'Django ORM', /postgres/);
  } else if (b === 'database.yml') {
    const m = text.match(/adapter:\s*['"]?(\w+)/);
    if (m && RAILS_ADAPTERS[m[1]]) add(RAILS_ADAPTERS[m[1]], 'Active Record', /adapter:/);
  } else if (b.startsWith('application')) {
    const m = text.match(/jdbc:(\w+):/);
    if (m && JDBC[m[1]]) add(JDBC[m[1]], 'JDBC', /jdbc:/);
    if (/spring\.data\.mongodb|mongodb:\/\//.test(text)) add('mongodb', 'Spring Data', /mongodb/);
    if (/spring\.(data\.)?redis/.test(text)) add('redis', 'Spring Data', /spring\.(data\.)?redis/);
    if (/spring\.kafka/.test(text)) add('kafka', 'Spring Kafka', /spring\.kafka/);
    if (/spring\.rabbitmq/.test(text)) add('rabbitmq', 'Spring AMQP', /spring\.rabbitmq/);
  } else if (b === 'database.php') {
    const m = text.match(/'default'\s*=>\s*env\(\s*'DB_CONNECTION'\s*,\s*'(\w+)'/);
    if (m && LARAVEL_CONNECTIONS[m[1]]) add(LARAVEL_CONNECTIONS[m[1]], 'Eloquent', /'default'\s*=>/);
  } else if (b === 'ormconfig.json') {
    const m = text.match(/"type"\s*:\s*"(\w+)"/);
    const map = { postgres: 'postgresql', mysql: 'mysql', mariadb: 'mariadb', sqlite: 'sqlite', mssql: 'mssql', mongodb: 'mongodb' };
    if (m && map[m[1]]) add(map[m[1]], 'TypeORM', /"type"/);
  } else if (b.startsWith('knexfile')) {
    const m = text.match(/client\s*:\s*['"](\w+)['"]/);
    const map = { pg: 'postgresql', postgres: 'postgresql', postgresql: 'postgresql', mysql: 'mysql', mysql2: 'mysql', sqlite3: 'sqlite', 'better-sqlite3': 'sqlite' };
    if (m && map[m[1]]) add(map[m[1]], 'Knex', /client\s*:/);
  }
  return hints;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
