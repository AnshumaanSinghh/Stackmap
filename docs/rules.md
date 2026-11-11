# Architecture rules

Rules turn the conventions in your team's head into checks that run in CI. Put them in `.stackmap.json`:

```json
{
  "rules": [
    { "deny": "kind:app -> category:database", "message": "Frontends go through the API" },
    { "deny": "* -> category:analytics", "except": "web, marketing" },
    { "deny": "worker -> api", "message": "Workers read from the queue, not the API" },
    { "require": "kind:service -> Sentry", "message": "Every service reports errors" },
    { "require": "kind:service, kind:worker -> category:observability" }
  ]
}
```

Run them:

```bash
npx stackmap-cli check
```

Each violation prints the message and the file and line that caused it. The command exits with code 1 when anything is violated, so it fails CI. In GitHub Actions, violations are also shown as annotations on the pull request.

## Rule types

- **`deny: "A -> B"`**: nothing matching `A` may connect to anything matching `B`.
- **`require: "A -> B"`**: everything matching `A` must connect to something matching `B`.
- **`except`**: selectors exempted from the rule, as a comma-separated string or an array.
- **`message`**: what to print when the rule is broken.
- **`view`**: `services` (default) or `everything`. In the services view, connections made through internal libraries count as direct connections. If `apps/web` imports `packages/db`, and `packages/db` talks to PostgreSQL, then `web -> PostgreSQL` exists for the rules. The violation points at the line in `web` that imports the library, because that is where the fix goes.

## Selectors

| Selector | Matches |
|---|---|
| `*` | everything |
| `web` | a node named `web`, or with that id, package name or path |
| `apps/*` | units whose path matches the glob |
| `kind:app` | by kind: `app`, `service`, `worker`, `cli`, `library`, `container`, `mobile`, `desktop`, `datastore`, `external` |
| `category:payments` | by category: `database`, `cache`, `queue`, `storage`, `search`, `vector`, `auth`, `payments`, `email`, `messaging`, `ai`, `observability`, `analytics`, `cms`, `flags`, `realtime`, `workflow`, `cloud`, `integrations` |
| `tech:stripe` | a technology by catalog id |

Separate several selectors with commas: `"kind:service, kind:worker"`.

## Ideas

- Keep personal data inside one service: `{ "deny": "* -> category:analytics", "except": "web" }`.
- Only one place may spend money on AI: `{ "deny": "* -> category:ai", "except": "ai-gateway" }`.
- No service talks to another service's database: `{ "deny": "billing -> tech:mongodb" }`.
- Every service has monitoring: `{ "require": "kind:service -> category:observability" }`.
