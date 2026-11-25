# Anthropic Claude Plugin & Connectors Directory Notes (Skeleton)

> **Prepare-only skeleton.** Documents Anthropic's current (`2026-11-24`) policy split between local `.mcpb` bundles, **Claude Plugins**, and the **Claude Connectors Directory** (`https://claude.ai/directory/manage`).

---

## Current Anthropic Directory Policy

1. **Standalone `.mcpb` Directory Submissions Are Deprecated:**
   - Anthropic's Claude Directory no longer accepts standalone `.mcpb` uploads for listing.
   - Local `.mcpb` bundles (built from [`manifest.json`](../../../manifest.json) via [`scripts/build-mcpb.mjs`](../../../scripts/build-mcpb.mjs)) remain **fully supported** for:
     - Direct local one-click installation in Claude Desktop (subject to Enterprise allowlists),
     - GitHub Release binary attachments (with SHA-256 checksums), and
     - Official MCP Registry distribution (`registryType: "mcpb"` + `fileSha256`).
   - To list a local MCP integration in Anthropic's public Claude Directory, wrap the MCP server inside a **Claude Plugin** (public GitHub repository) and submit through `https://claude.ai/directory/manage` using a **paid Anthropic account** (Pro, Max, Ultra, Team Owner, or Enterprise Owner/Directory role).

2. **Remote Connectors Directory (`https://api.privatools.me/mcp`):**
   - Submit via **Submit new → MCP connector** on `https://claude.ai/directory/manage`.
   - **Mandatory Pre-Submission Gate Checklist:**
     - [ ] Public HTTPS Streamable HTTP endpoint (`https://api.privatools.me/mcp`) pre-tested as a Custom Connector in Claude.ai.
     - [ ] Auth configured as public no-auth (anonymous sync + anonymous async jobs work out of the box on `https://api.privatools.me/mcp` via unguessable capability `job_id`s with the same per-format limits as sync and `<= 1 h` automatic retention; optional `X-API-Key` unlocks higher keyed quotas).
     - [ ] Every tool defines `title`, `readOnlyHint`, and `destructiveHint`, with programmatic tool names `<= 64` characters.
     - [ ] **Strict read/write tool separation (6 tools):** Anthropic rejects any single tool that combines safe read actions with destructive write actions. Confirm live `/mcp` exposes strictly read-only `privatools_job_status` (`readOnlyHint: true`, `destructiveHint: false`) separately from dedicated destructive `privatools_delete_job` (`readOnlyHint: false`, `destructiveHint: true`).
     - [ ] Tool descriptions and server instructions are purely descriptive with no imperative cross-tool instructions or embedded OpenAPI doc URLs (docs live on `https://privatools.me/mcp`).
     - [ ] Listing metadata ready from [`../COPY.md`](../COPY.md) and [`../SUBMIT.md`](../SUBMIT.md) (§10): Docs URL (`https://privatools.me/mcp`), Privacy Policy (`https://privatools.me/privacy`), Support (`hello@privatools.me` / `https://privatools.me/support` / `https://github.com/ethereaglehq/privatools-mcp/issues`), Icon (`../assets/icon-512.png`).

---

## Skeleton Files in This Folder

These example manifests show how to wrap PrivaTools' local or remote MCP server when preparing a dedicated Claude Plugin directory repository or `.claude-plugin/` layout:

- [`plugin.example.json`](./plugin.example.json) — Plugin metadata skeleton referencing PrivaTools' docs, support, privacy policy, and MCP config.
- [`mcp.example.json`](./mcp.example.json) — Dual-mode MCP configuration template (local stdio via `npx -y @privatools/mcp` and remote Streamable HTTP via `https://api.privatools.me/mcp`).
