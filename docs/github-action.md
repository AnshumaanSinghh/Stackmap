# GitHub Action

```yaml
# .github/workflows/stackmap.yml
name: Stackmap
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
  pull-requests: write
jobs:
  map:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: AnshumaanSinghh/Stackmap@v1
```

On pull requests, the action:

1. maps the pull request and its base commit (it fetches the base commit itself, so the default shallow checkout is enough);
2. posts one comment listing new and removed services, data stores, third-party APIs and connections, with a Mermaid diagram of the change, and keeps that comment updated on later pushes;
3. writes the map and the changes to the job summary;
4. checks the `rules` in `.stackmap.json`, if there are any, and annotates violations on the lines that caused them.

Pull requests that do not change the architecture get no comment. If an earlier push had changes and a later push removed them, the existing comment is updated to say so.

## Inputs

| Input | Default | What it does |
|---|---|---|
| `path` | `.` | Project folder, relative to the repository root. |
| `comment` | `true` | Post the pull request comment. Needs `pull-requests: write`. |
| `comment-when` | `changed` | `always` comments on every pull request. |
| `summary` | `true` | Write the map and the changes to the job summary. |
| `check` | `true` | Enforce `rules` from `.stackmap.json`. |
| `readme` | | A Markdown file whose Stackmap diagram must be current, for example `README.md`. |
| `readme-mode` | `check` | `check` fails when the diagram is out of date; `write` updates the file in the workspace. |
| `html` | | Also write the interactive map to this path, to upload as an artifact. |
| `config` | | Config file, relative to `path`. |
| `github-token` | `${{ github.token }}` | Token for the comment. |

## Outputs

`changed` (`true`/`false`), `added`, `removed`, `violations`, and `json` (path to the full graph).

## Recipes

### Keep the README diagram current automatically

```yaml
on:
  push:
    branches: [main]
permissions:
  contents: write
jobs:
  readme:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: AnshumaanSinghh/Stackmap@v1
        with:
          readme: README.md
          readme-mode: write
          comment: false
      - name: Commit the updated diagram
        run: |
          if ! git diff --quiet README.md; then
            git config user.name "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            git commit -am "docs: update architecture diagram"
            git push
          fi
```

### Publish the interactive map with every build

```yaml
      - uses: AnshumaanSinghh/Stackmap@v1
        with:
          html: stackmap.html
      - uses: actions/upload-artifact@v7
        with:
          name: architecture-map
          path: stackmap.html
```

### Fail the build when someone adds a third-party API without review

```yaml
      - uses: AnshumaanSinghh/Stackmap@v1
        id: stackmap
      - if: steps.stackmap.outputs.changed == 'true' && !contains(github.event.pull_request.labels.*.name, 'architecture-reviewed')
        run: |
          echo "This pull request changes the architecture. Add the 'architecture-reviewed' label after review."
          exit 1
```

## Pull requests from forks

GitHub gives pull requests from forks a read-only token, so the comment cannot be posted. The action logs a warning and still writes the job summary and runs the rules.

## Without the action

Any CI can run the CLI:

```bash
npx stackmap-cli diff origin/main -f md > stackmap-diff.md   # Markdown for a comment
npx stackmap-cli check                                       # rules, exit 1 on violations
npx stackmap-cli readme --check                              # README diagram is current
```
