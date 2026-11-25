export const JSONRPC_VERSION = "2.0";
export const MODERN_PROTOCOL_VERSIONS = Object.freeze(["2026-07-28"]);
export const LEGACY_PROTOCOL_VERSIONS = Object.freeze([
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
]);
export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([
  ...MODERN_PROTOCOL_VERSIONS,
  ...LEGACY_PROTOCOL_VERSIONS,
]);
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];
export const LATEST_LEGACY_PROTOCOL_VERSION = LEGACY_PROTOCOL_VERSIONS[0];

export const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
export const META_CLIENT_CAPABILITIES =
  "io.modelcontextprotocol/clientCapabilities";
export const META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo";
export const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

export const DEFAULT_DISCOVER_TTL_MS = 3_600_000;
export const DEFAULT_TOOLS_LIST_TTL_MS = 300_000;
export const DEFAULT_CACHE_SCOPE = "public";

export const MAX_BATCH_SIZE = 256;
export const MAX_LINE_BYTES = 16 * 1024 * 1024;
export const MAX_CONCURRENT_REQUESTS = 32;

const BATCHING_LEGACY_VERSIONS = new Set(["2025-03-26", "2024-11-05"]);

export const ERROR_CODES = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
});

export class JsonRpcError extends Error {
  constructor(code, message, data = undefined) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidId(id) {
  return (
    id === null ||
    typeof id === "string" ||
    (typeof id === "number" && Number.isFinite(id))
  );
}

export function makeSuccessResponse(id, result) {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    result,
  };
}

export function makeErrorResponse(id, code, message, data = undefined) {
  const error = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return {
    jsonrpc: JSONRPC_VERSION,
    id: isValidId(id) ? id : null,
    error,
  };
}

function formatToolError(err) {
  if (err && typeof err.toJSON === "function") {
    return { ok: false, error: err.toJSON() };
  }
  return {
    ok: false,
    error: {
      code: err?.code && typeof err.code === "string" ? err.code : "tool_error",
      message: err instanceof Error ? err.message : String(err),
    },
  };
}

function makeToolErrorResult(code, message, details = undefined) {
  const errObj = { code, message };
  if (details !== undefined) {
    errObj.details = details;
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: false, error: errObj }, null, 2),
      },
    ],
    isError: true,
  };
}

function matchesSchemaType(value, expectedType) {
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

function validateValueAgainstSchema(value, schema, fieldPath) {
  if (!isPlainObject(schema)) {
    return null;
  }

  if (schema.type !== undefined) {
    const allowedTypes = Array.isArray(schema.type)
      ? schema.type
      : [schema.type];
    const ok = allowedTypes.some((t) => matchesSchemaType(value, t));
    if (!ok) {
      return `'${fieldPath}' must be of type ${allowedTypes.join(" or ")}.`;
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return `'${fieldPath}' must be one of: ${schema.enum.join(", ")}.`;
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      return `'${fieldPath}' must be >= ${schema.minimum}.`;
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      return `'${fieldPath}' must be <= ${schema.maximum}.`;
    }
  }

  if (Array.isArray(value) && isPlainObject(schema.items)) {
    for (let i = 0; i < value.length; i += 1) {
      const itemErr = validateValueAgainstSchema(
        value[i],
        schema.items,
        `${fieldPath}[${i}]`
      );
      if (itemErr) return itemErr;
    }
  }

  return null;
}

function validateToolArguments(inputSchema, args) {
  if (!isPlainObject(inputSchema)) {
    return null;
  }

  const properties = isPlainObject(inputSchema.properties)
    ? inputSchema.properties
    : {};

  if (Array.isArray(inputSchema.required)) {
    for (const reqKey of inputSchema.required) {
      if (
        !Object.prototype.hasOwnProperty.call(args, reqKey) ||
        args[reqKey] === undefined
      ) {
        return `Missing required argument '${reqKey}'.`;
      }
    }
  }

  if (inputSchema.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        return `Unknown argument '${key}'.`;
      }
    }
  }

  for (const [key, propSchema] of Object.entries(properties)) {
    if (
      !Object.prototype.hasOwnProperty.call(args, key) ||
      args[key] === undefined
    ) {
      continue;
    }
    const err = validateValueAgainstSchema(args[key], propSchema, key);
    if (err) {
      return err;
    }
  }

  return null;
}

function normalizeCallResult(result, { hasOutputSchema = false } = {}) {
  if (
    isPlainObject(result) &&
    Array.isArray(result.content) &&
    result.content.every(
      (item) => isPlainObject(item) && typeof item.type === "string"
    )
  ) {
    return {
      ...result,
      isError: Boolean(result.isError),
    };
  }
  const text =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);
  const normalized = {
    content: [{ type: "text", text }],
    isError: false,
  };
  if (hasOutputSchema || isPlainObject(result)) {
    normalized.structuredContent = result;
  }
  return normalized;
}

function sanitizeIcons(icons) {
  if (!Array.isArray(icons) || icons.length === 0) {
    return undefined;
  }
  const valid = [];
  for (const icon of icons) {
    if (!isPlainObject(icon) || typeof icon.src !== "string" || !icon.src.trim()) {
      continue;
    }
    const entry = { src: icon.src.trim() };
    if (typeof icon.mimeType === "string" && icon.mimeType.trim()) {
      entry.mimeType = icon.mimeType.trim();
    }
    if (Array.isArray(icon.sizes) && icon.sizes.every((s) => typeof s === "string")) {
      entry.sizes = [...icon.sizes];
    }
    if (icon.theme === "light" || icon.theme === "dark") {
      entry.theme = icon.theme;
    }
    valid.push(entry);
  }
  return valid.length > 0 ? valid : undefined;
}

function sanitizeAnnotations(annotations) {
  if (!isPlainObject(annotations)) {
    return undefined;
  }
  const out = {};
  if (typeof annotations.title === "string" && annotations.title.trim()) {
    out.title = annotations.title.trim();
  }
  for (const key of [
    "readOnlyHint",
    "destructiveHint",
    "idempotentHint",
    "openWorldHint",
  ]) {
    if (typeof annotations[key] === "boolean") {
      out[key] = annotations[key];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function buildServerInfo({ name, version, title, description, websiteUrl, icons }) {
  const info = { name, version };
  if (typeof title === "string" && title.trim()) {
    info.title = title.trim();
  }
  if (typeof description === "string" && description.trim()) {
    info.description = description.trim();
  }
  if (typeof websiteUrl === "string" && websiteUrl.trim()) {
    info.websiteUrl = websiteUrl.trim();
  }
  const cleanIcons = sanitizeIcons(icons);
  if (cleanIcons) {
    info.icons = cleanIcons;
  }
  return info;
}

function buildServerInfoForLegacyVersion(fullServerInfo, protocolVersion) {
  if (protocolVersion === "2024-11-05" || protocolVersion === "2025-03-26") {
    return {
      name: fullServerInfo.name,
      version: fullServerInfo.version,
    };
  }
  if (protocolVersion === "2025-06-18") {
    const out = {
      name: fullServerInfo.name,
      version: fullServerInfo.version,
    };
    if (fullServerInfo.title) out.title = fullServerInfo.title;
    return out;
  }
  // 2025-11-25 supports full Implementation metadata (title, description, websiteUrl, icons).
  return { ...fullServerInfo };
}

function extractRequestMetaVersion(params) {
  if (!isPlainObject(params) || !isPlainObject(params._meta)) {
    return { present: false, version: null };
  }
  if (!Object.prototype.hasOwnProperty.call(params._meta, META_PROTOCOL_VERSION)) {
    return { present: false, version: null };
  }
  return { present: true, version: params._meta[META_PROTOCOL_VERSION] };
}

function isModernBatchElement(item) {
  if (!isPlainObject(item)) return false;
  if (item.method === "server/discover") return true;
  const meta = extractRequestMetaVersion(item.params);
  return meta.present;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      if (current >= items.length) {
        return;
      }
      nextIndex += 1;
      results[current] = await mapper(items[current]);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

export function createMcpServer({
  name = "@privatools/mcp",
  version = "0.1.0",
  title = undefined,
  description = undefined,
  websiteUrl = undefined,
  icons = undefined,
  instructions = "",
  tools = [],
  logger = null,
  discoverTtlMs = DEFAULT_DISCOVER_TTL_MS,
  toolsListTtlMs = DEFAULT_TOOLS_LIST_TTL_MS,
  maxBatchSize = MAX_BATCH_SIZE,
  maxLineBytes = MAX_LINE_BYTES,
  maxConcurrentRequests = MAX_CONCURRENT_REQUESTS,
} = {}) {
  const effectiveMaxBatchSize =
    Number.isInteger(maxBatchSize) && maxBatchSize > 0
      ? maxBatchSize
      : MAX_BATCH_SIZE;
  const effectiveMaxLineBytes =
    Number.isInteger(maxLineBytes) && maxLineBytes > 0
      ? maxLineBytes
      : MAX_LINE_BYTES;
  const effectiveMaxConcurrency =
    Number.isInteger(maxConcurrentRequests) && maxConcurrentRequests > 0
      ? maxConcurrentRequests
      : MAX_CONCURRENT_REQUESTS;
  const effectiveDiscoverTtlMs =
    Number.isInteger(discoverTtlMs) && discoverTtlMs >= 0
      ? discoverTtlMs
      : DEFAULT_DISCOVER_TTL_MS;
  const effectiveToolsListTtlMs =
    Number.isInteger(toolsListTtlMs) && toolsListTtlMs >= 0
      ? toolsListTtlMs
      : DEFAULT_TOOLS_LIST_TTL_MS;

  const serverInfo = buildServerInfo({
    name,
    version,
    title,
    description,
    websiteUrl,
    icons,
  });

  // Tracks the latest legacy handshake revision on this transport session (stdio).
  // Remains null for stateless 2026-07-28 clients.
  let negotiatedLegacyVersion = null;

  const toolMap = new Map();
  const toolDefs = [];

  for (const tool of tools) {
    if (
      !isPlainObject(tool) ||
      typeof tool.name !== "string" ||
      !tool.name.trim() ||
      typeof tool.handler !== "function"
    ) {
      throw new Error(
        "Each MCP tool must provide a non-empty name and handler function."
      );
    }
    if (toolMap.has(tool.name)) {
      throw new Error(`Duplicate MCP tool name: ${tool.name}`);
    }
    toolMap.set(tool.name, tool);
    const def = {
      name: tool.name,
      description: typeof tool.description === "string" ? tool.description : "",
      inputSchema: isPlainObject(tool.inputSchema)
        ? tool.inputSchema
        : { type: "object", properties: {} },
    };
    if (typeof tool.title === "string" && tool.title.trim()) {
      def.title = tool.title.trim();
    }
    if (isPlainObject(tool.outputSchema)) {
      def.outputSchema = tool.outputSchema;
    }
    const cleanAnnotations = sanitizeAnnotations(tool.annotations);
    if (cleanAnnotations) {
      def.annotations = cleanAnnotations;
    }
    const cleanIcons = sanitizeIcons(tool.icons);
    if (cleanIcons) {
      def.icons = cleanIcons;
    }
    toolDefs.push(def);
  }

  function logDebug(msg) {
    if (typeof logger === "function") {
      logger(msg);
    }
  }

  function wrapModernResult(result) {
    return {
      resultType: "complete",
      ...result,
      _meta: {
        ...(isPlainObject(result._meta) ? result._meta : {}),
        [META_SERVER_INFO]: { ...serverInfo },
      },
    };
  }

  function validateMetaProtocolVersion(params) {
    const metaInfo = extractRequestMetaVersion(params);
    if (!metaInfo.present) {
      return { present: false, version: null, isModern: false };
    }
    const requested = metaInfo.version;
    if (typeof requested !== "string" || !requested.trim()) {
      throw new JsonRpcError(
        ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION,
        "Unsupported protocol version",
        {
          supported: [...SUPPORTED_PROTOCOL_VERSIONS],
          requested: typeof requested === "string" ? requested : String(requested),
        }
      );
    }
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
      throw new JsonRpcError(
        ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION,
        `Unsupported protocol version: ${requested}`,
        {
          supported: [...SUPPORTED_PROTOCOL_VERSIONS],
          requested,
        }
      );
    }
    return {
      present: true,
      version: requested,
      isModern: MODERN_PROTOCOL_VERSIONS.includes(requested),
    };
  }

  async function dispatchRequest(method, params, isNotification) {
    const metaVersion = validateMetaProtocolVersion(params);
    const isModern = method === "server/discover" || metaVersion.isModern;

    switch (method) {
      case "server/discover": {
        if (params !== undefined && !isPlainObject(params)) {
          throw new JsonRpcError(
            ERROR_CODES.INVALID_PARAMS,
            "server/discover params must be an object when provided."
          );
        }
        const discoverResult = {
          supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
          protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: { ...serverInfo },
          ttlMs: effectiveDiscoverTtlMs,
          cacheScope: DEFAULT_CACHE_SCOPE,
        };
        if (instructions) {
          discoverResult.instructions = instructions;
        }
        return wrapModernResult(discoverResult);
      }

      case "initialize": {
        if (params !== undefined && !isPlainObject(params)) {
          throw new JsonRpcError(
            ERROR_CODES.INVALID_PARAMS,
            "initialize params must be an object."
          );
        }
        const requestedVersion =
          typeof params?.protocolVersion === "string"
            ? params.protocolVersion
            : "";
        const protocolVersion = LEGACY_PROTOCOL_VERSIONS.includes(
          requestedVersion
        )
          ? requestedVersion
          : LATEST_LEGACY_PROTOCOL_VERSION;
        negotiatedLegacyVersion = protocolVersion;

        const result = {
          protocolVersion,
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: buildServerInfoForLegacyVersion(
            serverInfo,
            protocolVersion
          ),
        };
        if (instructions) {
          result.instructions = instructions;
        }
        return result;
      }

      case "notifications/initialized":
      case "notifications/cancelled": {
        if (isNotification) {
          return null;
        }
        return isModern ? wrapModernResult({}) : {};
      }

      case "ping": {
        if (params !== undefined && !isPlainObject(params)) {
          throw new JsonRpcError(
            ERROR_CODES.INVALID_PARAMS,
            "ping params must be an object when provided."
          );
        }
        return isModern ? wrapModernResult({}) : {};
      }

      case "tools/list": {
        if (params !== undefined && !isPlainObject(params)) {
          throw new JsonRpcError(
            ERROR_CODES.INVALID_PARAMS,
            "tools/list params must be an object when provided."
          );
        }
        if (isModern) {
          return wrapModernResult({
            tools: toolDefs,
            ttlMs: effectiveToolsListTtlMs,
            cacheScope: DEFAULT_CACHE_SCOPE,
          });
        }
        return { tools: toolDefs };
      }

      case "tools/call": {
        if (!isPlainObject(params)) {
          throw new JsonRpcError(
            ERROR_CODES.INVALID_PARAMS,
            "tools/call requires a params object."
          );
        }
        if (typeof params.name !== "string" || !params.name.trim()) {
          throw new JsonRpcError(
            ERROR_CODES.INVALID_PARAMS,
            "tools/call requires a non-empty string 'name'."
          );
        }
        if (
          params.arguments !== undefined &&
          !isPlainObject(params.arguments)
        ) {
          throw new JsonRpcError(
            ERROR_CODES.INVALID_PARAMS,
            "tools/call 'arguments' must be an object when provided."
          );
        }
        const tool = toolMap.get(params.name);
        if (!tool) {
          throw new JsonRpcError(
            ERROR_CODES.INVALID_PARAMS,
            `Unknown tool: ${params.name}`
          );
        }

        const callArgs = params.arguments ?? {};
        const validationError = validateToolArguments(tool.inputSchema, callArgs);
        if (validationError) {
          const errResult = makeToolErrorResult(
            "invalid_arguments",
            validationError
          );
          return isModern ? wrapModernResult(errResult) : errResult;
        }

        try {
          const outcome = await tool.handler(callArgs);
          const normalized = normalizeCallResult(outcome, {
            hasOutputSchema: isPlainObject(tool.outputSchema),
          });
          return isModern ? wrapModernResult(normalized) : normalized;
        } catch (err) {
          if (err instanceof JsonRpcError) {
            throw err;
          }
          logDebug(`Tool ${params.name} failed: ${err?.message ?? err}`);
          const errResult = {
            content: [
              {
                type: "text",
                text: JSON.stringify(formatToolError(err), null, 2),
              },
            ],
            isError: true,
          };
          return isModern ? wrapModernResult(errResult) : errResult;
        }
      }

      default: {
        if (isNotification) {
          return null;
        }
        throw new JsonRpcError(
          ERROR_CODES.METHOD_NOT_FOUND,
          `Method not found: ${method}`
        );
      }
    }
  }

  async function handleSingleMessage(message) {
    if (!isPlainObject(message)) {
      return makeErrorResponse(
        null,
        ERROR_CODES.INVALID_REQUEST,
        "JSON-RPC request must be an object."
      );
    }

    const hasId = Object.prototype.hasOwnProperty.call(message, "id");
    const isNotification = !hasId;

    if (hasId && !isValidId(message.id)) {
      return makeErrorResponse(
        null,
        ERROR_CODES.INVALID_REQUEST,
        "JSON-RPC 'id' must be a string, finite number, or null."
      );
    }

    const id = hasId ? message.id : null;

    if (message.jsonrpc !== JSONRPC_VERSION) {
      return makeErrorResponse(
        id,
        ERROR_CODES.INVALID_REQUEST,
        "Invalid JSON-RPC version; expected '2.0'."
      );
    }

    if (typeof message.method !== "string" || message.method.length === 0) {
      return makeErrorResponse(
        id,
        ERROR_CODES.INVALID_REQUEST,
        "JSON-RPC request requires a non-empty string 'method'."
      );
    }

    try {
      const result = await dispatchRequest(
        message.method,
        message.params,
        isNotification
      );
      if (isNotification) {
        return null;
      }
      return makeSuccessResponse(id, result);
    } catch (err) {
      if (isNotification) {
        logDebug(`Notification ${message.method} error: ${err?.message ?? err}`);
        return null;
      }
      if (err instanceof JsonRpcError) {
        return makeErrorResponse(id, err.code, err.message, err.data);
      }
      logDebug(`Internal error handling ${message.method}: ${err?.message ?? err}`);
      return makeErrorResponse(
        id,
        ERROR_CODES.INTERNAL_ERROR,
        "Internal server error."
      );
    }
  }

  async function handleMessage(message) {
    if (Array.isArray(message)) {
      if (message.length === 0) {
        return makeErrorResponse(
          null,
          ERROR_CODES.INVALID_REQUEST,
          "JSON-RPC batch must not be empty."
        );
      }
      const hasModernElement = message.some(isModernBatchElement);
      const batchingAllowed =
        !hasModernElement &&
        negotiatedLegacyVersion !== null &&
        BATCHING_LEGACY_VERSIONS.has(negotiatedLegacyVersion);
      if (!batchingAllowed) {
        const effectiveVersion = hasModernElement
          ? LATEST_PROTOCOL_VERSION
          : negotiatedLegacyVersion ?? LATEST_PROTOCOL_VERSION;
        return makeErrorResponse(
          null,
          ERROR_CODES.INVALID_REQUEST,
          `JSON-RPC batching is not supported for MCP protocol version ${effectiveVersion}.`
        );
      }
      if (message.length > effectiveMaxBatchSize) {
        return makeErrorResponse(
          null,
          ERROR_CODES.INVALID_REQUEST,
          `JSON-RPC batch size ${message.length} exceeds maximum allowed (${effectiveMaxBatchSize}).`
        );
      }
      const responses = (
        await mapWithConcurrency(
          message,
          effectiveMaxConcurrency,
          handleSingleMessage
        )
      ).filter((entry) => entry !== null);
      return responses.length > 0 ? responses : null;
    }
    return handleSingleMessage(message);
  }

  function makeOversizedLineError() {
    return makeErrorResponse(
      null,
      ERROR_CODES.INVALID_REQUEST,
      `JSON-RPC message exceeds maximum allowed size (${effectiveMaxLineBytes} bytes).`
    );
  }

  async function handleRawLine(line) {
    if (typeof line !== "string") {
      return null;
    }
    if (Buffer.byteLength(line, "utf8") > effectiveMaxLineBytes) {
      return makeOversizedLineError();
    }
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return makeErrorResponse(
        null,
        ERROR_CODES.PARSE_ERROR,
        "Parse error: invalid JSON."
      );
    }
    return handleMessage(parsed);
  }

  function serveStdio({
    input = process.stdin,
    output = process.stdout,
    error = process.stderr,
  } = {}) {
    const inFlight = new Set();
    const pendingLines = [];
    let writeChain = Promise.resolve();
    let closed = false;
    let inputEnded = false;
    let settled = false;
    let lineChunks = [];
    let lineBytes = 0;
    let discardingOversizedLine = false;

    function enqueueWrite(payload) {
      const serialized = JSON.stringify(payload) + "\n";
      writeChain = writeChain.then(
        () =>
          new Promise((resolve, reject) => {
            if (output.writableEnded || output.destroyed) {
              resolve();
              return;
            }
            output.write(serialized, "utf8", (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          })
      );
      return writeChain;
    }

    let resolveDone;
    let rejectDone;
    const done = new Promise((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    function cleanupInputListeners() {
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("close", onEnd);
      input.off("error", onError);
    }

    function maybeFinish() {
      if (settled) return;
      if ((closed || inputEnded) && pendingLines.length === 0 && inFlight.size === 0) {
        settled = true;
        cleanupInputListeners();
        writeChain.then(() => resolveDone(), rejectDone);
      }
    }

    function pump() {
      while (!closed && inFlight.size < effectiveMaxConcurrency && pendingLines.length > 0) {
        const item = pendingLines.shift();
        const task = (async () => {
          try {
            const response = item.oversized
              ? makeOversizedLineError()
              : await handleRawLine(item.line);
            if (response !== null) {
              await enqueueWrite(response);
            }
          } catch (err) {
            if (error && !error.writableEnded && !error.destroyed) {
              error.write(
                `privatools-mcp: failed to process stdio message: ${err?.message ?? err}\n`
              );
            }
          }
        })();
        inFlight.add(task);
        task.finally(() => {
          inFlight.delete(task);
          pump();
        });
      }

      if (!closed && !inputEnded) {
        if (inFlight.size + pendingLines.length >= effectiveMaxConcurrency) {
          if (typeof input.pause === "function") {
            input.pause();
          }
        } else if (typeof input.resume === "function") {
          input.resume();
        }
      }

      maybeFinish();
    }

    function flushBufferedLine() {
      if (discardingOversizedLine) {
        discardingOversizedLine = false;
        lineChunks = [];
        lineBytes = 0;
        pendingLines.push({ oversized: true });
        return;
      }
      if (lineBytes === 0) {
        return;
      }
      const combined =
        lineChunks.length === 1 ? lineChunks[0] : Buffer.concat(lineChunks, lineBytes);
      lineChunks = [];
      lineBytes = 0;
      const lineStr = combined.toString("utf8");
      pendingLines.push({ oversized: false, line: lineStr });
    }

    function onData(chunk) {
      if (closed) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      let offset = 0;

      while (offset < buf.length) {
        const nlIdx = buf.indexOf(0x0a, offset);
        if (nlIdx === -1) {
          const partLen = buf.length - offset;
          if (!discardingOversizedLine) {
            if (lineBytes + partLen > effectiveMaxLineBytes) {
              discardingOversizedLine = true;
              lineChunks = [];
              lineBytes = 0;
            } else if (partLen > 0) {
              lineChunks.push(buf.subarray(offset));
              lineBytes += partLen;
            }
          }
          break;
        }

        const partLen = nlIdx - offset;
        if (discardingOversizedLine || lineBytes + partLen > effectiveMaxLineBytes) {
          discardingOversizedLine = true;
          lineChunks = [];
          lineBytes = 0;
          flushBufferedLine();
        } else {
          if (partLen > 0) {
            lineChunks.push(buf.subarray(offset, nlIdx));
            lineBytes += partLen;
          }
          flushBufferedLine();
        }
        offset = nlIdx + 1;
      }

      pump();
    }

    function onEnd() {
      if (closed || inputEnded) return;
      flushBufferedLine();
      inputEnded = true;
      pump();
    }

    function onError(err) {
      if (settled) return;
      settled = true;
      closed = true;
      pendingLines.length = 0;
      cleanupInputListeners();
      rejectDone(err);
    }

    input.on("data", onData);
    input.on("end", onEnd);
    input.on("close", onEnd);
    input.on("error", onError);

    return {
      done,
      close() {
        if (!closed) {
          closed = true;
          pendingLines.length = 0;
          lineChunks = [];
          lineBytes = 0;
          discardingOversizedLine = false;
          cleanupInputListeners();
          if (typeof input.pause === "function") {
            input.pause();
          }
          maybeFinish();
        }
      },
    };
  }

  return {
    handleMessage,
    handleRawLine,
    serveStdio,
    listTools: () => toolDefs.slice(),
    getServerInfo: () => ({ ...serverInfo }),
  };
}
