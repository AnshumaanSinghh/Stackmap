#!/usr/bin/env node
// Maps well-known open-source projects for the site gallery.
//
//   node scripts/build-gallery.js                 clone each repo (depth 1) into a temp folder, then map it
//   node scripts/build-gallery.js --corpus <dir>  reuse clones in <dir>/<owner>_<repo>
//   node scripts/build-gallery.js --only plane    one project
//
// Writes site/gallery/<slug>.html (interactive map), <slug>.svg (preview) and site/gallery/index.json.
// Nothing from the cloned repos is executed: Stackmap only reads files.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan, toSvg, toHtml } from '../src/index.js';

export const GALLERY = [
  { slug: 'cal-com', repo: 'calcom/cal.com', title: 'Cal.com', blurb: 'Scheduling platform: Next.js and NestJS over PostgreSQL, with dozens of calendar and video integrations.' },
  { slug: 'plane', repo: 'makeplane/plane', title: 'Plane', blurb: 'Project tracker: Django and Celery workers on RabbitMQ, three React apps, MinIO storage.' },
  { slug: 'mastodon', repo: 'mastodon/mastodon', title: 'Mastodon', blurb: 'Social network server: a Rails app, a Node streaming service and Sidekiq workers.' },
  { slug: 'langfuse', repo: 'langfuse/langfuse', title: 'Langfuse', blurb: 'LLM observability: Next.js web and an Express worker over ClickHouse, PostgreSQL and Redis.' },
  { slug: 'dub', repo: 'dubinc/dub', title: 'Dub', blurb: 'Link management: one Next.js app talking to 20+ APIs, PlanetScale, Tinybird and Upstash.' },
  { slug: 'immich', repo: 'immich-app/immich', title: 'Immich', blurb: 'Photo backup: NestJS server, SvelteKit web, a Python machine-learning service.' },
  { slug: 'chatwoot', repo: 'chatwoot/chatwoot', title: 'Chatwoot', blurb: 'Customer support: a Rails monolith with Sidekiq, Vue, and 30+ channel integrations.' },
  { slug: 'outline', repo: 'outline/outline', title: 'Outline', blurb: 'Team wiki: one Koa + React app with PostgreSQL, Redis, S3 and many sign-in providers.' },
];

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'site', 'gallery');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

function main() {
  const corpus = arg('corpus');
  const only = arg('only');
  fs.mkdirSync(outDir, { recursive: true });
  const indexFile = path.join(outDir, 'index.json');
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : [];
  for (const item of GALLERY) {
    if (only && item.slug !== only) continue;
    let dir;
    let cleanup = () => {};
    if (corpus) dir = path.join(corpus, item.repo.replace('/', '_'));
    else {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stackmap-gallery-'));
      execFileSync('git', ['clone', '-q', '--depth', '1', '--filter=blob:limit=1m', `https://github.com/${item.repo}.git`, tmp], { stdio: 'inherit' });
      dir = tmp;
      cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
    }
    try {
      const graph = scan(dir);
      graph.project.name = item.title;
      graph.project.repoUrl = `https://github.com/${item.repo}`;
      fs.writeFileSync(path.join(outDir, `${item.slug}.html`), toHtml(graph));
      fs.writeFileSync(path.join(outDir, `${item.slug}.svg`), toSvg(graph, { mode: 'light', legend: false, title: false }));
      const s = graph.summary;
      const entry = {
        ...item,
        commit: graph.project.commit,
        scannedAt: graph.project.generatedAt.slice(0, 10),
        ms: s.ms,
        files: s.filesListed,
        counts: { apps: s.apps, services: s.services, workers: s.workers, datastores: s.datastores, external: s.external, edges: s.edges },
        languages: s.languages.slice(0, 3).map((l) => l.name),
      };
      const i = index.findIndex((x) => x.slug === item.slug);
      if (i === -1) index.push(entry);
      else index[i] = entry;
      console.log(`${item.slug}: ${s.apps} apps, ${s.services} services, ${s.datastores} data, ${s.external} third-party in ${s.ms} ms`);
    } finally {
      cleanup();
    }
  }
  index.sort((a, b) => GALLERY.findIndex((x) => x.slug === a.slug) - GALLERY.findIndex((x) => x.slug === b.slug));
  fs.writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);
}

main();
