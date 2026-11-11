// scan(root) -> the Stackmap graph.
//
// 1. Find units: every directory with a package manifest (package.json, pyproject.toml, go.mod, ...).
// 2. Read each unit's runtime source once: imports, env vars read, API hosts called.
// 3. Match everything against the catalog: dependencies, imports, env vars, hosts,
//    docker-compose services, Kubernetes workloads, Terraform resources, DB config.
// 4. Every node and edge keeps the evidence (file, line, code) that created it.

import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createCatalog, dockerRepo } from '../catalog/index.js';
import { CATEGORIES } from '../catalog/categories.js';
import { loadConfig } from '../config.js';
import { gitInfo } from '../git.js';
import { baseOf, compileGlobs, dirOf, joinRel, listFiles, readText, snippet } from '../scan/files.js';
import { manifestEcosystem, readGradleCatalog, readManifest, readWorkspaceGlobs } from '../scan/manifests.js';
import { analyzeSource, isGoStdlib, isRuntimePath, languageOf, LANGUAGES } from '../scan/source.js';
import {
  isComposeFile, isDbConfigFile, isDockerfile, isEnvExample, LARAVEL_CONNECTIONS, maybeK8s, readCompose,
  readDbHints, readDockerfile, readEnvExample, readK8s, readRenderYaml, readTerraform, readWrangler,
} from '../scan/infra.js';
import { matchesSelector } from './select.js';

export const SCHEMA = 'stackmap/1';
export const VERSION = '1.0.0';

const CONFIDENCE = { inferred: 1, declared: 2, configured: 3, imported: 4 };
const MAX_EVIDENCE = 6;
const MAX_SOURCE_FILES = 60_000;
const MAX_SOURCE_FILES_PER_UNIT = 6_000;
// Files at a unit's root (or src/) that mark it as an app that runs, not a package.
const APP_FILE = /^(src\/)?(index\.html|vite\.config\.[cm]?[jt]s|next\.config\.[cm]?[jt]s|nuxt\.config\.[jt]s|svelte\.config\.[jt]s|astro\.config\.[cm]?[jt]s|remix\.config\.[cm]?js|react-router\.config\.ts|angular\.json|app\.json|electron-builder\.(json|ya?ml)|tauri\.conf\.json|Procfile|main\.(ts|js)|server\.(ts|js))$/;
const MAX_SOURCE_BYTES = 512 * 1024;

// Manifests in these folders are examples, fixtures or templates, not parts of the system.
const NOT_A_UNIT = /(^|\/)(examples?|example[-_]apps?|samples?|playgrounds?|fixtures?|__fixtures__|__tests__|tests?|e2e|testdata|templates?|boilerplates?|starters?|\.github|node_modules|vendor|third[-_]?party)(\/|$)/i;
// Packages that only hold tests: "app-tests", "e2e-utils", "integration-tests", "test-utils".
const TEST_PACKAGE = /(^|[-_.])(tests?|e2e|specs?|testing|test-utils|integration-tests|load-tests|benchmarks?)$|^(e2e|tests?)[-_]/i;
const LIBRARY_ROOTS = /^(packages|libs?|modules|shared|common|internal|crates|pkg|sdks?|plugins|tooling|tools|configs?)(\/|$)/i;
const WORKER_NAME = /(^|[-_/@])(workers?|jobs?|queues?|consumers?|cron|crons|scheduler|tasks|background)([-_/]|$)/i;
const WORKER_COMMAND = /\b(celery|sidekiq|rq\s+worker|dramatiq|huey|arq|queue:work|horizon|good_job|solid_queue|worker|beat|cron)\b/i;

/**
 * @param {string} rootDir
 * @param {{ config?: object, configFile?: string, ignore?: string[] }} [opts]
 */
export function scan(rootDir, opts = {}) {
  const t0 = performance.now();
  const root = path.resolve(rootDir);
  const loaded = opts.config ? { config: opts.config, file: null, errors: [] } : loadConfig(root, opts.configFile);
  const config = loaded.config;
  const warnings = [...loaded.errors];
  const catalog = createCatalog(config.technologies);
  const { files } = listFiles(root, { ignore: [...config.ignore, ...(opts.ignore ?? [])] });
  const forceInclude = compileGlobs(config.include);
  const g = new GraphBuilder(catalog);
  const lineCache = new Map();

  // ------------------------------------------------------------ 1. units
  const gradleCatalogFile = files.find((f) => f.endsWith('gradle/libs.versions.toml'));
  const gradleCatalog = gradleCatalogFile ? readGradleCatalog(root, gradleCatalogFile) : null;
  const unitsByDir = new Map();
  for (const file of files) {
    if (!manifestEcosystem(file)) continue;
    if ((NOT_A_UNIT.test(dirOf(file)) || TEST_PACKAGE.test(baseOf(dirOf(file)))) && !forceInclude(file)) continue;
    const m = readManifest(root, file, { gradleCatalog });
    if (!m) continue;
    warnings.push(...m.errors);
    let u = unitsByDir.get(m.dir);
    if (!u) {
      u = newUnit(m.dir);
      unitsByDir.set(m.dir, u);
    }
    u.manifests.push(m);
  }
  const rootWorkspaceGlobs = readWorkspaceGlobs(root, files);
  for (const u of unitsByDir.values()) finishUnit(u, rootWorkspaceGlobs);

  // Source files belong to the deepest unit that contains them.
  const unitDirs = [...unitsByDir.keys()].sort((a, b) => b.length - a.length);
  const ownerOf = (file) => {
    for (const d of unitDirs) if (d === '' || file === d || file.startsWith(`${d}/`)) return unitsByDir.get(d);
    return null;
  };

  // ------------------------------------------------------------ 2. source
  const languageCounts = {};
  let sourceRead = 0;
  let capped = 0;
  const orphanSources = [];
  const nested = new Set(); // unit dirs that contain other units
  for (const d of unitDirs) for (const p of unitDirs) if (p !== d && (d === '' || p.startsWith(`${d}/`))) nested.add(d);
  for (const file of files) {
    const u0 = ownerOf(file);
    // Files that mark a folder as a runnable app (as opposed to a package).
    if (u0 && APP_FILE.test(file.slice(u0.dir ? u0.dir.length + 1 : 0))) u0.appSignals.add(baseOf(file));
    const lang = languageOf(file);
    if (!lang) continue;
    languageCounts[LANGUAGES[lang].name] = (languageCounts[LANGUAGES[lang].name] ?? 0) + 1;
    const u = u0;
    const rel = u && u.dir ? file.slice(u.dir.length + 1) : file;
    if (!isRuntimePath(rel)) continue;
    if (!u) {
      orphanSources.push([file, lang]);
      continue;
    }
    // A per-unit budget keeps one giant package from starving the others.
    if (sourceRead >= MAX_SOURCE_FILES || u.sourceFiles >= MAX_SOURCE_FILES_PER_UNIT) {
      capped++;
      continue;
    }
    analyzeInto(u, file, lang);
  }
  if (capped) warnings.push(`Skipped ${capped} source files over the read budget (${MAX_SOURCE_FILES_PER_UNIT} per unit, ${MAX_SOURCE_FILES} total); the map may miss rare imports.`);
  // A repo with code but no manifest at all becomes one unit at the root.
  if (unitsByDir.size === 0 && orphanSources.length) {
    const u = newUnit('');
    u.implicit = true;
    finishUnit(u, []);
    unitsByDir.set('', u);
    unitDirs.push('');
    for (const [file, lang] of orphanSources) if (sourceRead < MAX_SOURCE_FILES) analyzeInto(u, file, lang);
  }

  function analyzeInto(u, file, lang) {
    const text = readText(root, file, MAX_SOURCE_BYTES);
    if (text == null) return;
    sourceRead++;
    u.sourceFiles++;
    u.langs[lang] = (u.langs[lang] ?? 0) + 1;
    if (lang === 'go' && /^package\s+main\b/m.test(text)) u.hasMain = true;
    if (lang === 'rs' && /(^|\/)src\/main\.rs$/.test(file)) u.hasMain = true;
    if (lang === 'py' && /(^|\/)(manage|main|app|wsgi|asgi|__main__|server)\.py$/.test(file)) u.hasMain = true;
    if (/\.(tsx|jsx|vue|svelte|astro)$/.test(file)) u.uiFiles++;
    const r = analyzeSource(text, lang);
    // Relative imports that land inside another unit's folder are dependencies on that unit.
    for (const rel of r.relative) {
      const target = joinRel(dirOf(file), rel.spec);
      if (target.startsWith('..')) continue;
      if (u.dir && (target === u.dir || target.startsWith(`${u.dir}/`)) && !nested.has(u.dir)) continue;
      const owner = ownerOf(`${target}/_`);
      if (owner && owner !== u && !u.crossImports.has(owner.dir)) u.crossImports.set(owner.dir, { file, line: rel.line, text: rel.text, unit: owner });
    }
    for (const imp of r.imports) {
      const key = `${lang}:${imp.name}`;
      if (!u.imports.has(key)) u.imports.set(key, { lang, name: imp.name, file, line: imp.line, text: imp.text });
    }
    for (const e of r.env) if (!u.env.has(e.name)) u.env.set(e.name, { file, line: e.line, text: e.text });
    for (const h of r.hosts) if (!u.hosts.has(h.host)) u.hosts.set(h.host, { file, line: h.line, text: h.text });
  }

  const units = [...unitsByDir.values()];
  const byPackage = new Map();
  for (const u of units) for (const m of u.manifests) if (m.name && (m.ecosystem === 'npm' || m.ecosystem === 'pypi' || m.ecosystem === 'cargo' || m.ecosystem === 'go' || m.ecosystem === 'hex')) {
    byPackage.set(`${m.ecosystem}:${normPkg(m.ecosystem, m.name)}`, u);
  }
  const byDir = (d) => unitsByDir.get(d) ?? null;
  // Published packages other units import (UI kits, SDKs): never "the app" a compose service runs.
  const importedLibraries = new Set();
  for (const u of units) {
    for (const m of u.manifests) for (const r of m.refs) if (r.kind === 'package') importedLibraries.add(byPackage.get(`${m.ecosystem}:${normPkg(m.ecosystem, r.value)}`));
    for (const imp of u.imports.values()) if (imp.lang === 'js' || imp.lang === 'ts') {
      const t = byPackage.get(`npm:${imp.name}`);
      if (t && t !== u) importedLibraries.add(t);
    }
  }
  for (const u of [...importedLibraries]) if (!u || !u.npmLibrary) importedLibraries.delete(u);

  // ------------------------------------------------------------ 3a. dependencies and imports
  // A monorepo root is orchestration (turbo, prettier, scripts), not a part of the system,
  // unless it is itself an app: a runtime framework in its dependencies or a start script.
  const ORCHESTRATOR = /\b(turbo|nx|lerna|rush|pnpm\s+(-r|--recursive|--filter|-F)|yarn\s+workspaces?|npm\s+(-w|--workspaces?)|concurrently|npm-run-all|run-p|run-s|docker[\s-]compose)\b/;
  for (const u of units) {
    const start = u.scripts?.start;
    // Root dependencies are often hoisted for the workspace, so a framework there only makes the
    // root an app when the root also holds a real amount of its own code.
    const framework = u.manifests.some((m) => m.deps.some((d) => !d.dev && catalog.matchPackage(m.ecosystem, d.name)?.kind === 'framework'));
    const nonNpmCode = u.manifests.some((m) => m.ecosystem !== 'npm') && u.sourceFiles >= 5;
    u.rootIsApp = Boolean(start && RUNNABLE_SCRIPT.test(start) && !ORCHESTRATOR.test(start)) || (framework && u.sourceFiles >= 10) || nonNpmCode;
  }
  // The root of a repo with several units is a unit only if it is an app in its own right
  // (a Rails or Go app at the root with a frontend folder beside it, for example).
  const isBareRoot = (u) => u.dir === '' && unitsByDir.size > 1 && !u.rootIsApp && (u.workspaceRoot || u.manifests.every((m) => m.ecosystem === 'npm'));
  for (const u of units) {
    if (isBareRoot(u)) continue; // hoisted deps count only where a unit imports them
    for (const m of u.manifests) {
      for (const dep of m.deps) {
        const internal = byPackage.get(`${m.ecosystem}:${normPkg(m.ecosystem, dep.name)}`);
        if (internal && internal !== u) continue; // handled as an internal edge
        const entry = catalog.matchPackage(m.ecosystem, dep.name);
        if (!entry) continue;
        const imp = findImport(u, m.ecosystem, dep.name, entry);
        const ev = evidence(m.file, dep.line, `${dep.name}`, dep.dev ? 'dev dependency' : 'dependency', readLine(m.file, dep.line));
        if (dep.dev && entry.kind !== 'framework' && entry.kind !== 'platform' && !imp) continue;
        u.matched.add(entry.id);
        use(u, entry, ev, imp ? 'imported' : 'declared', imp, scansImports(m.ecosystem) && u.langCount(m.ecosystem) > 0 && !imp);
      }
    }
  }
  // Imports that no manifest of the unit declares (hoisted root deps, Python namespace imports).
  for (const u of units) {
    for (const imp of u.imports.values()) {
      const entry = matchImport(imp);
      // Frameworks only count when declared: undeclared "imports" of React Native or Angular
      // are usually code samples inside strings (docs, onboarding snippets).
      if (!entry || u.matched.has(entry.id) || entry.kind === 'framework' || entry.kind === 'platform') {
        continue;
      }
      u.matched.add(entry.id);
      use(u, entry, null, 'imported', imp, false);
    }
  }

  function findImport(u, eco, depName, entry) {
    if (eco === 'npm') return u.imports.get(`js:${depName}`) ?? u.imports.get(`ts:${depName}`) ?? null;
    if (eco === 'pypi') {
      for (const imp of u.imports.values()) if (imp.lang === 'py' && catalog.matchPyModule(imp.name) === entry) return imp;
      return null;
    }
    if (eco === 'go') {
      for (const imp of u.imports.values()) if (imp.lang === 'go' && (imp.name === depName || imp.name.startsWith(`${depName}/`))) return imp;
      return null;
    }
    if (eco === 'cargo') return u.imports.get(`rs:${depName.replace(/-/g, '_')}`) ?? null;
    return null;
  }

  function matchImport(imp) {
    if (imp.lang === 'js' || imp.lang === 'ts') return catalog.matchPackage('npm', imp.name);
    if (imp.lang === 'py') return catalog.matchPyModule(imp.name);
    if (imp.lang === 'go') return isGoStdlib(imp.name) ? null : catalog.matchPackage('go', imp.name);
    if (imp.lang === 'rs') return catalog.matchPackage('cargo', imp.name.replace(/_/g, '-'));
    return null;
  }

  function use(u, entry, ev, confidence, imp, declaredOnly) {
    const evs = [ev, imp && evidence(imp.file, imp.line, entry.name, 'import', imp.text)].filter(Boolean);
    if (entry.kind === 'framework') {
      u.frameworks.set(entry.id, { entry, evidence: evs });
      return;
    }
    if (entry.kind === 'platform') {
      u.platforms.set(entry.id, { entry, evidence: evs });
      return;
    }
    if (entry.kind === 'client') {
      if (entry.role) u.roles.add(entry.role);
      if (entry.backs === 'sql') {
        u.sqlClients.push({ entry, evidence: evs, confidence });
        return;
      }
      const target = catalog.get(entry.backs);
      if (!target) return;
      g.edge(u.id, g.tech(target, evs).id, { kind: 'uses', via: entry.name, confidence, evidence: evs, declaredOnly });
      return;
    }
    if (entry.kind === 'datastore' || entry.kind === 'external') {
      g.edge(u.id, g.tech(entry, evs).id, { kind: 'uses', confidence, evidence: evs, declaredOnly });
    }
  }

  // ------------------------------------------------------------ 3b. infrastructure files
  const envDefs = new Map(); // NAME -> [{ file, line, scheme, host }]
  const addEnvDef = (d) => {
    if (!envDefs.has(d.name)) envDefs.set(d.name, []);
    envDefs.get(d.name).push(d);
  };
  const composeServices = [];
  const k8sWorkloads = [];
  const dbHints = [];
  const renders = [];
  const deployTargets = new Map();
  const notePlatform = (entry, file, line) => {
    if (!entry) return;
    const owner = ownerOf(file);
    const ev = evidence(file, line || 1, entry.name, 'deploy config', readLine(file, line || 1));
    if (!deployTargets.has(entry.id)) deployTargets.set(entry.id, { id: entry.id, name: entry.name, evidence: [] });
    pushEvidence(deployTargets.get(entry.id).evidence, ev);
    if (owner) owner.platforms.set(entry.id, { entry, evidence: [ev] });
  };

  for (const file of files) {
    const base = baseOf(file);
    // Infrastructure in examples, fixtures and tests describes some other system.
    if ((NOT_A_UNIT.test(dirOf(file)) || TEST_PACKAGE.test(baseOf(dirOf(file)))) && !forceInclude(file)) continue;
    for (const p of catalog.matchPlatformFile(file)) notePlatform(p, file, 1);
    try {
      if (isEnvExample(file)) {
        for (const d of readEnvExample(root, file)) addEnvDef(d);
      } else if (isComposeFile(file)) {
        const c = readCompose(root, file);
        if (c) composeServices.push(...c.services);
      } else if (maybeK8s(file)) {
        k8sWorkloads.push(...readK8s(root, file));
      } else if (file.endsWith('.tf')) {
        for (const r of readTerraform(root, file)) {
          const entry = catalog.matchTerraform(r.type);
          if (entry && (entry.kind === 'datastore' || entry.kind === 'external')) {
            g.tech(entry, [evidence(file, r.line, entry.name, 'terraform resource', r.text)]);
          }
        }
      } else if (isDockerfile(file)) {
        const d = readDockerfile(root, file);
        const owner = ownerOf(file);
        const docker = catalog.get('docker');
        if (owner && docker && d.from.length) owner.platforms.set('docker', { entry: docker, evidence: [evidence(file, d.from[0].line, 'Docker', 'Dockerfile', d.from[0].text)] });
        if (owner) owner.hasDockerfile = true;
      } else if (/^wrangler\.(toml|json|jsonc)$/.test(base)) {
        const owner = ownerOf(file);
        for (const b of readWrangler(root, file)) {
          const entry = catalog.get(b.techId);
          if (!entry) continue;
          const ev = evidence(file, b.line, entry.name, 'Cloudflare binding', b.text);
          if (owner) g.edge(owner.id, g.tech(entry, [ev]).id, { kind: 'uses', confidence: 'configured', evidence: [ev] });
          else g.tech(entry, [ev]);
        }
      } else if (base === 'render.yaml') {
        renders.push(readRenderYaml(root, file));
      }
      if (isDbConfigFile(file)) dbHints.push(...readDbHints(root, file));
    } catch (err) {
      warnings.push(`${file}: ${err.message}`);
    }
  }

  // DB config hints: "code in this folder talks to Postgres through Prisma".
  for (const h of dbHints) {
    const entry = catalog.get(h.tech);
    if (!entry) continue;
    const ev = evidence(h.file, h.line, entry.name, `${h.via} config`, h.text);
    const tech = g.tech(entry, [ev]);
    const owner = ownerOf(h.file);
    if (owner) {
      owner.dbHints.push({ ...h, techNodeId: tech.id });
      g.edge(owner.id, tech.id, { kind: 'uses', via: h.via, confidence: 'configured', evidence: [ev] });
    }
  }

  // Render blueprint: managed databases and per-service platforms.
  const render = catalog.get('render');
  for (const r of renders) {
    for (const db of r.databases) {
      const pg = catalog.get('postgresql');
      if (pg) g.tech(pg, [evidence(db.file, db.line, 'PostgreSQL', 'Render database', readLine(db.file, db.line))]);
    }
    for (const s of r.services) {
      if ((s.type === 'redis' || s.type === 'keyvalue') && catalog.get('redis')) g.tech(catalog.get('redis'), [evidence(s.file, s.line, 'Redis', 'Render key value', readLine(s.file, s.line))]);
      const u = s.rootDir != null ? byDir(joinRel('', s.rootDir)) : null;
      if (u && render) u.platforms.set('render', { entry: render, evidence: [evidence(s.file, s.line, 'Render', 'Render service', readLine(s.file, s.line))] });
    }
  }

  // ------------------------------------------------------------ 3c. docker compose
  // Services with the same name across compose files (base + overrides) are one service.
  const merged = new Map();
  const composeOrder = (f) => (/override|local|dev|test|debug|ci/i.test(baseOf(f)) ? 1 : 0);
  for (const s of [...composeServices].sort((a, b) => composeOrder(a.file) - composeOrder(b.file))) {
    const m = merged.get(s.name);
    if (!m) {
      merged.set(s.name, { ...s, dependsOn: s.dependsOn.map((d) => ({ ...d, file: s.file })), env: [...s.env], links: s.links.map((d) => ({ ...d, file: s.file })) });
      continue;
    }
    if (!m.image && s.image) Object.assign(m, { image: s.image, imageLine: s.imageLine, imageFile: s.file });
    if (!m.build && s.build) Object.assign(m, { build: s.build, buildFile: s.file });
    if (!m.command && s.command) m.command = s.command;
    m.dependsOn.push(...s.dependsOn.map((d) => ({ ...d, file: s.file })));
    m.env.push(...s.env);
    m.links.push(...s.links.map((d) => ({ ...d, file: s.file })));
  }
  const composeList = [...merged.values()];
  const unitByShortName = new Map();
  for (const u of units) {
    if (isBareRoot(u)) continue;
    for (const n of new Set([u.shortName, baseOf(u.dir)].filter(Boolean))) if (!unitByShortName.has(n.toLowerCase())) unitByShortName.set(n.toLowerCase(), u);
  }
  const pick = (x) => (x && !isBareRoot(x) ? x : null);
  const pickByName = (x) => (x && !isBareRoot(x) && !importedLibraries.has(x) ? x : null);
  const buildUnit = (s) => {
    if (!s.build) return null;
    const ctxDir = joinRel(s.build.composeDir, s.build.context);
    const dockerDir = s.build.dockerfile ? dirOf(joinRel(ctxDir, s.build.dockerfile)) : null;
    const owner = dockerDir != null ? ownerOf(`${dockerDir}/x`) : null;
    // Never fall back to the repo root for a Dockerfile-only folder (an nginx or Caddy proxy).
    return pick(dockerDir != null && byDir(dockerDir)) || pick(byDir(ctxDir)) || pickByName(unitByShortName.get(s.name.toLowerCase())) || pick(owner && owner.dir !== '' ? owner : null);
  };
  const JOB_NAME = /^(base|builder|build)$|^(pre|post)?[-_]?(start|migrat\w*|init\w*|setup|seed\w*|createbuckets|bootstrap|wait\w*)$|(^|[-_])(migrat\w*|init|setup|seed)([-_]|$)/i;
  const SERVER_COMMAND = /\b(rails\s+s(erver)?|puma|unicorn|gunicorn|uvicorn|hypercorn|daphne|runserver|php-fpm|artisan\s+serve|next\s+start|npm\s+(run\s+)?start|yarn\s+start|pnpm\s+start|node\s+\S*(server|main|index)|bun\s+\S*(server|index))/i;
  // The service named like its unit claims it first, then web servers; one-off jobs go last.
  const priority = (s) => {
    const u = buildUnit(s) ?? pickByName(unitByShortName.get(s.name.toLowerCase()));
    if (u && (s.name.toLowerCase() === baseOf(u.dir).toLowerCase() || s.name.toLowerCase() === (u.shortName ?? '').toLowerCase())) return 0;
    if (JOB_NAME.test(s.name)) return 4;
    if (SERVER_COMMAND.test(s.command)) return 1;
    return /^(web|app|server|api|backend)$/i.test(s.name) ? 2 : 3;
  };
  // A build-only "base" or "builder" service with no command is not a running process.
  for (let i = composeList.length - 1; i >= 0; i--) if (/^(base|builder|build)$/i.test(composeList[i].name) && !composeList[i].command) composeList.splice(i, 1);
  // Units by their image name too: "web: image: ghcr.io/mastodon/mastodon" runs the root app "mastodon".
  const unitByImageName = (repo) => {
    if (!repo) return null;
    const last = repo.split('/').pop().toLowerCase();
    const hit = unitByShortName.get(last);
    if (hit) return hit;
    const rootUnit = unitsByDir.get('');
    return rootUnit && !isBareRoot(rootUnit) && (rootUnit.shortName ?? '').toLowerCase() === last ? rootUnit : null;
  };
  // Database admin UIs and local-only helpers are tools around the system, not part of it.
  const DEV_TOOL = /^(adminer|dpage\/pgadmin4?|sosedoff\/pgweb|dbgate\/dbgate|phpmyadmin(\/phpmyadmin)?|mongo-express|redis\/redisinsight|redislabs\/redisinsight|rediscommander\/redis-commander|provectuslabs\/kafka-ui|obsidiandynamics\/kafdrop|[\w-]+\/bull-board|letsencrypt\/pebble|portainer\/portainer(-ce)?|containrrr\/watchtower|swaggerapi\/swagger-ui)$/i;
  for (let i = composeList.length - 1; i >= 0; i--) {
    const s = composeList[i];
    if (s.image && !s.build && DEV_TOOL.test(dockerRepo(s.image) ?? '')) composeList.splice(i, 1);
  }
  composeList.sort((a, b) => priority(a) - priority(b));
  const composeMap = new Map(); // compose service name -> node id
  const imageUnit = new Map(); // image repo -> the unit built into it
  const composeTag = catalog.get('docker-compose') ?? catalog.get('docker');
  const claim = (u, s, file, line) => {
    if (composeTag) u.platforms.set(composeTag.id, { entry: composeTag, evidence: [evidence(file, line, composeTag.name, 'compose service', readLine(file, line))] });
    u.deployable = true;
  };
  const runsContainer = (s, u, evS) => {
    const kind = WORKER_NAME.test(s.name) || WORKER_COMMAND.test(s.command) ? 'worker' : 'service';
    const c = g.container(s.name, null, evS, kind);
    c.runs = u.id;
    c.frameworks = [`runs ${u.shortName ?? (baseOf(u.dir) || 'app')} code`];
    return c.id;
  };
  for (const s of composeList) {
    let nodeId = null;
    const evS = evidence(s.file, s.line, s.name, 'compose service', readLine(s.file, s.line));
    const repo = s.image ? dockerRepo(s.image) : null;
    const u = buildUnit(s);
    if (u) {
      claim(u, s, s.buildFile ?? s.file, s.build.line);
      // Same code, different process (Django web + Celery worker from one image): draw both.
      if (u.composeCommands.size > 0 && !u.composeCommands.has(s.command)) nodeId = runsContainer(s, u, evS);
      else {
        nodeId = u.id;
        u.composeNames.add(s.name);
        u.composeCommands.add(s.command);
        if (repo) imageUnit.set(repo, u);
      }
    }
    if (!nodeId && s.image) {
      const entry = catalog.matchDockerImage(s.image);
      const file = s.imageFile ?? s.file;
      if (entry && (entry.kind === 'datastore' || entry.kind === 'external')) {
        nodeId = g.tech(entry, [evidence(file, s.imageLine, entry.name, 'docker image', readLine(file, s.imageLine))]).id;
      }
    }
    if (!nodeId) {
      // A prebuilt image whose service is named like a unit here ("api: image: org/app-api") is that unit.
      const byName = pickByName(unitByShortName.get(s.name.toLowerCase()) ?? (repo && !imageUnit.has(repo) ? unitByImageName(repo) : null));
      const sameImage = repo ? imageUnit.get(repo) : null;
      if (byName && (!byName.composeCommands.size || byName.composeCommands.has(s.command))) {
        nodeId = byName.id;
        claim(byName, s, s.imageFile ?? s.file, s.imageLine);
        byName.composeNames.add(s.name);
        byName.composeCommands.add(s.command);
        if (repo) imageUnit.set(repo, byName);
      } else if (sameImage) {
        nodeId = runsContainer(s, sameImage, evS);
      }
    }
    if (!nodeId) nodeId = g.container(s.name, repo, evS, WORKER_NAME.test(s.name) || WORKER_COMMAND.test(s.command) ? 'worker' : 'service').id;
    composeMap.set(s.name, nodeId);
  }
  for (const s of composeList) {
    const from = composeMap.get(s.name);
    if (!from) continue;
    for (const d of [...s.dependsOn, ...s.links]) {
      const to = composeMap.get(d.name);
      if (to && to !== from) g.edge(from, to, { kind: g.isTech(to) ? 'uses' : 'depends', confidence: 'configured', evidence: [evidence(d.file, d.line, d.name, 'compose depends_on', readLine(d.file, d.line))] });
    }
    for (const e of s.env) {
      addEnvDef({ ...e, composeNode: from });
      const hostTarget = (e.host && composeMap.get(e.host)) || (e.rawHost && composeMap.get(e.rawHost));
      if (hostTarget && hostTarget !== from) {
        g.edge(from, hostTarget, { kind: g.isTech(hostTarget) ? 'uses' : 'calls', confidence: 'configured', via: `$${e.name}`, evidence: [evidence(e.file, e.line, e.name, 'compose env', readLine(e.file, e.line), true)] });
      }
    }
  }

  // ------------------------------------------------------------ 3d. Kubernetes workloads
  for (const w of k8sWorkloads) {
    let nodeId = null;
    const u = unitByShortName.get(w.name.toLowerCase());
    if (u) nodeId = u.id;
    if (!nodeId) {
      for (const img of w.images) {
        const entry = catalog.matchDockerImage(img.image);
        if (entry && (entry.kind === 'datastore' || entry.kind === 'external')) {
          nodeId = g.tech(entry, [evidence(w.file, img.line, entry.name, 'kubernetes image', readLine(w.file, img.line))]).id;
          break;
        }
      }
    }
    if (!nodeId) {
      const kind = w.kind === 'CronJob' || w.kind === 'Job' || WORKER_NAME.test(w.name) ? 'worker' : 'service';
      nodeId = g.container(w.name, w.images[0] ? dockerRepo(w.images[0].image) : null, evidence(w.file, w.line, w.name, `kubernetes ${w.kind}`, readLine(w.file, w.line)), kind).id;
    }
    const k8s = catalog.get('kubernetes');
    if (u && k8s) u.platforms.set('kubernetes', { entry: k8s, evidence: [evidence(w.file, w.line, 'Kubernetes', w.kind, readLine(w.file, w.line))] });
    if (k8s && !deployTargets.has('kubernetes')) deployTargets.set('kubernetes', { id: 'kubernetes', name: k8s.name, evidence: [evidence(w.file, w.line, 'Kubernetes', w.kind, readLine(w.file, w.line))] });
    for (const e of w.env) addEnvDef({ ...e, composeNode: nodeId });
  }

  // ------------------------------------------------------------ 3e. env vars and hosts
  const varTech = (name) => {
    const found = [];
    const byName = catalog.matchEnv(name);
    if (byName && (byName.kind === 'datastore' || byName.kind === 'external')) found.push([byName, null]);
    for (const d of envDefs.get(name) ?? []) {
      let entry = d.scheme ? catalog.matchScheme(d.scheme) : null;
      if (!entry && d.host) entry = catalog.matchHost(d.host);
      if (!entry && d.dbConnection) entry = catalog.get(LARAVEL_CONNECTIONS[d.dbConnection] ?? '');
      if (entry && (entry.kind === 'datastore' || entry.kind === 'external')) found.push([entry, d]);
    }
    return found;
  };
  // Env vars defined in compose/k8s, or in an example file inside a unit's folder, link that service.
  // (Example files at the root of a monorepo only count where code reads the variable, below.)
  for (const [name, defs] of envDefs) {
    for (const [entry, d] of varTech(name)) {
      const def = d ?? defs[0];
      const owner = def.composeNode ? null : ownerOf(def.file);
      const from = def.composeNode ?? (owner && !isBareRoot(owner) ? owner.id : null);
      if (!from) continue;
      const ev = evidence(def.file, def.line, name, d?.scheme ? `${d.scheme}:// URL in env` : 'env var', readLine(def.file, def.line), true);
      const tech = g.tech(entry, [ev]);
      if (from !== tech.id) g.edge(from, tech.id, { kind: 'uses', via: `$${name}`, confidence: 'configured', evidence: [ev] });
    }
  }
  // Env vars read in code: the unit that reads them uses what they point to.
  for (const u of units) {
    for (const [name, ref] of u.env) {
      for (const [entry, d] of varTech(name)) {
        const evs = [evidence(ref.file, ref.line, name, 'reads env var', ref.text)];
        if (d) evs.push(evidence(d.file, d.line, name, d.scheme ? `${d.scheme}:// URL` : 'env definition', readLine(d.file, d.line), true));
        g.edge(u.id, g.tech(entry, evs).id, { kind: 'uses', via: `$${name}`, confidence: 'configured', evidence: evs });
      }
    }
    for (const [host, ref] of u.hosts) {
      const entry = catalog.matchHost(host);
      if (!entry || (entry.kind !== 'datastore' && entry.kind !== 'external')) continue;
      const ev = evidence(ref.file, ref.line, host, 'calls API host', ref.text);
      g.edge(u.id, g.tech(entry, [ev]).id, { kind: 'calls', confidence: 'imported', evidence: [ev] });
    }
  }

  // ------------------------------------------------------------ 3f. SQL clients (Prisma, Drizzle, SQLAlchemy, ...)
  for (const u of units) {
    for (const c of u.sqlClients) {
      const own = u.dbHints.filter((h) => h.via === c.entry.name || h.via.startsWith(c.entry.name.split(' ')[0]));
      const direct = g.edgesFrom(u.id).filter((e) => catalog.get(g.nodes.get(e.to)?.techId ?? '')?.sql);
      let targets = own.length ? own.map((h) => h.techNodeId) : direct.map((e) => e.to);
      let confidence = c.confidence;
      if (!targets.length) {
        // No config says which database: use the SQL database the rest of the repo uses most.
        const sqlNodes = [...g.nodes.values()].filter((n) => n.techId && catalog.get(n.techId)?.sql);
        const usage = (n) => [...g.edges.values()].filter((e) => e.to === n.id).length + n.evidence.length / 100;
        sqlNodes.sort((a, b) => usage(b) - usage(a));
        if (sqlNodes.length) {
          targets = [sqlNodes[0].id];
          confidence = 'inferred';
        }
      }
      if (!targets.length) targets = [g.genericSql(c.evidence).id];
      for (const t of new Set(targets)) g.edge(u.id, t, { kind: 'uses', via: c.entry.name, confidence, evidence: c.evidence });
    }
  }

  // ------------------------------------------------------------ 3g. internal edges between units
  for (const u of units) {
    for (const m of u.manifests) {
      for (const ref of m.refs) {
        let target = null;
        if (ref.kind === 'package') target = byPackage.get(`${m.ecosystem}:${normPkg(m.ecosystem, ref.value)}`);
        else if (ref.kind === 'path') target = byDir(joinRel(m.dir, ref.value));
        else if (ref.kind === 'gradle') target = byDir(joinRel(gradleRoot(m.dir), ref.value.replace(/^:/, '').replace(/:/g, '/')));
        else if (ref.kind === 'artifact') target = units.find((x) => x !== u && x.manifests.some((mm) => mm.ecosystem === 'maven' && mm.name === ref.value)) ?? null;
        if (!target || target === u) continue;
        const pkgName = ref.kind === 'package' ? ref.value : target.shortName;
        const imp = u.imports.get(`js:${pkgName}`) ?? u.imports.get(`ts:${pkgName}`);
        if (ref.dev && !imp) continue;
        const evs = [evidence(m.file, ref.line, pkgName, 'workspace dependency', readLine(m.file, ref.line)), imp && evidence(imp.file, imp.line, pkgName, 'import', imp.text)].filter(Boolean);
        g.edge(u.id, target.id, { kind: 'depends', confidence: imp ? 'imported' : 'declared', evidence: evs });
      }
    }
    for (const x of u.crossImports.values()) {
      if (x.unit === u || isBareRoot(x.unit) || isBareRoot(u)) continue;
      g.edge(u.id, x.unit.id, { kind: 'depends', confidence: 'imported', evidence: [evidence(x.file, x.line, x.unit.shortName ?? x.unit.dir, 'import', x.text)] });
    }
    // Imports of workspace packages that were never declared (common with TS path aliases).
    for (const imp of u.imports.values()) {
      if (imp.lang !== 'js' && imp.lang !== 'ts') continue;
      const target = byPackage.get(`npm:${imp.name}`);
      if (target && target !== u && !g.edges.has(`${u.id}->${target.id}`)) {
        g.edge(u.id, target.id, { kind: 'depends', confidence: 'imported', evidence: [evidence(imp.file, imp.line, imp.name, 'import', imp.text)] });
      }
    }
  }
  function gradleRoot(dir) {
    let d = dir;
    while (true) {
      if (files.includes(d ? `${d}/settings.gradle` : 'settings.gradle') || files.includes(d ? `${d}/settings.gradle.kts` : 'settings.gradle.kts')) return d;
      if (!d) return '';
      d = dirOf(d);
    }
  }

  // ------------------------------------------------------------ 4. classify units, drop empty workspace roots
  const dependents = new Map();
  for (const e of g.edges.values()) if (e.kind === 'depends') dependents.set(e.to, (dependents.get(e.to) ?? 0) + 1);
  for (const u of units) {
    u.kind = classify(u, dependents.get(u.id) ?? 0);
    if (isBareRoot(u)) u.drop = true;
    // In a repo with several units, a unit connected to nothing, running nothing and used by
    // nobody is tooling (tsconfig, eslint-config, scripts) rather than architecture.
    const isolated = !g.edgesFrom(u.id).length && !(dependents.get(u.id) ?? 0) && ![...g.edges.values()].some((e) => e.to === u.id);
    if (units.length > 1 && isolated && !u.frameworks.size && !isRunnable(u) && u.kind !== 'cli') u.drop = true;
  }

  // Service-to-service calls guessed from env names like API_URL or NEXT_PUBLIC_BACKEND_URL.
  const services = units.filter((u) => !u.drop && ['service', 'worker', 'app'].includes(u.kind));
  const containerByName = new Map([...composeMap].filter(([, id]) => id.startsWith('container:') || id.startsWith('unit:')));
  // Only from running code (not libraries) to backends (not frontends): a frontend URL in a
  // backend is usually a link or CORS origin, not a call.
  const isBackend = (id) => {
    const n = g.nodes.get(id);
    if (n?.container) return true;
    const t = units.find((x) => x.id === id);
    return Boolean(t && ['service', 'worker'].includes(t.kind));
  };
  for (const u of units) {
    if (u.drop || u.kind === 'library' || u.kind === 'cli') continue;
    for (const [name, ref] of u.env) {
      const m = name.match(/^(?:NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_|NUXT_PUBLIC_|EXPO_PUBLIC_|GATSBY_|VUE_APP_)?([A-Z0-9_]+?)_(?:URL|URI|HOST|ENDPOINT|BASE_URL|ORIGIN|ADDR|ADDRESS|SERVER_URL)$/);
      if (!m) continue;
      const key = m[1].toLowerCase().replace(/_/g, '-');
      let target = null;
      const cands = [key, `${key}-service`, `${key}-server`, key.replace(/-(service|server)$/, '')];
      for (const c of cands) {
        const t = unitByShortName.get(c);
        if (t && t !== u && !t.drop && t.kind !== 'library') {
          target = t.id;
          break;
        }
        if (containerByName.has(c) && containerByName.get(c) !== u.id) {
          target = containerByName.get(c);
          break;
        }
      }
      if (!target && ['api', 'backend', 'server', 'api-server'].includes(key)) {
        const backends = services.filter((s) => s.kind === 'service' && s !== u);
        if (backends.length === 1) target = backends[0].id;
      }
      if (target && target !== u.id && isBackend(target)) {
        g.edge(u.id, target, { kind: 'calls', via: `$${name}`, confidence: 'inferred', evidence: [evidence(ref.file, ref.line, name, 'reads service URL', ref.text)] });
      }
    }
  }

  // ------------------------------------------------------------ 5. unit nodes
  const shortNames = new Map();
  for (const u of units) if (!u.drop) shortNames.set(u.shortName, (shortNames.get(u.shortName) ?? 0) + 1);
  const git = opts.git === false ? {} : gitInfo(root);
  const projectName = config.name || projectNameOf(root, unitsByDir.get(''), git.repoUrl);
  for (const u of units) {
    if (u.drop) {
      g.removeNode(u.id);
      continue;
    }
    const m0 = u.manifests[0];
    const name = u.dir === '' ? (u.packageName ? u.shortName : projectName) : shortNames.get(u.shortName) > 1 ? u.dir : u.shortName;
    const frameworks = [...u.frameworks.values()].map((f) => f.entry.name);
    const platforms = [...u.platforms.values()].map((p) => p.entry.name);
    const fwEvidence = [...u.frameworks.values()].flatMap((f) => f.evidence);
    g.unitNode(u, {
      name,
      kind: u.kind,
      path: u.dir || '.',
      packageName: u.packageName ?? undefined,
      description: u.description ?? undefined,
      language: u.language(),
      frameworks,
      platforms,
      env: [...u.env.keys()].sort(),
      evidence: [m0 ? evidence(m0.file, nameLine(m0), m0.file, 'manifest', readLine(m0.file, nameLine(m0))) : evidence(u.dir || '.', 1, name, 'source folder', ''), ...fwEvidence],
    });
  }

  // A project's own SDK or hosted version is not a third party of itself (Umami's repo using "Umami").
  const selfNames = new Set([projectName, ...units.filter((u) => !u.drop).map((u) => u.shortName)].filter(Boolean).map((x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '')));
  for (const n of [...g.nodes.values()]) {
    if (n.techId && n.kind === 'external' && (selfNames.has(n.techId.replace(/[^a-z0-9]/g, '')) || selfNames.has(n.name.toLowerCase().replace(/[^a-z0-9]/g, '')))) g.removeNode(n.id);
  }

  // ------------------------------------------------------------ 6. config: custom nodes, edges, labels, hide
  for (const n of config.nodes) {
    g.custom(n, evidence(loaded.file ?? '.stackmap.json', n.line, n.id, 'declared in config', ''));
  }
  for (const e of config.edges) {
    const from = resolveRef(g, e.from);
    const to = resolveRef(g, e.to);
    if (!from || !to) {
      warnings.push(`Config edge ${e.from} -> ${e.to}: ${!from ? e.from : e.to} not found`);
      continue;
    }
    g.edge(from, to, { kind: e.kind ?? 'calls', via: e.label, confidence: 'configured', evidence: [evidence(loaded.file ?? '.stackmap.json', e.line, `${e.from} -> ${e.to}`, 'declared in config', '')] });
  }
  for (const [key, label] of Object.entries(config.labels)) {
    const id = resolveRef(g, key);
    if (id && typeof label === 'string') g.nodes.get(id).name = label;
  }
  for (const sel of config.hide) for (const n of [...g.nodes.values()]) if (matchesSelector(n, sel)) g.removeNode(n.id);

  // ------------------------------------------------------------ 7. assemble
  const nodes = [...g.nodes.values()];
  const edges = [...g.edges.values()].filter((e) => g.nodes.has(e.from) && g.nodes.has(e.to));
  for (const n of nodes) finalizeEvidence(n);
  for (const e of edges) finalizeEvidence(e);
  nodes.sort(nodeOrder);
  edges.sort((a, b) => a.id.localeCompare(b.id));

  const count = (pred) => nodes.filter(pred).length;
  const languages = Object.entries(languageCounts).sort((a, b) => b[1] - a[1]).map(([name, files]) => ({ name, files }));
  return {
    schema: SCHEMA,
    tool: { name: 'stackmap', version: VERSION },
    project: {
      name: projectName,
      repoUrl: git.repoUrl ?? null,
      commit: git.commit ?? null,
      branch: git.branch ?? null,
      prefix: git.prefix ?? '',
      generatedAt: new Date().toISOString(),
    },
    summary: {
      units: count((n) => n.unit),
      apps: count((n) => n.kind === 'app' || n.kind === 'mobile' || n.kind === 'desktop'),
      services: count((n) => n.kind === 'service' || n.kind === 'container' || n.kind === 'function'),
      workers: count((n) => n.kind === 'worker'),
      libraries: count((n) => n.kind === 'library'),
      datastores: count((n) => n.column === 'data'),
      external: count((n) => n.column === 'external'),
      edges: edges.length,
      languages,
      deploy: [...deployTargets.values()].map((d) => d.name),
      filesListed: files.length,
      sourceFilesRead: sourceRead,
      ms: Math.round(performance.now() - t0),
    },
    nodes,
    edges,
    warnings,
  };

  // ------------------------------------------------------------ helpers (closures over root)
  /** The line that names the package ("name": in package.json, module in go.mod ...), else 1. */
  function nameLine(m) {
    if (!m.name) return 1;
    for (let i = 1; i <= 60; i++) {
      const l = readLine(m.file, i);
      if (l.includes(m.name) && /name|module|artifactId|app:|<Project/i.test(l)) return i;
    }
    return 1;
  }
  function readLine(file, line) {
    let lines = lineCache.get(file);
    if (lines === undefined) {
      const text = readText(root, file, 2 * 1024 * 1024);
      lines = text == null ? null : text.split('\n');
      lineCache.set(file, lines);
    }
    return lines?.[line - 1] ?? '';
  }
}

// ==================================================================== units

function newUnit(dir) {
  const u = {
    id: `unit:${dir || '.'}`,
    dir,
    manifests: [],
    imports: new Map(),
    env: new Map(),
    hosts: new Map(),
    langs: {},
    sourceFiles: 0,
    frameworks: new Map(),
    platforms: new Map(),
    roles: new Set(),
    sqlClients: [],
    dbHints: [],
    matched: new Set(),
    composeNames: new Set(),
    composeCommands: new Set(),
    appSignals: new Set(),
    crossImports: new Map(),
    uiFiles: 0,
    hasMain: false,
    hasDockerfile: false,
    deployable: false,
    workspaceRoot: false,
    packageName: null,
    shortName: null,
    bin: false,
    kind: 'service',
    drop: false,
    langCount(eco) {
      const map = { npm: ['js', 'ts'], pypi: ['py'], go: ['go'], cargo: ['rs'] };
      return (map[eco] ?? []).reduce((s, l) => s + (this.langs[l] ?? 0), 0);
    },
    language() {
      const top = Object.entries(this.langs).sort((a, b) => b[1] - a[1])[0];
      if (top) return LANGUAGES[top[0]].name;
      const eco = this.manifests[0]?.ecosystem;
      return { npm: 'JavaScript', pypi: 'Python', go: 'Go', cargo: 'Rust', gem: 'Ruby', composer: 'PHP', maven: 'Java', nuget: 'C#', hex: 'Elixir' }[eco] ?? null;
    },
    ownsRuntimeCode() {
      return this.sourceFiles > 0;
    },
  };
  return u;
}

function finishUnit(u, rootWorkspaceGlobs) {
  const named = u.manifests.find((m) => m.name) ?? null;
  u.packageName = named?.name ?? null;
  u.description = u.manifests.find((m) => m.description)?.description ?? null;
  u.shortName = shortName(named?.name, named?.ecosystem) || baseOf(u.dir) || null;
  u.bin = u.manifests.some((m) => m.bin);
  u.scripts = Object.assign({}, ...u.manifests.map((m) => m.scripts ?? {}));
  u.npmLibrary = u.manifests.some((m) => m.library);
  u.workspaceRoot =
    u.manifests.some((m) => m.workspaces?.length || (m.packaging === 'pom' && m.workspaces)) ||
    (u.dir === '' && rootWorkspaceGlobs.length > 0) ||
    u.manifests.some((m) => m.ecosystem === 'cargo' && m.workspaces && !m.name);
  u.worker = u.manifests.some((m) => m.worker);
}

/** Root manifest name ("dub-monorepo" -> "dub"), else the repo name from the remote, else the folder. */
function projectNameOf(root, rootUnit, repoUrl) {
  const generic = /^(root|monorepo|workspace|workspaces|repo|project|app|main|src)$/i;
  const fromPkg = rootUnit?.packageName ? shortName(rootUnit.packageName, rootUnit.manifests[0]?.ecosystem)?.replace(/[-_](monorepo|root|workspace|repo|mono)$/i, '') : null;
  if (fromPkg && !generic.test(fromPkg)) return fromPkg;
  const fromRemote = repoUrl ? repoUrl.split('/').pop() : null;
  if (fromRemote) return fromRemote;
  return path.basename(root);
}

function shortName(name, eco) {
  if (!name) return null;
  if (eco === 'go') return name.split('/').filter((p) => !/^v\d+$/.test(p)).pop();
  if (eco === 'composer') return name.split('/').pop();
  return name.replace(/^@[^/]+\//, '');
}

// npm scripts that start a server or an app (as opposed to `tsup --watch`, `tsc -w`, `vite build`).
const RUNNABLE_SCRIPT = /\b(next\s+(dev|start)|nuxt|nuxi\s+(dev|preview)|remix\s+(dev|vite:dev)|astro\s+(dev|preview)|react-router\s+dev|svelte-kit\s+dev|vite(\s+(dev|serve|preview)|\s*$|\s+--(?!watch))|ng\s+serve|react-scripts\s+start|webpack(-dev-server|\s+serve)|parcel(?!\s+build)\s|expo\s+start|react-native\s+start|electron|tauri\s+dev|wrangler\s+dev|node\s|tsx\s|ts-node|nodemon|bun\s+(--watch\s+|--hot\s+|run\s+)?\S+\.[jt]s|deno\s+(run|task)|nest\s+start|fastify\s+start|uvicorn|gunicorn|python|http-server|serve\s+-|serve\s*$)/;

function isRunnable(u) {
  if (u.hasDockerfile || u.deployable) return true;
  if ([...u.appSignals].some((f) => f !== 'main.ts' && f !== 'main.js' && f !== 'server.ts' && f !== 'server.js')) return true;
  const sc = u.scripts ?? {};
  if (typeof sc.start === 'string' && !/\b(turbo|nx|lerna)\b/.test(sc.start)) return true;
  return Object.entries(sc).some(([k, v]) => /^(start|dev|serve|preview|develop)(:|$)/.test(k) && typeof v === 'string' && RUNNABLE_SCRIPT.test(v));
}

// Folders that hold deployable apps by convention.
const APP_ROOTS = /^(apps?|services?|servers?|web|frontend|backend|api|site|website|www|docs)(\/|$)/i;

function classify(u, dependentCount) {
  const roles = new Set(u.roles);
  for (const f of u.frameworks.values()) if (f.entry.role) roles.add(f.entry.role);
  const label = `${u.dir}/${u.shortName ?? ''}`;
  const runnable = isRunnable(u);
  const eco = u.manifests[0]?.ecosystem;
  const serverRole = ['backend', 'fullstack', 'mobile', 'desktop'].some((r) => roles.has(r));
  // Shared packages (UI kits, utils, SDKs, embeds) depend on React or Next.js too; that does not
  // make them apps. Being imported by other units is the strongest signal.
  if (eco === 'npm' && u.dir !== '' && !u.deployable && !u.hasDockerfile && !APP_ROOTS.test(u.dir)) {
    const appLike = runnable && (serverRole || roles.has('frontend'));
    if (dependentCount > 0 && (u.npmLibrary || !appLike)) return 'library';
    if (!runnable && (u.npmLibrary || LIBRARY_ROOTS.test(u.dir)) && !serverRole) return u.bin ? 'cli' : 'library';
  }
  // A package with a `bin` is a command-line tool unless it is deployed or lives in an apps folder.
  if (u.bin && !u.deployable && !u.hasDockerfile && (!APP_ROOTS.test(u.dir) || (!serverRole && !roles.has('frontend')))) return 'cli';
  if (roles.has('mobile')) return 'mobile';
  if (roles.has('desktop')) return 'desktop';
  // React on a backend is often only for emails or SSR; call it an app only when UI code dominates.
  if (roles.has('backend') && !roles.has('fullstack') && roles.has('frontend')) {
    const ui = u.uiFiles >= 25 || u.uiFiles > u.sourceFiles * 0.3;
    if (!ui) return WORKER_NAME.test(baseOf(u.dir) || '') ? 'worker' : 'service';
  }
  if (roles.has('frontend') || roles.has('fullstack')) return 'app';
  if (roles.has('backend')) return WORKER_NAME.test(baseOf(u.dir) || '') ? 'worker' : 'service';
  const composeWorker = u.composeCommands.size > 0 && [...u.composeCommands].every((c) => WORKER_COMMAND.test(c));
  if (roles.has('worker') || u.worker || composeWorker || (WORKER_NAME.test(label) && u.sourceFiles > 0)) return 'worker';
  if (u.bin && !runnable) return 'cli';
  if (u.deployable) return 'service';
  if (eco === 'go' || eco === 'cargo') return u.hasMain ? (u.bin ? 'cli' : 'service') : 'library';
  if (eco === 'pypi') return u.hasMain || u.hasDockerfile ? 'service' : u.dir === '' ? 'service' : 'library';
  if (LIBRARY_ROOTS.test(u.dir) && !runnable) return 'library';
  if (dependentCount > 0 && !runnable) return 'library';
  if (eco === 'npm' && !runnable && u.dir !== '') return 'library';
  return 'service';
}

function scansImports(eco) {
  return eco === 'npm' || eco === 'pypi' || eco === 'go' || eco === 'cargo';
}

function normPkg(eco, name) {
  if (eco === 'pypi') return name.toLowerCase().replace(/[-_.]+/g, '-');
  if (eco === 'cargo') return name.toLowerCase().replace(/_/g, '-');
  return name;
}

function resolveRef(g, ref) {
  const lower = ref.toLowerCase();
  const ids = new Set([lower, `custom:${lower}`, `tech:${lower}`, `unit:${lower}`, `container:${lower}`]);
  for (const n of g.nodes.values()) {
    if (ids.has(n.id.toLowerCase()) || n.name?.toLowerCase() === lower || n.techId === lower || n.path === ref || n.packageName === ref) return n.id;
  }
  return null;
}

// ==================================================================== evidence

function evidence(file, line, subject, why, text, hideValue = false) {
  let t = snippet(text ?? '');
  // Never show a value from an env file or compose environment: keep "NAME=" only.
  if (hideValue) t = t.replace(/^(\s*(?:export\s+)?-?\s*["']?[A-Za-z_][\w.]*["']?\s*[=:]).*/, '$1 …');
  return { file, line: line || 1, why, text: t, subject };
}

function pushEvidence(list, ev) {
  if (!ev) return;
  if (list.some((x) => x.file === ev.file && x.line === ev.line)) return;
  list.push(ev);
}

function finalizeEvidence(item) {
  const all = item.evidence;
  // Strongest first: imports and calls, then config, then manifests.
  const rank = (e) => (e.why === 'import' || e.why === 'calls API host' ? 0 : e.why.includes('config') || e.why.includes('env') || e.why.includes('compose') ? 1 : 2);
  all.sort((a, b) => rank(a) - rank(b));
  item.evidenceCount = all.length;
  item.evidence = all.slice(0, MAX_EVIDENCE).map(({ file, line, why, text }) => ({ file, line, why, text }));
}

const KIND_ORDER = { app: 0, mobile: 1, desktop: 2, service: 3, function: 4, container: 5, worker: 6, cli: 7, library: 8, datastore: 9, external: 10 };
function nodeOrder(a, b) {
  return (KIND_ORDER[a.kind] ?? 20) - (KIND_ORDER[b.kind] ?? 20) || a.name.localeCompare(b.name);
}

// ==================================================================== graph builder

class GraphBuilder {
  constructor(catalog) {
    this.catalog = catalog;
    this.nodes = new Map();
    this.edges = new Map();
    this.out = new Map();
  }

  isTech(id) {
    return id.startsWith('tech:');
  }

  tech(entry, evs = []) {
    const id = `tech:${entry.id}`;
    let n = this.nodes.get(id);
    if (!n) {
      const column = this.catalog.column(entry);
      n = {
        id,
        techId: entry.id,
        name: entry.name,
        kind: entry.kind,
        category: entry.category,
        categoryLabel: CATEGORIES[entry.category]?.label ?? entry.category,
        column,
        url: entry.url ?? null,
        unit: false,
        evidence: [],
      };
      this.nodes.set(id, n);
    }
    for (const ev of evs) pushEvidence(n.evidence, ev);
    return n;
  }

  genericSql(evs) {
    const id = 'tech:sql';
    let n = this.nodes.get(id);
    if (!n) {
      n = { id, techId: 'sql', name: 'SQL database', kind: 'datastore', category: 'database', categoryLabel: 'Databases', column: 'data', url: null, unit: false, evidence: [] };
      this.nodes.set(id, n);
    }
    for (const ev of evs) pushEvidence(n.evidence, ev);
    return n;
  }

  container(name, image, ev, kind = 'service') {
    const id = `container:${name}`;
    let n = this.nodes.get(id);
    if (!n) {
      n = { id, name, kind, column: 'services', image: image ?? null, unit: false, container: true, frameworks: image ? [image] : [], evidence: [] };
      this.nodes.set(id, n);
    }
    pushEvidence(n.evidence, ev);
    return n;
  }

  custom(def, ev) {
    const id = def.id.includes(':') ? def.id : `custom:${def.id}`;
    const isTech = ['datastore', 'external'].includes(def.kind);
    const column = def.column ?? (isTech ? (CATEGORIES[def.category]?.column === 'data' || def.kind === 'datastore' ? 'data' : 'external') : 'services');
    const n = { id, name: def.name ?? def.id, kind: def.kind ?? 'service', category: def.category, categoryLabel: CATEGORIES[def.category]?.label, column, description: def.description, unit: false, custom: true, evidence: [ev] };
    this.nodes.set(id, n);
    return n;
  }

  unitNode(u, props) {
    const column = { app: 'apps', mobile: 'apps', desktop: 'apps', library: 'libraries' }[props.kind] ?? 'services';
    const n = { id: u.id, unit: true, column, ...props };
    n.evidence = [];
    for (const ev of props.evidence) pushEvidence(n.evidence, ev);
    this.nodes.set(u.id, n);
    return n;
  }

  removeNode(id) {
    this.nodes.delete(id);
    for (const [k, e] of this.edges) if (e.from === id || e.to === id) this.edges.delete(k);
    this.out.delete(id);
  }

  edgesFrom(id) {
    return [...(this.out.get(id) ?? [])].map((k) => this.edges.get(k)).filter(Boolean);
  }

  edge(from, to, { kind, via, confidence, evidence: evs = [], declaredOnly = false }) {
    if (from === to) return null;
    const id = `${from}->${to}`;
    let e = this.edges.get(id);
    if (!e) {
      e = { id, from, to, kind, via: [], confidence, declaredOnly, evidence: [] };
      this.edges.set(id, e);
      if (!this.out.has(from)) this.out.set(from, new Set());
      this.out.get(from).add(id);
    } else {
      if (CONFIDENCE[confidence] > CONFIDENCE[e.confidence]) e.confidence = confidence;
      e.declaredOnly = e.declaredOnly && declaredOnly;
      if (kind === 'calls' && e.kind === 'depends') e.kind = 'calls';
    }
    if (CONFIDENCE[e.confidence] > CONFIDENCE.declared) e.declaredOnly = false;
    if (via && !e.via.includes(via)) e.via.push(via);
    for (const ev of evs) pushEvidence(e.evidence, ev);
    return e;
  }
}
