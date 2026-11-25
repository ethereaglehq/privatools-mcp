import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createPrivaToolsClient } from "../src/client.mjs";
import {
  createMcpServer,
  META_PROTOCOL_VERSION,
} from "../src/protocol.mjs";
import {
  createPrivaToolsTools,
  SERVER_INSTRUCTIONS,
} from "../src/tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.resolve(__dirname, "../bin/privatools-mcp.mjs");

const FORBIDDEN_PATTERNS = [
  { label: "imperative 'call privatools_'", re: /\bcall\s+privatools_/i },
  { label: "imperative 'before calling'", re: /\bbefore\s+calling\b/i },
  { label: "directive 'always'", re: /\balways\b/i },
  { label: "directive 'you must'", re: /\byou\s+must\b/i },
  { label: "directive 'must call'", re: /\bmust\s+call\b/i },
  { label: "imperative 'use privatools_'", re: /\buse\s+privatools_/i },
  { label: "OpenAPI doc label", re: /full\s+openapi\s+documentation\s*:/i },
  { label: "OpenAPI URL", re: /openapi\.json/i },
  { label: "external doc URL in description", re: /https?:\/\/\S*privatools\.me/i },
  { label: "progressive step instruction", re: /\bstep\s+\d+\b/i },
];

const EXPECTED_TOOL_METADATA = {
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

function findViolations(text) {
  const hits = [];
  for (const { label, re } of FORBIDDEN_PATTERNS) {
    if (re.test(text)) {
      hits.push(`${label} (${re})`);
    }
  }
  return hits;
}

function collectSchemaDescriptions(node, trail = "", out = []) {
  if (!node || typeof node !== "object") {
    return out;
  }
  if (typeof node.description === "string") {
    out.push({ path: trail || "<root>", text: node.description });
  }
  if (Array.isArray(node)) {
    node.forEach((item, idx) =>
      collectSchemaDescriptions(item, `${trail}[${idx}]`, out)
    );
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "description") continue;
    if (value && typeof value === "object") {
      const nextTrail = trail ? `${trail}.${key}` : key;
      collectSchemaDescriptions(value, nextTrail, out);
    }
  }
  return out;
}

function assertPurelyDescriptiveTools(tools) {
  const expectedNames = Object.keys(EXPECTED_TOOL_METADATA);
  assert.deepEqual(
    tools.map((t) => t.name),
    expectedNames,
    "registered tool set must match expected 6 tools"
  );

  for (const tool of tools) {
    const expected = EXPECTED_TOOL_METADATA[tool.name];
    assert.ok(tool.name.length <= 64, `${tool.name} exceeds 64 chars`);
    assert.equal(
      tool.title,
      expected.title,
      `${tool.name} title must remain intact`
    );
    assert.deepEqual(
      tool.annotations,
      expected.annotations,
      `${tool.name} annotations must remain intact`
    );
    assert.equal(
      typeof tool.description,
      "string",
      `${tool.name} must define a string description`
    );
    assert.ok(
      tool.description.trim().length > 10,
      `${tool.name} description must be non-empty`
    );

    const descViolations = findViolations(tool.description);
    assert.deepEqual(
      descViolations,
      [],
      `${tool.name}.description contains forbidden imperative/URL language: ${descViolations.join(", ")}\nActual: ${tool.description}`
    );

    for (const schemaKey of ["inputSchema", "outputSchema"]) {
      const entries = collectSchemaDescriptions(tool[schemaKey], schemaKey);
      for (const entry of entries) {
        const schemaViolations = findViolations(entry.text);
        assert.deepEqual(
          schemaViolations,
          [],
          `${tool.name}.${entry.path}.description contains forbidden imperative/URL language: ${schemaViolations.join(", ")}\nActual: ${entry.text}`
        );
      }
    }
  }
}

function assertPurelyDescriptiveInstructions(instructions, sourceLabel) {
  assert.equal(
    typeof instructions,
    "string",
    `${sourceLabel} must be a string`
  );
  assert.ok(
    instructions.trim().length > 0,
    `${sourceLabel} must be non-empty`
  );
  const violations = findViolations(instructions);
  assert.deepEqual(
    violations,
    [],
    `${sourceLabel} contains forbidden imperative/URL language: ${violations.join(", ")}\nActual: ${instructions}`
  );
}

describe("MCP tool descriptions and server instructions compliance", () => {
  it("detects forbidden imperative cross-tool and OpenAPI URL patterns", () => {
    const badSamples = [
      "Progressive discovery step 1 before calling privatools_describe_tool.",
      "Call privatools_describe_tool first for parameter details.",
      "Read-only — use privatools_delete_job for deletion.",
      "Always inspect schemas first.",
      "You must validate inputs before uploading.",
      "Callers must call privatools_list_tools first.",
      "Full OpenAPI documentation: https://api.privatools.me/api/v1/openapi.json",
    ];
    for (const sample of badSamples) {
      assert.ok(
        findViolations(sample).length > 0,
        `expected violation matcher to reject: ${sample}`
      );
    }
  });

  it("ensures every registered tool description, schema description, title, annotation, and SERVER_INSTRUCTIONS are compliant", async () => {
    const client = createPrivaToolsClient({
      baseUrl: "http://127.0.0.1:1/api/v1",
    });
    const server = createMcpServer({
      instructions: SERVER_INSTRUCTIONS,
      tools: createPrivaToolsTools(client),
    });

    assertPurelyDescriptiveInstructions(SERVER_INSTRUCTIONS, "SERVER_INSTRUCTIONS");

    const listed = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    assertPurelyDescriptiveTools(listed.result.tools);

    const discovered = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "server/discover",
      params: { _meta: { [META_PROTOCOL_VERSION]: "2026-07-28" } },
    });
    assertPurelyDescriptiveInstructions(
      discovered.result.instructions,
      "server/discover instructions"
    );

    const initialized = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "compliance-test", version: "1.0.0" },
      },
    });
    assertPurelyDescriptiveInstructions(
      initialized.result.instructions,
      "initialize instructions"
    );
  });

  it("verifies live bin/privatools-mcp.mjs stdio server exposes compliant tool descriptions and instructions", async () => {
    const child = spawn(process.execPath, [BIN_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    const requests = [
      {
        jsonrpc: "2.0",
        id: "disc",
        method: "server/discover",
        params: { _meta: { [META_PROTOCOL_VERSION]: "2026-07-28" } },
      },
      {
        jsonrpc: "2.0",
        id: "init",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "compliance-stdio", version: "1.0.0" },
        },
      },
      { jsonrpc: "2.0", id: "list", method: "tools/list" },
    ];

    for (const req of requests) {
      child.stdin.write(JSON.stringify(req) + "\n");
    }
    child.stdin.end();

    const exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });

    assert.equal(exitCode, 0, `unexpected stderr: ${stderr}`);
    assert.equal(stderr, "");

    const byId = new Map(
      stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const msg = JSON.parse(line);
          return [msg.id, msg];
        })
    );

    assertPurelyDescriptiveInstructions(
      byId.get("disc").result.instructions,
      "stdio server/discover instructions"
    );
    assertPurelyDescriptiveInstructions(
      byId.get("init").result.instructions,
      "stdio initialize instructions"
    );
    assertPurelyDescriptiveTools(byId.get("list").result.tools);
  });
});
