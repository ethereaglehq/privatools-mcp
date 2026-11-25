# Contributing to `@privatools/mcp`

Thanks for your interest in improving `@privatools/mcp` — the MIT-licensed, zero-dependency Model Context Protocol (MCP) client for the PrivaTools API. This guide covers how to get set up, validate your changes, and open a pull request.

## Ground Rules

- **Privacy first.** `@privatools/mcp` keeps zero local databases, zero cache files, and zero telemetry. Never add analytics, third-party trackers, or undisclosed external network calls. `PRIVATOOLS_API_KEY` must never be logged to stdout/stderr or echoed in error messages.
- **Zero runtime dependencies.** The server runs strictly on Node.js (`>= 20`) built-in ESM modules (`node:fs`, `node:path`, `node:crypto`, `node:zlib`, `fetch`, `FormData`, `Blob`). Keep `dependencies` empty so the npm package, container image, and `.mcpb` bundle stay auditable and minimal.
- **Strict read/write tool separation.** Do not combine safe read-only operations with destructive mutations inside the same MCP tool; keep destructive deletion isolated in `privatools_delete_job` (`destructiveHint: true`).
- **MIT licensed.** By contributing you agree your contribution is licensed under the [MIT License](./LICENSE).
- **Be respectful.** Assume good faith; keep discussion technical and kind.

## Getting Started

Requirements: **Node.js 20+** (CI runs on Node 24).

```bash
git clone https://github.com/ethereaglehq/privatools-mcp.git
cd privatools-mcp
```

No `npm install` step is needed because `@privatools/mcp` has zero external runtime or test dependencies.

## Required Checks Before Opening a PR

CI runs all of these checks on every push to `main` and every pull request (`.github/workflows/test.yml`). Run them locally first:

```bash
# 1. Run the unit & stdio integration test suite
node --test test/*.test.mjs

# 2. Validate manifest.json and .mcpb bundle inputs
node scripts/build-mcpb.mjs --check

# 3. Verify npm tarball payload (must ship ONLY bin/, src/, data/, README.md, package.json, LICENSE)
npm pack --dry-run
```

If you change `package.json`, `manifest.json`, `server.json`, or `gemini-extension.json`, make sure versions, `mcpName` (`io.github.ethereaglehq/privatools`), entrypoints, and repository URLs stay in sync. You can also validate `server.json` against the Official MCP Registry schema with `mcp-publisher validate server.json`.

Optional MCP Inspector conformance check:

```bash
npx -y @modelcontextprotocol/inspector --cli node bin/privatools-mcp.mjs \
  --method tools/list --strict --format json
npx -y @modelcontextprotocol/inspector --cli --protocol-era modern \
  node bin/privatools-mcp.mjs --method tools/list --strict --format json
```

## Security

Found a vulnerability? **Do not open a public issue.** Follow [SECURITY.md](./SECURITY.md) — email `hello@privatools.me` with the `[Security]` subject prefix, or use GitHub's private vulnerability reporting. We aim to acknowledge within 72 hours.

For changes touching file I/O or API requests, keep existing defenses intact: `fs.realpath` containment for `PRIVATOOLS_MCP_ALLOWED_DIRS`, null-byte path rejection, `overwrite: false` default, stdout JSON-RPC isolation, and `X-API-Key` redaction.

## Pull Requests

1. Branch off `main`.
2. Keep PRs focused and include tests under `test/` for any bug fix or behavioral change.
3. Verify all checks above pass locally.
4. Open a pull request with a clear explanation of *what* changed and *why*.

## Releases & Publishing

Publishing is strictly manual via `.github/workflows/publish.yml` (`workflow_dispatch`, `dry_run: true` by default) behind the `mcp-publish` GitHub Actions deployment environment with Required Reviewers. Merging to `main` never auto-publishes to npm, GHCR, or the Official MCP Registry.
