# Configuration

Stackmap needs no configuration. When it gets something wrong, or cannot see something (a legacy system reached over SOAP, a partner's SFTP server), describe the fix in `.stackmap.json` at the project root. The file is optional and every key in it is optional too. You can also put the same object under a `"stackmap"` key in `package.json`.

```json
{
  "name": "Acme",
  "ignore": ["legacy/**", "tools/"],
  "include": ["examples/reference-app/package.json"],
  "hide": ["category:analytics", "Mail catcher (dev)"],
  "labels": { "web": "Customer dashboard", "api": "Public API" },
  "technologies": [
    { "id": "acme-billing-sdk", "name": "Acme Billing", "kind": "external", "category": "payments", "npm": ["@acme/billing-sdk"], "env": ["ACME_BILLING_*"] }
  ],
  "nodes": [
    { "id": "legacy-erp", "name": "Legacy ERP", "kind": "external", "category": "integrations", "description": "SOAP, on-premises" }
  ],
  "edges": [
    { "from": "api", "to": "legacy-erp", "label": "SOAP" }
  ],
  "rules": [
    { "deny": "kind:app -> category:database", "message": "Frontends go through the API" }
  ]
}
```

| Key | What it does |
|---|---|
| `name` | Project name shown on the map. Defaults to the root package name, then the git remote, then the folder name. |
| `ignore` | Globs for paths to skip entirely (`*`, `**`, `?`; a pattern without `/` matches any folder or file with that name). `.gitignore` is always honoured. |
| `include` | Globs for manifests that would otherwise be skipped. By default, manifests in `examples/`, `fixtures/`, `test/`, `templates/`, `playground/` and similar folders are not part of the system. |
| `hide` | [Selectors](rules.md#selectors) for nodes to remove from the map. |
| `labels` | Rename nodes. Keys are selectors or names, values are the new label. |
| `technologies` | Extra catalog entries, usually your company's internal SDKs. Same shape as [`src/catalog/data.js`](../src/catalog/data.js). An entry with an existing `id` overrides it. |
| `nodes` | Things Stackmap cannot detect. `kind` is one of `app`, `service`, `worker`, `datastore`, `external`; give `category` for data stores and external services. |
| `edges` | Connections Stackmap cannot detect. `from` and `to` are node names or ids; `label` is shown on the arrow. |
| `rules` | Architecture rules for `stackmap check`. See [rules.md](rules.md). |

Edges and nodes from the config carry evidence pointing at `.stackmap.json`, so the map still tells the truth about where each fact came from.

## What counts as a unit

A unit is a folder with a package manifest: `package.json`, `pyproject.toml`, `requirements*.txt`, `Pipfile`, `setup.py`, `go.mod`, `Cargo.toml`, `Gemfile`, `composer.json`, `pom.xml`, `build.gradle(.kts)`, `*.csproj`, or `mix.exs`. Manifests in the same folder are one unit. Source files belong to the deepest unit that contains them.

Units are classified as:

- **app**: has a frontend or full-stack framework (Next.js, Nuxt, SvelteKit, Remix, Vite + React ...) and runs on its own;
- **service**: has a backend framework, a Dockerfile, a start script, or is started by docker-compose;
- **worker**: runs background jobs (Celery, Sidekiq, BullMQ workers ...), or compose starts it with a worker command;
- **library**: imported by other units, or a package with no way to run on its own;
- **cli**: has a `bin` entry or is a command-line binary.

In the default view, libraries are folded into the units that use them. Switch to **Everything** in the viewer, or pass `--libraries`, to draw them.

The root folder of a monorepo is not a unit unless it is an app in its own right.

## Formats

| `--format` | Output |
|---|---|
| `html` | Interactive map, one self-contained file. Default. |
| `svg` | Static image with legend; follows light and dark mode. |
| `mermaid` | Mermaid flowchart for Markdown. Third-party services are folded by category when there are more than 14. |
| `md` | `STACK.md`-style inventory: every unit, store and API with links to the code. |
| `json` | The full graph (`schema: "stackmap/1"`), including evidence. |
| `dot` | Graphviz. |
