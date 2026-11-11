# Security

## What Stackmap reads

Stackmap only reads files in the folder you point it at. It never executes code from that folder, never makes network requests, and never reads `.env` or other secret files. It reads `.env.example`-style templates and keeps variable names, URL schemes and host names from them, never values. Evidence snippets from docker-compose `environment:` entries are shown with their values removed.

The HTML map is a single file with no external scripts, styles or fonts.

The GitHub Action uses the workflow's token only to read and write its own pull request comment.

## Reporting a vulnerability

Please report security issues privately through [GitHub security advisories](https://github.com/AnshumaanSinghh/Stackmap/security/advisories/new), not in public issues. You will get a reply within a few days. Once a fix is released, you will be credited in the changelog unless you prefer not to be.
