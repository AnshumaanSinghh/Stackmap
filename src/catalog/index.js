// Turns names found in a codebase (packages, images, env vars, hosts, Terraform types)
// into catalog technologies. Exact names always win over trailing-* wildcards.

import { TECHNOLOGIES } from './data.js';
import { CATEGORIES, ECOSYSTEMS, columnOf } from './categories.js';

const normalisers = {
  npm: (n) => n,
  pypi: (n) => n.toLowerCase().replace(/[-_.]+/g, '-'),
  go: (n) => n.toLowerCase(),
  cargo: (n) => n.toLowerCase().replace(/_/g, '-'),
  gem: (n) => n.toLowerCase(),
  composer: (n) => n.toLowerCase(),
  maven: (n) => n.toLowerCase(),
  nuget: (n) => n.toLowerCase(),
  hex: (n) => n.toLowerCase(),
  docker: (n) => n.toLowerCase(),
  env: (n) => n.toUpperCase(),
};

class Matcher {
  constructor(normalise) {
    this.normalise = normalise;
    this.exact = new Map();
    this.prefixes = []; // [prefix, entry], longest first
  }
  add(name, entry) {
    const n = this.normalise(name);
    if (n.endsWith('*')) this.prefixes.push([n.slice(0, -1), entry]);
    else if (!this.exact.has(n)) this.exact.set(n, entry);
  }
  finish() {
    this.prefixes.sort((a, b) => b[0].length - a[0].length);
  }
  match(name) {
    const n = this.normalise(name);
    const hit = this.exact.get(n);
    if (hit) return hit;
    for (const [p, entry] of this.prefixes) if (n.startsWith(p)) return entry;
    return null;
  }
}

export function createCatalog(extra = []) {
  const entries = [...TECHNOLOGIES];
  for (const e of extra) {
    const i = entries.findIndex((x) => x.id === e.id);
    if (i === -1) entries.push(e);
    else entries[i] = { ...entries[i], ...e };
  }

  const byId = new Map(entries.map((e) => [e.id, e]));
  const packages = Object.fromEntries(ECOSYSTEMS.map((eco) => [eco, new Matcher(normalisers[eco])]));
  const goModules = []; // [prefix, entry]
  const docker = new Matcher(normalisers.docker);
  const env = new Matcher(normalisers.env);
  const pyModules = new Map();
  const hosts = [];
  const terraform = [];
  const schemes = new Map();
  const platformFiles = [];

  for (const e of entries) {
    for (const eco of ECOSYSTEMS) {
      for (const name of e[eco] ?? []) {
        if (eco === 'go') goModules.push([name.toLowerCase().replace(/\*$/, ''), e]);
        else packages[eco].add(name, e);
      }
    }
    for (const img of e.docker ?? []) docker.add(img, e);
    for (const name of e.env ?? []) env.add(name, e);
    for (const m of e.pyModules ?? []) if (!pyModules.has(m)) pyModules.set(m, e);
    for (const dist of e.pypi ?? []) {
      if (dist.endsWith('*')) continue;
      const mod = dist.toLowerCase().replace(/-/g, '_');
      if (!pyModules.has(mod)) pyModules.set(mod, e);
    }
    for (const h of e.hosts ?? []) hosts.push([h.toLowerCase(), e]);
    for (const t of e.terraform ?? []) terraform.push([t.replace(/\*$/, ''), e]);
    for (const s of e.schemes ?? []) if (!schemes.has(s)) schemes.set(s.toLowerCase(), e);
    for (const f of e.files ?? []) platformFiles.push([f, e]);
  }
  // Datastore image names usable for fuzzy matching (single words, 4+ letters: postgres, redis, minio ...).
  const dockerBases = [];
  for (const e of entries) {
    if (e.kind !== 'datastore') continue;
    for (const img of e.docker ?? []) {
      const last = img.replace(/\*$/, '').split('/').pop().toLowerCase();
      if (/^[a-z]{4,}$/.test(last) && !dockerBases.some(([b]) => b === last)) dockerBases.push([last, e]);
    }
  }
  Object.values(packages).forEach((m) => m.finish());
  docker.finish();
  env.finish();
  goModules.sort((a, b) => b[0].length - a[0].length);
  hosts.sort((a, b) => b[0].length - a[0].length);
  terraform.sort((a, b) => b[0].length - a[0].length);

  return {
    entries,
    get: (id) => byId.get(id) ?? null,
    column: (entry) => (entry.kind === 'datastore' ? 'data' : entry.kind === 'external' ? columnOf(entry.category) : 'none'),

    matchPackage(ecosystem, name) {
      if (!name) return null;
      if (ecosystem === 'go') {
        const n = name.toLowerCase();
        for (const [p, e] of goModules) if (n === p || n.startsWith(`${p}/`)) return e;
        return null;
      }
      return packages[ecosystem]?.match(name) ?? null;
    },

    /** Python import path like "google.cloud.storage" or "stripe". */
    matchPyModule(mod) {
      const parts = mod.split('.');
      for (let i = parts.length; i > 0; i--) {
        const hit = pyModules.get(parts.slice(0, i).join('.').toLowerCase());
        if (hit) return hit;
      }
      return null;
    },

    matchDockerImage(image) {
      const repo = dockerRepo(image);
      if (!repo) return null;
      const hit = docker.match(repo);
      if (hit) return hit;
      // Custom builds of well-known stores: "immich-app/postgres", "bitnamilegacy/redis-cluster",
      // "twentycrm/twenty-postgres-spilo". Match a datastore name as a whole word of the last segment.
      const last = repo.split('/').pop();
      const words = last.split(/[-_.]/);
      for (const [base, e] of dockerBases) if (last === base || words.includes(base)) return e;
      return null;
    },

    matchEnv(name) {
      return env.match(name);
    },

    matchHost(host) {
      const h = host.toLowerCase();
      for (const [p, e] of hosts) if (h === p || h.endsWith(`.${p}`)) return e;
      return null;
    },

    matchTerraform(type) {
      for (const [p, e] of terraform) if (type === p || type.startsWith(p)) return e;
      return null;
    },

    matchScheme(scheme) {
      return schemes.get(scheme.toLowerCase()) ?? null;
    },

    /** Platform entries whose `files` match a repo-relative path. */
    matchPlatformFile(rel) {
      const base = rel.slice(rel.lastIndexOf('/') + 1);
      const hits = [];
      for (const [f, e] of platformFiles) {
        if (f.includes('/') ? rel === f || rel.endsWith(`/${f}`) : base === f) hits.push(e);
      }
      return hits;
    },

    categoryLabel: (c) => CATEGORIES[c]?.label ?? c,
  };
}

/** "docker.io/library/postgres:16-alpine@sha256:..." -> "postgres" */
export function dockerRepo(image) {
  if (!image || typeof image !== 'string') return null;
  // Resolve compose interpolation: ${VAR:-default} -> default, ${VAR} -> ''.
  let s = image.trim().replace(/\$\{[A-Za-z_][\w]*(?::?[-=?]([^}]*))?\}/g, (_, def) => def ?? '');
  if (!s) return null;
  s = s.replace(/@sha256:[a-f0-9]+$/i, '');
  // Strip a tag (the last ':' after the last '/').
  const slash = s.lastIndexOf('/');
  const colon = s.lastIndexOf(':');
  if (colon > slash) s = s.slice(0, colon);
  const parts = s.split('/');
  if (parts.length > 1 && (/[.:]/.test(parts[0]) || parts[0] === 'localhost')) parts.shift();
  if (parts[0] === 'library' && parts.length === 2) parts.shift();
  const repo = parts.join('/').toLowerCase();
  if (!repo || repo.includes('${') || repo.includes('{{')) return null;
  return repo;
}
