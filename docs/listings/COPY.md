# PrivaTools MCP — Canonical Store Listing Copy

> **Prepare-only listing kit.** Use these canonical strings across every MCP registry, directory, and marketplace so descriptions, URLs, privacy disclosures, and character limits stay consistent.

---

## Core Identity

| Field | Value |
| :--- | :--- |
| **Name** | `PrivaTools` |
| **npm Package** | `@privatools/mcp` |
| **OCI Image** | `ghcr.io/ethereaglehq/privatools-mcp` |
| **Remote Streamable HTTP URL** | `https://api.privatools.me/mcp` |
| **Official Registry Namespace** | `io.github.ethereaglehq/privatools` |
| **MCP Client License** | `MIT` *(MCP client only)* |
| **Homepage** | `https://privatools.me` |
| **Docs URL** | `https://privatools.me/mcp` |
| **Privacy Policy URL** | `https://privatools.me/privacy` |
| **Security Policy URL** | `https://privatools.me/security` |
| **Support URL (MCP Issues)** | `https://github.com/ethereaglehq/privatools-mcp/issues` |
| **Source Repository (MCP Client)** | `https://github.com/ethereaglehq/privatools-mcp` |
| **OpenAPI Reference** | `https://api.privatools.me/api/v1/openapi.json` |

---

## 1-Line Description (`<= 100` characters — Official MCP Registry Limit)

> Exact length: **92 characters** (limit: 1–100 characters for `server.json` `description`).

```text
Stateless privacy-first PDF, image, document, and media processing tools via PrivaTools API.
```

---

## Short / Meta Description (`<= 160` characters)

> Exact length: **151 characters** (limit: `<= 160` characters for directory cards & SEO meta tags).

```text
Privacy-first MCP server for 140+ stateless PDF, image, audio, video, OCR, and document tools via the PrivaTools API. No tracking. MIT-licensed client.
```

---

## Full Long Description

**PrivaTools** brings 140+ privacy-first file processing tools—covering PDFs, documents, images, audio, video, OCR, archives, accessibility validation, and QR/barcodes—directly into MCP-compatible AI assistants (Claude Desktop, Claude Code, Cursor, VS Code / GitHub Copilot, Gemini CLI, ChatGPT/Codex, Cline, and LobeHub).

### Progressive Discovery (6 Strictly Separated Tools, Not 200+ Bloated Schemas)

Instead of flooding an agent's context window with tens of thousands of tokens of endpoint schemas, PrivaTools exposes a small progressive-discovery surface with strict read/write separation (compliant with Anthropic Claude Connectors Directory and OpenAI Plugin Directory review standards):

1. **`privatools_list_tools`** *(read-only)* — Search and filter `/api/v1` operations by keyword (`query`), `category`, or execution `mode` (`sync` / `async`), backed by the live `/api/v1/operations` catalog with a bundled offline fallback.
2. **`privatools_describe_tool`** *(read-only)* — Inspect exact endpoint path, HTTP method, multipart upload field names, parameters, constraints, cost units, async support, and response media types before running an operation.
3. **`privatools_run_tool`** *(sync execution)* — Execute any synchronous `/api/v1/<operation>` endpoint against local file(s) and parameters. Binary outputs stream directly to local disk (never clobbering existing files unless `overwrite: true`) and return concise metadata + `X-*` headers instead of base64 blobs; JSON-returning tools (`accessibility-check`, `view-exif`, `remove-watermark/detect`, etc.) return JSON inline.
4. **`privatools_submit_job`** *(async submit)* — Submit asynchronous background jobs (`POST /api/v1/jobs`) for heavy PDF workloads (`merge`, `compress`, `grayscale`, `pdf-to-text`) with automatic `Idempotency-Key` support. On the hosted remote endpoint (`https://api.privatools.me/mcp`), anonymous async jobs work without an API key starting with PrivaTools `v2.7.39` using 192-bit capability `job_id`s, the same per-format limits as sync, and `<= 1 hour` automatic retention (optional `X-API-Key` unlocks higher keyed quotas).
5. **`privatools_job_status`** *(strictly read-only)* — Poll job progress (`action: "status"`) or download completed artifacts (`action: "download"`). Never mutates or deletes server-side state.
6. **`privatools_delete_job`** *(destructive)* — Immediately delete a completed server-side job artifact or cancel a running asynchronous job (`destructiveHint: true`).

### Covered Operation Families (143 Bundled API Operations)

- **PDF Processing & Security:** Merge, split, compress, batch compress, flatten, grayscale, deskew, repair, crop, resize, rotate, watermark, remove watermark, Bates numbering, protect, unlock, redact, sanitize, strip metadata, PDF/A validation, signature verification.
- **Document & PDF Conversion:** Office (Word, Excel, PowerPoint) to PDF, Markdown/HTML to PDF, PDF to Word/text/images, OCR across 18 Tesseract languages.
- **Accessibility:** PDF accessibility checker (`accessibility-check`), structural validation, and compliance reports.
- **Image Processing:** Compress, resize, crop, convert formats, EXIF inspection/stripping (`view-exif`), background removal.
- **Audio & Video:** Transcode, compress video, trim/merge audio, burn subtitles, extract audio.
- **Archives, QR/Barcodes & Developer Utilities:** Archive extraction/packing, QR/barcode generation & decoding, transparency inspection, and API metadata endpoints.

### Deployment Options & Architecture

- **Zero-dependency Local Stdio (`@privatools/mcp`):** Pure Node.js (`>= 20`) ESM with zero external runtime packages, optional filesystem sandboxing (`PRIVATOOLS_MCP_ALLOWED_DIRS` enforced via `fs.realpath`), and support for pointing `PRIVATOOLS_API_URL` at another PrivaTools-compatible endpoint.
- **Hosted Remote Streamable HTTP (`https://api.privatools.me/mcp`):** Stateless HTTPS MCP endpoint with no local runtime, account, or API key required—both synchronous tools and anonymous async jobs work out of the box (optional `X-API-Key` raises quotas).
- **MIT-Licensed MCP Client & Container:** The `@privatools/mcp` client (`ethereaglehq/privatools-mcp`) and standalone MCP container image (`ghcr.io/ethereaglehq/privatools-mcp`) are published under the MIT License.

---

## Categories & Tags

| Store System | Recommended Categories | Tags / Keywords |
| :--- | :--- | :--- |
| **General / Official Registry / Glama / mcp.so** | `Productivity`, `Developer Tools`, `File Processing` | `pdf`, `image`, `document`, `media`, `ocr`, `privacy`, `file-processing`, `stateless`, `mit`, `mcp` |
| **Docker MCP Catalog** | `productivity` | `pdf`, `image`, `media`, `document`, `privacy`, `ocr`, `mcp` |
| **Claude / OpenAI / Cursor / Cline** | `Productivity`, `Utilities`, `Document & File Tools` | `pdf-tools`, `image-compression`, `ocr`, `accessibility`, `exif`, `privacy-first`, `mit` |

---

## Honest Privacy & Data Handling Statement

Use this verbatim (or lightly condensed for field length limits) on every marketplace privacy disclosure:

### 1. Exact Data Sent — Local Stdio (`@privatools/mcp`) vs. Remote (`https://api.privatools.me/mcp`)

- **Local stdio client (`@privatools/mcp`):**
  - Runs locally on your machine with **zero local databases, zero cache files, and zero telemetry**.
  - `privatools_list_tools` and `privatools_describe_tool` read `/api/v1/operations` (or `/api/v1/openapi.json`) from `PRIVATOOLS_API_URL` (falling back to a bundled offline manifest) and transmit **no user files**.
  - When you invoke `privatools_run_tool` or `privatools_submit_job`, the specific local input file(s) and tool parameters you pass are uploaded over HTTPS (`multipart/form-data` or JSON) to `PRIVATOOLS_API_URL` (default `https://api.privatools.me/api/v1`).
  - You can point `PRIVATOOLS_API_URL` at another PrivaTools-compatible endpoint if desired.
  - Binary outputs are streamed straight to disk—never base64-encoded into LLM chat context.
  - Optional `PRIVATOOLS_MCP_ALLOWED_DIRS` restricts every file read and write via `fs.realpath` containment before any network call is made.
  - `PRIVATOOLS_API_KEY` is sent only in the `X-API-Key` request header to `PRIVATOOLS_API_URL` and is never logged or echoed in error payloads.
- **Remote Streamable HTTP server (`https://api.privatools.me/mcp`):**
  - MCP JSON-RPC requests, tool parameters, and any file inputs submitted to remote tools are transmitted over HTTPS directly to `api.privatools.me` (fronted by Cloudflare edge).
  - The remote server never has access to your local filesystem.

### 2. Retention & Auto-Deletion

- **Synchronous operations (`/api/v1/*` via `privatools_run_tool`):** Uploaded inputs and generated outputs exist only in isolated server temporary storage for the duration of the HTTP request and are **deleted immediately after the response is sent**. A background cleanup janitor sweeps any orphaned temporary files from interrupted/timed-out requests.
- **Asynchronous jobs (`/api/v1/jobs` via `privatools_submit_job`):** Work anonymously on `https://api.privatools.me/mcp` without an API key (scoped by unguessable capability `job_id`s with the same per-format limits as sync) as well as with an optional `X-API-Key` for higher keyed quotas. Completed job artifacts are retained for **at most 1 hour after completion** to support polling and repeat downloads, then automatically purged. Callers may delete artifacts immediately via `privatools_delete_job`.
- **Logging & Third Parties:** PrivaTools never passes uploaded files to third parties and never uses user files for AI model training. Server access logs record only HTTP method, path template, status code, and duration—never file contents, filenames, or query strings.

### 3. Accounts, API Keys & License

- **No account required** for synchronous processing or anonymous async jobs on the hosted remote MCP endpoint (`https://api.privatools.me/mcp`).
- **Optional API key** (`PRIVATOOLS_API_KEY` / `X-API-Key`) unlocks higher keyed quotas on `privatools.me`.
- **MCP Client License:** The `@privatools/mcp` client is released under the [MIT License](https://github.com/ethereaglehq/privatools-mcp/blob/main/LICENSE).
- **Full Privacy Policy:** [https://privatools.me/privacy](https://privatools.me/privacy)
- **Security Policy:** [https://privatools.me/security](https://privatools.me/security)
