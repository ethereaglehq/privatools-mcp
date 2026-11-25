import {
  PrivaToolsError,
  inspectOperationBodySchema,
  normalizeOperationSlug,
} from "./client.mjs";

const HEADERS_SCHEMA = {
  type: "object",
  description: "Relevant X-* and HTTP response headers returned by PrivaTools.",
  additionalProperties: { type: "string" },
};

const JSON_DATA_SCHEMA = {
  description: "Structured JSON payload returned inline by the PrivaTools API.",
  anyOf: [
    { type: "object", additionalProperties: true },
    { type: "array" },
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
  ],
};

const JOB_RECORD_SCHEMA = {
  type: "object",
  description: "Asynchronous job record returned by /api/v1/jobs.",
  properties: {
    id: { type: "string" },
    operation: { type: "string" },
    state: { type: "string" },
    status_url: { type: "string" },
  },
  additionalProperties: true,
};

function assertOptionalString(value, fieldName) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new PrivaToolsError(
      "invalid_arguments",
      `'${fieldName}' must be a string.`
    );
  }
  return value;
}

function assertOptionalBoolean(value, fieldName, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new PrivaToolsError(
      "invalid_arguments",
      `'${fieldName}' must be a boolean.`
    );
  }
  return value;
}

function assertOptionalInteger(value, fieldName, min, max, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new PrivaToolsError(
      "invalid_arguments",
      `'${fieldName}' must be an integer between ${min} and ${max}.`
    );
  }
  return value;
}

function assertOptionalStringArray(value, fieldName) {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item.trim().length > 0)
  ) {
    throw new PrivaToolsError(
      "invalid_arguments",
      `'${fieldName}' must be an array of non-empty strings.`
    );
  }
  return value;
}

function assertOptionalObject(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PrivaToolsError(
      "invalid_arguments",
      `'${fieldName}' must be an object.`
    );
  }
  return value;
}

function matchesQuery(op, queryTokens) {
  if (queryTokens.length === 0) return true;
  const haystack = [
    op.operation,
    op.path,
    op.category,
    op.summary,
    op.description,
    ...(op.tool_aliases ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return queryTokens.every((token) => haystack.includes(token));
}

export function createPrivaToolsTools(client) {
  return [
    {
      name: "privatools_list_tools",
      title: "Search PrivaTools Operations",
      description:
        "Search and filter PrivaTools /api/v1 operations by keyword query, category, or mode (sync/async). Uses the live /api/v1 catalog (or OpenAPI spec) with an automatic offline fallback.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description:
              "Optional keyword search across operation slugs, tool aliases, summaries, and categories (e.g. 'compress', 'watermark', 'accessibility', 'exif').",
          },
          category: {
            type: "string",
            description:
              "Optional category filter (case-insensitive substring, e.g. 'PDF processing', 'Accessibility', 'Image', 'Audio and video').",
          },
          mode: {
            type: "string",
            enum: ["all", "sync", "async"],
            default: "all",
            description:
              "Filter by execution mode: 'all' (default), 'sync', or 'async' (operations supported by /api/v1/jobs).",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 250,
            default: 50,
            description: "Maximum number of operations to return (default 50).",
          },
          offset: {
            type: "integer",
            minimum: 0,
            default: 0,
            description: "Pagination offset (default 0).",
          },
        },
      },
      outputSchema: {
        type: "object",
        required: [
          "ok",
          "source",
          "total",
          "returned",
          "offset",
          "limit",
          "categories",
          "async_available",
          "operations",
        ],
        properties: {
          ok: { type: "boolean" },
          source: {
            type: "string",
            enum: ["live-operations", "live-openapi", "bundled-fallback"],
          },
          total: { type: "integer", minimum: 0 },
          returned: { type: "integer", minimum: 0 },
          offset: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1 },
          categories: {
            type: "array",
            items: { type: "string" },
          },
          async_available: { type: "boolean" },
          operations: {
            type: "array",
            items: {
              type: "object",
              required: [
                "operation",
                "method",
                "path",
                "category",
                "summary",
                "tool_aliases",
                "response_media",
                "async_supported",
                "cost_units",
              ],
              properties: {
                operation: { type: "string" },
                method: { type: "string" },
                path: { type: "string" },
                category: { type: "string" },
                summary: { type: "string" },
                tool_aliases: { type: "array", items: { type: "string" } },
                response_media: { type: "array", items: { type: "string" } },
                async_supported: { type: "boolean" },
                cost_units: {
                  anyOf: [{ type: "number" }, { type: "null" }],
                },
              },
            },
          },
        },
      },
      async handler(args) {
        const query = assertOptionalString(args.query, "query")?.trim() ?? "";
        const category =
          assertOptionalString(args.category, "category")?.trim().toLowerCase() ??
          "";
        const mode = assertOptionalString(args.mode, "mode") ?? "all";
        if (!["all", "sync", "async"].includes(mode)) {
          throw new PrivaToolsError(
            "invalid_arguments",
            "'mode' must be one of: all, sync, async."
          );
        }
        const limit = assertOptionalInteger(args.limit, "limit", 1, 250, 50);
        const offset = assertOptionalInteger(args.offset, "offset", 0, 10000, 0);

        const catalog = await client.getCatalog();
        const queryTokens = query
          ? query.toLowerCase().split(/\s+/).filter(Boolean)
          : [];

        const categories = [
          ...new Set(catalog.operations.map((op) => op.category).filter(Boolean)),
        ].sort();

        const filtered = catalog.operations.filter((op) => {
          if (category && !(op.category ?? "").toLowerCase().includes(category)) {
            return false;
          }
          if (mode === "async" && !op.async?.supported) {
            return false;
          }
          if (mode === "sync" && op.operation.startsWith("jobs")) {
            return false;
          }
          return matchesQuery(op, queryTokens);
        });

        const page = filtered.slice(offset, offset + limit).map((op) => ({
          operation: op.operation,
          method: op.method,
          path: op.path,
          category: op.category,
          summary: op.summary,
          tool_aliases: op.tool_aliases,
          response_media: op.response_media,
          async_supported: Boolean(op.async?.supported),
          cost_units: op.cost?.units ?? null,
        }));

        return {
          ok: true,
          source: catalog.source,
          total: filtered.length,
          returned: page.length,
          offset,
          limit,
          categories,
          async_available: Boolean(catalog.async?.available),
          operations: page,
        };
      },
    },

    {
      name: "privatools_describe_tool",
      title: "Inspect PrivaTools Operation Schema",
      description:
        "Inspect the exact endpoint, HTTP method, accepted file upload fields, form/query parameters, constraints, cost, async support, and response media types for a PrivaTools operation slug or alias.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["operation"],
        properties: {
          operation: {
            type: "string",
            description:
              "Operation slug, path, or tool alias (e.g. 'compress', 'compress-pdf', 'merge', 'accessibility-check', 'remove-watermark/detect').",
          },
        },
      },
      outputSchema: {
        type: "object",
        required: [
          "ok",
          "source",
          "operation",
          "id",
          "method",
          "endpoint",
          "path",
          "category",
          "summary",
          "description",
          "tool_aliases",
          "request_content_type",
          "upload_fields",
          "form_fields",
          "parameters",
          "response_media",
          "constraints",
          "cost",
          "async",
          "retry_safe",
        ],
        properties: {
          ok: { type: "boolean" },
          source: {
            type: "string",
            enum: ["live-operations", "live-openapi", "bundled-fallback"],
          },
          operation: { type: "string" },
          id: { type: "string" },
          method: { type: "string" },
          endpoint: { type: "string" },
          path: { type: "string" },
          category: { type: "string" },
          summary: { type: "string" },
          description: { type: "string" },
          tool_aliases: { type: "array", items: { type: "string" } },
          request_content_type: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          upload_fields: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "multiple", "required"],
              properties: {
                name: { type: "string" },
                multiple: { type: "boolean" },
                required: { type: "boolean" },
                minItems: { type: "integer" },
                maxItems: { type: "integer" },
                description: { type: "string" },
              },
            },
          },
          form_fields: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "required"],
              properties: {
                name: { type: "string" },
                required: { type: "boolean" },
                type: { type: "string" },
                types: { type: "array", items: { type: "string" } },
                enum: { type: "array" },
                default: JSON_DATA_SCHEMA,
                minimum: { type: "number" },
                maximum: { type: "number" },
                description: { type: "string" },
              },
            },
          },
          parameters: { type: "array", items: { type: "object", additionalProperties: true } },
          response_media: { type: "array", items: { type: "string" } },
          constraints: { type: "array", items: { type: "string" } },
          cost: {
            anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }],
          },
          async: {
            anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }],
          },
          retry_safe: { type: "boolean" },
        },
      },
      async handler(args) {
        const rawOperation = assertOptionalString(args.operation, "operation");
        if (!rawOperation || !rawOperation.trim()) {
          throw new PrivaToolsError(
            "invalid_arguments",
            "'operation' is required."
          );
        }
        const slug = normalizeOperationSlug(rawOperation);
        const catalog = await client.getCatalog();
        const entry = client.findOperationInCatalog(catalog, slug);

        if (!entry) {
          const unavailable = (catalog.unavailable_tools ?? []).find(
            (item) => item.slug?.toLowerCase() === slug.toLowerCase()
          );
          if (unavailable) {
            throw new PrivaToolsError(
              "operation_browser_only",
              `'${unavailable.slug}' (${unavailable.name}) is not an HTTP API operation: ${unavailable.reason}`
            );
          }
          const tokens = slug.toLowerCase().split(/[-/_]+/).filter(Boolean);
          const suggestions = catalog.operations
            .filter((op) =>
              tokens.some(
                (t) =>
                  op.operation.toLowerCase().includes(t) ||
                  (op.tool_aliases ?? []).some((a) => a.toLowerCase().includes(t))
              )
            )
            .slice(0, 8)
            .map((op) => op.operation);
          throw new PrivaToolsError(
            "operation_not_found",
            `Unknown PrivaTools API operation: '${rawOperation}'.`,
            suggestions.length > 0 ? { details: { suggestions } } : {}
          );
        }

        const body = inspectOperationBodySchema(entry, catalog.components);

        return {
          ok: true,
          source: catalog.source,
          operation: entry.operation,
          id: entry.id,
          method: entry.method,
          endpoint: `${client.baseUrl}/${entry.operation}`,
          path: entry.path,
          category: entry.category,
          summary: entry.summary,
          description: entry.description,
          tool_aliases: entry.tool_aliases,
          request_content_type: body.contentType,
          upload_fields: body.uploadFields,
          form_fields: body.formFields,
          parameters: entry.parameters,
          response_media: entry.response_media,
          constraints: entry.constraints,
          cost: entry.cost,
          async: entry.async,
          retry_safe: entry.retry_safe,
        };
      },
    },

    {
      name: "privatools_run_tool",
      title: "Run PrivaTools File Operation",
      description:
        "Execute any synchronous PrivaTools /api/v1/<operation> file or document tool against local file(s) and parameters. Binary outputs are written directly to disk (without overwriting unless overwrite: true) and concise metadata + X-* headers are returned; JSON-returning tools return their JSON response directly. See the full OpenAPI specification at https://api.privatools.me/api/v1/openapi.json and MCP documentation at https://privatools.me/mcp.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["operation"],
        properties: {
          operation: {
            type: "string",
            description:
              "Operation slug, path, or tool alias (e.g. 'compress', 'merge', 'accessibility-check', 'view-exif', 'remove-watermark/detect').",
          },
          file_path: {
            type: "string",
            description: "Local path to a single input file.",
          },
          file_paths: {
            type: "array",
            items: { type: "string" },
            description: "Local paths to multiple input files, in order.",
          },
          file_field: {
            type: "string",
            description:
              "Optional multipart upload field name override (auto-detected from API schema when omitted; defaults to 'file' for file_path or 'files' for file_paths).",
          },
          file_fields: {
            type: "object",
            description:
              "Optional map of multipart field names to local file path(s) (string or array of strings) for tools with distinct named file inputs (e.g. { file1: 'a.pdf', file2: 'b.pdf' }).",
            additionalProperties: true,
          },
          params: {
            type: "object",
            description:
              "Optional operation parameters (form fields for multipart endpoints, JSON fields for JSON endpoints, or query params for GET endpoints).",
            additionalProperties: true,
          },
          output_path: {
            type: "string",
            description:
              "Optional destination file path for binary output. If omitted, output is auto-named next to the input file without overwriting existing files.",
          },
          overwrite: {
            type: "boolean",
            default: false,
            description:
              "Allow replacing an existing file at output_path (default false).",
          },
        },
      },
      outputSchema: {
        type: "object",
        required: ["ok", "operation", "media_type", "headers"],
        properties: {
          ok: { type: "boolean" },
          operation: { type: "string" },
          media_type: { type: "string" },
          output_path: { type: "string" },
          bytes: { type: "integer", minimum: 0 },
          filename: { type: "string" },
          data: JSON_DATA_SCHEMA,
          headers: HEADERS_SCHEMA,
        },
      },
      async handler(args) {
        const operation = assertOptionalString(args.operation, "operation");
        if (!operation || !operation.trim()) {
          throw new PrivaToolsError(
            "invalid_arguments",
            "'operation' is required."
          );
        }
        const filePath = assertOptionalString(args.file_path, "file_path");
        const filePaths = assertOptionalStringArray(args.file_paths, "file_paths");
        const fileField = assertOptionalString(args.file_field, "file_field");
        const fileFields = assertOptionalObject(args.file_fields, "file_fields");
        if (fileFields) {
          for (const [k, v] of Object.entries(fileFields)) {
            const validStr = typeof v === "string" && v.trim().length > 0;
            const validArr =
              Array.isArray(v) &&
              v.length > 0 &&
              v.every((item) => typeof item === "string" && item.trim().length > 0);
            if (!validStr && !validArr) {
              throw new PrivaToolsError(
                "invalid_arguments",
                `'file_fields.${k}' must be a non-empty file path string or array of file path strings.`
              );
            }
          }
        }
        const params = assertOptionalObject(args.params, "params");
        const outputPath = assertOptionalString(args.output_path, "output_path");
        const overwrite = assertOptionalBoolean(args.overwrite, "overwrite", false);

        return client.runTool({
          operation,
          filePath,
          filePaths,
          fileField,
          fileFields,
          params,
          outputPath,
          overwrite,
        });
      },
    },

    {
      name: "privatools_submit_job",
      title: "Submit Async PrivaTools Job",
      description:
        "Submit an asynchronous background job (POST /api/v1/jobs) for supported heavy/large operations such as 'merge', 'compress', 'grayscale', or 'pdf-to-text'. Completed job artifacts expire automatically within one hour and can be removed early with privatools_delete_job.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["operation"],
        properties: {
          operation: {
            type: "string",
            description:
              "Async operation slug (e.g. 'merge', 'compress', 'grayscale', 'pdf-to-text').",
          },
          file_path: {
            type: "string",
            description: "Local path to a single PDF input file.",
          },
          file_paths: {
            type: "array",
            items: { type: "string" },
            description: "Local paths to multiple PDF input files, in order.",
          },
          options: {
            type: "object",
            description:
              "Optional operation-specific options object (e.g. { level: 'recommended' } for compress).",
            additionalProperties: true,
          },
          idempotency_key: {
            type: "string",
            description:
              "Optional Idempotency-Key (1–128 visible ASCII chars) for safe retries. Auto-generated when omitted.",
          },
        },
      },
      outputSchema: {
        type: "object",
        required: ["ok", "idempotency_key", "job", "headers"],
        properties: {
          ok: { type: "boolean" },
          idempotency_key: { type: "string" },
          job: JOB_RECORD_SCHEMA,
          headers: HEADERS_SCHEMA,
        },
      },
      async handler(args) {
        const operation = assertOptionalString(args.operation, "operation");
        if (!operation || !operation.trim()) {
          throw new PrivaToolsError(
            "invalid_arguments",
            "'operation' is required."
          );
        }
        const filePath = assertOptionalString(args.file_path, "file_path");
        const filePaths = assertOptionalStringArray(args.file_paths, "file_paths");
        const options = assertOptionalObject(args.options, "options") ?? {};
        const idempotencyKey = assertOptionalString(
          args.idempotency_key,
          "idempotency_key"
        );

        return client.submitJob({
          operation,
          filePath,
          filePaths,
          options,
          idempotencyKey,
        });
      },
    },

    {
      name: "privatools_job_status",
      title: "Check or Download PrivaTools Job",
      description:
        "Poll an asynchronous job's status (action: 'status') or download its completed artifact to output_path (action: 'download'). Read-only on the server — use privatools_delete_job to cancel or delete a job.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["job_id"],
        properties: {
          job_id: {
            type: "string",
            description: "Job ID returned by privatools_submit_job.",
          },
          action: {
            type: "string",
            enum: ["status", "download"],
            default: "status",
            description:
              "Read-only action to perform: 'status' (poll) or 'download' (fetch completed artifact). To delete or cancel a job, call privatools_delete_job.",
          },
          output_path: {
            type: "string",
            description:
              "Destination file path when downloading a binary artifact (or saving a JSON artifact to disk).",
          },
          overwrite: {
            type: "boolean",
            default: false,
            description:
              "Allow replacing an existing file at output_path (default false).",
          },
          download: {
            type: "boolean",
            default: false,
            description:
              "When action is 'status' and the job has succeeded, automatically download the artifact in the same call.",
          },
        },
      },
      outputSchema: {
        type: "object",
        required: ["ok", "headers"],
        properties: {
          ok: { type: "boolean" },
          job: JOB_RECORD_SCHEMA,
          job_id: { type: "string" },
          media_type: { type: "string" },
          output_path: { type: "string" },
          bytes: { type: "integer", minimum: 0 },
          filename: { type: "string" },
          data: JSON_DATA_SCHEMA,
          downloaded: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              job_id: { type: "string" },
              media_type: { type: "string" },
              output_path: { type: "string" },
              bytes: { type: "integer", minimum: 0 },
              filename: { type: "string" },
              data: JSON_DATA_SCHEMA,
              headers: HEADERS_SCHEMA,
            },
          },
          headers: HEADERS_SCHEMA,
        },
      },
      async handler(args) {
        const jobId = assertOptionalString(args.job_id, "job_id");
        if (!jobId || !jobId.trim()) {
          throw new PrivaToolsError("invalid_arguments", "'job_id' is required.");
        }
        const action = assertOptionalString(args.action, "action") ?? "status";
        if (!["status", "download"].includes(action)) {
          throw new PrivaToolsError(
            "invalid_arguments",
            "'action' must be one of: status, download. Use 'privatools_delete_job' to delete or cancel a job."
          );
        }
        const outputPath = assertOptionalString(args.output_path, "output_path");
        const overwrite = assertOptionalBoolean(args.overwrite, "overwrite", false);
        const download = assertOptionalBoolean(args.download, "download", false);

        if (action === "download") {
          return client.downloadJobResult({
            jobId,
            outputPath,
            overwrite,
          });
        }

        const statusRes = await client.getJobStatus(jobId);
        if (download && statusRes.job?.state === "succeeded") {
          const downloaded = await client.downloadJobResult({
            jobId,
            outputPath,
            overwrite,
          });
          return {
            ...statusRes,
            downloaded,
          };
        }
        return statusRes;
      },
    },

    {
      name: "privatools_delete_job",
      title: "Delete PrivaTools Async Job",
      description:
        "Permanently delete a completed PrivaTools asynchronous job's server-side artifact or cancel a queued/running job (DELETE /api/v1/jobs/{job_id}).",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["job_id"],
        properties: {
          job_id: {
            type: "string",
            description: "Job ID returned by privatools_submit_job to cancel or delete.",
          },
        },
      },
      outputSchema: {
        type: "object",
        required: ["ok", "deletion", "headers"],
        properties: {
          ok: { type: "boolean" },
          deletion: {
            type: "object",
            properties: {
              id: { type: "string" },
              state: { type: "string" },
              deletion_pending: { type: "boolean" },
            },
            additionalProperties: true,
          },
          headers: HEADERS_SCHEMA,
        },
      },
      async handler(args) {
        const jobId = assertOptionalString(args.job_id, "job_id");
        if (!jobId || !jobId.trim()) {
          throw new PrivaToolsError("invalid_arguments", "'job_id' is required.");
        }
        return client.deleteJob(jobId);
      },
    },
  ];
}
