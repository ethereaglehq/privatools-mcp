# Smithery Legacy Note (`smithery.yaml` Intentionally Omitted)

**Primary Source:** [`https://smithery.ai/future`](https://smithery.ai/future) (verified `2026-11-24`).

## Why There Is No `smithery.yaml` in This Repository

On **2026-10-31**, Smithery (now part of Arcade) shut down its hosted MCP proxy (`server.smithery.ai`), user accounts, hosted container deployments, public submission API, `@smithery/cli`, and `run.tools`.

Specifically, live verification confirmed:
- `https://smithery.ai/new` and `https://smithery.ai/submit` both return **HTTP 404**.
- `smithery.yaml` (`startCommand: { type: stdio, configSchema, commandFunction }`) is **legacy / deprecated** and no longer drives an active self-serve build or registry pipeline.
- Smithery now operates as a **curated, non-proxied directory** backed by Arcade.dev that points directly to vendor-hosted remote MCP URLs.

Adding a dead `smithery.yaml` would mislead contributors and drift without validation, so it is intentionally omitted from `ethereaglehq/privatools-mcp`.

## Optional Direct Vendor Outreach

If PrivaTools wants to appear in Smithery's curated directory once `https://api.privatools.me/mcp` is live in production, contact the Smithery / Arcade team directly (`ani@smithery.ai` or via Arcade.dev) with:
- **Server Name:** `PrivaTools`
- **Direct Remote Streamable HTTP URL:** `https://api.privatools.me/mcp`
- **Docs URL:** `https://privatools.me/mcp`
- **Source Repository:** `https://github.com/ethereaglehq/privatools-mcp`
- **Canonical Listing Copy & Icon:** [`COPY.md`](./COPY.md) and [`assets/icon-512.png`](./assets/icon-512.png)
