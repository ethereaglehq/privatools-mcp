import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_API_URL = "https://api.privatools.me/api/v1";
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_CATALOG_TTL_MS = 60_000;

const KNOWN_ASYNC_OPERATIONS = new Set([
  "merge",
  "compress",
  "grayscale",
  "pdf-to-text",
]);

const OPERATION_SLUG_RE = /^[a-z0-9][a-z0-9/_-]*$/i;
const JOB_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{1,128}$/;

const IGNORED_X_HEADERS = new Set([
  "x-content-type-options",
  "x-frame-options",
  "x-xss-protection",
  "x-powered-by",
  "x-dns-prefetch-control",
  "x-download-options",
  "x-permitted-cross-domain-policies",
]);

const CANONICAL_HEADER_NAMES = new Map([
  ["x-request-id", "X-Request-ID"],
  ["x-ratelimit-limit", "X-RateLimit-Limit"],
  ["x-ratelimit-remaining", "X-RateLimit-Remaining"],
  ["x-ratelimit-reset", "X-RateLimit-Reset"],
  ["x-quota-bytes-limit", "X-Quota-Bytes-Limit"],
  ["x-quota-bytes-remaining", "X-Quota-Bytes-Remaining"],
  ["x-target-met", "X-Target-Met"],
  ["x-compressed-size", "X-Compressed-Size"],
  ["x-repair-pages", "X-Repair-Pages"],
  ["x-repair-status", "X-Repair-Status"],
  ["x-bates-next", "X-Bates-Next"],
  ["x-bates-first", "X-Bates-First"],
  ["x-bates-manifest", "X-Bates-Manifest"],
  ["x-bates-removed", "X-Bates-Removed"],
  ["x-bates-remaining", "X-Bates-Remaining"],
  ["x-bates-elsewhere", "X-Bates-Elsewhere"],
  ["x-markdown-report", "X-Markdown-Report"],
  ["x-redaction-report", "X-Redaction-Report"],
  ["x-redact-hits", "X-Redact-Hits"],
  ["x-highlight-hits", "X-Highlight-Hits"],
  ["x-equations-left-out", "X-Equations-Left-Out"],
  ["retry-after", "Retry-After"],
  ["idempotency-replayed", "Idempotency-Replayed"],
  ["location", "Location"],
]);

const MIME_TO_EXT = new Map([
  ["application/pdf", ".pdf"],
  ["application/zip", ".zip"],
  ["application/x-zip-compressed", ".zip"],
  ["application/json", ".json"],
  ["text/markdown", ".md"],
  ["text/plain", ".txt"],
  ["text/html", ".html"],
  ["text/csv", ".csv"],
  ["text/xml", ".xml"],
  ["application/xml", ".xml"],
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/bmp", ".bmp"],
  ["image/tiff", ".tiff"],
  ["image/svg+xml", ".svg"],
  ["image/x-icon", ".ico"],
  ["image/avif", ".avif"],
  ["audio/mpeg", ".mp3"],
  ["audio/wav", ".wav"],
  ["audio/ogg", ".ogg"],
  ["audio/flac", ".flac"],
  ["audio/aac", ".aac"],
  ["audio/mp4", ".m4a"],
  ["video/mp4", ".mp4"],
  ["video/webm", ".webm"],
  ["application/epub+zip", ".epub"],
  ["application/rtf", ".rtf"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".docx",
  ],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xlsx",
  ],
  [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".pptx",
  ],
]);

const EXT_TO_MIME = new Map([
  [".pdf", "application/pdf"],
  [".zip", "application/zip"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".txt", "text/plain"],
  [".html", "text/html"],
  [".htm", "text/html"],
  [".csv", "text/csv"],
  [".xml", "application/xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".bmp", "image/bmp"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".svg", "image/svg+xml"],
  [".heic", "image/heic"],
  [".heif", "image/heif"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],
  [".flac", "audio/flac"],
  [".aac", "audio/aac"],
  [".m4a", "audio/mp4"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"],
  [".srt", "application/x-subrip"],
  [".vtt", "text/vtt"],
  [".epub", "application/epub+zip"],
  [".rtf", "application/rtf"],
  [
    ".docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  [
    ".xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  [
    ".pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
]);

export class PrivaToolsError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "PrivaToolsError";
    this.code = code;
    if (extra.status !== undefined) this.status = extra.status;
    if (extra.requestId !== undefined) this.requestId = extra.requestId;
    if (extra.retryAfter !== undefined) this.retryAfter = extra.retryAfter;
    if (extra.details !== undefined) this.details = extra.details;
  }

  toJSON() {
    const out = {
      code: this.code,
      message: this.message,
    };
    if (this.status !== undefined) out.status = this.status;
    if (this.requestId !== undefined) out.request_id = this.requestId;
    if (this.retryAfter !== undefined) out.retry_after = this.retryAfter;
    if (this.details !== undefined) out.details = this.details;
    return out;
  }
}

const SENSITIVE_KEY_NAMES = new Set([
  "authorization",
  "proxyauthorization",
  "xapikey",
  "apikey",
  "cookie",
  "setcookie",
  "password",
  "passwd",
  "passphrase",
  "secret",
  "clientsecret",
  "sharedsecret",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authtoken",
  "bearertoken",
  "privatekey",
  "secretkey",
  "signingkey",
  "sessionid",
  "sessiontoken",
  "credential",
  "credentials",
]);

const SENSITIVE_KEY_SUFFIXES = [
  "apikey",
  "authorization",
  "cookie",
  "password",
  "passwd",
  "passphrase",
  "secret",
  "privatekey",
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "bearertoken",
  "sessiontoken",
];

const BEARER_SECRET_RE = /\b(Bearer[ \t]{1,8})[^\s"',;]+/gi;
const SENSITIVE_HEADER_VALUE_RE =
  /\b((?:x-api-key|authorization|proxy-authorization|cookie|set-cookie)[ \t]{0,8}[:=][ \t]{0,8})[^\r\n"',;]+/gi;

function isSensitiveKey(key) {
  if (typeof key !== "string" && typeof key !== "number") return false;
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) return false;
  if (SENSITIVE_KEY_NAMES.has(normalized)) return true;
  return SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function redactSecret(text, secret) {
  if (!secret || typeof text !== "string") return text;
  return text.split(secret).join("[REDACTED]");
}

function redactSensitiveString(text, secret) {
  if (typeof text !== "string") return text;
  let out = redactSecret(text, secret);
  out = out.replace(BEARER_SECRET_RE, "$1[REDACTED]");
  out = out.replace(SENSITIVE_HEADER_VALUE_RE, "$1[REDACTED]");
  return out;
}

function redactErrorDetails(value, secret, depth = 0) {
  if (depth > 12) {
    return "[TRUNCATED]";
  }
  if (typeof value === "string") {
    return redactSensitiveString(value, secret);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactErrorDetails(item, secret, depth + 1));
  }
  if (value && typeof value === "object") {
    const locIsSensitive =
      Array.isArray(value.loc) && value.loc.some((part) => isSensitiveKey(part));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSensitiveKey(k) || (locIsSensitive && (k === "input" || k === "value"))) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactErrorDetails(v, secret, depth + 1);
      }
    }
    return out;
  }
  return value;
}

function sanitizeUrlForDisplay(rawUrl) {
  if (typeof rawUrl !== "string") return "";
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
      return stripChar(parsed.toString(), "/", { leading: false, trailing: true });
    }
    return stripChar(rawUrl, "/", { leading: false, trailing: true });
  } catch {
    const schemeIdx = rawUrl.indexOf("://");
    if (schemeIdx !== -1) {
      const authorityStart = schemeIdx + 3;
      const slashIdx = rawUrl.indexOf("/", authorityStart);
      const authorityEnd = slashIdx === -1 ? rawUrl.length : slashIdx;
      const atIdx = rawUrl.indexOf("@", authorityStart);
      if (atIdx !== -1 && atIdx < authorityEnd) {
        return `${rawUrl.slice(0, authorityStart)}[REDACTED]@${rawUrl.slice(atIdx + 1)}`;
      }
    }
    return rawUrl;
  }
}

function canonicalHeaderName(lowerName) {
  const known = CANONICAL_HEADER_NAMES.get(lowerName);
  if (known) return known;
  return lowerName
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join("-");
}

export function extractRelevantHeaders(headers) {
  const out = {};
  if (!headers) return out;
  for (const [rawKey, value] of headers.entries()) {
    const key = rawKey.toLowerCase();
    if (
      (key.startsWith("x-") && !IGNORED_X_HEADERS.has(key)) ||
      key === "retry-after" ||
      key === "idempotency-replayed" ||
      key === "location"
    ) {
      out[canonicalHeaderName(key)] = value;
    }
  }
  return out;
}

export function parseContentDispositionFilename(headerValue) {
  if (typeof headerValue !== "string" || !headerValue.trim()) {
    return null;
  }
  const starMatch = headerValue.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\r\n]+)/);
  let candidate = null;
  if (starMatch) {
    try {
      candidate = decodeURIComponent(starMatch[1].trim().replace(/^"|"$/g, ""));
    } catch {
      candidate = starMatch[1].trim().replace(/^"|"$/g, "");
    }
  } else {
    const quotedMatch = headerValue.match(/filename\s*=\s*"([^"\r\n]+)"/i);
    if (quotedMatch) {
      candidate = quotedMatch[1];
    } else {
      const bareMatch = headerValue.match(/filename\s*=\s*([^;\r\n]+)/i);
      if (bareMatch) {
        candidate = bareMatch[1].trim();
      }
    }
  }
  if (!candidate) return null;
  const cleaned = path
    .basename(candidate.replace(/\\/g, "/"))
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return null;
  }
  return cleaned;
}

function stripChar(value, ch, { leading = true, trailing = true } = {}) {
  let start = 0;
  let end = value.length;
  if (leading) {
    while (start < end && value[start] === ch) start++;
  }
  if (trailing) {
    while (end > start && value[end - 1] === ch) end--;
  }
  return value.slice(start, end);
}

export function normalizeBaseUrl(rawUrl) {
  const candidate = (rawUrl ?? DEFAULT_API_URL).trim();
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new PrivaToolsError(
      "invalid_api_url",
      `Invalid PRIVATOOLS_API_URL: ${sanitizeUrlForDisplay(candidate)}`
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PrivaToolsError(
      "invalid_api_url",
      "PRIVATOOLS_API_URL must use http:// or https://."
    );
  }
  return stripChar(candidate, "/", { leading: false, trailing: true });
}

export function normalizeOperationSlug(rawOperation) {
  if (typeof rawOperation !== "string" || !rawOperation.trim()) {
    throw new PrivaToolsError(
      "invalid_operation",
      "Operation must be a non-empty string."
    );
  }
  let cleaned = rawOperation.trim();
  if (cleaned.startsWith("/api/v1/")) {
    cleaned = cleaned.slice("/api/v1/".length);
  } else if (cleaned.startsWith("api/v1/")) {
    cleaned = cleaned.slice("api/v1/".length);
  }
  cleaned = stripChar(cleaned, "/");
  if (
    !cleaned ||
    cleaned.includes("..") ||
    cleaned.includes("\\") ||
    cleaned.includes("?") ||
    cleaned.includes("#") ||
    cleaned.includes("\0") ||
    !OPERATION_SLUG_RE.test(cleaned)
  ) {
    throw new PrivaToolsError(
      "invalid_operation",
      `Invalid operation identifier: ${rawOperation}`
    );
  }
  return cleaned;
}

function validateJobId(jobId) {
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId.trim())) {
    throw new PrivaToolsError(
      "invalid_job_id",
      "job_id must be 1–128 alphanumeric, '.', '_', or '-' characters."
    );
  }
  return jobId.trim();
}

function validateIdempotencyKey(key) {
  if (typeof key !== "string" || !IDEMPOTENCY_KEY_RE.test(key)) {
    throw new PrivaToolsError(
      "invalid_idempotency_key",
      "idempotency_key must be 1–128 visible ASCII characters."
    );
  }
  return key;
}

const MAX_SYMLINK_DEPTH = 40;

function splitPathForWalk(absPath) {
  const { root } = path.parse(absPath);
  const rest = absPath.slice(root.length);
  const segments = rest ? rest.split(path.sep).filter(Boolean) : [];
  return { root, segments };
}

function resolveDeepestRealPathSync(targetPath) {
  let currentAbs = path.resolve(targetPath);
  let { root: resolved, segments } = splitPathForWalk(currentAbs);
  let index = 0;
  let symlinkCount = 0;

  while (index < segments.length) {
    const next = path.join(resolved, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(next);
    } catch (err) {
      if (err?.code === "ENOENT" || err?.code === "ENOTDIR") {
        return path.join(resolved, ...segments.slice(index));
      }
      throw new PrivaToolsError(
        "invalid_path",
        `Unable to inspect path '${targetPath}': ${err?.message ?? err}`
      );
    }

    if (stat.isSymbolicLink()) {
      symlinkCount += 1;
      if (symlinkCount > MAX_SYMLINK_DEPTH) {
        throw new PrivaToolsError(
          "invalid_path",
          `Too many symbolic link levels resolving path: ${targetPath}`
        );
      }
      let linkTarget;
      try {
        linkTarget = fs.readlinkSync(next);
      } catch (err) {
        throw new PrivaToolsError(
          "invalid_path",
          `Unable to read symbolic link '${next}': ${err?.message ?? err}`
        );
      }
      const targetAbs = path.resolve(resolved, linkTarget);
      const remaining = segments.slice(index + 1);
      currentAbs =
        remaining.length > 0 ? path.join(targetAbs, ...remaining) : targetAbs;
      ({ root: resolved, segments } = splitPathForWalk(currentAbs));
      index = 0;
      continue;
    }

    resolved = next;
    index += 1;
  }

  return resolved;
}

export async function resolveDeepestRealPath(targetPath) {
  let currentAbs = path.resolve(targetPath);
  let { root: resolved, segments } = splitPathForWalk(currentAbs);
  let index = 0;
  let symlinkCount = 0;

  while (index < segments.length) {
    const next = path.join(resolved, segments[index]);
    let stat;
    try {
      stat = await fs.promises.lstat(next);
    } catch (err) {
      if (err?.code === "ENOENT" || err?.code === "ENOTDIR") {
        return path.join(resolved, ...segments.slice(index));
      }
      throw new PrivaToolsError(
        "invalid_path",
        `Unable to inspect path '${targetPath}': ${err?.message ?? err}`
      );
    }

    if (stat.isSymbolicLink()) {
      symlinkCount += 1;
      if (symlinkCount > MAX_SYMLINK_DEPTH) {
        throw new PrivaToolsError(
          "invalid_path",
          `Too many symbolic link levels resolving path: ${targetPath}`
        );
      }
      let linkTarget;
      try {
        linkTarget = await fs.promises.readlink(next);
      } catch (err) {
        throw new PrivaToolsError(
          "invalid_path",
          `Unable to read symbolic link '${next}': ${err?.message ?? err}`
        );
      }
      const targetAbs = path.resolve(resolved, linkTarget);
      const remaining = segments.slice(index + 1);
      currentAbs =
        remaining.length > 0 ? path.join(targetAbs, ...remaining) : targetAbs;
      ({ root: resolved, segments } = splitPathForWalk(currentAbs));
      index = 0;
      continue;
    }

    resolved = next;
    index += 1;
  }

  return resolved;
}

async function assertNotSymlink(targetPath) {
  try {
    const st = await fs.promises.lstat(targetPath);
    if (st.isSymbolicLink()) {
      throw new PrivaToolsError(
        "invalid_path",
        `Refusing to write through symbolic link: ${targetPath}`
      );
    }
  } catch (err) {
    if (err instanceof PrivaToolsError) throw err;
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") {
      return;
    }
    throw new PrivaToolsError(
      "invalid_path",
      `Unable to inspect output path '${targetPath}': ${err?.message ?? err}`
    );
  }
}

export function parseAllowedDirs(raw) {
  if (!raw) return [];
  const entries = Array.isArray(raw)
    ? raw
    : String(raw).split(path.delimiter);
  const resolved = [];
  for (const entry of entries) {
    const trimmed = typeof entry === "string" ? entry.trim() : "";
    if (!trimmed) continue;
    if (trimmed.includes("\0")) {
      throw new PrivaToolsError(
        "invalid_allowed_dir",
        "PRIVATOOLS_MCP_ALLOWED_DIRS contains a null byte."
      );
    }
    resolved.push(resolveDeepestRealPathSync(trimmed));
  }
  return resolved;
}

export function isPathWithinDir(targetPath, allowedDir) {
  const rel = path.relative(allowedDir, targetPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertWithinAllowedDirs(realPath, allowedDirs, label) {
  if (!allowedDirs || allowedDirs.length === 0) return;
  const ok = allowedDirs.some((dir) => isPathWithinDir(realPath, dir));
  if (!ok) {
    throw new PrivaToolsError(
      "path_not_allowed",
      `${label} path '${realPath}' is outside PRIVATOOLS_MCP_ALLOWED_DIRS.`
    );
  }
}

export async function validateInputFile(rawPath, allowedDirs = []) {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new PrivaToolsError("invalid_path", "File path must be a non-empty string.");
  }
  if (rawPath.includes("\0")) {
    throw new PrivaToolsError("invalid_path", "File path must not contain null bytes.");
  }
  const absPath = path.resolve(rawPath);
  const preRealPath = await resolveDeepestRealPath(absPath);
  assertWithinAllowedDirs(preRealPath, allowedDirs, "Input");

  let stat;
  try {
    stat = await fs.promises.stat(absPath);
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new PrivaToolsError("file_not_found", `Input file does not exist: ${rawPath}`);
    }
    if (err?.code === "EACCES" || err?.code === "EPERM") {
      throw new PrivaToolsError("file_not_readable", `Input file is not readable: ${rawPath}`);
    }
    throw new PrivaToolsError(
      "invalid_path",
      `Unable to access input file '${rawPath}': ${err?.message ?? err}`
    );
  }

  if (!stat.isFile()) {
    throw new PrivaToolsError(
      "not_a_file",
      `Input path is not a regular file: ${rawPath}`
    );
  }

  try {
    await fs.promises.access(absPath, fs.constants.R_OK);
  } catch {
    throw new PrivaToolsError("file_not_readable", `Input file is not readable: ${rawPath}`);
  }

  const realPath = await fs.promises.realpath(absPath);
  assertWithinAllowedDirs(realPath, allowedDirs, "Input");

  return {
    path: realPath,
    filename: path.basename(realPath),
    size: stat.size,
  };
}

function sanitizeFilenameSegment(value) {
  const collapsed = String(value || "output").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return stripChar(collapsed, "-").slice(0, 64) || "output";
}

function extensionForMediaType(mediaType) {
  if (!mediaType) return ".bin";
  const base = mediaType.split(";", 1)[0].trim().toLowerCase();
  return MIME_TO_EXT.get(base) ?? ".bin";
}

function mimeForFilename(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  return EXT_TO_MIME.get(ext) ?? "application/octet-stream";
}

export async function resolveOutputTarget({
  explicitOutputPath,
  inputPaths = [],
  operation = "output",
  mediaType = "application/octet-stream",
  contentDisposition = null,
  allowedDirs = [],
}) {
  const serverFilename = parseContentDispositionFilename(contentDisposition);
  const mediaExt = extensionForMediaType(mediaType);
  const serverExt = serverFilename ? path.extname(serverFilename) : "";
  const chosenExt =
    mediaExt !== ".bin" ? mediaExt : serverExt || ".bin";

  if (explicitOutputPath !== undefined && explicitOutputPath !== null && explicitOutputPath !== "") {
    if (typeof explicitOutputPath !== "string") {
      throw new PrivaToolsError("invalid_path", "output_path must be a string.");
    }
    if (explicitOutputPath.includes("\0")) {
      throw new PrivaToolsError(
        "invalid_path",
        "output_path must not contain null bytes."
      );
    }
    const absExplicit = path.resolve(explicitOutputPath);
    const realTarget = await resolveDeepestRealPath(absExplicit);
    assertWithinAllowedDirs(realTarget, allowedDirs, "Output");
    await assertNotSymlink(absExplicit);
    if (realTarget !== absExplicit) {
      await assertNotSymlink(realTarget);
    }

    try {
      const existingStat = await fs.promises.lstat(realTarget);
      if (existingStat.isDirectory()) {
        throw new PrivaToolsError(
          "output_is_directory",
          `output_path points to a directory, not a file: ${realTarget}`
        );
      }
    } catch (err) {
      if (err instanceof PrivaToolsError) throw err;
    }

    const parentDir = path.dirname(realTarget);
    await fs.promises.mkdir(parentDir, { recursive: true });
    const realParentDir = await fs.promises.realpath(parentDir);
    const verifiedTarget = path.join(realParentDir, path.basename(realTarget));
    assertWithinAllowedDirs(verifiedTarget, allowedDirs, "Output");
    await assertNotSymlink(verifiedTarget);

    return {
      targetPath: verifiedTarget,
      isAutoNamed: false,
      serverFilename,
    };
  }

  const baseDir =
    inputPaths.length > 0 ? path.dirname(inputPaths[0]) : process.cwd();
  const realBaseDir = await resolveDeepestRealPath(baseDir);
  assertWithinAllowedDirs(realBaseDir, allowedDirs, "Output");

  let filename;
  if (inputPaths.length > 0) {
    const parsedInput = path.parse(inputPaths[0]);
    const opSlug = sanitizeFilenameSegment(operation);
    filename = `${parsedInput.name}-${opSlug}${chosenExt}`;
  } else if (serverFilename) {
    filename = serverFilename;
  } else {
    filename = `${sanitizeFilenameSegment(operation)}${chosenExt}`;
  }

  const candidatePath = path.join(realBaseDir, filename);
  const resolvedTarget = await resolveDeepestRealPath(candidatePath);
  assertWithinAllowedDirs(resolvedTarget, allowedDirs, "Output");
  await assertNotSymlink(candidatePath);
  if (resolvedTarget !== candidatePath) {
    await assertNotSymlink(resolvedTarget);
  }

  return {
    targetPath: resolvedTarget,
    isAutoNamed: true,
    serverFilename,
  };
}

export async function writeBufferSafely({
  buffer,
  targetPath,
  isAutoNamed = false,
  overwrite = false,
  allowedDirs = [],
}) {
  const absTarget = path.resolve(targetPath);
  const realTarget = await resolveDeepestRealPath(absTarget);
  assertWithinAllowedDirs(realTarget, allowedDirs, "Output");
  await assertNotSymlink(absTarget);
  if (realTarget !== absTarget) {
    await assertNotSymlink(realTarget);
  }

  if (overwrite) {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    const flags =
      fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_TRUNC |
      noFollow;
    let fh;
    try {
      fh = await fs.promises.open(realTarget, flags, 0o666);
      await fh.writeFile(buffer);
      return realTarget;
    } catch (err) {
      if (err?.code === "ELOOP") {
        throw new PrivaToolsError(
          "invalid_path",
          `Refusing to write through symbolic link: ${realTarget}`
        );
      }
      if (err?.code === "EISDIR") {
        throw new PrivaToolsError(
          "output_is_directory",
          `output_path points to a directory, not a file: ${realTarget}`
        );
      }
      throw new PrivaToolsError(
        "write_failed",
        `Failed to write output file '${realTarget}': ${err?.message ?? err}`
      );
    } finally {
      if (fh) {
        await fh.close().catch(() => {});
      }
    }
  }

  if (!isAutoNamed) {
    try {
      await fs.promises.writeFile(realTarget, buffer, { flag: "wx" });
      return realTarget;
    } catch (err) {
      if (err?.code === "EEXIST") {
        throw new PrivaToolsError(
          "output_exists",
          `Output file already exists: ${realTarget}. Pass overwrite: true or choose a different output_path.`
        );
      }
      throw new PrivaToolsError(
        "write_failed",
        `Failed to write output file '${realTarget}': ${err?.message ?? err}`
      );
    }
  }

  const parsed = path.parse(realTarget);
  for (let i = 0; i < 1000; i += 1) {
    const candidate =
      i === 0
        ? realTarget
        : path.join(parsed.dir, `${parsed.name}-${i}${parsed.ext}`);
    try {
      await fs.promises.writeFile(candidate, buffer, { flag: "wx" });
      return candidate;
    } catch (err) {
      if (err?.code === "EEXIST") {
        continue;
      }
      throw new PrivaToolsError(
        "write_failed",
        `Failed to write output file '${candidate}': ${err?.message ?? err}`
      );
    }
  }

  throw new PrivaToolsError(
    "write_failed",
    `Could not allocate a unique filename near: ${realTarget}`
  );
}

let cachedBundledMetadata = null;

export function loadBundledMetadata() {
  if (cachedBundledMetadata) {
    return cachedBundledMetadata;
  }
  const candidates = [
    new URL("../data/operation_metadata.json", import.meta.url),
  ];
  for (const url of candidates) {
    try {
      const raw = fs.readFileSync(url, "utf8");
      cachedBundledMetadata = JSON.parse(raw);
      return cachedBundledMetadata;
    } catch {
      // Try next fallback location.
    }
  }
  cachedBundledMetadata = { operations: {}, unavailable_tools: [] };
  return cachedBundledMetadata;
}

function buildFallbackCatalog(metadata) {
  const operations = [
    {
      operation: "whoami",
      id: "v1_get_whoami",
      method: "GET",
      path: "/api/v1/whoami",
      summary: "Confirm a key works",
      description: "",
      category: "Key and usage",
      tool_aliases: [],
      response_media: ["application/json"],
      request_body: null,
      parameters: [],
      constraints: [],
      cost: { units: 0, mode: "fixed" },
      async: { supported: false },
      retry_safe: true,
    },
    {
      operation: "usage",
      id: "v1_get_usage",
      method: "GET",
      path: "/api/v1/usage",
      summary: "Your current free-tier usage",
      description: "",
      category: "Key and usage",
      tool_aliases: [],
      response_media: ["application/json"],
      request_body: null,
      parameters: [],
      constraints: [],
      cost: { units: 0, mode: "fixed" },
      async: { supported: false },
      retry_safe: true,
    },
  ];
  for (const [shortPath, info] of Object.entries(metadata.operations ?? {})) {
    const slug = shortPath.replace(/^\/+/, "");
    const isGet =
      shortPath === "/developer/status" ||
      shortPath === "/pipeline/templates" ||
      shortPath === "/transparency/janitor";
    const asyncSupported = !isGet && KNOWN_ASYNC_OPERATIONS.has(slug);
    operations.push({
      operation: slug,
      id: `v1_${isGet ? "get" : "post"}_${slug.replace(/[^a-zA-Z0-9]+/g, "_")}`,
      method: isGet ? "GET" : "POST",
      path: `/api/v1${shortPath}`,
      summary: slug.replace(/[-/]+/g, " "),
      description: "",
      category: info.category ?? "Other",
      tool_aliases: Array.isArray(info.tool_aliases) ? info.tool_aliases : [],
      response_media: Array.isArray(info.response_media)
        ? info.response_media
        : [],
      request_body: null,
      parameters: [],
      constraints: [],
      cost: null,
      async: asyncSupported
        ? { supported: true, operation: slug }
        : { supported: false },
      retry_safe: isGet,
    });
  }
  operations.sort((a, b) => a.operation.localeCompare(b.operation));
  return {
    source: "bundled-fallback",
    operations,
    components: {},
    async: {
      available: false,
      operations: [...KNOWN_ASYNC_OPERATIONS],
    },
    unavailable_tools: Array.isArray(metadata.unavailable_tools)
      ? metadata.unavailable_tools
      : [],
  };
}

function extractResponseMedia(responses) {
  const ok = responses?.["200"] ?? responses?.["202"] ?? null;
  if (!ok || !ok.content || typeof ok.content !== "object") {
    return [];
  }
  return Object.keys(ok.content);
}

function normalizeOperationsCatalog(payload) {
  const ops = (payload.operations ?? []).map((op) => {
    const rawPath = String(op.path ?? "");
    const slug = rawPath.replace(/^\/api\/v1\//, "").replace(/^\/+/, "");
    return {
      operation: slug,
      id: op.id ?? "",
      method: String(op.method ?? "POST").toUpperCase(),
      path: rawPath || `/api/v1/${slug}`,
      summary: op.summary ?? slug,
      description: op.description ?? "",
      category: op.category ?? "Other",
      tool_aliases: Array.isArray(op.tool_aliases) ? op.tool_aliases : [],
      response_media: extractResponseMedia(op.responses),
      request_body: op.request_body ?? null,
      parameters: Array.isArray(op.parameters) ? op.parameters : [],
      constraints: Array.isArray(op.constraints) ? op.constraints : [],
      cost: op.cost ?? null,
      async: op.async ?? { supported: false },
      retry_safe: Boolean(op.retry_safe),
    };
  });
  return {
    source: "live-operations",
    operations: ops,
    components: payload.components ?? {},
    async: payload.async ?? {},
    limits: payload.limits ?? null,
    unavailable_tools: Array.isArray(payload.unavailable_tools)
      ? payload.unavailable_tools
      : [],
  };
}

function normalizeOpenApiCatalog(doc, bundledMetadata) {
  const metaOps = bundledMetadata?.operations ?? {};
  const operations = [];
  for (const [rawPath, methods] of Object.entries(doc.paths ?? {})) {
    if (!methods || typeof methods !== "object") continue;
    const shortPath = rawPath.replace(/^\/api\/v1/, "");
    const slug = shortPath.replace(/^\/+/, "");
    const meta = metaOps[shortPath] ?? {};
    for (const [method, op] of Object.entries(methods)) {
      if (!op || typeof op !== "object") continue;
      const lowerMethod = method.toLowerCase();
      if (!["get", "post", "put", "patch", "delete"].includes(lowerMethod)) {
        continue;
      }
      const ext = op["x-privatools"] ?? {};
      const responseMedia = extractResponseMedia(op.responses);
      operations.push({
        operation: slug,
        id: op.operationId ?? "",
        method: lowerMethod.toUpperCase(),
        path: rawPath.startsWith("/api/v1") ? rawPath : `/api/v1${shortPath}`,
        summary: op.summary ?? slug,
        description: op.description ?? "",
        category:
          (Array.isArray(op.tags) && op.tags[0]) || meta.category || "Other",
        tool_aliases: Array.isArray(meta.tool_aliases) ? meta.tool_aliases : [],
        response_media:
          responseMedia.length > 0
            ? responseMedia
            : Array.isArray(meta.response_media)
            ? meta.response_media
            : [],
        request_body: op.requestBody ?? null,
        parameters: Array.isArray(op.parameters) ? op.parameters : [],
        constraints: [],
        cost: ext.cost ?? null,
        async: ext.async ?? { supported: false },
        retry_safe: Boolean(ext.retrySafe ?? lowerMethod === "get"),
      });
    }
  }
  operations.sort((a, b) => a.operation.localeCompare(b.operation));
  return {
    source: "live-openapi",
    operations,
    components: doc.components ?? {},
    async: doc["x-privatools-async"] ?? {},
    limits: null,
    unavailable_tools: Array.isArray(bundledMetadata?.unavailable_tools)
      ? bundledMetadata.unavailable_tools
      : [],
  };
}

export function resolveSchemaRef(schema, components, seen = new Set()) {
  if (!schema || typeof schema !== "object") return schema;
  if (typeof schema.$ref === "string" && schema.$ref.startsWith("#/components/schemas/")) {
    const name = schema.$ref.slice("#/components/schemas/".length);
    if (seen.has(name)) return schema;
    const target = components?.schemas?.[name];
    if (target) {
      const nextSeen = new Set(seen);
      nextSeen.add(name);
      return resolveSchemaRef(target, components, nextSeen);
    }
  }
  return schema;
}

function isBinarySchema(propSchema, components) {
  const resolved = resolveSchemaRef(propSchema, components);
  if (!resolved || typeof resolved !== "object") return false;
  if (
    resolved.format === "binary" ||
    resolved.contentMediaType === "application/octet-stream"
  ) {
    return true;
  }
  if (Array.isArray(resolved.anyOf)) {
    return resolved.anyOf.some((sub) => isBinarySchema(sub, components));
  }
  return false;
}

function isBinaryArraySchema(propSchema, components) {
  const resolved = resolveSchemaRef(propSchema, components);
  if (!resolved || typeof resolved !== "object") return false;
  if (resolved.type === "array" && resolved.items) {
    return isBinarySchema(resolved.items, components);
  }
  if (Array.isArray(resolved.anyOf)) {
    return resolved.anyOf.some((sub) => isBinaryArraySchema(sub, components));
  }
  return false;
}

export function inspectOperationBodySchema(operationEntry, components = {}) {
  const content = operationEntry?.request_body?.content;
  if (!content || typeof content !== "object") {
    return {
      contentType: null,
      uploadFields: [],
      formFields: [],
    };
  }
  const contentType = content["multipart/form-data"]
    ? "multipart/form-data"
    : content["application/json"]
    ? "application/json"
    : Object.keys(content)[0] ?? null;

  const rawSchema = contentType ? content[contentType]?.schema : null;
  const schema = resolveSchemaRef(rawSchema, components);
  const properties = schema?.properties ?? {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);

  const uploadFields = [];
  const formFields = [];

  for (const [name, prop] of Object.entries(properties)) {
    const resolved = resolveSchemaRef(prop, components) ?? {};
    const multiple = isBinaryArraySchema(resolved, components);
    const single = !multiple && isBinarySchema(resolved, components);
    if (single || multiple) {
      const info = {
        name,
        multiple,
        required: required.has(name),
      };
      if (resolved.minItems !== undefined) info.minItems = resolved.minItems;
      if (resolved.maxItems !== undefined) info.maxItems = resolved.maxItems;
      if (resolved.description) info.description = resolved.description;
      uploadFields.push(info);
    } else {
      const fieldInfo = {
        name,
        required: required.has(name),
      };
      if (resolved.type) fieldInfo.type = resolved.type;
      else if (Array.isArray(resolved.anyOf)) {
        fieldInfo.types = resolved.anyOf
          .map((s) => s?.type)
          .filter(Boolean);
      }
      if (resolved.enum) fieldInfo.enum = resolved.enum;
      if (resolved.default !== undefined) fieldInfo.default = resolved.default;
      if (resolved.minimum !== undefined) fieldInfo.minimum = resolved.minimum;
      if (resolved.maximum !== undefined) fieldInfo.maximum = resolved.maximum;
      if (resolved.description) fieldInfo.description = resolved.description;
      formFields.push(fieldInfo);
    }
  }

  return {
    contentType,
    uploadFields,
    formFields,
  };
}

function isJsonMediaType(contentType) {
  if (!contentType) return false;
  const base = contentType.split(";", 1)[0].trim().toLowerCase();
  return base === "application/json" || base.endsWith("+json");
}

export function createPrivaToolsClient({
  baseUrl = process.env.PRIVATOOLS_API_URL ?? DEFAULT_API_URL,
  apiKey = process.env.PRIVATOOLS_API_KEY ?? "",
  allowedDirs = parseAllowedDirs(process.env.PRIVATOOLS_MCP_ALLOWED_DIRS),
  timeoutMs = Number(process.env.PRIVATOOLS_API_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  catalogTtlMs = DEFAULT_CATALOG_TTL_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const displayBaseUrl = sanitizeUrlForDisplay(normalizedBaseUrl);
  const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
  const normalizedAllowedDirs = parseAllowedDirs(allowedDirs);
  const effectiveTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;

  let cachedCatalog = null;
  let cachedCatalogAt = 0;

  function buildAuthHeaders(extra = {}) {
    const headers = { ...extra };
    if (normalizedApiKey) {
      headers["X-API-Key"] = normalizedApiKey;
    }
    return headers;
  }

  async function safeFetch(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    try {
      return await fetchImpl(url, {
        ...options,
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new PrivaToolsError(
          "request_timeout",
          `PrivaTools API request timed out after ${effectiveTimeoutMs} ms.`
        );
      }
      throw new PrivaToolsError(
        "network_error",
        redactSensitiveString(
          `Failed to connect to PrivaTools API (${displayBaseUrl}): ${err?.message ?? err}`,
          normalizedApiKey
        )
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function parseApiError(response) {
    const contentType = response.headers.get("content-type") ?? "";
    const requestId = response.headers.get("x-request-id") ?? undefined;
    const retryAfter = response.headers.get("retry-after") ?? undefined;
    let body = null;
    let text = "";
    try {
      if (isJsonMediaType(contentType)) {
        body = await response.json();
      } else {
        text = await response.text();
      }
    } catch {
      // Fall back to HTTP status text.
    }

    let code = `http_${response.status}`;
    let message = response.statusText || `HTTP ${response.status}`;
    let details;

    if (body && typeof body === "object") {
      if (typeof body.code === "string") {
        code = body.code;
      } else if (body.detail && typeof body.detail === "object" && typeof body.detail.code === "string") {
        code = body.detail.code;
      }

      if (typeof body.message === "string") {
        message = body.message;
      } else if (body.detail && typeof body.detail === "object" && typeof body.detail.message === "string") {
        message = body.detail.message;
      } else if (typeof body.detail === "string") {
        message = body.detail;
      } else if (Array.isArray(body.detail)) {
        message = "Request validation failed.";
        details = body.detail;
      }

      if (Array.isArray(body.errors)) {
        details = body.errors;
      } else if (details === undefined && body.details !== undefined) {
        details = body.details;
      }
    } else if (text.trim()) {
      message = text.trim().slice(0, 500);
    }

    const rawRequestId = body?.request_id ?? requestId;
    return new PrivaToolsError(
      code,
      redactSensitiveString(message, normalizedApiKey),
      {
        status: response.status,
        requestId:
          typeof rawRequestId === "string"
            ? redactSensitiveString(rawRequestId, normalizedApiKey)
            : rawRequestId,
        retryAfter,
        details:
          details !== undefined
            ? redactErrorDetails(details, normalizedApiKey)
            : undefined,
      }
    );
  }

  async function getCatalog({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (
      !forceRefresh &&
      cachedCatalog &&
      catalogTtlMs > 0 &&
      now - cachedCatalogAt < catalogTtlMs
    ) {
      return cachedCatalog;
    }

    const bundled = loadBundledMetadata();

    try {
      const res = await safeFetch(`${normalizedBaseUrl}/operations`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        cachedCatalog = normalizeOperationsCatalog(data);
        cachedCatalogAt = Date.now();
        return cachedCatalog;
      }
    } catch {
      // Try OpenAPI endpoint next.
    }

    try {
      const res = await safeFetch(`${normalizedBaseUrl}/openapi.json`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        cachedCatalog = normalizeOpenApiCatalog(data, bundled);
        cachedCatalogAt = Date.now();
        return cachedCatalog;
      }
    } catch {
      // Fall back to bundled metadata.
    }

    cachedCatalog = buildFallbackCatalog(bundled);
    cachedCatalogAt = Date.now();
    return cachedCatalog;
  }

  function findOperationInCatalog(catalog, rawOperation) {
    const slug = normalizeOperationSlug(rawOperation);
    const lower = slug.toLowerCase();

    const exact = catalog.operations.find(
      (op) => op.operation.toLowerCase() === lower
    );
    if (exact) return exact;

    const byAlias = catalog.operations.find(
      (op) =>
        Array.isArray(op.tool_aliases) &&
        op.tool_aliases.some((alias) => alias.toLowerCase() === lower)
    );
    if (byAlias) return byAlias;

    return null;
  }

  async function resolveOperationTarget(rawOperation) {
    const slug = normalizeOperationSlug(rawOperation);
    let catalog = null;
    try {
      catalog = await getCatalog();
    } catch {
      catalog = buildFallbackCatalog(loadBundledMetadata());
    }
    const entry = findOperationInCatalog(catalog, slug);
    if (entry) {
      return {
        operation: entry.operation,
        entry,
        catalog,
      };
    }
    return {
      operation: slug,
      entry: null,
      catalog,
    };
  }

  async function appendFileToForm(form, fieldName, fileInfo) {
    const bytes = await fs.promises.readFile(fileInfo.path);
    const blob = new Blob([bytes], { type: mimeForFilename(fileInfo.filename) });
    form.append(fieldName, blob, fileInfo.filename);
  }

  async function runTool({
    operation,
    filePath,
    filePaths,
    fileField,
    fileFields,
    params,
    outputPath,
    overwrite = false,
  }) {
    if (filePath && filePaths && filePaths.length > 0) {
      throw new PrivaToolsError(
        "invalid_arguments",
        "Provide either file_path or file_paths, not both."
      );
    }

    const { operation: resolvedSlug, entry, catalog } =
      await resolveOperationTarget(operation);
    const method = entry?.method ?? "POST";
    const bodyInfo = entry
      ? inspectOperationBodySchema(entry, catalog?.components)
      : { contentType: null, uploadFields: [], formFields: [] };

    // Validate and resolve all local input files before any network call.
    const validatedInputPaths = [];
    const uploads = [];

    if (fileFields && typeof fileFields === "object" && !Array.isArray(fileFields)) {
      for (const [fieldName, value] of Object.entries(fileFields)) {
        const list = Array.isArray(value) ? value : [value];
        for (const p of list) {
          const info = await validateInputFile(p, normalizedAllowedDirs);
          validatedInputPaths.push(info.path);
          uploads.push({ fieldName, info });
        }
      }
    }

    const positionalPaths =
      filePath !== undefined && filePath !== null && filePath !== ""
        ? [filePath]
        : Array.isArray(filePaths)
        ? filePaths
        : [];

    if (positionalPaths.length > 0) {
      const validated = [];
      for (const p of positionalPaths) {
        const info = await validateInputFile(p, normalizedAllowedDirs);
        validatedInputPaths.push(info.path);
        validated.push(info);
      }

      if (typeof fileField === "string" && fileField.trim()) {
        const chosen = fileField.trim();
        for (const info of validated) {
          uploads.push({ fieldName: chosen, info });
        }
      } else if (bodyInfo.uploadFields.length === 1) {
        const chosen = bodyInfo.uploadFields[0].name;
        for (const info of validated) {
          uploads.push({ fieldName: chosen, info });
        }
      } else if (
        bodyInfo.uploadFields.length > 1 &&
        bodyInfo.uploadFields.every((f) => !f.multiple) &&
        validated.length === bodyInfo.uploadFields.length
      ) {
        for (let i = 0; i < validated.length; i += 1) {
          uploads.push({
            fieldName: bodyInfo.uploadFields[i].name,
            info: validated[i],
          });
        }
      } else {
        const arrayField = bodyInfo.uploadFields.find((f) => f.multiple);
        const fallbackField =
          validated.length > 1 || Array.isArray(filePaths)
            ? arrayField?.name ?? "files"
            : bodyInfo.uploadFields[0]?.name ?? "file";
        for (const info of validated) {
          uploads.push({ fieldName: fallbackField, info });
        }
      }
    }

    // Validate explicit output_path up-front (before uploading files) to fail fast
    // on path traversal or disallowed directories.
    if (outputPath !== undefined && outputPath !== null && outputPath !== "") {
      if (typeof outputPath !== "string" || outputPath.includes("\0")) {
        throw new PrivaToolsError("invalid_path", "output_path is invalid.");
      }
      const absPrecheck = path.resolve(outputPath);
      const precheckReal = await resolveDeepestRealPath(absPrecheck);
      assertWithinAllowedDirs(precheckReal, normalizedAllowedDirs, "Output");
      await assertNotSymlink(absPrecheck);
      if (precheckReal !== absPrecheck) {
        await assertNotSymlink(precheckReal);
      }
      if (!overwrite) {
        try {
          const st = await fs.promises.lstat(precheckReal);
          if (st.isDirectory()) {
            throw new PrivaToolsError(
              "output_is_directory",
              `output_path points to a directory, not a file: ${precheckReal}`
            );
          }
          throw new PrivaToolsError(
            "output_exists",
            `Output file already exists: ${precheckReal}. Pass overwrite: true or choose a different output_path.`
          );
        } catch (err) {
          if (err instanceof PrivaToolsError) throw err;
        }
      }
    }

    const url = new URL(`${normalizedBaseUrl}/${resolvedSlug}`);
    const fetchOptions = {
      method,
      headers: buildAuthHeaders(),
    };

    const safeParams =
      params && typeof params === "object" && !Array.isArray(params)
        ? params
        : {};

    if (method === "GET" || method === "HEAD") {
      for (const [key, value] of Object.entries(safeParams)) {
        if (value === undefined) continue;
        url.searchParams.set(
          key,
          typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : String(value)
        );
      }
    } else if (
      uploads.length === 0 &&
      bodyInfo.contentType === "application/json"
    ) {
      fetchOptions.headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(safeParams);
    } else {
      const form = new FormData();
      for (const upload of uploads) {
        await appendFileToForm(form, upload.fieldName, upload.info);
      }
      for (const [key, value] of Object.entries(safeParams)) {
        if (value === undefined) continue;
        if (value === null) {
          form.append(key, "");
        } else if (typeof value === "object") {
          form.append(key, JSON.stringify(value));
        } else {
          form.append(key, String(value));
        }
      }
      fetchOptions.body = form;
    }

    const response = await safeFetch(url.toString(), fetchOptions);
    if (!response.ok) {
      throw await parseApiError(response);
    }

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
    const relevantHeaders = extractRelevantHeaders(response.headers);

    if (isJsonMediaType(contentType)) {
      const rawText = await response.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = rawText;
      }
      const result = {
        ok: true,
        operation: resolvedSlug,
        media_type: mediaType || "application/json",
        data,
        headers: relevantHeaders,
      };
      if (outputPath !== undefined && outputPath !== null && outputPath !== "") {
        const target = await resolveOutputTarget({
          explicitOutputPath: outputPath,
          inputPaths: validatedInputPaths,
          operation: resolvedSlug,
          mediaType: "application/json",
          contentDisposition: response.headers.get("content-disposition"),
          allowedDirs: normalizedAllowedDirs,
        });
        const buf = Buffer.from(rawText, "utf8");
        const savedPath = await writeBufferSafely({
          buffer: buf,
          targetPath: target.targetPath,
          isAutoNamed: target.isAutoNamed,
          overwrite,
          allowedDirs: normalizedAllowedDirs,
        });
        result.output_path = savedPath;
        result.bytes = buf.length;
      }
      return result;
    }

    const arrayBuf = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const target = await resolveOutputTarget({
      explicitOutputPath: outputPath,
      inputPaths: validatedInputPaths,
      operation: resolvedSlug,
      mediaType,
      contentDisposition: response.headers.get("content-disposition"),
      allowedDirs: normalizedAllowedDirs,
    });
    const savedPath = await writeBufferSafely({
      buffer,
      targetPath: target.targetPath,
      isAutoNamed: target.isAutoNamed,
      overwrite,
      allowedDirs: normalizedAllowedDirs,
    });

    return {
      ok: true,
      operation: resolvedSlug,
      output_path: savedPath,
      bytes: buffer.length,
      media_type: mediaType,
      filename: target.serverFilename ?? path.basename(savedPath),
      headers: relevantHeaders,
    };
  }

  async function submitJob({
    operation,
    filePath,
    filePaths,
    options = {},
    idempotencyKey,
  }) {
    if (filePath && filePaths && filePaths.length > 0) {
      throw new PrivaToolsError(
        "invalid_arguments",
        "Provide either file_path or file_paths, not both."
      );
    }
    const opSlug = normalizeOperationSlug(operation);
    const paths =
      filePath !== undefined && filePath !== null && filePath !== ""
        ? [filePath]
        : Array.isArray(filePaths)
        ? filePaths
        : [];
    if (paths.length === 0) {
      throw new PrivaToolsError(
        "invalid_arguments",
        "At least one input file (file_path or file_paths) is required to submit a job."
      );
    }
    if (
      options !== undefined &&
      (options === null || typeof options !== "object" || Array.isArray(options))
    ) {
      throw new PrivaToolsError(
        "invalid_arguments",
        "options must be a JSON object."
      );
    }

    const key =
      idempotencyKey !== undefined && idempotencyKey !== ""
        ? validateIdempotencyKey(idempotencyKey)
        : `mcp-${crypto.randomUUID()}`;

    const validatedFiles = [];
    for (const p of paths) {
      validatedFiles.push(await validateInputFile(p, normalizedAllowedDirs));
    }

    const form = new FormData();
    form.append("operation", opSlug);
    form.append("options", JSON.stringify(options ?? {}));
    for (const fileInfo of validatedFiles) {
      await appendFileToForm(form, "files", fileInfo);
    }

    const response = await safeFetch(`${normalizedBaseUrl}/jobs`, {
      method: "POST",
      headers: buildAuthHeaders({
        "Idempotency-Key": key,
      }),
      body: form,
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    const job = await response.json();
    return {
      ok: true,
      idempotency_key: key,
      job,
      headers: extractRelevantHeaders(response.headers),
    };
  }

  async function getJobStatus(jobId) {
    const id = validateJobId(jobId);
    const response = await safeFetch(
      `${normalizedBaseUrl}/jobs/${encodeURIComponent(id)}`,
      {
        method: "GET",
        headers: buildAuthHeaders({ Accept: "application/json" }),
      }
    );
    if (!response.ok) {
      throw await parseApiError(response);
    }
    const job = await response.json();
    return {
      ok: true,
      job,
      headers: extractRelevantHeaders(response.headers),
    };
  }

  async function downloadJobResult({
    jobId,
    outputPath,
    overwrite = false,
  }) {
    const id = validateJobId(jobId);

    if (outputPath !== undefined && outputPath !== null && outputPath !== "") {
      if (typeof outputPath !== "string" || outputPath.includes("\0")) {
        throw new PrivaToolsError("invalid_path", "output_path is invalid.");
      }
      const absPrecheck = path.resolve(outputPath);
      const precheckReal = await resolveDeepestRealPath(absPrecheck);
      assertWithinAllowedDirs(precheckReal, normalizedAllowedDirs, "Output");
      await assertNotSymlink(absPrecheck);
      if (precheckReal !== absPrecheck) {
        await assertNotSymlink(precheckReal);
      }
      if (!overwrite) {
        try {
          const st = await fs.promises.lstat(precheckReal);
          if (st.isDirectory()) {
            throw new PrivaToolsError(
              "output_is_directory",
              `output_path points to a directory, not a file: ${precheckReal}`
            );
          }
          throw new PrivaToolsError(
            "output_exists",
            `Output file already exists: ${precheckReal}. Pass overwrite: true or choose a different output_path.`
          );
        } catch (err) {
          if (err instanceof PrivaToolsError) throw err;
        }
      }
    }

    const response = await safeFetch(
      `${normalizedBaseUrl}/jobs/${encodeURIComponent(id)}/result`,
      {
        method: "GET",
        headers: buildAuthHeaders(),
      }
    );
    if (!response.ok) {
      throw await parseApiError(response);
    }

    const contentType =
      response.headers.get("content-type") ?? "application/octet-stream";
    const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
    const relevantHeaders = extractRelevantHeaders(response.headers);

    if (
      isJsonMediaType(contentType) &&
      (outputPath === undefined || outputPath === null || outputPath === "")
    ) {
      const data = await response.json();
      return {
        ok: true,
        job_id: id,
        media_type: mediaType || "application/json",
        data,
        headers: relevantHeaders,
      };
    }

    const arrayBuf = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const target = await resolveOutputTarget({
      explicitOutputPath: outputPath,
      inputPaths: [],
      operation: `job-${id}`,
      mediaType,
      contentDisposition: response.headers.get("content-disposition"),
      allowedDirs: normalizedAllowedDirs,
    });
    const savedPath = await writeBufferSafely({
      buffer,
      targetPath: target.targetPath,
      isAutoNamed: target.isAutoNamed,
      overwrite,
      allowedDirs: normalizedAllowedDirs,
    });

    return {
      ok: true,
      job_id: id,
      output_path: savedPath,
      bytes: buffer.length,
      media_type: mediaType,
      filename: target.serverFilename ?? path.basename(savedPath),
      headers: relevantHeaders,
    };
  }

  async function deleteJob(jobId) {
    const id = validateJobId(jobId);
    const response = await safeFetch(
      `${normalizedBaseUrl}/jobs/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: buildAuthHeaders({ Accept: "application/json" }),
      }
    );
    if (!response.ok) {
      throw await parseApiError(response);
    }
    const deletion = await response.json();
    return {
      ok: true,
      deletion,
      headers: extractRelevantHeaders(response.headers),
    };
  }

  return {
    baseUrl: displayBaseUrl,
    hasApiKey: Boolean(normalizedApiKey),
    allowedDirs: normalizedAllowedDirs,
    getCatalog,
    findOperationInCatalog,
    runTool,
    submitJob,
    getJobStatus,
    downloadJobResult,
    deleteJob,
  };
}
