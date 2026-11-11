// Reads package manifests for nine ecosystems into one shape:
// { file, dir, ecosystem, name, deps: [{ name, line, dev }], refs: [{ kind, value, line }], ... }
// `refs` are links to other units in the same repo (workspace deps, path deps, project refs).

import { parseToml } from '../parse/toml.js';
import { parseYaml } from '../parse/yaml.js';
import { baseOf, dirOf, joinRel, readText } from './files.js';

const MANIFEST_TESTS = [
  ['npm', (b) => b === 'package.json'],
  ['pypi', (b, f) => b === 'pyproject.toml' || b === 'Pipfile' || b === 'setup.py' || isRequirementsFile(b, f)],
  ['go', (b) => b === 'go.mod'],
  ['cargo', (b) => b === 'Cargo.toml'],
  ['gem', (b) => b === 'Gemfile'],
  ['composer', (b) => b === 'composer.json'],
  ['maven', (b) => b === 'pom.xml' || b === 'build.gradle' || b === 'build.gradle.kts'],
  ['nuget', (b) => b.endsWith('.csproj') || b.endsWith('.fsproj')],
  ['hex', (b) => b === 'mix.exs'],
];

function isRequirementsFile(base, file) {
  if (!base.endsWith('.txt') && !base.endsWith('.in')) return false;
  if (/^requirements([-_.][\w.-]+)?\.(txt|in)$/i.test(base) || /[-_]requirements\.(txt|in)$/i.test(base)) return true;
  return /(^|\/)requirements\//.test(file);
}

export function manifestEcosystem(file) {
  const base = baseOf(file);
  for (const [eco, test] of MANIFEST_TESTS) if (test(base, file)) return eco;
  return null;
}

/** Directory a manifest describes (requirements/*.txt describes the parent directory). */
export function manifestUnitDir(file) {
  const dir = dirOf(file);
  if (/(^|\/)requirements$/.test(dir) && isRequirementsFile(baseOf(file), file)) return dirOf(dir);
  return dir;
}

export function readManifest(root, file, ctx = {}) {
  const eco = manifestEcosystem(file);
  if (!eco) return null;
  const text = readText(root, file, 2 * 1024 * 1024);
  if (text == null) return null;
  const base = baseOf(file);
  const m = { file, dir: manifestUnitDir(file), ecosystem: eco, name: null, deps: [], refs: [], errors: [] };
  try {
    if (eco === 'npm') readPackageJson(text, m);
    else if (base === 'pyproject.toml') readPyproject(text, m);
    else if (base === 'Pipfile') readPipfile(text, m);
    else if (base === 'setup.py') readSetupPy(text, m);
    else if (eco === 'pypi') readRequirements(text, m);
    else if (eco === 'go') readGoMod(text, m);
    else if (eco === 'cargo') readCargo(text, m);
    else if (eco === 'gem') readGemfile(text, m);
    else if (eco === 'composer') readComposer(text, m);
    else if (base === 'pom.xml') readPom(text, m);
    else if (eco === 'maven') readGradle(text, m, ctx.gradleCatalog);
    else if (eco === 'nuget') readCsproj(text, m);
    else if (eco === 'hex') readMix(text, m);
  } catch (err) {
    m.errors.push(`${file}: ${err.message}`);
  }
  return m;
}

// ---------------------------------------------------------------- helpers

/** First line at or after `from` that contains `token` as a whole word (quotes, spaces or brackets around it). */
export function locate(text, token, from = 1) {
  if (!token) return from || 1;
  const lines = text.split('\n');
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[\\s"'\`(\\[{:,=<>])${esc}($|[\\s"'\`)\\]}:,=<>@;\\[~!^])`);
  for (let i = Math.max(0, from - 1); i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  for (let i = 0; i < Math.min(from - 1, lines.length); i++) if (re.test(lines[i])) return i + 1;
  return from || 1;
}

function lineOfKey(text, key, from = 1) {
  const lines = text.split('\n');
  const re = new RegExp(`^\\s*["']?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*[:=]`);
  for (let i = Math.max(0, from - 1); i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return 0;
}

const DEV_WORDS = /(^|[-_.\/])(dev|develop|development|test|tests|testing|lint|linting|docs?|ci|typing|types|mypy|bench)([-_.]|$)/i;

// PEP 508: "name[extra]>=1 ; python_version<'3.9'" -> "name"
function pep508Name(spec) {
  const m = String(spec).trim().match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- npm

function readPackageJson(text, m) {
  const pkg = JSON.parse(text);
  m.name = typeof pkg.name === 'string' ? pkg.name : null;
  m.packageName = m.name;
  if (typeof pkg.description === 'string') m.description = pkg.description.slice(0, 200);
  m.private = pkg.private === true;
  m.bin = Boolean(pkg.bin);
  m.scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  m.library = Boolean(pkg.main || pkg.module || pkg.exports || pkg.types || pkg.typings);
  const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
  if (Array.isArray(ws)) m.workspaces = ws.filter((x) => typeof x === 'string');
  const sections = [
    ['dependencies', false],
    ['optionalDependencies', false],
    ['peerDependencies', true],
    ['devDependencies', true],
  ];
  for (const [section, dev] of sections) {
    const deps = pkg[section];
    if (!deps || typeof deps !== 'object') continue;
    const start = lineOfKey(text, section) || 1;
    for (const [name, version] of Object.entries(deps)) {
      const line = locate(text, `"${name}"`.slice(1, -1), start);
      const v = String(version);
      m.deps.push({ name, version: v, line, dev, section });
      if (/^(workspace:|link:|file:|portal:)/.test(v) || v === '*') {
        m.refs.push({ kind: 'package', value: name, line, dev, path: /^(link:|file:|portal:)/.test(v) ? v.replace(/^\w+:/, '') : null });
      }
    }
  }
}

// ---------------------------------------------------------------- Python

function readPyproject(text, m) {
  const doc = parseToml(text);
  const project = doc.project ?? {};
  const poetry = doc.tool?.poetry ?? {};
  m.name = project.name ?? poetry.name ?? null;
  const desc = project.description ?? poetry.description;
  if (typeof desc === 'string') m.description = desc.slice(0, 200);
  m.bin = Boolean(project.scripts || poetry.scripts);
  const add = (name, dev, from) => {
    if (!name || name.toLowerCase() === 'python') return;
    m.deps.push({ name, line: locate(text, name, from), dev });
  };
  const startOf = (header) => {
    const i = text.split('\n').findIndex((l) => l.trim().startsWith(header));
    return i === -1 ? 1 : i + 1;
  };
  for (const spec of project.dependencies ?? []) add(pep508Name(spec), false, startOf('[project]'));
  for (const [group, specs] of Object.entries(project['optional-dependencies'] ?? {})) {
    const from = startOf('[project.optional-dependencies]');
    for (const spec of specs ?? []) add(pep508Name(spec), DEV_WORDS.test(group), from);
  }
  for (const [group, specs] of Object.entries(doc['dependency-groups'] ?? {})) {
    for (const spec of specs ?? []) if (typeof spec === 'string') add(pep508Name(spec), true, startOf('[dependency-groups]'));
    void group;
  }
  for (const spec of doc.tool?.uv?.['dev-dependencies'] ?? []) add(pep508Name(spec), true, startOf('[tool.uv'));
  for (const [name, val] of Object.entries(poetry.dependencies ?? {})) {
    add(name, false, startOf('[tool.poetry.dependencies]'));
    if (val && typeof val === 'object' && val.path) m.refs.push({ kind: 'path', value: val.path, line: locate(text, name) });
  }
  for (const name of Object.keys(poetry['dev-dependencies'] ?? {})) add(name, true, startOf('[tool.poetry.dev-dependencies]'));
  for (const [group, body] of Object.entries(poetry.group ?? {})) {
    const from = startOf(`[tool.poetry.group.${group}`);
    for (const name of Object.keys(body?.dependencies ?? {})) add(name, DEV_WORDS.test(group) || group !== 'main', from);
  }
  for (const [group, specs] of Object.entries(doc.tool?.pdm?.['dev-dependencies'] ?? {})) {
    for (const spec of specs ?? []) add(pep508Name(spec), true, startOf('[tool.pdm'));
    void group;
  }
  // uv workspace members
  const members = doc.tool?.uv?.workspace?.members;
  if (Array.isArray(members)) m.workspaces = members;
  for (const [name, src] of Object.entries(doc.tool?.uv?.sources ?? {})) {
    if (src && typeof src === 'object' && (src.workspace || src.path)) {
      m.refs.push({ kind: src.path ? 'path' : 'package', value: src.path ?? name, line: locate(text, name) });
    }
  }
}

function readPipfile(text, m) {
  const doc = parseToml(text);
  for (const name of Object.keys(doc.packages ?? {})) m.deps.push({ name, line: locate(text, name), dev: false });
  const devStart = text.split('\n').findIndex((l) => l.trim() === '[dev-packages]') + 1;
  for (const name of Object.keys(doc['dev-packages'] ?? {})) m.deps.push({ name, line: locate(text, name, devStart), dev: true });
}

function readSetupPy(text, m) {
  const nameMatch = text.match(/\bname\s*=\s*['"]([^'"]+)['"]/);
  if (nameMatch) m.name = nameMatch[1];
  const block = text.match(/install_requires\s*=\s*\[([\s\S]*?)\]/);
  if (!block) return;
  const offsetLine = text.slice(0, block.index).split('\n').length;
  for (const s of block[1].matchAll(/['"]([^'"]+)['"]/g)) {
    const name = pep508Name(s[1]);
    if (name) m.deps.push({ name, line: locate(text, name, offsetLine), dev: false });
  }
}

function readRequirements(text, m) {
  const dev = DEV_WORDS.test(baseOf(m.file).replace(/\.(txt|in)$/, ''));
  text.split('\n').forEach((raw, i) => {
    let line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) return;
    const egg = line.match(/#egg=([A-Za-z0-9._-]+)/);
    if (egg) return m.deps.push({ name: egg[1], line: i + 1, dev });
    if (line.startsWith('-')) {
      const local = line.match(/^-e\s+(\.{1,2}\/[^\s;]+)/);
      if (local) m.refs.push({ kind: 'path', value: local[1], line: i + 1 });
      return;
    }
    if (/^[a-z]+:\/\//i.test(line)) return;
    const at = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*@/);
    const name = at ? at[1] : pep508Name(line);
    if (name) m.deps.push({ name, line: i + 1, dev });
  });
}

// ---------------------------------------------------------------- Go

function readGoMod(text, m) {
  const lines = text.split('\n');
  let inRequire = false;
  let inReplace = false;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '').trim();
    const indirect = /\/\/\s*indirect/.test(raw);
    if (!line) return;
    const mod = line.match(/^module\s+(\S+)/);
    if (mod) return (m.name = mod[1].replace(/^"|"$/g, ''));
    if (/^require\s*\($/.test(line)) return (inRequire = true);
    if (/^replace\s*\($/.test(line)) return (inReplace = true);
    if (line === ')') return (inRequire = inReplace = false);
    let req = null;
    if (inRequire) req = line.match(/^(\S+)\s+\S+/);
    else if (line.startsWith('require ')) req = line.match(/^require\s+(\S+)\s+\S+/);
    if (req && !indirect) m.deps.push({ name: req[1], line: i + 1, dev: false });
    let rep = null;
    if (inReplace) rep = line.match(/^(\S+)(?:\s+\S+)?\s*=>\s*(\.{1,2}\/\S*)/);
    else if (line.startsWith('replace ')) rep = line.match(/^replace\s+(\S+)(?:\s+\S+)?\s*=>\s*(\.{1,2}\/\S*)/);
    if (rep) m.refs.push({ kind: 'path', value: rep[2], line: i + 1, module: rep[1] });
  });
}

// ---------------------------------------------------------------- Rust

function readCargo(text, m) {
  const doc = parseToml(text);
  m.name = doc.package?.name ?? null;
  if (typeof doc.package?.description === 'string') m.description = doc.package.description.slice(0, 200);
  m.bin = Array.isArray(doc.bin) && doc.bin.length > 0;
  if (Array.isArray(doc.workspace?.members)) m.workspaces = doc.workspace.members;
  const tables = [
    [doc.dependencies, false, '[dependencies]'],
    [doc['dev-dependencies'], true, '[dev-dependencies]'],
    [doc['build-dependencies'], true, '[build-dependencies]'],
    [doc.workspace?.dependencies, false, '[workspace.dependencies]'],
  ];
  for (const target of Object.values(doc.target ?? {})) {
    tables.push([target?.dependencies, false, 'dependencies]'], [target?.['dev-dependencies'], true, 'dev-dependencies]']);
  }
  const lines = text.split('\n');
  for (const [table, dev, header] of tables) {
    if (!table || typeof table !== 'object') continue;
    const from = lines.findIndex((l) => l.includes(header)) + 1 || 1;
    for (const [key, val] of Object.entries(table)) {
      const real = val && typeof val === 'object' && typeof val.package === 'string' ? val.package : key;
      const line = locate(text, key, from);
      m.deps.push({ name: real, line, dev });
      if (val && typeof val === 'object' && typeof val.path === 'string') m.refs.push({ kind: 'path', value: val.path, line, dev });
    }
  }
}

// ---------------------------------------------------------------- Ruby

function readGemfile(text, m) {
  const groupStack = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const group = line.match(/^group\s+(.+?)\s+do\b/);
    if (group) return groupStack.push(/development|test/.test(group[1]) && !/production|default/.test(group[1]));
    if (/^(platforms?|install_if|source|git|path)\b.*\bdo\b/.test(line)) return groupStack.push(groupStack.at(-1) ?? false);
    if (line === 'end') return groupStack.pop();
    const gem = line.match(/^gem\s+['"]([^'"]+)['"](.*)$/);
    if (!gem) return;
    const inlineDev = /group[s]?:\s*\[?[^\]]*:(development|test)/.test(gem[2]) || /require:\s*false/.test(gem[2]) && false;
    m.deps.push({ name: gem[1], line: i + 1, dev: Boolean(groupStack.at(-1)) || inlineDev });
    const p = gem[2].match(/path:\s*['"]([^'"]+)['"]/);
    if (p) m.refs.push({ kind: 'path', value: p[1], line: i + 1 });
  });
}

// ---------------------------------------------------------------- PHP

function readComposer(text, m) {
  const pkg = JSON.parse(text);
  m.name = pkg.name ?? null;
  for (const [section, dev] of [['require', false], ['require-dev', true]]) {
    const start = lineOfKey(text, section) || 1;
    for (const name of Object.keys(pkg[section] ?? {})) {
      if (name === 'php' || name.startsWith('ext-') || name.startsWith('lib-')) continue;
      m.deps.push({ name, line: locate(text, name, start), dev });
    }
  }
}

// ---------------------------------------------------------------- JVM

function readPom(text, m) {
  const clean = text.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
  const lineAt = (idx) => clean.slice(0, idx).split('\n').length;
  const parent = clean.match(/<parent>([\s\S]*?)<\/parent>/);
  if (parent) {
    const g = parent[1].match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/)?.[1];
    const a = parent[1].match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/)?.[1];
    if (g && a) m.deps.push({ name: `${g}:${a}`, line: lineAt(parent.index), dev: false });
  }
  const withoutBlocks = clean.replace(/<(parent|dependencies|dependencyManagement|build|profiles|plugins)>[\s\S]*?<\/\1>/g, (b) => b.replace(/[^\n]/g, ' '));
  m.name = withoutBlocks.match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/)?.[1] ?? null;
  m.packaging = withoutBlocks.match(/<packaging>\s*([^<\s]+)\s*<\/packaging>/)?.[1] ?? 'jar';
  const modules = [...clean.matchAll(/<module>\s*([^<\s]+)\s*<\/module>/g)].map((x) => x[1]);
  if (modules.length) m.workspaces = modules;
  // Skip <dependencyManagement> (versions only, not usage).
  const usage = clean.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, (b) => b.replace(/[^\n]/g, ' '));
  for (const dep of usage.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const g = dep[1].match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/)?.[1];
    const a = dep[1].match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/)?.[1];
    if (!g || !a) continue;
    const scope = dep[1].match(/<scope>\s*([^<\s]+)\s*<\/scope>/)?.[1];
    const line = lineAt(dep.index + dep[0].indexOf('<artifactId>'));
    m.deps.push({ name: `${g}:${a}`, line, dev: scope === 'test' });
    m.refs.push({ kind: 'artifact', value: a, line, weak: true });
  }
}

const GRADLE_CONFIG = /\b(implementation|api|compileOnly|runtimeOnly|developmentOnly|testImplementation|testRuntimeOnly|androidTestImplementation|kapt|ksp|annotationProcessor|compile|testCompile)\b/;

function readGradle(text, m, catalog) {
  const lines = text.split('\n');
  // Android projects put the app module in a folder called "app"; name it after its parent instead.
  const base = baseOf(m.dir);
  m.name = (base === 'app' || base === 'src' ? baseOf(dirOf(m.dir)) || base : base) || null;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '');
    const conf = line.match(GRADLE_CONFIG);
    if (/id\s*\(?\s*['"]org\.springframework\.boot['"]/.test(line)) {
      m.deps.push({ name: 'org.springframework.boot:spring-boot', line: i + 1, dev: false });
    }
    if (/id\s*\(?\s*['"]io\.quarkus['"]/.test(line)) m.deps.push({ name: 'io.quarkus:quarkus-core', line: i + 1, dev: false });
    if (/id\s*\(?\s*['"]io\.ktor\.plugin['"]/.test(line)) m.deps.push({ name: 'io.ktor:ktor-server-core', line: i + 1, dev: false });
    if (!conf) return;
    const dev = /^test|androidTest/.test(conf[1]);
    for (const coord of line.matchAll(/['"]([\w.-]+):([\w.-]+)(?::[^'"]*)?['"]/g)) {
      m.deps.push({ name: `${coord[1]}:${coord[2]}`, line: i + 1, dev });
    }
    for (const g of line.matchAll(/group\s*[:=]\s*['"]([\w.-]+)['"]\s*,\s*name\s*[:=]\s*['"]([\w.-]+)['"]/g)) {
      m.deps.push({ name: `${g[1]}:${g[2]}`, line: i + 1, dev });
    }
    for (const p of line.matchAll(/project\s*\(\s*(?:path\s*[:=]\s*)?['"](:[\w:.-]+)['"]\s*\)/g)) {
      m.refs.push({ kind: 'gradle', value: p[1], line: i + 1, dev });
    }
    if (catalog) {
      for (const alias of line.matchAll(/\blibs\.([\w.]+)/g)) {
        const key = alias[1].replace(/\./g, '-').toLowerCase();
        const coord = catalog.get(key);
        if (coord) m.deps.push({ name: coord, line: i + 1, dev });
      }
    }
  });
}

/** gradle/libs.versions.toml -> Map(alias -> "group:artifact") */
export function readGradleCatalog(root, file) {
  const text = readText(root, file);
  if (!text) return null;
  try {
    const doc = parseToml(text);
    const map = new Map();
    for (const [alias, val] of Object.entries(doc.libraries ?? {})) {
      let coord = null;
      if (typeof val === 'string') coord = val.split(':').slice(0, 2).join(':');
      else if (val?.module) coord = val.module;
      else if (val?.group && val?.name) coord = `${val.group}:${val.name}`;
      if (coord) map.set(alias.replace(/[._]/g, '-').toLowerCase(), coord);
    }
    return map;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- .NET

function readCsproj(text, m) {
  m.name = baseOf(m.file).replace(/\.(cs|fs)proj$/, '');
  const lineAt = (idx) => text.slice(0, idx).split('\n').length;
  const sdk = text.match(/<Project\s+Sdk="([^"]+)"/);
  if (sdk && /Microsoft\.NET\.Sdk\.(Web|BlazorWebAssembly|Razor)/.test(sdk[1])) {
    m.deps.push({ name: 'Microsoft.AspNetCore.App', line: lineAt(sdk.index), dev: false });
  }
  if (sdk && /Microsoft\.NET\.Sdk\.Worker/.test(sdk[1])) m.worker = true;
  for (const p of text.matchAll(/<PackageReference\s+Include="([^"]+)"/g)) {
    m.deps.push({ name: p[1], line: lineAt(p.index), dev: /test|xunit|nunit|mstest|moq|coverlet/i.test(p[1]) });
  }
  for (const p of text.matchAll(/<ProjectReference\s+Include="([^"]+)"/g)) {
    m.refs.push({ kind: 'path', value: dirOf(p[1].replace(/\\/g, '/')), line: lineAt(p.index) });
  }
  m.bin = /<OutputType>\s*Exe\s*<\/OutputType>/i.test(text) || Boolean(sdk && /Web|Worker/.test(sdk[1]));
}

// ---------------------------------------------------------------- Elixir

function readMix(text, m) {
  m.name = text.match(/\bapp:\s*:(\w+)/)?.[1] ?? null;
  const block = text.match(/defp?\s+deps\b[\s\S]*?\[([\s\S]*?)\n\s*\]\s*\n\s*end/);
  if (!block) return;
  const offsetLine = text.slice(0, block.index).split('\n').length;
  block[0].split('\n').forEach((line, i) => {
    const d = line.match(/\{\s*:(\w+)\s*,/);
    if (!d) return;
    const dev = /only:\s*(\[[^\]]*\]|:\w+)/.test(line) && !/:prod/.test(line);
    m.deps.push({ name: d[1], line: offsetLine + i, dev });
    const p = line.match(/(?:path|in_umbrella):\s*(?:"([^"]+)"|true)/);
    if (p) m.refs.push({ kind: p[1] ? 'path' : 'package', value: p[1] ?? d[1], line: offsetLine + i });
  });
}

// ---------------------------------------------------------------- workspace files

/** pnpm-workspace.yaml / lerna.json globs at the repo root. */
export function readWorkspaceGlobs(root, files) {
  const globs = [];
  if (files.includes('pnpm-workspace.yaml')) {
    try {
      const doc = parseYaml(readText(root, 'pnpm-workspace.yaml') ?? '');
      if (Array.isArray(doc?.packages)) globs.push(...doc.packages.filter((x) => typeof x === 'string'));
    } catch {
      /* ignore */
    }
  }
  if (files.includes('lerna.json')) {
    try {
      const doc = JSON.parse(readText(root, 'lerna.json') ?? '{}');
      if (Array.isArray(doc.packages)) globs.push(...doc.packages);
    } catch {
      /* ignore */
    }
  }
  return globs;
}

export { joinRel };
