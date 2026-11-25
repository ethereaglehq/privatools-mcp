import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createPrivaToolsClient,
  loadBundledMetadata,
} from "../src/client.mjs";
import {
  createMcpServer,
  ERROR_CODES,
  LATEST_LEGACY_PROTOCOL_VERSION,
  LATEST_PROTOCOL_VERSION,
  LEGACY_PROTOCOL_VERSIONS,
  MAX_BATCH_SIZE,
  MAX_CONCURRENT_REQUESTS,
  MAX_LINE_BYTES,
  META_PROTOCOL_VERSION,
  META_SERVER_INFO,
  MODERN_PROTOCOL_VERSIONS,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "../src/protocol.mjs";
import { createPrivaToolsTools } from "../src/tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.resolve(__dirname, "../bin/privatools-mcp.mjs");

const FAKE_PDF_A = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const FAKE_PDF_B = Buffer.from("%PDF-1.7\n2 0 obj\n<<>>\nendobj\n%%EOF\n");
const FAKE_OUTPUT_PDF = Buffer.from("%PDF-1.7\n9 0 obj\n(processed)\nendobj\n%%EOF\n");

function parseMultipart(bodyBuffer, contentType) {
  const match = /boundary=([^;\s]+)/i.exec(contentType || "");
  if (!match) {
    return { fields: {}, files: [] };
  }
  const boundary = match[1].replace(/^"|"$/g, "");
  const raw = bodyBuffer.toString("latin1");
  const delimiter = `--${boundary}`;
  const parts = raw.split(delimiter).slice(1, -1);

  const fields = {};
  const files = [];

  for (const part of parts) {
    const trimmed = part.startsWith("\r\n") ? part.slice(2) : part;
    const headerEnd = trimmed.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headerBlock = trimmed.slice(0, headerEnd);
    let content = trimmed.slice(headerEnd + 4);
    if (content.endsWith("\r\n")) {
      content = content.slice(0, -2);
    }
    const dispMatch = /content-disposition:[^\r\n]*/i.exec(headerBlock);
    if (!dispMatch) continue;
    const nameMatch = /name="([^"]+)"/i.exec(dispMatch[0]);
    const filenameMatch = /filename="([^"]*)"/i.exec(dispMatch[0]);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];

    if (filenameMatch) {
      files.push({
        field: fieldName,
        filename: filenameMatch[1],
        bytes: Buffer.from(content, "latin1"),
      });
    } else {
      const value = Buffer.from(content, "latin1").toString("utf8");
      if (fieldName in fields) {
        fields[fieldName] = Array.isArray(fields[fieldName])
          ? [...fields[fieldName], value]
          : [fields[fieldName], value];
      } else {
        fields[fieldName] = value;
      }
    }
  }

  return { fields, files };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function createMockApiServer() {
  const recorded = [];
  const jobs = new Map();
  let jobCounter = 0;
  let operationsEndpointEnabled = true;

  const sampleComponents = {
    schemas: {
      Body_compress: {
        type: "object",
        required: ["files"],
        properties: {
          files: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            items: {
              type: "string",
              format: "binary",
              contentMediaType: "application/octet-stream",
            },
          },
          level: {
            type: "string",
            default: "recommended",
            enum: ["light", "recommended", "extreme", "custom"],
          },
          target_size_mb: {
            anyOf: [{ type: "number", maximum: 500 }, { type: "null" }],
          },
        },
      },
      Body_merge: {
        type: "object",
        required: ["files"],
        properties: {
          files: {
            type: "array",
            minItems: 2,
            maxItems: 100,
            items: { type: "string", format: "binary" },
          },
          page_ranges: { type: "string" },
        },
      },
      Body_compare: {
        type: "object",
        required: ["file1", "file2"],
        properties: {
          file1: { type: "string", format: "binary" },
          file2: { type: "string", format: "binary" },
          mode: { type: "string", enum: ["visual", "text"], default: "visual" },
        },
      },
      Body_accessibility_check: {
        type: "object",
        required: ["file"],
        properties: {
          file: { type: "string", format: "binary" },
        },
      },
    },
  };

  const sampleCatalog = {
    schema_version: "1",
    api_version: "v1",
    base_path: "/api/v1",
    openapi_url: "/api/v1/openapi.json",
    async: {
      available: true,
      enabled: true,
      operations: ["merge", "compress", "grayscale", "pdf-to-text"],
    },
    components: sampleComponents,
    unavailable_tools: [
      {
        slug: "regex-tester",
        name: "Regex Tester",
        reason: "Browser-only utility; no v1 HTTP endpoint.",
      },
    ],
    operations: [
      {
        id: "v1_post_compress",
        method: "POST",
        path: "/api/v1/compress",
        summary: "Compress PDF",
        description: "Reduce PDF file size.",
        category: "PDF processing",
        tool_aliases: ["compress-pdf"],
        request_body: {
          content: {
            "multipart/form-data": {
              schema: { $ref: "#/components/schemas/Body_compress" },
            },
          },
        },
        parameters: [],
        responses: {
          "200": {
            content: {
              "application/pdf": { schema: { type: "string", format: "binary" } },
              "application/zip": { schema: { type: "string", format: "binary" } },
            },
          },
        },
        cost: { units: 1, mode: "fixed" },
        async: { supported: true, operation: "compress" },
        constraints: ["Upload 1–100 PDFs."],
        retry_safe: false,
      },
      {
        id: "v1_post_merge",
        method: "POST",
        path: "/api/v1/merge",
        summary: "Merge PDFs",
        description: "Combine multiple PDFs in order.",
        category: "PDF processing",
        tool_aliases: ["merge-pdf"],
        request_body: {
          content: {
            "multipart/form-data": {
              schema: { $ref: "#/components/schemas/Body_merge" },
            },
          },
        },
        parameters: [],
        responses: {
          "200": {
            content: {
              "application/pdf": { schema: { type: "string", format: "binary" } },
            },
          },
        },
        cost: { units: 1, mode: "fixed" },
        async: { supported: true, operation: "merge" },
        constraints: ["Upload 2–100 PDFs."],
        retry_safe: false,
      },
      {
        id: "v1_post_compare",
        method: "POST",
        path: "/api/v1/compare",
        summary: "Compare two PDFs",
        description: "Compare two PDF documents visually or by text.",
        category: "PDF processing",
        tool_aliases: ["compare-pdf"],
        request_body: {
          content: {
            "multipart/form-data": {
              schema: { $ref: "#/components/schemas/Body_compare" },
            },
          },
        },
        parameters: [],
        responses: {
          "200": {
            content: {
              "application/pdf": { schema: { type: "string", format: "binary" } },
              "application/json": { schema: {} },
            },
          },
        },
        cost: { units: 1, mode: "fixed" },
        async: { supported: false },
        constraints: [],
        retry_safe: false,
      },
      {
        id: "v1_post_accessibility_check",
        method: "POST",
        path: "/api/v1/accessibility-check",
        summary: "PDF Accessibility Checker",
        description: "Inspect PDF/UA & WCAG compliance.",
        category: "Accessibility",
        tool_aliases: ["accessibility-check"],
        request_body: {
          content: {
            "multipart/form-data": {
              schema: { $ref: "#/components/schemas/Body_accessibility_check" },
            },
          },
        },
        parameters: [],
        responses: {
          "200": {
            content: {
              "application/json": { schema: {} },
            },
          },
        },
        cost: { units: 1, mode: "fixed" },
        async: { supported: false },
        constraints: [],
        retry_safe: false,
      },
      {
        id: "v1_post_remove_watermark_detect",
        method: "POST",
        path: "/api/v1/remove-watermark/detect",
        summary: "Detect PDF watermarks",
        description: "Identify repeated watermark candidates.",
        category: "PDF processing",
        tool_aliases: ["remove-watermark"],
        request_body: {
          content: {
            "multipart/form-data": {
              schema: { $ref: "#/components/schemas/Body_accessibility_check" },
            },
          },
        },
        parameters: [],
        responses: {
          "200": {
            content: {
              "application/json": { schema: {} },
            },
          },
        },
        cost: { units: 1, mode: "fixed" },
        async: { supported: false },
        constraints: [],
        retry_safe: false,
      },
    ],
  };

  const sampleOpenApi = {
    openapi: "3.1.0",
    info: { title: "PrivaTools API", version: "1.0.0" },
    "x-privatools-async": sampleCatalog.async,
    components: sampleComponents,
    paths: {
      "/api/v1/compress": {
        post: {
          operationId: "v1_post_compress",
          summary: "Compress PDF (from OpenAPI)",
          tags: ["PDF processing"],
          requestBody: sampleCatalog.operations[0].request_body,
          responses: sampleCatalog.operations[0].responses,
          "x-privatools": {
            cost: { units: 1, mode: "fixed" },
            async: { supported: true, operation: "compress" },
            retrySafe: false,
          },
        },
      },
    },
  };

  const server = http.createServer(async (req, res) => {
    const body = await readRequestBody(req);
    const url = new URL(req.url, "http://127.0.0.1");
    const parsedMultipart = (req.headers["content-type"] || "").includes(
      "multipart/form-data"
    )
      ? parseMultipart(body, req.headers["content-type"])
      : null;

    recorded.push({
      method: req.method,
      pathname: url.pathname,
      search: url.search,
      headers: { ...req.headers },
      multipart: parsedMultipart,
      bodyText: parsedMultipart ? null : body.toString("utf8"),
    });

    if (req.method === "GET" && url.pathname === "/api/v1/operations") {
      if (!operationsEndpointEnabled) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "not_found", message: "Not found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sampleCatalog));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/openapi.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sampleOpenApi));
      return;
    }

    if (req.headers["x-api-key"] === "bad-key") {
      res.writeHead(401, {
        "Content-Type": "application/json",
        "X-Request-ID": "req-auth-401",
      });
      res.end(
        JSON.stringify({
          code: "invalid_api_key",
          message: "That key is not recognised, or it has been revoked.",
          request_id: "req-auth-401",
        })
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/compress") {
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="compressed.pdf"',
        "X-Target-Met": "true",
        "X-Compressed-Size": String(FAKE_OUTPUT_PDF.length),
        "X-Request-ID": "req-compress-1",
        "X-RateLimit-Remaining": "499",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(FAKE_OUTPUT_PDF);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/repair") {
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="repaired.pdf"',
        "X-Repair-Pages": "12/12",
        "X-Repair-Status": "repaired",
        "X-Bates-Next": "0013",
        "X-Accessibility-Score-Before": "62",
        "X-Accessibility-Score-After": "96",
      });
      res.end(FAKE_OUTPUT_PDF);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/merge") {
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="merged.pdf"',
        "X-Request-ID": "req-merge-1",
      });
      res.end(FAKE_OUTPUT_PDF);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/compare") {
      if (parsedMultipart?.fields?.mode === "text") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ differences: 2, identical: false }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="comparison.pdf"',
      });
      res.end(FAKE_OUTPUT_PDF);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/accessibility-check") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "X-Request-ID": "req-a11y-1",
      });
      res.end(
        JSON.stringify({
          score: 88,
          grade: "B",
          checks: [{ id: "document-title", status: "pass" }],
        })
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/remove-watermark/detect") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ candidates: [{ text: "DRAFT", pages: [1, 2] }] }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/rate-limited") {
      res.writeHead(429, {
        "Content-Type": "application/json",
        "Retry-After": "15",
        "X-Request-ID": "req-429",
      });
      res.end(
        JSON.stringify({
          code: "rate_limit_exceeded",
          message: "This key's request burst is exhausted.",
          request_id: "req-429",
        })
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/leaky-validation-error") {
      const sentKey = req.headers["x-api-key"] || "missing-key";
      res.writeHead(422, {
        "Content-Type": "application/json",
        "X-Request-ID": `req-422-${sentKey}`,
      });
      res.end(
        JSON.stringify({
          detail: [
            {
              type: "value_error",
              loc: ["header", "x-api-key"],
              msg: `Rejected key ${sentKey} with Authorization: Bearer topsecret-bearer-token`,
              input: sentKey,
            },
            {
              type: "value_error",
              loc: ["body", "params"],
              msg: "Bad params",
              headers: {
                "X-API-Key": sentKey,
                Authorization: "Bearer another-secret-tok",
                Cookie: "session=super-secret-cookie",
                "Content-Type": "application/json",
              },
              password: "pdf-owner-password-999",
              client_secret: "client-sec-123",
            },
          ],
        })
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/jobs") {
      const idempKey = req.headers["idempotency-key"];
      if (!idempKey) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "invalid_idempotency_key",
            message: "Send an Idempotency-Key.",
          })
        );
        return;
      }
      jobCounter += 1;
      const id = `job_${jobCounter}`;
      const operation = parsedMultipart?.fields?.operation || "compress";
      const isText = operation === "pdf-to-text";
      const record = {
        id,
        operation,
        state: "queued",
        polls: 0,
        deleted: false,
        media_type: isText ? "application/json" : "application/pdf",
        filename: isText ? "result.json" : "result.pdf",
      };
      jobs.set(id, record);

      res.writeHead(202, {
        "Content-Type": "application/json",
        Location: `/api/v1/jobs/${id}`,
        "Retry-After": "2",
        "Idempotency-Replayed": "false",
      });
      res.end(
        JSON.stringify({
          id,
          operation,
          state: "queued",
          created_at: "2026-11-24T12:00:00Z",
          started_at: null,
          completed_at: null,
          expires_at: null,
          attempts: 0,
          error: null,
          status_url: `/api/v1/jobs/${id}`,
          result: null,
        })
      );
      return;
    }

    const jobResultMatch = /^\/api\/v1\/jobs\/([^/]+)\/result$/.exec(
      url.pathname
    );
    if (req.method === "GET" && jobResultMatch) {
      const job = jobs.get(jobResultMatch[1]);
      if (!job) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "job_not_found", message: "Job not found." }));
        return;
      }
      if (job.deleted) {
        res.writeHead(410, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "job_result_expired",
            message: "The job result has expired.",
          })
        );
        return;
      }
      if (job.media_type === "application/json") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="result.json"',
        });
        res.end(
          JSON.stringify({
            text: "Hello world",
            characters: 11,
            pages: [{ page: 1, text: "Hello world" }],
          })
        );
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="job-result.pdf"',
      });
      res.end(FAKE_OUTPUT_PDF);
      return;
    }

    const jobMatch = /^\/api\/v1\/jobs\/([^/]+)$/.exec(url.pathname);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "job_not_found", message: "Job not found." }));
        return;
      }
      if (req.method === "GET") {
        job.polls += 1;
        if (job.deleted) {
          job.state = "canceled";
        } else if (job.polls === 1) {
          job.state = "running";
        } else {
          job.state = "succeeded";
        }
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Retry-After": "2",
        });
        res.end(
          JSON.stringify({
            id: job.id,
            operation: job.operation,
            state: job.state,
            created_at: "2026-11-24T12:00:00Z",
            started_at: "2026-11-24T12:00:01Z",
            completed_at:
              job.state === "succeeded" ? "2026-11-24T12:00:03Z" : null,
            expires_at:
              job.state === "succeeded" ? "2026-11-24T13:00:03Z" : null,
            attempts: 1,
            error: null,
            status_url: `/api/v1/jobs/${job.id}`,
            result:
              job.state === "succeeded"
                ? {
                    url: `/api/v1/jobs/${job.id}/result`,
                    bytes: FAKE_OUTPUT_PDF.length,
                    media_type: job.media_type,
                    filename: job.filename,
                  }
                : null,
          })
        );
        return;
      }
      if (req.method === "DELETE") {
        job.deleted = true;
        job.state = "canceled";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: job.id,
            state: "canceled",
            deletion_pending: false,
          })
        );
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "not_found", message: `Unknown path: ${url.pathname}` }));
  });

  return {
    server,
    recorded,
    setOperationsEnabled(flag) {
      operationsEndpointEnabled = flag;
    },
    async start() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const addr = server.address();
      return `http://127.0.0.1:${addr.port}/api/v1`;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function parseToolPayload(mcpResponse) {
  assert.ok(mcpResponse?.result, "expected JSON-RPC result");
  assert.ok(Array.isArray(mcpResponse.result.content));
  assert.equal(mcpResponse.result.content[0].type, "text");
  const isError = Boolean(mcpResponse.result.isError);
  const payload = JSON.parse(mcpResponse.result.content[0].text);
  if (isError) {
    assert.equal(
      mcpResponse.result.structuredContent,
      undefined,
      "error tool results must not include structuredContent"
    );
  } else {
    assert.deepEqual(
      mcpResponse.result.structuredContent,
      payload,
      "successful tool results must include matching structuredContent"
    );
  }
  return {
    isError,
    payload,
    structuredContent: mcpResponse.result.structuredContent,
    resultType: mcpResponse.result.resultType,
    meta: mcpResponse.result._meta,
  };
}

describe("PrivaTools MCP server", () => {
  let mockApi;
  let baseUrl;
  let tmpRoot;
  let allowedDir;
  let siblingEvilDir;
  let outsideDir;
  let pdfA;
  let pdfB;
  let outsidePdf;

  before(async () => {
    mockApi = createMockApiServer();
    baseUrl = await mockApi.start();

    tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "privatools-mcp-test-"));
    allowedDir = path.join(tmpRoot, "allowed");
    siblingEvilDir = path.join(tmpRoot, "allowed-evil");
    outsideDir = path.join(tmpRoot, "outside");
    await fs.promises.mkdir(allowedDir, { recursive: true });
    await fs.promises.mkdir(siblingEvilDir, { recursive: true });
    await fs.promises.mkdir(outsideDir, { recursive: true });

    pdfA = path.join(allowedDir, "doc-a.pdf");
    pdfB = path.join(allowedDir, "doc-b.pdf");
    outsidePdf = path.join(outsideDir, "secret.pdf");

    await fs.promises.writeFile(pdfA, FAKE_PDF_A);
    await fs.promises.writeFile(pdfB, FAKE_PDF_B);
    await fs.promises.writeFile(outsidePdf, FAKE_PDF_A);
    await fs.promises.writeFile(path.join(siblingEvilDir, "sibling.pdf"), FAKE_PDF_A);
  });

  after(async () => {
    await mockApi.stop();
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  });

  describe("JSON-RPC 2.0 & MCP protocol layer", () => {
    function makeServer() {
      const client = createPrivaToolsClient({
        baseUrl,
        apiKey: "test-key-123",
        allowedDirs: [allowedDir],
      });
      return createMcpServer({
        name: "@privatools/mcp",
        version: "0.1.0",
        title: "PrivaTools",
        description: "Stateless privacy-first PrivaTools MCP server.",
        websiteUrl: "https://privatools.me",
        icons: [
          {
            src: "https://privatools.me/icons/icon-512.png",
            mimeType: "image/png",
            sizes: ["512x512"],
          },
        ],
        instructions: "Use PrivaTools tools for file processing.",
        tools: createPrivaToolsTools(client),
      });
    }

    it("supports MCP 2026-07-28 stateless core (server/discover, per-request _meta, resultType, -32022)", async () => {
      const server = makeServer();
      const modernMeta = {
        [META_PROTOCOL_VERSION]: "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "modern-client", version: "2.0" },
      };

      assert.equal(LATEST_PROTOCOL_VERSION, "2026-07-28");
      assert.deepEqual([...MODERN_PROTOCOL_VERSIONS], ["2026-07-28"]);
      assert.deepEqual([...LEGACY_PROTOCOL_VERSIONS], [
        "2025-11-25",
        "2025-06-18",
        "2025-03-26",
        "2024-11-05",
      ]);

      // server/discover advertises versions, capabilities, serverInfo, and cache hints
      const discovered = await server.handleMessage({
        jsonrpc: "2.0",
        id: "disc-1",
        method: "server/discover",
        params: { _meta: modernMeta },
      });
      assert.equal(discovered.jsonrpc, "2.0");
      assert.equal(discovered.id, "disc-1");
      assert.equal(discovered.result.resultType, "complete");
      assert.deepEqual(discovered.result.supportedVersions, [...SUPPORTED_PROTOCOL_VERSIONS]);
      assert.deepEqual(discovered.result.protocolVersions, [...SUPPORTED_PROTOCOL_VERSIONS]);
      assert.deepEqual(discovered.result.capabilities, { tools: { listChanged: false } });
      assert.equal(discovered.result.cacheScope, "public");
      assert.ok(Number.isInteger(discovered.result.ttlMs) && discovered.result.ttlMs > 0);
      assert.equal(discovered.result.instructions, "Use PrivaTools tools for file processing.");
      for (const info of [
        discovered.result.serverInfo,
        discovered.result._meta[META_SERVER_INFO],
      ]) {
        assert.equal(info.name, "@privatools/mcp");
        assert.equal(info.version, "0.1.0");
        assert.equal(info.title, "PrivaTools");
        assert.match(info.description, /PrivaTools/);
        assert.equal(info.websiteUrl, "https://privatools.me");
        assert.equal(info.icons.length, 1);
        assert.equal(info.icons[0].src, "https://privatools.me/icons/icon-512.png");
      }

      // tools/list under 2026-07-28 returns resultType, cache hints, and _meta serverInfo
      const listed = await server.handleMessage({
        jsonrpc: "2.0",
        id: "list-1",
        method: "tools/list",
        params: { _meta: modernMeta },
      });
      assert.equal(listed.result.resultType, "complete");
      assert.equal(listed.result.cacheScope, "public");
      assert.ok(Number.isInteger(listed.result.ttlMs) && listed.result.ttlMs >= 0);
      assert.equal(listed.result._meta[META_SERVER_INFO].name, "@privatools/mcp");
      assert.equal(listed.result.tools.length, 6);

      // tools/call under 2026-07-28 returns resultType, structuredContent, content, and _meta
      const calledRaw = await server.handleMessage({
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "privatools_list_tools",
          arguments: { query: "compress", limit: 5 },
          _meta: modernMeta,
        },
      });
      const called = parseToolPayload(calledRaw);
      assert.equal(called.isError, false);
      assert.equal(called.resultType, "complete");
      assert.equal(called.meta[META_SERVER_INFO].name, "@privatools/mcp");
      assert.equal(called.structuredContent.ok, true);
      assert.ok(called.structuredContent.operations.some((op) => op.operation === "compress"));

      // Unsupported _meta protocol version returns -32022 with { supported, requested }
      const mismatch = await server.handleMessage({
        jsonrpc: "2.0",
        id: "bad-ver-1",
        method: "tools/list",
        params: {
          _meta: {
            [META_PROTOCOL_VERSION]: "1999-01-01",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      });
      assert.equal(mismatch.id, "bad-ver-1");
      assert.equal(mismatch.error.code, ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION);
      assert.equal(mismatch.error.code, -32022);
      assert.equal(mismatch.error.data.requested, "1999-01-01");
      assert.deepEqual(mismatch.error.data.supported, [...SUPPORTED_PROTOCOL_VERSIONS]);

      // server/discover also validates _meta protocol version
      const discoverMismatch = await server.handleMessage({
        jsonrpc: "2.0",
        id: "bad-ver-2",
        method: "server/discover",
        params: {
          _meta: { [META_PROTOCOL_VERSION]: "2099-12-31" },
        },
      });
      assert.equal(discoverMismatch.error.code, -32022);
      assert.equal(discoverMismatch.error.data.requested, "2099-12-31");
      assert.deepEqual(discoverMismatch.error.data.supported, [...SUPPORTED_PROTOCOL_VERSIONS]);
    });

    it("handles legacy initialize negotiation across 2025-11-25..2024-11-05, notifications/initialized, ping, and 6 separated tools", async () => {
      const server = makeServer();

      for (const rev of LEGACY_PROTOCOL_VERSIONS) {
        const initRes = await server.handleMessage({
          jsonrpc: "2.0",
          id: `init-${rev}`,
          method: "initialize",
          params: {
            protocolVersion: rev,
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0" },
          },
        });
        assert.equal(initRes.jsonrpc, "2.0");
        assert.equal(initRes.result.protocolVersion, rev);
        assert.equal(initRes.result.resultType, undefined);
        assert.equal(initRes.result.serverInfo.name, "@privatools/mcp");
        assert.deepEqual(initRes.result.capabilities.tools, { listChanged: false });
        if (rev === "2025-11-25") {
          assert.equal(initRes.result.serverInfo.title, "PrivaTools");
          assert.equal(initRes.result.serverInfo.websiteUrl, "https://privatools.me");
          assert.equal(initRes.result.serverInfo.icons.length, 1);
        } else if (rev === "2025-06-18") {
          assert.equal(initRes.result.serverInfo.title, "PrivaTools");
          assert.equal(initRes.result.serverInfo.icons, undefined);
        } else {
          assert.equal(initRes.result.serverInfo.title, undefined);
        }
      }

      const initFuture = await server.handleMessage({
        jsonrpc: "2.0",
        id: "init-future",
        method: "initialize",
        params: { protocolVersion: "2099-01-01" },
      });
      assert.equal(initFuture.result.protocolVersion, LATEST_LEGACY_PROTOCOL_VERSION);
      assert.equal(initFuture.result.protocolVersion, "2025-11-25");

      const notif = await server.handleMessage({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });
      assert.equal(notif, null);

      const pong = await server.handleMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "ping",
      });
      assert.deepEqual(pong, { jsonrpc: "2.0", id: 2, result: {} });

      const listed = await server.handleMessage({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
      });
      assert.equal(listed.result.resultType, undefined);
      const names = listed.result.tools.map((t) => t.name);
      assert.deepEqual(names, [
        "privatools_list_tools",
        "privatools_describe_tool",
        "privatools_run_tool",
        "privatools_submit_job",
        "privatools_job_status",
        "privatools_delete_job",
      ]);

      const expectedMeta = {
        privatools_list_tools: {
          title: "Search PrivaTools Operations",
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        privatools_describe_tool: {
          title: "Inspect PrivaTools Operation Schema",
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        privatools_run_tool: {
          title: "Run PrivaTools File Operation",
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
        },
        privatools_submit_job: {
          title: "Submit Async PrivaTools Job",
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
        },
        privatools_job_status: {
          title: "Check or Download PrivaTools Job",
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        privatools_delete_job: {
          title: "Delete PrivaTools Async Job",
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
      };

      for (const tool of listed.result.tools) {
        assert.ok(tool.name.length <= 64);
        assert.equal(tool.title, expectedMeta[tool.name].title);
        assert.deepEqual(tool.annotations, expectedMeta[tool.name].annotations);
        assert.equal(tool.inputSchema.type, "object");
        assert.equal(tool.outputSchema.type, "object");
        assert.ok(tool.description.length > 10);
      }

      const runTool = listed.result.tools.find((t) => t.name === "privatools_run_tool");
      assert.doesNotMatch(runTool.description, /openapi\.json/i);
      assert.doesNotMatch(runTool.description, /https?:\/\/\S*privatools\.me/i);

      const statusTool = listed.result.tools.find((t) => t.name === "privatools_job_status");
      assert.deepEqual(statusTool.inputSchema.properties.action.enum, ["status", "download"]);
      assert.equal(statusTool.inputSchema.properties.delete_after_download, undefined);
    });

    it("returns SEP-1303 Tool Execution Errors (isError: true) for input validation failures", async () => {
      const server = makeServer();
      const modernMeta = { [META_PROTOCOL_VERSION]: "2026-07-28" };

      const cases = [
        {
          label: "missing required argument",
          name: "privatools_describe_tool",
          args: {},
        },
        {
          label: "unknown argument rejected by additionalProperties: false",
          name: "privatools_list_tools",
          args: { bogus_arg: 123 },
        },
        {
          label: "invalid enum value",
          name: "privatools_list_tools",
          args: { mode: "turbo" },
        },
        {
          label: "out of range integer",
          name: "privatools_list_tools",
          args: { limit: 0 },
        },
        {
          label: "wrong argument type",
          name: "privatools_delete_job",
          args: { job_id: 42 },
        },
        {
          label: "disallowed delete action on read-only privatools_job_status",
          name: "privatools_job_status",
          args: { job_id: "job_1", action: "delete" },
        },
        {
          label: "removed delete_after_download on read-only privatools_job_status",
          name: "privatools_job_status",
          args: { job_id: "job_1", delete_after_download: true },
        },
      ];

      for (const tc of cases) {
        const res = await server.handleMessage({
          jsonrpc: "2.0",
          id: tc.label,
          method: "tools/call",
          params: { name: tc.name, arguments: tc.args, _meta: modernMeta },
        });
        assert.equal(res.error, undefined, `${tc.label} must not return a JSON-RPC protocol error`);
        const parsed = parseToolPayload(res);
        assert.equal(parsed.isError, true, `${tc.label} must return isError: true`);
        assert.equal(parsed.resultType, "complete");
        assert.equal(parsed.payload.ok, false);
        assert.equal(parsed.payload.error.code, "invalid_arguments");
      }
    });

    it("returns standard JSON-RPC error codes for parse errors, invalid requests, unknown methods, and unknown tools", async () => {
      const server = makeServer();

      const parseErr = await server.handleRawLine("{not-json");
      assert.equal(parseErr.error.code, ERROR_CODES.PARSE_ERROR);
      assert.equal(parseErr.id, null);

      const badVer = await server.handleMessage({
        jsonrpc: "1.0",
        id: 10,
        method: "ping",
      });
      assert.equal(badVer.error.code, ERROR_CODES.INVALID_REQUEST);
      assert.equal(badVer.id, 10);

      const emptyBatch = await server.handleMessage([]);
      assert.equal(emptyBatch.error.code, ERROR_CODES.INVALID_REQUEST);

      const unknownMethod = await server.handleMessage({
        jsonrpc: "2.0",
        id: 11,
        method: "resources/read",
      });
      assert.equal(unknownMethod.error.code, ERROR_CODES.METHOD_NOT_FOUND);
      assert.equal(unknownMethod.id, 11);

      const unknownTool = await server.handleMessage({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "nonexistent_tool", arguments: {} },
      });
      assert.equal(unknownTool.error.code, ERROR_CODES.INVALID_PARAMS);
      assert.match(unknownTool.error.message, /Unknown tool/);

      const badArgs = await server.handleMessage({
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: { name: "privatools_list_tools", arguments: "not-an-object" },
      });
      assert.equal(badArgs.error.code, ERROR_CODES.INVALID_PARAMS);

      // Unknown notifications must be silently ignored (JSON-RPC 2.0).
      const unknownNotif = await server.handleMessage({
        jsonrpc: "2.0",
        method: "notifications/custom",
      });
      assert.equal(unknownNotif, null);
    });

    it("rejects JSON-RPC batching for >=2025-06-18 while keeping 2025-03-26/2024-11-05 compat and oversized guards", async () => {
      const server = makeServer();

      // Generous protocol defaults accept large legitimate legacy batches and stdio frames.
      assert.ok(MAX_BATCH_SIZE >= 256);
      assert.ok(MAX_LINE_BYTES >= 16 * 1024 * 1024);
      assert.ok(MAX_CONCURRENT_REQUESTS >= 32);

      // Default stateless (2026-07-28) rejects batching cleanly.
      const defaultBatchErr = await server.handleMessage([
        { jsonrpc: "2.0", id: 1, method: "ping" },
      ]);
      assert.equal(defaultBatchErr.error.code, ERROR_CODES.INVALID_REQUEST);
      assert.match(defaultBatchErr.error.message, /batching is not supported/i);

      // Negotiating 2025-11-25 or 2025-06-18 still rejects batching.
      for (const noBatchRev of ["2025-11-25", "2025-06-18"]) {
        await server.handleMessage({
          jsonrpc: "2.0",
          id: `nb-${noBatchRev}`,
          method: "initialize",
          params: { protocolVersion: noBatchRev },
        });
        const rejected = await server.handleMessage([
          { jsonrpc: "2.0", id: 1, method: "ping" },
        ]);
        assert.equal(rejected.error.code, ERROR_CODES.INVALID_REQUEST);
        assert.match(rejected.error.message, new RegExp(noBatchRev));
      }

      // Negotiating 2025-03-26 allows legacy batching (unless a batch item uses modern _meta).
      await server.handleMessage({
        jsonrpc: "2.0",
        id: "legacy-batch-init",
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      });

      const modernInBatch = await server.handleMessage([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: { _meta: { [META_PROTOCOL_VERSION]: "2026-07-28" } },
        },
      ]);
      assert.equal(modernInBatch.error.code, ERROR_CODES.INVALID_REQUEST);
      assert.match(modernInBatch.error.message, /batching is not supported/i);

      // Valid small legacy batch succeeds under 2025-03-26.
      const smallBatch = await server.handleMessage([
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "ping" },
      ]);
      assert.ok(Array.isArray(smallBatch));
      assert.equal(smallBatch.length, 2);
      assert.deepEqual(smallBatch[0], { jsonrpc: "2.0", id: 1, result: {} });
      assert.deepEqual(smallBatch[1], { jsonrpc: "2.0", id: 2, result: {} });

      // Oversized legacy batch exceeding MAX_BATCH_SIZE is rejected with INVALID_REQUEST.
      const oversizedBatch = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => ({
        jsonrpc: "2.0",
        id: i + 1,
        method: "ping",
      }));
      const batchErr = await server.handleMessage(oversizedBatch);
      assert.equal(batchErr.jsonrpc, "2.0");
      assert.equal(batchErr.id, null);
      assert.equal(batchErr.error.code, ERROR_CODES.INVALID_REQUEST);
      assert.match(batchErr.error.message, /batch size/i);

      // Oversized line rejected in handleRawLine and over serveStdio without breaking later lines.
      const tightServer = createMcpServer({
        name: "@privatools/mcp",
        version: "0.1.0",
        tools: [],
        maxLineBytes: 256,
      });
      const hugeLine = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
        params: { pad: "x".repeat(512) },
      });
      const rawLineErr = await tightServer.handleRawLine(hugeLine);
      assert.equal(rawLineErr.error.code, ERROR_CODES.INVALID_REQUEST);
      assert.match(rawLineErr.error.message, /maximum allowed size/i);

      const input = new PassThrough();
      const output = new PassThrough();
      let outText = "";
      output.on("data", (chunk) => {
        outText += chunk.toString("utf8");
      });
      const session = tightServer.serveStdio({ input, output });
      input.write(hugeLine + "\n");
      input.write(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "ping" }) + "\n");
      input.end();
      await session.done;

      const outLines = outText.trim().split("\n").map((l) => JSON.parse(l));
      assert.equal(outLines.length, 2);
      assert.equal(outLines[0].error.code, ERROR_CODES.INVALID_REQUEST);
      assert.match(outLines[0].error.message, /maximum allowed size/i);
      assert.deepEqual(outLines[1], { jsonrpc: "2.0", id: 99, result: {} });
    });
  });

  describe("Discovery tools (list & describe)", () => {
    it("filters live catalog by query, category, and mode, and describes tool schemas with resolved $refs", async () => {
      const client = createPrivaToolsClient({ baseUrl, catalogTtlMs: 0 });
      const server = createMcpServer({ tools: createPrivaToolsTools(client) });

      const allRes = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "privatools_list_tools", arguments: {} },
        })
      );
      assert.equal(allRes.isError, false);
      assert.equal(allRes.payload.source, "live-operations");
      assert.equal(allRes.payload.total, 5);
      assert.equal(allRes.payload.async_available, true);

      const asyncRes = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "privatools_list_tools", arguments: { mode: "async" } },
        })
      );
      assert.deepEqual(
        asyncRes.payload.operations.map((o) => o.operation),
        ["compress", "merge"]
      );

      const catRes = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "privatools_list_tools",
            arguments: { category: "accessibility" },
          },
        })
      );
      assert.deepEqual(
        catRes.payload.operations.map((o) => o.operation),
        ["accessibility-check"]
      );

      // Describe via alias ('compress-pdf' -> 'compress')
      const descRes = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "privatools_describe_tool",
            arguments: { operation: "compress-pdf" },
          },
        })
      );
      assert.equal(descRes.isError, false);
      assert.equal(descRes.payload.operation, "compress");
      assert.equal(descRes.payload.method, "POST");
      assert.equal(descRes.payload.upload_fields.length, 1);
      assert.equal(descRes.payload.upload_fields[0].name, "files");
      assert.equal(descRes.payload.upload_fields[0].multiple, true);
      assert.ok(
        descRes.payload.form_fields.some(
          (f) => f.name === "level" && Array.isArray(f.enum)
        )
      );
      assert.deepEqual(descRes.payload.response_media, [
        "application/pdf",
        "application/zip",
      ]);

      // Browser-only tool returns a clear error
      const browserOnly = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: {
            name: "privatools_describe_tool",
            arguments: { operation: "regex-tester" },
          },
        })
      );
      assert.equal(browserOnly.isError, true);
      assert.equal(browserOnly.payload.error.code, "operation_browser_only");
    });

    it("falls back to /openapi.json when /operations is absent and to bundled metadata when offline", async () => {
      mockApi.setOperationsEnabled(false);
      try {
        const openApiClient = createPrivaToolsClient({ baseUrl, catalogTtlMs: 0 });
        const openApiServer = createMcpServer({
          tools: createPrivaToolsTools(openApiClient),
        });
        const res = parseToolPayload(
          await openApiServer.handleMessage({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "privatools_list_tools", arguments: { query: "compress" } },
          })
        );
        assert.equal(res.payload.source, "live-openapi");
        assert.equal(res.payload.operations[0].operation, "compress");
      } finally {
        mockApi.setOperationsEnabled(true);
      }

      // Offline bundled fallback using operation_metadata.json
      const offlineClient = createPrivaToolsClient({
        baseUrl: "http://127.0.0.1:1/api/v1",
        timeoutMs: 500,
        catalogTtlMs: 0,
        fetchImpl: async () => {
          throw new Error("ECONNREFUSED");
        },
      });
      const offlineServer = createMcpServer({
        tools: createPrivaToolsTools(offlineClient),
      });
      const bundledMeta = loadBundledMetadata();
      const opKeys = Object.keys(bundledMeta.operations);
      assert.equal(opKeys.length, 145);
      assert.ok(bundledMeta.operations["/accessibility-fix"]);
      assert.ok(bundledMeta.operations["/remove-video-watermark"]);
      assert.equal(bundledMeta.unavailable_tools.length, 37);
      const uniqueAliases = new Set(
        Object.values(bundledMeta.operations).flatMap((op) => op.tool_aliases ?? [])
      );
      assert.equal(uniqueAliases.size + bundledMeta.unavailable_tools.length, 229);

      const listOffline = parseToolPayload(
        await offlineServer.handleMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "privatools_list_tools",
            arguments: { query: "watermark" },
          },
        })
      );
      assert.equal(listOffline.isError, false);
      assert.equal(listOffline.payload.source, "bundled-fallback");
      assert.ok(
        listOffline.payload.operations.some(
          (op) => op.operation === "remove-watermark/detect"
        )
      );
    });
  });

  describe("Synchronous execution (privatools_run_tool)", () => {
    it("saves binary output without clobbering existing files unless overwrite: true, and returns X-* headers", async () => {
      const client = createPrivaToolsClient({
        baseUrl,
        apiKey: "secret-api-key-xyz",
        allowedDirs: [allowedDir],
      });
      const server = createMcpServer({ tools: createPrivaToolsTools(client) });

      const explicitOut = path.join(allowedDir, "compressed-out.pdf");
      mockApi.recorded.length = 0;

      const first = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: {
              operation: "compress",
              file_path: pdfA,
              params: { level: "extreme" },
              output_path: explicitOut,
            },
          },
        })
      );
      assert.equal(first.isError, false);
      assert.equal(first.payload.output_path, await fs.promises.realpath(explicitOut));
      assert.equal(first.payload.bytes, FAKE_OUTPUT_PDF.length);
      assert.equal(first.payload.media_type, "application/pdf");
      assert.equal(first.payload.headers["X-Target-Met"], "true");
      assert.equal(first.payload.headers["X-RateLimit-Remaining"], "499");
      assert.equal(first.payload.headers["X-Request-ID"], "req-compress-1");
      assert.equal(first.payload.headers["X-Content-Type-Options"], undefined);
      assert.deepEqual(await fs.promises.readFile(explicitOut), FAKE_OUTPUT_PDF);

      // Verify X-API-Key forwarding and schema-driven upload field ('files')
      const postReq = mockApi.recorded.find((r) => r.pathname === "/api/v1/compress");
      assert.equal(postReq.headers["x-api-key"], "secret-api-key-xyz");
      assert.equal(postReq.multipart.fields.level, "extreme");
      assert.equal(postReq.multipart.files.length, 1);
      assert.equal(postReq.multipart.files[0].field, "files");

      // Second call to same explicit output_path without overwrite must fail and NOT clobber
      await fs.promises.writeFile(explicitOut, Buffer.from("KEEP-ME"));
      const blocked = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: {
              operation: "compress",
              file_path: pdfA,
              output_path: explicitOut,
            },
          },
        })
      );
      assert.equal(blocked.isError, true);
      assert.equal(blocked.payload.error.code, "output_exists");
      assert.equal((await fs.promises.readFile(explicitOut, "utf8")), "KEEP-ME");

      // Explicit overwrite: true succeeds
      const overwritten = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: {
              operation: "repair",
              file_path: pdfA,
              output_path: explicitOut,
              overwrite: true,
            },
          },
        })
      );
      assert.equal(overwritten.isError, false);
      assert.equal(overwritten.payload.headers["X-Repair-Pages"], "12/12");
      assert.equal(overwritten.payload.headers["X-Bates-Next"], "0013");
      assert.equal(overwritten.payload.headers["X-Accessibility-Score-Before"], "62");
      assert.equal(overwritten.payload.headers["X-Accessibility-Score-After"], "96");
      assert.deepEqual(await fs.promises.readFile(explicitOut), FAKE_OUTPUT_PDF);

      // Auto-naming next to input never clobbers an existing auto-named file
      const auto1 = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: { operation: "compress", file_path: pdfA },
          },
        })
      );
      const auto2 = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: { operation: "compress", file_path: pdfA },
          },
        })
      );
      assert.equal(auto1.isError, false);
      assert.equal(auto2.isError, false);
      assert.notEqual(auto1.payload.output_path, auto2.payload.output_path);
      assert.match(path.basename(auto1.payload.output_path), /^doc-a-compress\.pdf$/);
      assert.match(path.basename(auto2.payload.output_path), /^doc-a-compress-1\.pdf$/);
    });

    it("returns JSON inline for JSON-returning endpoints and handles multi-file uploads", async () => {
      const client = createPrivaToolsClient({
        baseUrl,
        allowedDirs: [allowedDir],
      });
      const server = createMcpServer({ tools: createPrivaToolsTools(client) });
      mockApi.recorded.length = 0;

      // JSON response inline (/accessibility-check) and no X-API-Key when unset
      const a11y = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: {
              operation: "accessibility-check",
              file_path: pdfA,
            },
          },
        })
      );
      assert.equal(a11y.isError, false);
      assert.equal(a11y.payload.media_type, "application/json");
      assert.equal(a11y.payload.data.score, 88);
      assert.equal(a11y.payload.output_path, undefined);

      const a11yReq = mockApi.recorded.find(
        (r) => r.pathname === "/api/v1/accessibility-check"
      );
      assert.equal(a11yReq.headers["x-api-key"], undefined);
      assert.equal(a11yReq.multipart.files[0].field, "file");

      // Multi-file upload (/merge with repeated 'files' + JSON array param)
      const mergedOut = path.join(allowedDir, "merged-out.pdf");
      const merged = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: {
              operation: "merge",
              file_paths: [pdfA, pdfB],
              params: { page_ranges: ["1", "all"] },
              output_path: mergedOut,
            },
          },
        })
      );
      assert.equal(merged.isError, false);
      const mergeReq = mockApi.recorded.find((r) => r.pathname === "/api/v1/merge");
      assert.equal(mergeReq.multipart.files.length, 2);
      assert.deepEqual(
        mergeReq.multipart.files.map((f) => f.field),
        ["files", "files"]
      );
      assert.equal(mergeReq.multipart.fields.page_ranges, '["1","all"]');

      // Named multi-file fields (/compare -> file1, file2) returning JSON when mode='text'
      const compared = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: {
              operation: "compare",
              file_paths: [pdfA, pdfB],
              params: { mode: "text" },
            },
          },
        })
      );
      assert.equal(compared.isError, false);
      assert.equal(compared.payload.data.differences, 2);
      const cmpReq = mockApi.recorded.find((r) => r.pathname === "/api/v1/compare");
      assert.deepEqual(
        cmpReq.multipart.files.map((f) => f.field),
        ["file1", "file2"]
      );
    });

    it("enforces PRIVATOOLS_MCP_ALLOWED_DIRS against traversal, sibling prefix, symlinks, and null bytes", async () => {
      const client = createPrivaToolsClient({
        baseUrl,
        allowedDirs: [allowedDir],
      });
      const server = createMcpServer({ tools: createPrivaToolsTools(client) });

      // Direct outside input
      const outsideRes = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: { operation: "compress", file_path: outsidePdf },
          },
        })
      );
      assert.equal(outsideRes.isError, true);
      assert.equal(outsideRes.payload.error.code, "path_not_allowed");

      // Traversal via '..'
      const traversalPath = path.join(allowedDir, "..", "outside", "secret.pdf");
      const traversalRes = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: { operation: "compress", file_path: traversalPath },
          },
        })
      );
      assert.equal(traversalRes.isError, true);
      assert.equal(traversalRes.payload.error.code, "path_not_allowed");

      // Sibling prefix trick (/tmp/.../allowed-evil/sibling.pdf)
      const siblingRes = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: {
              operation: "compress",
              file_path: path.join(siblingEvilDir, "sibling.pdf"),
            },
          },
        })
      );
      assert.equal(siblingRes.isError, true);
      assert.equal(siblingRes.payload.error.code, "path_not_allowed");

      // Symlink inside allowedDir pointing outside
      const escapeLink = path.join(allowedDir, "escape-link.pdf");
      await fs.promises.symlink(outsidePdf, escapeLink);
      const symlinkRes = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: { operation: "compress", file_path: escapeLink },
          },
        })
      );
      assert.equal(symlinkRes.isError, true);
      assert.equal(symlinkRes.payload.error.code, "path_not_allowed");

      // Output path outside allowedDir
      const outsideOutRes = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: {
              operation: "compress",
              file_path: pdfA,
              output_path: path.join(outsideDir, "pwned.pdf"),
            },
          },
        })
      );
      assert.equal(outsideOutRes.isError, true);
      assert.equal(outsideOutRes.payload.error.code, "path_not_allowed");

      // Null byte in path
      const nullByteRes = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: { operation: "compress", file_path: `${pdfA}\0.pdf` },
          },
        })
      );
      assert.equal(nullByteRes.isError, true);
      assert.equal(nullByteRes.payload.error.code, "invalid_path");

      // Dangling symlink inside allowedDir pointing outside must be blocked for output
      const danglingEscape = path.join(allowedDir, "dangling-out.pdf");
      await fs.promises.symlink(
        path.join(outsideDir, "never-write-here.pdf"),
        danglingEscape
      );
      const danglingOutRes = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: {
              operation: "compress",
              file_path: pdfA,
              output_path: danglingEscape,
              overwrite: true,
            },
          },
        })
      );
      assert.equal(danglingOutRes.isError, true);
      assert.equal(danglingOutRes.payload.error.code, "path_not_allowed");

      // Dangling leaf symlink pointing outside must also be rejected as input
      const danglingInputRes = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 8,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: {
              operation: "compress",
              file_path: danglingEscape,
            },
          },
        })
      );
      assert.equal(danglingInputRes.isError, true);
      assert.equal(danglingInputRes.payload.error.code, "path_not_allowed");

      // Dangling intermediate directory symlink inside allowedDir pointing outside must be blocked
      const danglingDirLink = path.join(allowedDir, "dangling-dir-link");
      const outsideMissingDir = path.join(outsideDir, "missing-subdir");
      await fs.promises.symlink(outsideMissingDir, danglingDirLink);
      const danglingIntermediateRes = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: {
              operation: "compress",
              file_path: pdfA,
              output_path: path.join(danglingDirLink, "nested", "escape.pdf"),
              overwrite: true,
            },
          },
        })
      );
      assert.equal(danglingIntermediateRes.isError, true);
      assert.equal(danglingIntermediateRes.payload.error.code, "path_not_allowed");
      assert.equal(fs.existsSync(outsideMissingDir), false);

      // Auto-named output colliding with a pre-existing symlink pointing outside allowedDir (with overwrite: true) must be rejected
      const autoCollisionInput = path.join(allowedDir, "auto-target.pdf");
      await fs.promises.writeFile(autoCollisionInput, FAKE_PDF_A);
      const outsideVictim = path.join(outsideDir, "victim.pdf");
      await fs.promises.writeFile(outsideVictim, Buffer.from("ORIGINAL-OUTSIDE-SECRET"));
      const autoCollisionLink = path.join(allowedDir, "auto-target-compress.pdf");
      await fs.promises.symlink(outsideVictim, autoCollisionLink);

      const autoCollisionRes = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 10,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: {
              operation: "compress",
              file_path: autoCollisionInput,
              overwrite: true,
            },
          },
        })
      );
      assert.equal(autoCollisionRes.isError, true);
      assert.equal(autoCollisionRes.payload.error.code, "path_not_allowed");
      assert.equal(
        await fs.promises.readFile(outsideVictim, "utf8"),
        "ORIGINAL-OUTSIDE-SECRET"
      );

      // Auto-named output colliding with an in-sandbox symlink (with overwrite: true) must also refuse to follow the symlink
      const insideVictim = path.join(allowedDir, "inside-victim.pdf");
      await fs.promises.writeFile(insideVictim, Buffer.from("KEEP-INSIDE"));
      const autoInsideInput = path.join(allowedDir, "auto-inside.pdf");
      await fs.promises.writeFile(autoInsideInput, FAKE_PDF_A);
      const autoInsideLink = path.join(allowedDir, "auto-inside-compress.pdf");
      await fs.promises.symlink(insideVictim, autoInsideLink);

      const autoInsideRes = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 11,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: {
              operation: "compress",
              file_path: autoInsideInput,
              overwrite: true,
            },
          },
        })
      );
      assert.equal(autoInsideRes.isError, true);
      assert.equal(autoInsideRes.payload.error.code, "invalid_path");
      assert.equal(await fs.promises.readFile(insideVictim, "utf8"), "KEEP-INSIDE");
    });

    it("propagates structured API errors without leaking secrets", async () => {
      const authFailClient = createPrivaToolsClient({
        baseUrl,
        apiKey: "bad-key",
        allowedDirs: [allowedDir],
      });
      const authServer = createMcpServer({
        tools: createPrivaToolsTools(authFailClient),
      });

      const unauth = parseToolPayload(
        await authServer.handleMessage({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: { operation: "compress", file_path: pdfA },
          },
        })
      );
      assert.equal(unauth.isError, true);
      assert.equal(unauth.payload.error.status, 401);
      assert.equal(unauth.payload.error.code, "invalid_api_key");
      assert.equal(unauth.payload.error.request_id, "req-auth-401");
      assert.ok(!JSON.stringify(unauth.payload).includes("bad-key"));

      const okClient = createPrivaToolsClient({
        baseUrl,
        apiKey: "good-key",
        allowedDirs: [allowedDir],
      });
      const rateServer = createMcpServer({
        tools: createPrivaToolsTools(okClient),
      });
      const rateLimited = parseToolPayload(
        await rateServer.handleMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: { operation: "rate-limited", file_path: pdfA },
          },
        })
      );
      assert.equal(rateLimited.isError, true);
      assert.equal(rateLimited.payload.error.status, 429);
      assert.equal(rateLimited.payload.error.code, "rate_limit_exceeded");
      assert.equal(rateLimited.payload.error.retry_after, "15");
      assert.equal(rateLimited.payload.error.request_id, "req-429");

      // Sensitive keys, headers, Bearer tokens, and API key values in validation error details must be redacted
      const leakyClient = createPrivaToolsClient({
        baseUrl,
        apiKey: "super-secret-api-key-987",
        allowedDirs: [allowedDir],
      });
      const leakyServer = createMcpServer({
        tools: createPrivaToolsTools(leakyClient),
      });
      const leakyErr = parseToolPayload(
        await leakyServer.handleMessage({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: { operation: "leaky-validation-error", file_path: pdfA },
          },
        })
      );
      assert.equal(leakyErr.isError, true);
      assert.equal(leakyErr.payload.error.status, 422);
      const serialized = JSON.stringify(leakyErr.payload);
      assert.ok(!serialized.includes("super-secret-api-key-987"));
      assert.ok(!serialized.includes("topsecret-bearer-token"));
      assert.ok(!serialized.includes("another-secret-tok"));
      assert.ok(!serialized.includes("super-secret-cookie"));
      assert.ok(!serialized.includes("pdf-owner-password-999"));
      assert.ok(!serialized.includes("client-sec-123"));
      assert.equal(leakyErr.payload.error.details[0].input, "[REDACTED]");
      assert.equal(leakyErr.payload.error.details[1].headers["X-API-Key"], "[REDACTED]");
      assert.equal(leakyErr.payload.error.details[1].headers.Authorization, "[REDACTED]");
      assert.equal(leakyErr.payload.error.details[1].headers.Cookie, "[REDACTED]");
      assert.equal(leakyErr.payload.error.details[1].headers["Content-Type"], "application/json");
      assert.equal(leakyErr.payload.error.details[1].password, "[REDACTED]");
      assert.equal(leakyErr.payload.error.details[1].client_secret, "[REDACTED]");

      // Embedded URL credentials must never leak in baseUrl or network error messages
      const credClient = createPrivaToolsClient({
        baseUrl: "http://alice:embedded-url-pass@127.0.0.1:1/api/v1",
        apiKey: "cred-key-456",
        fetchImpl: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      });
      assert.ok(!credClient.baseUrl.includes("embedded-url-pass"));
      await assert.rejects(
        () => credClient.getJobStatus("job_1"),
        (err) => {
          assert.equal(err.code, "network_error");
          assert.ok(!err.message.includes("embedded-url-pass"));
          assert.ok(!err.message.includes("cred-key-456"));
          return true;
        }
      );
    });
  });

  describe("Async jobs (privatools_submit_job, privatools_job_status & privatools_delete_job)", () => {
    it("submits, polls, downloads binary artifact, enforces read/write separation, and deletes via privatools_delete_job", async () => {
      const client = createPrivaToolsClient({
        baseUrl,
        apiKey: "async-key",
        allowedDirs: [allowedDir],
      });
      const server = createMcpServer({ tools: createPrivaToolsTools(client) });

      const submitted = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "privatools_submit_job",
            arguments: {
              operation: "merge",
              file_paths: [pdfA, pdfB],
              options: {},
              idempotency_key: "test-merge-001",
            },
          },
        })
      );
      assert.equal(submitted.isError, false);
      assert.equal(submitted.payload.idempotency_key, "test-merge-001");
      assert.equal(submitted.payload.job.state, "queued");
      const jobId = submitted.payload.job.id;

      // Poll 1: running
      const poll1 = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "privatools_job_status", arguments: { job_id: jobId } },
        })
      );
      assert.equal(poll1.payload.job.state, "running");

      // Poll 2: succeeded
      const poll2 = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "privatools_job_status", arguments: { job_id: jobId } },
        })
      );
      assert.equal(poll2.payload.job.state, "succeeded");

      // Download artifact to output_path
      const jobOut = path.join(allowedDir, "async-merged.pdf");
      const downloaded = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "privatools_job_status",
            arguments: {
              job_id: jobId,
              action: "download",
              output_path: jobOut,
            },
          },
        })
      );
      assert.equal(downloaded.isError, false);
      assert.equal(downloaded.payload.bytes, FAKE_OUTPUT_PDF.length);
      assert.deepEqual(await fs.promises.readFile(jobOut), FAKE_OUTPUT_PDF);

      // Strict read/write separation: privatools_job_status rejects action: 'delete'
      const rejectedDelete = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: {
            name: "privatools_job_status",
            arguments: { job_id: jobId, action: "delete" },
          },
        })
      );
      assert.equal(rejectedDelete.isError, true);
      assert.equal(rejectedDelete.payload.error.code, "invalid_arguments");

      // Explicit delete via dedicated destructive tool privatools_delete_job
      const deleted = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: {
            name: "privatools_delete_job",
            arguments: { job_id: jobId },
          },
        })
      );
      assert.equal(deleted.isError, false);
      assert.equal(deleted.payload.deletion.state, "canceled");
      assert.equal(deleted.payload.deletion.deletion_pending, false);

      // Downloading after deletion returns 410 job_result_expired
      const afterDelete = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: {
            name: "privatools_job_status",
            arguments: {
              job_id: jobId,
              action: "download",
              output_path: path.join(allowedDir, "should-not-exist.pdf"),
            },
          },
        })
      );
      assert.equal(afterDelete.isError, true);
      assert.equal(afterDelete.payload.error.status, 410);
      assert.equal(afterDelete.payload.error.code, "job_result_expired");
    });

    it("downloads JSON job artifacts inline via privatools_job_status and deletes via privatools_delete_job", async () => {
      const client = createPrivaToolsClient({
        baseUrl,
        apiKey: "async-key",
        allowedDirs: [allowedDir],
      });
      const server = createMcpServer({ tools: createPrivaToolsTools(client) });

      const submitted = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "privatools_submit_job",
            arguments: {
              operation: "pdf-to-text",
              file_path: pdfA,
            },
          },
        })
      );
      assert.equal(submitted.isError, false);
      assert.match(submitted.payload.idempotency_key, /^mcp-/);
      const jobId = submitted.payload.job.id;

      // Advance to succeeded
      await server.handleMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "privatools_job_status", arguments: { job_id: jobId } },
      });

      const fetched = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "privatools_job_status",
            arguments: {
              job_id: jobId,
              action: "status",
              download: true,
            },
          },
        })
      );
      assert.equal(fetched.isError, false);
      assert.equal(fetched.payload.job.state, "succeeded");
      assert.equal(fetched.payload.downloaded.data.text, "Hello world");

      // Delete explicitly using privatools_delete_job
      const del = parseToolPayload(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "privatools_delete_job",
            arguments: { job_id: jobId },
          },
        })
      );
      assert.equal(del.isError, false);
      assert.equal(del.payload.deletion.state, "canceled");
    });
  });

  describe("CLI & real stdio child-process round-trip", () => {
    it("supports --version, --help, and rejects unknown CLI flags cleanly", async () => {
      const runCli = (args) =>
        new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [BIN_PATH, ...args], {
            stdio: ["ignore", "pipe", "pipe"],
          });
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (d) => (stdout += d.toString()));
          child.stderr.on("data", (d) => (stderr += d.toString()));
          child.on("error", reject);
          child.on("close", (code) => resolve({ code, stdout, stderr }));
        });

      const ver = await runCli(["--version"]);
      assert.equal(ver.code, 0);
      assert.match(ver.stdout, /@privatools\/mcp 0\.1\.0/);
      assert.equal(ver.stderr, "");

      const help = await runCli(["--help"]);
      assert.equal(help.code, 0);
      assert.match(help.stdout, /PRIVATOOLS_API_URL/);
      assert.match(help.stdout, /PRIVATOOLS_MCP_ALLOWED_DIRS/);

      const bad = await runCli(["--unknown-flag"]);
      assert.equal(bad.code, 1);
      assert.match(bad.stderr, /Unknown argument/);
    });

    it("spawns bin/privatools-mcp.mjs and completes a full stdio JSON-RPC session", async () => {
      const child = spawn(process.execPath, [BIN_PATH], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PRIVATOOLS_API_URL: baseUrl,
          PRIVATOOLS_API_KEY: "stdio-test-key",
          PRIVATOOLS_MCP_ALLOWED_DIRS: allowedDir,
        },
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      const stdioOut = path.join(allowedDir, "stdio-compressed.pdf");
      const requests = [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "stdio-harness", version: "1.0.0" },
          },
        },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "ping" },
        { jsonrpc: "2.0", id: 3, method: "tools/list" },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: {
              operation: "compress",
              file_path: pdfA,
              output_path: stdioOut,
            },
          },
        },
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: {
            name: "privatools_run_tool",
            arguments: {
              operation: "accessibility-check",
              file_path: pdfA,
            },
          },
        },
        { jsonrpc: "2.0", id: 6, method: "unknown/method" },
      ];

      for (const req of requests) {
        child.stdin.write(JSON.stringify(req) + "\n");
      }
      child.stdin.end();

      const exitCode = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });

      assert.equal(exitCode, 0);
      assert.equal(stderr, "", "stderr should be silent unless debug is enabled");

      const lines = stdout
        .trim()
        .split("\n")
        .filter(Boolean);
      // 7 sent messages minus 1 notification = 6 responses
      assert.equal(lines.length, 6);

      const responses = new Map();
      for (const line of lines) {
        const msg = JSON.parse(line);
        assert.equal(msg.jsonrpc, "2.0");
        responses.set(msg.id, msg);
      }

      assert.equal(responses.get(1).result.protocolVersion, "2025-03-26");
      assert.deepEqual(responses.get(2).result, {});
      assert.equal(responses.get(3).result.tools.length, 6);

      const compressPayload = parseToolPayload(responses.get(4));
      assert.equal(compressPayload.isError, false);
      assert.equal(compressPayload.payload.bytes, FAKE_OUTPUT_PDF.length);
      assert.deepEqual(await fs.promises.readFile(stdioOut), FAKE_OUTPUT_PDF);

      const a11yPayload = parseToolPayload(responses.get(5));
      assert.equal(a11yPayload.isError, false);
      assert.equal(a11yPayload.payload.data.score, 88);

      assert.equal(responses.get(6).error.code, ERROR_CODES.METHOD_NOT_FOUND);
    });

    it("spawns bin/privatools-mcp.mjs and completes a stateless MCP 2026-07-28 stdio session", async () => {
      const child = spawn(process.execPath, [BIN_PATH], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PRIVATOOLS_API_URL: baseUrl,
          PRIVATOOLS_API_KEY: "stdio-modern-key",
          PRIVATOOLS_MCP_ALLOWED_DIRS: allowedDir,
        },
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      const meta = {
        [META_PROTOCOL_VERSION]: "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "stdio-2026", version: "1.0.0" },
      };

      const requests = [
        { jsonrpc: "2.0", id: "d1", method: "server/discover", params: { _meta: meta } },
        { jsonrpc: "2.0", id: "l1", method: "tools/list", params: { _meta: meta } },
        {
          jsonrpc: "2.0",
          id: "c1",
          method: "tools/call",
          params: {
            name: "privatools_describe_tool",
            arguments: { operation: "compress" },
            _meta: meta,
          },
        },
        {
          jsonrpc: "2.0",
          id: "e1",
          method: "tools/list",
          params: { _meta: { [META_PROTOCOL_VERSION]: "1999-01-01" } },
        },
        [{ jsonrpc: "2.0", id: "b1", method: "tools/list", params: { _meta: meta } }],
      ];

      for (const req of requests) {
        child.stdin.write(JSON.stringify(req) + "\n");
      }
      child.stdin.end();

      const exitCode = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });

      assert.equal(exitCode, 0);
      assert.equal(stderr, "", "stderr should be silent unless debug is enabled");

      const messages = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      assert.equal(messages.length, 5);

      const byId = new Map(messages.map((m) => [m.id, m]));
      const d1 = byId.get("d1");
      assert.equal(d1.result.resultType, "complete");
      assert.deepEqual(d1.result.supportedVersions, [...SUPPORTED_PROTOCOL_VERSIONS]);
      assert.equal(d1.result.serverInfo.title, "PrivaTools");
      assert.equal(d1.result.serverInfo.websiteUrl, "https://privatools.me");
      assert.equal(d1.result._meta[META_SERVER_INFO].icons[0].src, "https://privatools.me/icons/icon-512.png");

      const l1 = byId.get("l1");
      assert.equal(l1.result.resultType, "complete");
      assert.equal(l1.result.tools.length, 6);
      assert.equal(l1.result.cacheScope, "public");

      const c1 = parseToolPayload(byId.get("c1"));
      assert.equal(c1.isError, false);
      assert.equal(c1.resultType, "complete");
      assert.equal(c1.structuredContent.operation, "compress");

      const e1 = byId.get("e1");
      assert.equal(e1.error.code, -32022);
      assert.equal(e1.error.data.requested, "1999-01-01");

      const batchErr = byId.get(null);
      assert.equal(batchErr.error.code, ERROR_CODES.INVALID_REQUEST);
      assert.match(batchErr.error.message, /batching is not supported/i);
    });
  });
});
