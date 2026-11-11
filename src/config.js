// .stackmap.json (or "stackmap" in package.json) lets a team correct and extend the map.
// Everything is optional. See docs/config.md.

import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILES = ['.stackmap.json', 'stackmap.config.json'];

const KNOWN_KEYS = new Set(['$schema', 'name', 'ignore', 'include', 'hide', 'labels', 'technologies', 'nodes', 'edges', 'rules', 'readme']);

/** @returns {{ config: object, file: string|null, errors: string[] }} */
export function loadConfig(root, explicit) {
  const errors = [];
  const candidates = explicit ? [explicit] : CONFIG_FILES;
  for (const name of candidates) {
    const file = path.resolve(root, name);
    if (!fs.existsSync(file)) {
      if (explicit) errors.push(`Config file not found: ${explicit}`);
      continue;
    }
    try {
      const text = fs.readFileSync(file, 'utf8');
      const config = JSON.parse(text);
      return { config: normalise(config, errors, text), file: path.relative(root, file) || name, errors };
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      return { config: normalise({}, errors, ''), file: null, errors };
    }
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.stackmap && typeof pkg.stackmap === 'object') {
      return { config: normalise(pkg.stackmap, errors, ''), file: 'package.json', errors };
    }
  } catch {
    /* no package.json */
  }
  return { config: normalise({}, errors, ''), file: null, errors };
}

function normalise(raw, errors, text) {
  const c = raw && typeof raw === 'object' ? raw : {};
  for (const k of Object.keys(c)) if (!KNOWN_KEYS.has(k)) errors.push(`Unknown config key "${k}" (ignored)`);
  const arr = (k) => {
    if (c[k] == null) return [];
    if (!Array.isArray(c[k])) {
      errors.push(`"${k}" must be an array`);
      return [];
    }
    return c[k];
  };
  const lineOf = (needle) => {
    if (!text || !needle) return 1;
    const i = text.indexOf(needle);
    return i === -1 ? 1 : text.slice(0, i).split('\n').length;
  };
  return {
    name: typeof c.name === 'string' ? c.name : null,
    ignore: arr('ignore').filter((x) => typeof x === 'string'),
    include: arr('include').filter((x) => typeof x === 'string'),
    hide: arr('hide').filter((x) => typeof x === 'string'),
    labels: c.labels && typeof c.labels === 'object' ? c.labels : {},
    technologies: arr('technologies').filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string'),
    nodes: arr('nodes').filter((n) => n && typeof n.id === 'string').map((n) => ({ ...n, line: lineOf(`"${n.id}"`) })),
    edges: arr('edges').filter((e) => e && typeof e.from === 'string' && typeof e.to === 'string').map((e) => ({ ...e, line: lineOf(`"${e.from}"`) })),
    rules: arr('rules').filter((r) => r && typeof r === 'object').map((r) => ({ ...r, line: lineOf(JSON.stringify(r.deny ?? r.require ?? '').slice(0, 40)) })),
    readme: c.readme && typeof c.readme === 'object' ? c.readme : {},
  };
}
