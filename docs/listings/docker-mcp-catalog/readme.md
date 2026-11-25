# PrivaTools MCP Server — Docker MCP Catalog Submission

> Ready for submission to [`docker/mcp-registry`](https://github.com/docker/mcp-registry) under `servers/privatools/`.

## Overview

**PrivaTools** provides 140+ stateless, privacy-first PDF, document, image, audio, video, OCR, archive, and accessibility tools through 6 strictly separated progressive-discovery MCP tools (`privatools_list_tools`, `privatools_describe_tool`, `privatools_run_tool`, `privatools_submit_job`, `privatools_job_status`, `privatools_delete_job`).

- **MCP Client Source & License:** [`ethereaglehq/privatools-mcp`](https://github.com/ethereaglehq/privatools-mcp) (`MIT` — MCP client only)
- **Documentation:** [`https://privatools.me/mcp`](https://privatools.me/mcp)
- **Privacy Policy:** [`https://privatools.me/privacy`](https://privatools.me/privacy)
- **Security Policy:** [`https://privatools.me/security`](https://privatools.me/security)
- **Support:** [`https://github.com/ethereaglehq/privatools-mcp/issues`](https://github.com/ethereaglehq/privatools-mcp/issues)
- **Container Image:** Built from [`Dockerfile`](../../../Dockerfile) (non-root `USER node`, `node:24-alpine`, zero runtime dependencies).

## Configuration

| Variable / Secret | Required | Default | Purpose |
| :--- | :--- | :--- | :--- |
| `PRIVATOOLS_API_KEY` *(secret)* | No | *(unset)* | Optional account API key from `privatools.me` sent via `X-API-Key` for authenticated higher-quota access. |
| `PRIVATOOLS_API_URL` | No | `https://api.privatools.me/api/v1` | Optional PrivaTools-compatible `/api/v1` endpoint URL. |
| `PRIVATOOLS_MCP_ALLOWED_DIRS` | No | *(unset)* | Optional path allowlist for mounted container volumes (enforced via `fs.realpath`). |

## Privacy & Retention

- Synchronous operations delete temporary server files immediately after the HTTP response is returned.
- Asynchronous job artifacts expire automatically after 1 hour and can be deleted immediately via `privatools_delete_job`.
- No user files are shared with third parties or retained for training.

## Remote Catalog Entry Alternative (`type: remote`)

If submitting PrivaTools' hosted remote Streamable HTTP endpoint (`https://api.privatools.me/mcp`) instead of (or alongside) the Docker-built stdio image in `docker/mcp-registry`:
- Set `type: remote` with `remote.transport_type: streamable-http` and `remote.url: https://api.privatools.me/mcp`,
- Omit `source.directory` / `Dockerfile`, and
- Set `tools.json` to `[]` (per `docker/mcp-registry` remote server guidelines, where tools are discovered dynamically at runtime).
