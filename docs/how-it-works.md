# How Stackmap works

Stackmap reads files. It does not run your code, call a language model, or touch the network. Same code in, same map out.

## 1. Find the units

`git ls-files` lists the project (so `.gitignore` is respected); without git, Stackmap walks the folders and skips `node_modules`, build output, virtual environments and the like. Every folder with a package manifest becomes a unit: `package.json`, `pyproject.toml`, `requirements*.txt`, `go.mod`, `Cargo.toml`, `Gemfile`, `composer.json`, `pom.xml`, `build.gradle`, `*.csproj`, `mix.exs`. Manifests under `examples/`, `test/`, `fixtures/`, `templates/` and `playground/` are skipped, as are test-only packages.

## 2. Read the source once

Each runtime source file (not tests, stories, scripts, migrations or tool config) is read once and scanned for:

- **imports**: `import`/`require` in JS and TS, `import`/`from` in Python, Go import blocks, Rust `use`;
- **env vars read**: `process.env.X`, `import.meta.env.X`, `os.environ["X"]`, `os.Getenv("X")`, `ENV["X"]`, `env("X")`, `System.getenv("X")` and friends;
- **API hosts called**: URL literals like `https://api.stripe.com/v1/...`.

Relative imports that land in another unit's folder count as a dependency on that unit, which catches monorepos that wire packages together with paths instead of package names.

## 3. Match against the catalog

[`src/catalog/data.js`](../src/catalog/data.js) maps names to technologies: npm, PyPI, Go, crates.io, RubyGems, Packagist, Maven, NuGet and Hex package names; Docker images; env var names; API hostnames; Terraform resource types; URL schemes (`postgres://`, `redis://`, `amqp://`). [`scripts/verify-catalog.js`](../scripts/verify-catalog.js) checks every package name against its registry.

Clients and ORMs (Prisma, Drizzle, SQLAlchemy, BullMQ ...) do not become boxes. They label the arrow to the database they use ("web → PostgreSQL via Prisma"). Which database an ORM talks to comes from its config: `schema.prisma` providers, `drizzle.config` dialects, Django `ENGINE`, Rails `database.yml`, Spring JDBC URLs, Laravel `DB_CONNECTION`.

## 4. Read the infrastructure

- **docker-compose**: services built from a unit's folder are that unit. Images of known stores become those stores, and other images become containers. `depends_on` and env values like `redis://redis:6379` become arrows. When two services run the same code with different commands (a Django web process and a Celery worker), both are drawn.
- **`.env.example` files**: `DATABASE_URL=postgres://...` tells Stackmap which database a unit that reads `DATABASE_URL` talks to. Values are never stored.
- **Kubernetes, Terraform, Wrangler, Render, Fly, Vercel, Netlify ...**: workloads, managed resources, bindings and deploy targets.

## 5. Decide how sure it is

Every arrow carries the strongest evidence found for it:

| Confidence | Meaning | Drawn as |
|---|---|---|
| `imported` | the code imports the SDK or calls the API host | solid |
| `configured` | wired in configuration: compose, env vars read by the code, ORM config, IaC | solid |
| `declared` | in a manifest only | solid, or dashed when import scanning found no import (likely unused) |
| `inferred` | from naming, for example `NEXT_PUBLIC_API_URL` read by the web app and a unit called `api` | dotted |

## 6. Fold libraries

Internal libraries that other units import are folded into those units in the default view, so `web → packages/db → PostgreSQL` is drawn as `web → PostgreSQL (through db)`. Rules and PR diffs use this view, so they see through libraries too.

## Limits

- Dynamic configuration Stackmap cannot read statically (a service URL fetched from a secrets manager at runtime) is invisible. Add it in [`.stackmap.json`](config.md).
- Languages without manifest support (Dart, Swift, C/C++) are not mapped yet. Contributions welcome.
- Very large repositories are read with a budget of 6,000 source files per unit and 60,000 in total; Stackmap warns when it hits the budget.
