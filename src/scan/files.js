// Lists the files of a project and reads them with small, safe limits.
// Prefers `git ls-files` (fast, honours .gitignore); falls back to a directory walk.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Directories that never hold first-party architecture.
export const IGNORED_DIRS = new Set([
  'node_modules', 'bower_components', 'jspm_packages', '.pnpm-store', '.yarn',
  '.git', '.hg', '.svn',
  'dist', 'build', 'out', '.output', '.next', '.nuxt', '.svelte-kit', '.astro', '.angular',
  '.turbo', '.vercel', '.netlify', '.serverless', '.wrangler', '.expo', '.parcel-cache', '.cache',
  'coverage', '.nyc_output', 'storybook-static',
  'vendor', 'target', 'Pods', 'DerivedData', '.gradle', '.dart_tool', '.terraform',
  '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache', 'site-packages',
  '.idea', '.vscode', '.fleet',
]);

const MAX_LISTED = 300_000;

/**
 * @param {string} root absolute project directory
 * @param {{ ignore?: string[] }} [opts]
 * @returns {{ files: string[], source: 'git' | 'walk' }} repo-relative POSIX paths
 */
export function listFiles(root, opts = {}) {
  const ignore = compileGlobs(opts.ignore ?? []);
  let files = gitListFiles(root);
  let source = 'git';
  if (!files) {
    files = walk(root);
    source = 'walk';
  }
  files = files.filter((f) => !hasIgnoredDir(f) && !ignore(f));
  files.sort();
  return { files, source };
}

function gitListFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const files = out.split('\0').filter(Boolean);
    if (files.length === 0) return null;
    // Deleted-but-tracked paths simply fail to read later; no need to stat 100k files here.
    return files.slice(0, MAX_LISTED);
  } catch {
    return null;
  }
}

function walk(root) {
  const out = [];
  const rootIgnores = readRootGitignore(root);
  const stack = [''];
  while (stack.length && out.length < MAX_LISTED) {
    const rel = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name) || rootIgnores.has(e.name) || rootIgnores.has(childRel)) continue;
        stack.push(childRel);
      } else if (e.isFile()) {
        out.push(childRel);
      }
    }
  }
  return out;
}

// Only simple directory names from the root .gitignore; enough for the no-git fallback.
function readRootGitignore(root) {
  const set = new Set();
  try {
    for (let line of fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/)) {
      line = line.trim();
      if (!line || line.startsWith('#') || line.startsWith('!') || /[*?[\]]/.test(line)) continue;
      set.add(line.replace(/^\//, '').replace(/\/$/, ''));
    }
  } catch {
    /* no .gitignore */
  }
  return set;
}

function hasIgnoredDir(file) {
  const parts = file.split('/');
  for (let i = 0; i < parts.length - 1; i++) if (IGNORED_DIRS.has(parts[i])) return true;
  return false;
}

/**
 * Compile simple glob patterns (`*`, `**`, `?`, trailing `/`) into one predicate.
 * A pattern without a slash matches a basename or any directory segment.
 */
export function compileGlobs(patterns) {
  const regs = patterns.filter(Boolean).map(globToRegExp);
  if (regs.length === 0) return () => false;
  return (file) => regs.some((r) => r.test(file));
}

export function globToRegExp(glob) {
  let g = glob.trim().replace(/^\.\//, '');
  const dirOnly = g.endsWith('/');
  if (dirOnly) g = g.slice(0, -1);
  const anchored = g.includes('/');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        re += '.*';
        i++;
        if (g[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const prefix = anchored ? '^' : '(^|/)';
  return new RegExp(`${prefix}${re}(/|$)`);
}

/** Read a text file relative to root. Returns null when missing, too large or binary. */
export function readText(root, rel, maxBytes = 1024 * 1024) {
  const abs = path.join(root, rel);
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > maxBytes) return null;
    const buf = fs.readFileSync(abs);
    // Binary check: a NUL byte in the first 8 KB.
    const head = buf.subarray(0, 8192);
    if (head.includes(0)) return null;
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return text;
  } catch {
    return null;
  }
}

/** Precomputed line starts so offset -> line lookups are O(log n). */
export function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return {
    lineAt(offset) {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    },
    textOf(line) {
      const s = starts[line - 1];
      if (s === undefined) return '';
      const e = line < starts.length ? starts[line] - 1 : text.length;
      return text.slice(s, e).replace(/\r$/, '');
    },
  };
}

/** One trimmed line of code, short enough to show as evidence. */
export function snippet(text, max = 140) {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Find the first line matching a predicate or regexp. Returns 1-based line or 0. */
export function findLine(text, test) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (typeof test === 'function' ? test(lines[i]) : test.test(lines[i])) return i + 1;
  }
  return 0;
}

export function dirOf(rel) {
  const i = rel.lastIndexOf('/');
  return i === -1 ? '' : rel.slice(0, i);
}

export function baseOf(rel) {
  const i = rel.lastIndexOf('/');
  return i === -1 ? rel : rel.slice(i + 1);
}

export function joinRel(dir, rel) {
  const joined = path.posix.normalize(path.posix.join(dir || '.', rel));
  return joined === '.' ? '' : joined.replace(/^\.\//, '').replace(/\/$/, '');
}
