# PrivaTools MCP Extension Guide for Gemini CLI

PrivaTools provides 140+ stateless, privacy-first PDF, document, image, audio, video, OCR, archive, and accessibility tools through a compact 6-tool progressive-discovery MCP server (`@privatools/mcp`) with strict read/write separation.

## Recommended Workflow

1. **Discover operations first (`privatools_list_tools`):**
   - Search by keyword (`query`), `category`, or `mode` (`sync` / `async`) instead of guessing endpoint slugs.
   - Example: `privatools_list_tools({ query: "compress", limit: 10 })`.
2. **Inspect exact schema before running (`privatools_describe_tool`):**
   - Always call `privatools_describe_tool({ operation: "<slug>" })` before executing an unfamiliar operation so you pass exact upload field names (`file`, `files`, or named `file_fields`), valid `params`, and know whether the output is binary or inline JSON.
3. **Run synchronous operations safely (`privatools_run_tool`):**
   - Pass local input paths via `file_path`, `file_paths`, or `file_fields`.
   - Binary outputs are written straight to disk (never base64-encoded into chat context) and never overwrite existing files unless the user explicitly asks to set `overwrite: true`.
   - JSON tools (such as `accessibility-check` and `view-exif`) return structured JSON directly.
4. **Use async jobs for large/heavy PDF workloads (`privatools_submit_job` + `privatools_job_status` + `privatools_delete_job`):**
   - Supported async operations include `merge`, `compress`, `grayscale`, and `pdf-to-text`.
   - Poll with `privatools_job_status({ job_id, action: "status" })` and download completed artifacts with `action: "download"` (`privatools_job_status` is strictly read-only).
   - Call `privatools_delete_job({ job_id })` after downloading to remove server-side artifacts immediately rather than waiting for the 1-hour automatic expiry.

## Privacy & Sandboxing Rules

- Never print, log, or echo `PRIVATOOLS_API_KEY`.
- Respect `PRIVATOOLS_MCP_ALLOWED_DIRS` if configured; do not attempt to read or write files outside user-approved directories.
- Remind the user when targeting the hosted API (`https://api.privatools.me/api/v1`) vs. a custom PrivaTools-compatible endpoint configured via `PRIVATOOLS_API_URL`.
- Docs & privacy policy: `https://privatools.me/mcp` · `https://privatools.me/privacy`
