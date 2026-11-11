// GitHub Action entry point. Zero dependencies: talks to the REST API with fetch and to the
// runner through the documented files and workflow commands.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../src/graph/build.js';
import { viewGraph } from '../src/graph/view.js';
import { diffGraphs, diffToMarkdown, COMMENT_MARKER } from '../src/graph/diff.js';
import { checkRules } from '../src/graph/rules.js';
import { toMermaid } from '../src/render/mermaid.js';
import { toHtml } from '../src/render/html.js';
import { updateReadme } from '../src/readme.js';
import { loadConfig } from '../src/config.js';
import { exportRef } from '../src/git.js';
import { summaryText } from '../src/summary.js';

const env = process.env;

export function input(name, fallback = '') {
  const v = env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`];
  return v === undefined || v === '' ? fallback : v.trim();
}
const bool = (name, fallback) => /^(true|yes|1|on)$/i.test(input(name, String(fallback)));

const log = {
  info: (s) => process.stdout.write(`${s}\n`),
  warn: (s) => process.stdout.write(`::warning title=Stackmap::${escapeCmd(s)}\n`),
  error: (s, file, line) => process.stdout.write(`::error ${file ? `file=${file},line=${line ?? 1},` : ''}title=Stackmap::${escapeCmd(s)}\n`),
  group: (s) => process.stdout.write(`::group::${s}\n`),
  end: () => process.stdout.write('::endgroup::\n'),
};

function escapeCmd(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function setOutput(name, value) {
  if (!env.GITHUB_OUTPUT) return;
  const delim = `stackmap_${Math.random().toString(36).slice(2)}`;
  fs.appendFileSync(env.GITHUB_OUTPUT, `${name}<<${delim}\n${value}\n${delim}\n`);
}

function appendSummary(md) {
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${md}\n`);
}

async function main() {
  const workspace = env.GITHUB_WORKSPACE || process.cwd();
  const root = path.resolve(workspace, input('path', '.'));
  const configFile = input('config') || undefined;
  const event = env.GITHUB_EVENT_PATH && fs.existsSync(env.GITHUB_EVENT_PATH) ? JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const pr = event.pull_request ?? null;
  let failed = false;

  log.group('Mapping the architecture');
  const head = scan(root, { configFile });
  const s = head.summary;
  log.info(`${summaryText(s, { sep: ", ", connections: true }) || "nothing found"} (${s.ms} ms)`);
  for (const w of head.warnings.slice(0, 20)) log.info(`warning: ${w}`);
  log.end();

  const jsonPath = path.join(env.RUNNER_TEMP || os.tmpdir(), 'stackmap.json');
  fs.writeFileSync(jsonPath, JSON.stringify(head, null, 2));
  setOutput('json', jsonPath);

  const html = input('html');
  if (html) {
    const out = path.resolve(workspace, html);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, toHtml(head));
    log.info(`Interactive map written to ${html}`);
  }

  // ---------------------------------------------------------------- pull request diff
  let diff = null;
  if (pr) {
    log.group('Comparing with the base branch');
    try {
      const baseSha = pr.base?.sha;
      ensureCommit(root, baseSha);
      const exp = exportRef(root, baseSha);
      try {
        const base = scan(exp.dir, { configFile, git: false });
        diff = diffGraphs(base, head);
      } finally {
        exp.cleanup();
      }
      const added = diff.addedNodes.length + diff.addedEdges.length;
      const removed = diff.removedNodes.length + diff.removedEdges.length;
      log.info(diff.changed ? `Architecture changed: +${added} / -${removed}` : 'No architecture changes.');
      setOutput('changed', String(diff.changed));
      setOutput('added', String(added));
      setOutput('removed', String(removed));
    } catch (err) {
      log.warn(`Could not compare with the base branch: ${err.message}`);
    }
    log.end();
  } else {
    setOutput('changed', 'false');
  }

  if (diff && bool('comment', true)) {
    const body = diffToMarkdown(diff);
    try {
      await upsertComment(event, body, diff.changed || input('comment-when', 'changed') === 'always');
    } catch (err) {
      const hint = /403|Resource not accessible/.test(err.message) ? ' Give the job `permissions: pull-requests: write` (pull requests from forks get a read-only token).' : '';
      log.warn(`Could not post the pull request comment: ${err.message}.${hint}`);
    }
  }

  // ---------------------------------------------------------------- job summary
  if (bool('summary', true)) {
    const view = viewGraph(head, { libraries: false });
    const lines = [`## Stackmap: ${head.project.name}`, '', summaryText(s, { connections: true }), ''];
    if (diff) lines.push(diffToMarkdown(diff, { diagram: true }).replace(COMMENT_MARKER, ''), '');
    if (view.nodes.length) lines.push('<details><summary>Full architecture map</summary>', '', '```mermaid', toMermaid(view), '```', '', '</details>');
    appendSummary(lines.join('\n'));
  }

  // ---------------------------------------------------------------- rules
  if (bool('check', true)) {
    const { config } = loadConfig(root, configFile);
    if (config.rules.length) {
      log.group('Checking architecture rules');
      const res = checkRules(head, config.rules);
      for (const e of res.errors) log.error(`Config: ${e}`);
      for (const v of res.violations) {
        const file = v.evidence ? path.relative(workspace, path.join(root, v.evidence.file)) : null;
        log.error(v.message + (v.through.length ? ` (through ${v.through.join(', ')})` : ''), file, v.evidence?.line);
      }
      log.info(res.ok ? `${res.checked} rule(s) passed.` : `${res.violations.length} violation(s).`);
      setOutput('violations', String(res.violations.length));
      if (!res.ok) failed = true;
      log.end();
    } else {
      setOutput('violations', '0');
    }
  }

  // ---------------------------------------------------------------- README
  const readme = input('readme');
  if (readme) {
    const mode = input('readme-mode', 'check');
    const res = updateReadme(root, head, { file: readme, check: mode !== 'write' });
    if (mode === 'write') log.info(`${readme}: ${res.status}`);
    else if (res.status !== 'unchanged') {
      log.error(`${readme} has an out-of-date architecture diagram. Run "npx stackmap-cli readme" and commit the result.`, path.relative(workspace, res.file), 1);
      failed = true;
    } else log.info(`${readme}: diagram is up to date.`);
  }

  if (failed) process.exitCode = 1;
}

/** Make sure the base commit exists locally (actions/checkout fetches depth 1 by default). */
function ensureCommit(root, sha) {
  if (!sha) throw new Error('pull request has no base sha');
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root, stdio: 'ignore' });
  } catch {
    execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', sha], { cwd: root, stdio: 'ignore' });
  }
}

async function api(method, url, body) {
  const token = input('github-token');
  if (!token) throw new Error('no github-token');
  const base = env.GITHUB_API_URL || 'https://api.github.com';
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'stackmap-action',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

async function upsertComment(event, body, shouldCreate) {
  const repo = env.GITHUB_REPOSITORY;
  const number = event.pull_request?.number;
  if (!repo || !number) return;
  let existing = null;
  for (let page = 1; page <= 10 && !existing; page++) {
    const list = await api('GET', `/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`);
    existing = list.find((c) => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER)) ?? null;
    if (list.length < 100) break;
  }
  if (existing) {
    if (existing.body !== body) await api('PATCH', `/repos/${repo}/issues/comments/${existing.id}`, { body });
    log.info('Updated the Stackmap comment on the pull request.');
  } else if (shouldCreate) {
    await api('POST', `/repos/${repo}/issues/${number}/comments`, { body });
    log.info('Posted a Stackmap comment on the pull request.');
  } else {
    log.info('No architecture changes, so no comment was posted.');
  }
}

main().catch((err) => {
  log.error(err.stack || err.message);
  process.exitCode = 1;
});
