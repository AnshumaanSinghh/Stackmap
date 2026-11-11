# Changelog

## 1.0.0 (unreleased)

Stackmap is rebuilt from the ground up as a command-line tool that maps a system's architecture from its code. The earlier canvas prototype (a Next.js, Fastify and Socket.io scaffold) is still in the git history.

- Maps apps, services, workers, libraries, databases, caches, queues, storage, search and third-party APIs from JavaScript and TypeScript, Python, Go, Rust, Ruby, PHP, Java and Kotlin, .NET and Elixir projects.
- Reads docker-compose, Dockerfiles, Kubernetes manifests, Terraform, Wrangler, Render, `.env.example` files and ORM configuration.
- Every node and edge carries file:line evidence and a confidence level; declared-but-unused dependencies are flagged.
- Outputs: interactive self-contained HTML, SVG, Mermaid, Markdown inventory, JSON and Graphviz DOT.
- `stackmap readme` keeps a Mermaid diagram in the README current; `--check` fails CI when it drifts.
- `stackmap diff` and the GitHub Action report architecture changes on pull requests.
- `stackmap check` enforces architecture rules from `.stackmap.json`.
- `stackmap why` explains any node with its evidence and impact.
- `stackmap mcp` serves the map to AI coding agents over the Model Context Protocol.
- Catalog of technologies verified against npm, PyPI, the Go proxy, crates.io, RubyGems, Packagist, Maven Central, NuGet, Hex and Docker Hub.
