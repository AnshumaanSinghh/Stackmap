# Contributing to Stackmap

Thanks for helping. Stackmap is plain JavaScript (ES modules, Node 20+) with zero runtime dependencies, so there is nothing to install:

```bash
git clone https://github.com/AnshumaanSinghh/Stackmap.git
cd Stackmap
npm test                      # node --test, about two seconds
node bin/stackmap.js .        # map any folder
```

## Add a technology (the most useful contribution)

If Stackmap missed a database, queue, SaaS API or framework your project uses, add it to [`src/catalog/data.js`](src/catalog/data.js):

```js
{
  id: 'acme-mail',                 // unique, kebab-case
  name: 'Acme Mail',               // as the vendor writes it
  kind: 'external',                // datastore | external | framework | client | platform
  category: 'email',               // see src/catalog/categories.js
  url: 'https://acmemail.example',
  npm: ['@acme-mail/node'],        // package names, per ecosystem: npm, pypi, go, cargo, gem, composer, maven, nuget, hex
  pypi: ['acme-mail'],
  env: ['ACME_MAIL_API_KEY'],      // only names that clearly identify the vendor
  hosts: ['api.acmemail.example'], // API hosts, never marketing domains
},
```

Then run:

```bash
npm test                                   # schema checks
node scripts/verify-catalog.js --id acme-mail   # checks the names exist in their registries
```

Rules of thumb:

- One package name maps to one technology. Database drivers go on the database entry; ORMs and queue libraries are `client` entries with `backs`.
- Only list env var names that unambiguously identify the vendor. `DATABASE_URL` and `API_KEY` are not.
- Only list API hostnames that code calls, not websites that docs link to.

## Fix a detection bug

1. Reproduce it with the smallest folder you can: a manifest and a file or two.
2. Add it under `test/fixtures/` (or extend an existing fixture) and write a failing test in `test/scan.test.js`.
3. Fix it. Detection lives in `src/graph/build.js` (units, edges, compose), `src/scan/` (reading files) and `src/catalog/` (matching).
4. If you can, run Stackmap on a couple of real repositories before and after, to make sure nothing else moved.

## Style

- No runtime dependencies. If you need a parser, write the small part you need (see `src/parse/`).
- Every node and edge must carry evidence (file, line, code). If Stackmap cannot point at a line, it should not draw the box.
- Never read secret files (`.env`, credentials) and never store env values.
- `src/graph/view.js`, `src/render/layout.js`, `src/render/theme.js`, `src/render/icons.js` and `src/render/draw.js` also run in the browser: no Node APIs there, and imports only from each other.

## Pull requests

Keep them focused, describe what changed and why, and include a test. CI runs on Linux, macOS and Windows with Node 20, 22, 24 and 26.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
