# Official MCP Registry Manifest (`server.json`)

> **Active canonical namespace:** **`io.github.ethereaglehq/privatools`** (root [`server.json`](../../../server.json)), published from GitHub Actions via **`mcp-publisher login github-oidc`** (no DNS TXT records, no private keys, no PATs).
>
> Both manifests conform to the official `2025-12-11` schema (`https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`). [`server.dns.json`](./server.dns.json) (`me.privatools/privatools`) is retained in the repository as an inactive reference only and is not used by CI or active docs.

## Canonical Namespace & Package Ownership

The Official MCP Registry verifies npm package ownership by requiring root `package.json` to declare `"mcpName"` matching `server.json`'s `"name"`.

- **Active canonical manifest:** [`server.json`](../../../server.json) — `io.github.ethereaglehq/privatools` (matches `"mcpName": "io.github.ethereaglehq/privatools"` in root `package.json` and `LABEL io.modelcontextprotocol.server.name` in root `Dockerfile`).
- **Inactive archived reference:** [`server.dns.json`](./server.dns.json) — `me.privatools/privatools` (kept on disk for historical reference; not published).

Once published to `registry.modelcontextprotocol.io`, the entry automatically propagates downstream to:
- **GitHub MCP Registry** (`https://github.com/mcp`)
- **VS Code / GitHub Copilot** (`@type:mcp` and `vscode:mcp/by-name/io.github.ethereaglehq/privatools`)
- **Glama Connectors** (`https://glama.ai/mcp/connectors`)

---

## Active Path — GitHub Organization Namespace (`io.github.ethereaglehq/privatools`)

### Critical Org Auth Rule (`mcp-publisher` Issue #1468)

Interactive `mcp-publisher login github` (GitHub Device Flow) **does NOT work for GitHub organizations** (`ethereaglehq`). Publishing uses **GitHub Actions OIDC** (`mcp-publisher login github-oidc` with `permissions: { contents: read, id-token: write }`) inside `.github/workflows/publish.yml`.

*(Local fallback for an org Owner, if ever needed outside CI: classic PAT with `read:org` scope or fine-grained PAT with Organization → Members: Read-only via `mcp-publisher login github --token "$GH_ORG_READ_TOKEN"`.)*

### Publishing via `.github/workflows/publish.yml`

1. Confirm root `package.json` declares `"mcpName": "io.github.ethereaglehq/privatools"` and `"repository": { "type": "git", "url": "https://github.com/ethereaglehq/privatools-mcp.git" }` (already set).
2. Ensure `@privatools/mcp@<version>` is published on npm (either in the same workflow run with `publish_npm: true`, or already published from the one-time initial bootstrap publish of `@privatools/mcp@0.1.0`).
3. Dispatch `.github/workflows/publish.yml` manually:
   - **Dry run / validate only:** `dry_run: true`, `publish_registry: true` — runs `mcp-publisher validate server.json` with SHA-256-pinned `mcp-publisher v1.8.16` without publishing.
   - **Live publish:** `dry_run: false`, `publish_registry: true` (and `publish_npm: true` for future releases) and approve the `mcp-publish` deployment environment. The `publish-registry` job verifies `@privatools/mcp@<version>` is live on npm with matching `mcpName`, validates `server.json`, authenticates via `mcp-publisher login github-oidc`, and runs `mcp-publisher publish server.json`.

---

## Inactive Alternative (Kept for Reference Only) — Domain DNS / HTTP (`me.privatools/privatools`)

`server.dns.json` is intentionally dropped from the active release path so publishing requires zero DNS TXT edits and zero long-lived private keys. For historical reference if a domain namespace were ever reconsidered:

> **CRITICAL:** Domain verification uses the **apex domain `privatools.me`** (`privatools.me. IN TXT "v=MCPv1; k=ed25519; p=<base64-32-byte-pubkey>"`) — **NEVER** `_mcp-auth.privatools.me` — or serves the same single line at `https://privatools.me/.well-known/mcp-registry-auth`.

---

## Schema Constraints Checked Automatically

`.github/workflows/test.yml` enforces:
- `$schema` equals `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`.
- `description` is `1..100` characters (currently 92 characters).
- `version` and `packages[].version` are exact SemVer strings (never `"latest"` or ranges) matching root `package.json`.
- Root `package.json` `"mcpName"` matches `server.json`'s `"name"` (`io.github.ethereaglehq/privatools`).
- `repository.url` is `https://github.com/ethereaglehq/privatools-mcp` with no `subfolder`.
- `packages[]` declares npm `@privatools/mcp` with `stdio` transport and `remotes[]` declares `streamable-http` at `https://api.privatools.me/mcp`.
- Official CLI schema validation via SHA-256-pinned `mcp-publisher v1.8.16 validate server.json`.
