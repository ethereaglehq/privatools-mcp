# `@privatools/mcp`

A zero-dependency, stateless, dual-era [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for the [PrivaTools](https://privatools.me) `/api/v1` file-processing API — giving AI assistants access to 140+ privacy-first PDF, document, image, audio, video, OCR, archive, and accessibility tools through 6 progressive-discovery tools.

Built on pure Node.js (`>= 20`) ESM built-ins (`fs`, `path`, `fetch`, `FormData`, `Blob`, `crypto`) with **zero external runtime dependencies**, keeping the npm, OCI, and `.mcpb` supply-chain footprint minimal.

- **Docs & setup guide:** [privatools.me/mcp](https://privatools.me/mcp)
- **Local stdio package (npm):** `@privatools/mcp`
- **Remote Streamable HTTP endpoint:** `https://api.privatools.me/mcp`
- **Official MCP Registry:** `io.github.ethereaglehq/privatools`
- **Container image (OCI):** `ghcr.io/ethereaglehq/privatools-mcp`
- **Source & issues:** [github.com/ethereaglehq/privatools-mcp](https://github.com/ethereaglehq/privatools-mcp)
- **Privacy Policy & Security:** [privatools.me/privacy](https://privatools.me/privacy) · [privatools.me/security](https://privatools.me/security)

[![Install in VS Code (Local)](https://img.shields.io/badge/VS_Code-Install_PrivaTools_MCP-0098FF?style=flat-square&logo=visualstudiocode)](https://vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522privatools%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540privatools%252Fmcp%2522%255D%257D)
[![Install in VS Code (Remote)](https://img.shields.io/badge/VS_Code-Install_PrivaTools_Remote-0098FF?style=flat-square&logo=visualstudiocode)](https://vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522privatools%2522%252C%2522type%2522%253A%2522http%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fapi.privatools.me%252Fmcp%2522%257D)
[![@privatools/mcp MCP server – quality and maintenance score on Glama](https://glama.ai/mcp/servers/ethereaglehq/privatools-mcp/badges/score.svg)](https://glama.ai/mcp/servers/ethereaglehq/privatools-mcp)

## Directory & Marketplace Listings

- **Glama:** [glama.ai/mcp/servers/ethereaglehq/privatools-mcp](https://glama.ai/mcp/servers/ethereaglehq/privatools-mcp) *(claimed, `0.1.0` build/release passing)*
- **LobeHub:** `ethereaglehq-privatools-mcp`
- **Cursor Directory:** submitted *(scanning)*
- **Cline MCP Marketplace:** [`cline/mcp-marketplace#4106`](https://github.com/cline/mcp-marketplace/issues/4106)
- **mcp.so:** [`chatmcp/mcpso#8044`](https://github.com/chatmcp/mcpso/issues/8044)
- **awesome-mcp-servers:** [`punkpeye/awesome-mcp-servers#20670`](https://github.com/punkpeye/awesome-mcp-servers/pull/20670)
- **awesome-remote-mcp-servers:** [`punkpeye/awesome-remote-mcp-servers#5880`](https://github.com/punkpeye/awesome-remote-mcp-servers/pull/5880)
- **Docker MCP Catalog:** [`docker/mcp-registry#7686`](https://github.com/docker/mcp-registry/pull/7686)

## Protocol Support (Dual-Era MCP `2026-07-28` + Legacy `<= 2025-11-25`)

`@privatools/mcp` implements both modern and legacy MCP protocol eras concurrently over stdio:

- **Modern stateless core (`2026-07-28`):**
  - `server/discover` advertising supported protocol versions, capabilities, server metadata (`name`, `version`, `title`, `description`, `websiteUrl`, `icons`), and cache hints (`ttlMs`, `cacheScope`).
  - Per-request `_meta["io.modelcontextprotocol/protocolVersion"]` validation, returning `-32022` (`UnsupportedProtocolVersionError`) with `data: { supported, requested }` on version mismatch.
  - `resultType: "complete"` and `_meta["io.modelcontextprotocol/serverInfo"]` on modern results.
  - `tools/list` cache directives (`ttlMs`, `cacheScope: "public"`).
- **Legacy handshake compatibility (`2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`):**
  - Full `initialize`, `notifications/initialized`, `notifications/cancelled`, and `ping` support with version negotiation down to `2024-11-05`.
  - JSON-RPC batching is cleanly rejected for protocol versions `>= 2025-06-18` (and stateless `2026-07-28`), while remaining supported for negotiated `2025-03-26` / `2024-11-05` sessions.
- **Structured tool metadata & SEP-1303 error semantics:**
  - Every tool defines `title`, `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), `inputSchema`, and `outputSchema`.
  - Successful `tools/call` responses return both `structuredContent` (conforming to `outputSchema`) and serialized JSON in `TextContent` for backwards compatibility.
  - Tool input validation failures and API/file errors return Tool Execution Errors (`isError: true`) rather than raw JSON-RPC protocol exceptions so models can self-correct.

## Why 6 tools instead of 200+ schemas?

Dumping every PrivaTools endpoint into `tools/list` would consume tens of thousands of tokens in every agent session. Instead, `@privatools/mcp` exposes **6 progressive-discovery tools** with strict read/write separation (no single tool mixes safe reads and destructive deletes):

| Tool | Title | Annotations | Purpose |
| --- | --- | --- | --- |
| `privatools_list_tools` | Search PrivaTools Operations | `readOnlyHint: true`, `idempotentHint: true` | Search and filter `/api/v1` operations by `query`, `category`, or `mode` (`sync` / `async`), backed by live `/api/v1/operations` (or `/api/v1/openapi.json`) with a bundled offline fallback covering 145 HTTP operations (192 aliases + 37 browser-only = 229 catalog tools). |
| `privatools_describe_tool` | Inspect PrivaTools Operation Schema | `readOnlyHint: true`, `idempotentHint: true` | Inspect exact endpoint path, HTTP method, upload field names (`file` vs `files` vs named fields), form/query parameters, constraints, cost, async availability, and response media types. |
| `privatools_run_tool` | Run PrivaTools File Operation | `readOnlyHint: false`, `destructiveHint: false`, `openWorldHint: true` | Run any synchronous `/api/v1/<operation>` endpoint against local file(s) and parameters. Binary outputs are written directly to disk (never clobbering existing files unless `overwrite: true`) and concise metadata + `X-*` headers are returned; JSON tools (e.g. `accessibility-check`, `view-exif`, `remove-watermark/detect`) return JSON inline. See [OpenAPI spec](https://api.privatools.me/api/v1/openapi.json) and [PrivaTools MCP docs](https://privatools.me/mcp). |
| `privatools_submit_job` | Submit Async PrivaTools Job | `readOnlyHint: false`, `destructiveHint: false`, `openWorldHint: true` | Submit an asynchronous background job (`POST /api/v1/jobs`) for heavy/large PDF operations (`merge`, `compress`, `grayscale`, `pdf-to-text`) with automatic `Idempotency-Key` support. On `https://api.privatools.me/mcp`, anonymous async jobs work without an API key starting with PrivaTools `v2.7.39` using 192-bit capability `job_id`s (same per-format limits as sync, `<= 1 h` retention; optional `X-API-Key` raises quotas). |
| `privatools_job_status` | Check or Download PrivaTools Job | `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: true` | Read-only on the server: poll job status (`action: "status"`) or download a completed artifact (`action: "download"`). |
| `privatools_delete_job` | Delete PrivaTools Async Job | `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: true`, `openWorldHint: true` | Dedicated destructive tool to immediately delete a completed server-side job artifact or cancel a running job (`DELETE /api/v1/jobs/{job_id}`). |

## Requirements

- **Node.js 20+** (for local stdio execution via `npx -y @privatools/mcp` or from source)
- **No API key required** on the hosted remote endpoint (`https://api.privatools.me/mcp`) — both synchronous tools and (starting with PrivaTools `v2.7.39`) anonymous async jobs work out of the box (192-bit capability `job_id`s, same per-format limits as sync, `<= 1 h` retention); an optional PrivaTools API key (`X-API-Key` / `PRIVATOOLS_API_KEY`) from [privatools.me](https://privatools.me) unlocks higher keyed quotas

## Setup

You can run the server via `npx -y @privatools/mcp`, directly from this repository (`node /path/to/privatools-mcp/bin/privatools-mcp.mjs`), via Docker (`ghcr.io/ethereaglehq/privatools-mcp`), or connect directly to the hosted Streamable HTTP endpoint (`https://api.privatools.me/mcp`).

> **Official MCP Registry:** `package.json` declares `"mcpName": "io.github.ethereaglehq/privatools"`, matching [`server.json`](./server.json) (published via GitHub Actions OIDC in [`.github/workflows/publish.yml`](./.github/workflows/publish.yml)).

### Claude Desktop / Claude Code

**Claude Code CLI:**

```bash
# Local stdio (reads/writes local files directly)
claude mcp add privatools \
  -e PRIVATOOLS_API_KEY="YOUR_API_KEY" \
  -e PRIVATOOLS_MCP_ALLOWED_DIRS="$HOME/Documents:$HOME/Downloads" \
  -- npx -y @privatools/mcp

# Remote Streamable HTTP (no local runtime)
claude mcp add --transport http privatools https://api.privatools.me/mcp
```

**Claude Desktop** (`claude_desktop_config.json`):

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "privatools": {
      "command": "npx",
      "args": ["-y", "@privatools/mcp"],
      "env": {
        "PRIVATOOLS_API_KEY": "YOUR_API_KEY",
        "PRIVATOOLS_MCP_ALLOWED_DIRS": "/Users/you/Documents:/Users/you/Downloads"
      }
    }
  }
}
```

Or in a project `.mcp.json` when running directly from a local checkout:

```json
{
  "mcpServers": {
    "privatools": {
      "command": "node",
      "args": ["./bin/privatools-mcp.mjs"],
      "env": {
        "PRIVATOOLS_API_KEY": "${PRIVATOOLS_API_KEY}",
        "PRIVATOOLS_MCP_ALLOWED_DIRS": "${PWD}"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "privatools": {
      "command": "npx",
      "args": ["-y", "@privatools/mcp"],
      "env": {
        "PRIVATOOLS_API_KEY": "YOUR_API_KEY",
        "PRIVATOOLS_MCP_ALLOWED_DIRS": "/path/to/workspace"
      }
    }
  }
}
```

For remote Streamable HTTP in Cursor, use `{ "mcpServers": { "privatools": { "url": "https://api.privatools.me/mcp" } } }`. See [`docs/listings/install-links.md`](./docs/listings/install-links.md) for verified one-click deeplinks.

### VS Code

Use the one-click badges at the top of this README or add `.vscode/mcp.json`:

```json
{
  "servers": {
    "privatools": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@privatools/mcp"],
      "env": {
        "PRIVATOOLS_API_KEY": "${input:privatools_api_key}"
      }
    }
  },
  "inputs": [
    {
      "id": "privatools_api_key",
      "type": "promptString",
      "description": "Optional PrivaTools API key from privatools.me",
      "password": true
    }
  ]
}
```

For remote Streamable HTTP in VS Code, set `"type": "http"` and `"url": "https://api.privatools.me/mcp"`.

### Gemini CLI

Install as a Gemini CLI extension directly from this repository:

```bash
gemini extensions install https://github.com/ethereaglehq/privatools-mcp
```

Or add directly to `~/.gemini/settings.json` (or `.gemini/settings.json`):

```json
{
  "mcpServers": {
    "privatools": {
      "command": "npx",
      "args": ["-y", "@privatools/mcp"],
      "env": {
        "PRIVATOOLS_API_KEY": "$PRIVATOOLS_API_KEY",
        "PRIVATOOLS_MCP_ALLOWED_DIRS": "$PWD"
      }
    }
  }
}
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.privatools]
command = "npx"
args = ["-y", "@privatools/mcp"]

[mcp_servers.privatools.env]
PRIVATOOLS_API_KEY = "YOUR_API_KEY"
PRIVATOOLS_MCP_ALLOWED_DIRS = "/path/to/workspace"
```

### Custom PrivaTools-Compatible Endpoint

Point `PRIVATOOLS_API_URL` at another PrivaTools-compatible `/api/v1` endpoint if you want the client to target a non-default base URL (defaults to `https://api.privatools.me/api/v1`):

```json
{
  "mcpServers": {
    "privatools-custom": {
      "command": "npx",
      "args": ["-y", "@privatools/mcp"],
      "env": {
        "PRIVATOOLS_API_URL": "https://your-privatools-compatible-endpoint.example/api/v1",
        "PRIVATOOLS_API_KEY": "YOUR_API_KEY_IF_REQUIRED",
        "PRIVATOOLS_MCP_ALLOWED_DIRS": "/path/to/working-dir"
      }
    }
  }
}
```

`PRIVATOOLS_API_KEY` is omitted from requests when unset.

## Privacy & Stateless Design

- **Zero local state:** `@privatools/mcp` creates no databases, caches no files on disk, and writes nothing except the output files you explicitly request (or auto-named outputs next to inputs).
- **Minimal context footprint:** Binary files are streamed to/from local disk rather than base64-encoded into LLM messages; only concise metadata (`output_path`, `bytes`, `media_type`, relevant `X-*` headers) is returned to the model.
- **Short-lived async artifacts:** On `https://api.privatools.me/mcp`, anonymous async jobs work without an API key (scoped by unguessable capability `job_id`s with the same per-format limits as sync; optional `X-API-Key` raises quotas). Background job results expire within one hour on PrivaTools servers and can be deleted immediately via `privatools_delete_job`.
- **Stdout isolation:** All protocol traffic uses newline-delimited JSON-RPC 2.0 on `stdout`. Diagnostics (when `PRIVATOOLS_MCP_DEBUG=1`) go exclusively to `stderr`, and `PRIVATOOLS_API_KEY` is never logged or echoed in error payloads.
- **Full privacy policy:** [https://privatools.me/privacy](https://privatools.me/privacy)

## Filesystem Sandboxing (`PRIVATOOLS_MCP_ALLOWED_DIRS`)

By default, the server can read and write paths accessible to the OS user running it. To restrict all file reads and writes to specific folders, set `PRIVATOOLS_MCP_ALLOWED_DIRS` using your OS path delimiter (`:` on Linux/macOS, `;` on Windows):

```bash
export PRIVATOOLS_MCP_ALLOWED_DIRS="$HOME/Documents:$HOME/Downloads"
```

When set:

- Every input file and output path is resolved through `fs.realpath` (catching `..` traversal and symlinks pointing outside the allowlist).
- Paths containing null bytes or pointing outside the allowlist are rejected before any network request is made.
- Existing output files are never overwritten unless `overwrite: true` is explicitly passed.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PRIVATOOLS_API_URL` | `https://api.privatools.me/api/v1` | Base URL for the PrivaTools v1 API. |
| `PRIVATOOLS_API_KEY` | *(unset)* | Sent in the `X-API-Key` header when set. |
| `PRIVATOOLS_MCP_ALLOWED_DIRS` | *(unset)* | Optional path-delimiter-separated directory allowlist for reads and writes. |
| `PRIVATOOLS_API_TIMEOUT_MS` | `120000` | Per-request HTTP timeout in milliseconds. |
| `PRIVATOOLS_MCP_DEBUG` | *(unset)* | Set to `1` to log diagnostics to `stderr`. |

## Running Tests, MCPB Packaging & Conformance Checks

```bash
# Unit & stdio integration tests
node --test test/*.test.mjs

# Validate .mcpb manifest and bundle inputs
node scripts/build-mcpb.mjs --check

# Verify npm package payload contents
npm pack --dry-run

# MCP Inspector CLI conformance (strict schema portability + tool calls)
npx -y @modelcontextprotocol/inspector --cli node bin/privatools-mcp.mjs \
  --method tools/list --strict --format json
npx -y @modelcontextprotocol/inspector --cli --protocol-era modern \
  node bin/privatools-mcp.mjs --method tools/list --strict --format json
```

## License

The `@privatools/mcp` client in this repository is licensed under the MIT License — see [LICENSE](./LICENSE).
