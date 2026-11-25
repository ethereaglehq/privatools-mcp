# OpenAI ChatGPT / Codex Plugin Directory — Submission Test Cases

> Ready for submission on [`https://platform.openai.com/plugins`](https://platform.openai.com/plugins).
> Covers **5 positive test cases** (core discovery, schema inspection, read-only analysis, synchronous transformation, and async job lifecycle) and **3 negative test cases** (out-of-scope non-triggering prompt, unknown/browser-only operation error handling, and invalid argument / sandbox boundary enforcement).

**Target Remote MCP Endpoint:** `https://api.privatools.me/mcp`  
**Canonical Docs:** `https://privatools.me/mcp` | **OpenAPI:** `https://api.privatools.me/api/v1/openapi.json` | **Privacy Policy:** `https://privatools.me/privacy`

---

## Positive Test Cases (5)

### P1 — Progressive Tool Discovery (`privatools_list_tools`)

- **Goal:** Verify the model invokes `privatools_list_tools` (read-only) to discover available PDF compression and optimization operations without hallucinating endpoint names.
- **User Prompt:** `"What tools does PrivaTools offer for compressing PDFs or images?"`
- **Expected Tool Call:**
  ```json
  {
    "name": "privatools_list_tools",
    "arguments": {
      "query": "compress",
      "limit": 10
    }
  }
  ```
- **Expected Result & Assertions:**
  - Tool executes with `isError: false`.
  - Returned payload has `"ok": true`, `"total" >= 4`, and includes `compress` (`PDF processing`), `batch-compress-pdf`, `image-compressor` (`Image`), and `compress-video` (`Audio and video`).
  - Assistant summarizes the matching tools accurately and notes async support on `compress`.
- **Expected Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`.

---

### P2 — Exact Operation Schema Inspection (`privatools_describe_tool`)

- **Goal:** Verify the model inspects an operation's exact HTTP method, upload fields, parameters, constraints, and response media types before calling it.
- **User Prompt:** `"Check the exact parameters, upload fields, and output format for PrivaTools' PDF accessibility checker."`
- **Expected Tool Call:**
  ```json
  {
    "name": "privatools_describe_tool",
    "arguments": {
      "operation": "accessibility-check"
    }
  }
  ```
- **Expected Result & Assertions:**
  - Tool executes with `isError: false`.
  - Returned JSON has `"ok": true`, `"operation": "accessibility-check"`, `"category": "Accessibility"`, `"method": "POST"`, and `"response_media": ["application/json"]`.
  - Assistant reports the exact upload field requirements and confirms the output is structured JSON.
- **Expected Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`.

---

### P3 — Read-Only Document / Media Inspection (`privatools_run_tool`, JSON Output)

- **Goal:** Verify a non-mutating JSON inspection operation runs cleanly and returns inline structured findings with zero persistent storage.
- **User Prompt:** `"Run PrivaTools view-exif on the attached sample photo to inspect its EXIF metadata fields."`
- **Expected Tool Call:**
  ```json
  {
    "name": "privatools_run_tool",
    "arguments": {
      "operation": "view-exif",
      "file_path": "/samples/photo.jpg"
    }
  }
  ```
- **Expected Result & Assertions:**
  - Tool executes with `isError: false`.
  - Response returns inline JSON metadata (`media_type: "application/json"`) without modifying the input file.
  - Temporary server-side upload is deleted immediately after the HTTP response completes.
- **Expected Annotations:** Read-only inspection operation; no permanent user account mutation.

---

### P4 — Synchronous File Transformation (`privatools_run_tool`, Binary Output)

- **Goal:** Verify a synchronous PDF transformation executes cleanly, returns concise artifact metadata + compression headers instead of dumping raw base64 into context, and never clobbers the source file.
- **User Prompt:** `"Compress report.pdf using PrivaTools with the recommended compression level and save the result separately without overwriting the original."`
- **Expected Tool Call:**
  ```json
  {
    "name": "privatools_run_tool",
    "arguments": {
      "operation": "compress",
      "file_path": "/samples/report.pdf",
      "params": {
        "level": "recommended"
      },
      "overwrite": false
    }
  }
  ```
- **Expected Result & Assertions:**
  - Tool executes with `isError: false`.
  - Response returns structured metadata (`output_path`, `bytes`, `media_type: "application/pdf"`, relevant `X-*` headers) and leaves `/samples/report.pdf` untouched.
  - Assistant reports the output file path and resulting size clearly.

---

### P5 — Asynchronous Background Job Submission & Status Polling (`privatools_submit_job` + `privatools_job_status`)

- **Goal:** Verify heavy PDF workloads use the idempotent `/api/v1/jobs` workflow, report job status accurately, and respect the 1-hour artifact retention policy.
- **User Prompt:** `"Submit a background PrivaTools job to convert manual.pdf to grayscale, then check its current status."`
- **Expected Tool Calls:**
  1. `privatools_submit_job`:
     ```json
     {
       "name": "privatools_submit_job",
       "arguments": {
         "operation": "grayscale",
         "file_path": "/samples/manual.pdf"
       }
     }
     ```
  2. `privatools_job_status`:
     ```json
     {
       "name": "privatools_job_status",
       "arguments": {
         "job_id": "<returned_job_id>",
         "action": "status"
       }
     }
     ```
- **Expected Result & Assertions:**
  - Submission returns a job identifier and `Idempotency-Key` semantics (`isError: false`).
  - Status poll (`privatools_job_status`, strictly read-only: `readOnlyHint: true`, `destructiveHint: false`) returns structured job state (`queued`, `running`, or `succeeded`) without deleting or mutating the job.
  - Assistant notes that completed async artifacts expire automatically after 1 hour or can be explicitly deleted via the separate destructive `privatools_delete_job` tool (`destructiveHint: true`).

---

## Negative Test Cases (3)

### N1 — Out-of-Scope Prompt (Must NOT Trigger PrivaTools MCP)

- **Goal:** Verify the model does **not** invoke any PrivaTools MCP tool for unrelated general-knowledge, real-time weather, messaging, or non-file requests.
- **User Prompt:** `"What is the weather forecast in Tokyo tomorrow, and can you draft a short email to my team about it?"`
- **Expected Tool Call:** **None** (0 PrivaTools MCP tool calls).
- **Expected Result & Assertions:**
  - Model answers directly (or declines live weather without browsing) without calling `privatools_list_tools`, `privatools_describe_tool`, or `privatools_run_tool`.
  - Confirms tool descriptions are tightly scoped to file, PDF, image, document, and media processing.

---

### N2 — Unknown or Browser-Only Operation Rejection (`operation_not_found` / `operation_browser_only`)

- **Goal:** Verify calling `privatools_describe_tool` with a nonexistent or browser-only operation returns a clean, structured MCP tool execution error (`isError: true`) without crashing or leaking internal stack traces / secrets.
- **User Prompt:** `"Inspect the PrivaTools API operation named 'quantum-teleport-pdf'."`
- **Expected Tool Call:**
  ```json
  {
    "name": "privatools_describe_tool",
    "arguments": {
      "operation": "quantum-teleport-pdf"
    }
  }
  ```
- **Expected Result & Assertions:**
  - Tool returns `isError: true` with structured JSON error payload (`"ok": false`, `"error": { "code": "operation_not_found", ... }` and optional valid operation `suggestions`).
  - No stack trace, no `X-API-Key` value, and no raw HTML error page is leaked.
  - Assistant informs the user that the operation does not exist and offers real alternatives from `privatools_list_tools`.

---

### N3 — Invalid Arguments / Filesystem Sandbox Boundary Rejection

- **Goal:** Verify strict input validation and sandbox boundary enforcement before any network request is made.
- **User Prompt:** `"List PrivaTools tools with mode='invalid_mode' (or run compress on '../../../etc/passwd' outside the allowed workspace)."`
- **Expected Tool Call (Variant A — Invalid Enum):**
  ```json
  {
    "name": "privatools_list_tools",
    "arguments": {
      "mode": "invalid_mode"
    }
  }
  ```
  *(Variant B — Local Stdio Sandbox Traversal when `PRIVATOOLS_MCP_ALLOWED_DIRS` is set: `privatools_run_tool` with `file_path: "../../../etc/passwd"`.)*
- **Expected Result & Assertions:**
  - Variant A returns `isError: true` with `"code": "invalid_arguments"` (`'mode' must be one of: all, sync, async.`).
  - Variant B rejects the path via `fs.realpath` containment before issuing any HTTP request, returning `isError: true` with a sandbox violation error and zero file content disclosure.
  - Assistant cleanly explains the validation/sandbox refusal without retrying with bypassed paths.
