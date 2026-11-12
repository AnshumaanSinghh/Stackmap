import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan, viewGraph } from '../src/index.js';

const fx = (name) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name);
const byName = (g, name) => g.nodes.find((n) => n.name === name);
const edge = (g, from, to) => g.edges.find((e) => e.from === byName(g, from)?.id && e.to === byName(g, to)?.id);

const saas = scan(fx('saas'), { git: false });
const services = viewGraph(saas, { libraries: false });
const sEdge = (from, to) => services.edges.find((e) => e.from === services.nodes.find((n) => n.name === from)?.id && e.to === services.nodes.find((n) => n.name === to)?.id);

test('finds every unit of a JS monorepo and classifies it', () => {
  assert.equal(byName(saas, 'web')?.kind, 'app');
  assert.deepEqual(byName(saas, 'web').frameworks.slice().sort(), ['Next.js', 'React'].sort());
  assert.equal(byName(saas, 'api')?.kind, 'service');
  assert.ok(byName(saas, 'api').frameworks.includes('Fastify'));
  assert.equal(byName(saas, 'worker')?.kind, 'worker');
  assert.equal(byName(saas, 'db')?.kind, 'library');
  assert.equal(byName(saas, 'ui')?.kind, 'library');
  assert.equal(byName(saas, 'web').description, 'Customer dashboard');
});

test('ignores examples, the bare workspace root and tooling', () => {
  assert.equal(byName(saas, 'demo'), undefined, 'examples/ is not part of the system');
  assert.equal(saas.nodes.find((n) => n.path === '.'), undefined, 'workspace root without code is not a unit');
  assert.equal(saas.nodes.find((n) => n.name === 'Express'), undefined);
  assert.equal(saas.nodes.find((n) => n.name === 'MongoDB'), undefined);
});

test('links code to data stores with evidence', () => {
  const e = edge(saas, 'api', 'Redis');
  assert.ok(e, 'api -> Redis');
  assert.equal(e.confidence, 'imported');
  assert.ok(e.evidence.some((ev) => ev.file === 'apps/api/src/server.ts' && ev.why === 'import'));
  const pg = edge(saas, 'db', 'PostgreSQL');
  assert.ok(pg, 'db library -> PostgreSQL');
  assert.ok(pg.via.includes('Prisma'));
  assert.ok(pg.evidence.some((ev) => ev.file === 'packages/db/prisma/schema.prisma'));
});

test('folds libraries into the apps that use them', () => {
  assert.equal(services.nodes.find((n) => n.name === 'db'), undefined);
  const e = sEdge('web', 'PostgreSQL');
  assert.ok(e, 'web reaches PostgreSQL through the db library');
  assert.deepEqual(e.through, ['db']);
  assert.ok(sEdge('worker', 'PostgreSQL'));
  const everything = viewGraph(saas, { libraries: true });
  assert.ok(everything.nodes.find((n) => n.name === 'db'));
});

test('third-party APIs from SDK imports, env vars and raw HTTP calls', () => {
  assert.equal(edge(saas, 'api', 'Stripe')?.confidence, 'imported');
  assert.equal(edge(saas, 'api', 'OpenAI')?.confidence, 'imported');
  assert.ok(edge(saas, 'api', 'Sentry'));
  assert.ok(edge(saas, 'web', 'PostHog'));
  const pm = edge(saas, 'api', 'Postmark');
  assert.ok(pm, 'fetch("https://api.postmarkapp.com/...") counts');
  assert.equal(pm.evidence[0].why, 'calls API host');
});

test('flags dependencies that are declared but never imported', () => {
  const e = edge(saas, 'api', 'Resend');
  assert.ok(e);
  assert.equal(e.declaredOnly, true);
  assert.equal(e.confidence, 'declared');
  assert.equal(edge(saas, 'api', 'Stripe').declaredOnly, false);
});

test('ignores test files and dev dependencies that are not imported at runtime', () => {
  assert.equal(saas.nodes.find((n) => /nock/i.test(n.name)), undefined);
  assert.equal(saas.nodes.find((n) => n.name === 'Vitest'), undefined);
  assert.ok(!byName(saas, 'web').env.includes('SHOULD_NOT_COUNT'), 'next.config.js is tool config, not runtime');
});

test('docker-compose: services map to units, images to technologies', () => {
  const api = byName(saas, 'api');
  assert.ok(api.platforms.some((p) => /Docker/.test(p)));
  const dep = edge(saas, 'api', 'PostgreSQL');
  assert.ok(dep, 'compose depends_on / DATABASE_URL');
  assert.ok(dep.evidence.some((ev) => ev.file === 'docker-compose.yml'));
  assert.ok(edge(saas, 'worker', 'Redis'), 'worker built from apps/worker/Dockerfile');
  const mail = saas.nodes.find((n) => n.evidence.some((ev) => ev.file === 'docker-compose.yml' && /mailpit/.test(ev.text)));
  assert.ok(mail, 'mailpit image appears');
});

test('env values never leak into evidence', () => {
  const all = JSON.stringify(saas);
  assert.ok(!all.includes('postgres:postgres@'), 'credentials from compose and .env.example are hidden');
  assert.ok(!all.includes('sk_test_xxx'));
});

test('infers service calls from URL env vars', () => {
  const e = edge(saas, 'web', 'api');
  assert.ok(e, 'NEXT_PUBLIC_API_URL -> api');
  assert.equal(e.confidence, 'inferred');
  assert.equal(e.kind, 'calls');
});

test('terraform resources and platform files', () => {
  assert.ok(saas.nodes.find((n) => n.name === 'Amazon S3'));
  assert.ok(byName(saas, 'web').platforms.includes('Vercel'));
  assert.ok(saas.summary.deploy.includes('Vercel'));
});

test('summary and ordering are stable', () => {
  assert.equal(saas.schema, 'stackmap/1');
  assert.ok(saas.summary.ms >= 0);
  const again = scan(fx('saas'), { git: false });
  const strip = (g) => JSON.stringify({ ...g, project: { ...g.project, generatedAt: 0 }, summary: { ...g.summary, ms: 0 } });
  assert.equal(strip(again), strip(saas));
});

test('Python: Django + Celery + compose', () => {
  const g = scan(fx('django'), { git: false });
  const units = g.nodes.filter((n) => n.unit);
  assert.equal(units.length, 1);
  const app = units[0];
  assert.ok(app.frameworks.includes('Django'));
  const e = (to) => g.edges.find((x) => x.from === app.id && g.nodes.find((n) => n.id === x.to)?.name === to);
  assert.ok(e('PostgreSQL'), 'Django settings / psycopg2');
  assert.ok(e('Stripe'));
  assert.ok(e('Redis'), 'CELERY_BROKER_URL=redis://');
  assert.ok(e('Sentry'));
  assert.ok(!g.nodes.find((n) => /moto/i.test(n.name)), 'dev requirements are ignored');
  const worker = g.nodes.find((n) => n.name === 'worker');
  assert.ok(worker, 'compose worker without its own folder becomes a container');
});

test('Go: go.mod, imports in subpackages, env URL', () => {
  const g = scan(fx('go-orders'), { git: false });
  const app = g.nodes.find((n) => n.unit);
  assert.equal(app.name, 'orders');
  assert.equal(app.kind, 'service');
  assert.ok(app.frameworks.includes('Gin'));
  const pg = g.edges.find((e) => e.from === app.id && e.to === 'tech:postgresql');
  assert.ok(pg);
  assert.equal(pg.confidence, 'imported');
  const redis = g.edges.find((e) => e.from === app.id && e.to === 'tech:redis');
  assert.ok(redis?.declaredOnly, 'go-redis is required but never imported');
  assert.ok(app.platforms.includes('Fly.io'));
});

test('empty folder', () => {
  const g = scan(fx('empty'), { git: false });
  assert.equal(g.nodes.length, 0);
  assert.equal(g.edges.length, 0);
});

test('self-hosting compose files: jobs, opt-in profiles and dev copies are not services', () => {
  const g = scan(fx('selfhost'), { git: false });
  const names = g.nodes.map((n) => n.name);
  for (const gone of ['db-migrate', 'grafana', 'Grafana', 'dev', 'acme', 'database', 'storybook', 'smoke-check', 'scripts', 'OpenAI']) {
    assert.ok(!names.includes(gone), `${gone} should not be on the map`);
  }
  assert.equal(g.nodes.filter((n) => n.unit || n.container).length, 2, 'only the web app and the db package');
  // "acme: image: ghcr.io/acme/acme" is the project's one app; the dev compose copy of it merges in.
  const web = byName(g, 'web');
  assert.equal(web.kind, 'app');
  assert.ok(web.platforms.includes('Docker Compose'));
  assert.ok(edge(g, 'web', 'PostgreSQL'), 'compose env on the acme service links the web app');
  // A service built FROM postgres is PostgreSQL, with the Dockerfile line as evidence.
  const pg = byName(g, 'PostgreSQL');
  assert.ok(pg.evidence.some((e) => e.file === 'docker/Dockerfile.postgres' && e.line === 1 && e.why === 'Dockerfile base image'));
  // A Dockerfile that only packages a migration tool does not turn an imported package into a service.
  assert.equal(byName(g, 'db').kind, 'library');
});
