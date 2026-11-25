#!/usr/bin/env node
/**
 * Zero-dependency MCP Bundle (.mcpb) validator and ZIP packager for @privatools/mcp.
 *
 * Usage:
 *   node scripts/build-mcpb.mjs --check
 *   node scripts/build-mcpb.mjs --output /tmp/privatools-mcp.mcpb
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "manifest.json");
const PACKAGE_PATH = path.join(REPO_ROOT, "package.json");
const DEFAULT_ICON_SRC = path.join(
  REPO_ROOT,
  "docs",
  "listings",
  "assets",
  "icon-512.png"
);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Create a deterministic PKZIP archive (Deflate method 8) using pure Node built-ins.
 * @param {Array<{ name: string, data: Buffer, mode?: number }>} entries
 * @returns {Buffer}
 */
function buildZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  // Fixed DOS timestamp (2026-01-01 00:00:00) for reproducible builds.
  const dosTime = 0x0000;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replaceAll("\\", "/"), "utf8");
    const rawData = entry.data;
    const compressed = zlib.deflateRawSync(rawData, { level: 9 });
    const checksum = crc32(rawData);
    const unixMode = (entry.mode ?? 0o100644) >>> 0;

    // Local File Header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed: 2.0
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(8, 8); // compression method: deflate
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localParts.push(localHeader, nameBuf, compressed);

    // Central Directory Header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, version 2.0
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(8, 10); // deflate
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE((unixMode << 16) >>> 0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // relative local header offset

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`MCPB validation failed: ${message}`);
  }
}

function collectFilesRecursive(baseDir, relSubdir) {
  const results = [];
  const fullDir = path.join(baseDir, relSubdir);
  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relPath = path.posix.join(relSubdir, entry.name);
    const fullPath = path.join(fullDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursive(baseDir, relPath));
    } else if (entry.isFile()) {
      results.push({ relPath, fullPath });
    }
  }
  return results;
}

export function validateManifestAndInputs({ iconSrc = DEFAULT_ICON_SRC } = {}) {
  assert(fs.existsSync(MANIFEST_PATH), `missing ${MANIFEST_PATH}`);
  assert(fs.existsSync(PACKAGE_PATH), `missing ${PACKAGE_PATH}`);

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8"));

  assert(manifest.manifest_version === "0.3", `manifest_version must be "0.3", got ${JSON.stringify(manifest.manifest_version)}`);
  assert(typeof manifest.name === "string" && /^[a-z0-9][a-z0-9-]*$/.test(manifest.name), "invalid manifest.name");
  assert(typeof manifest.display_name === "string" && manifest.display_name.trim().length > 0, "display_name is required");
  assert(typeof manifest.version === "string" && SEMVER_RE.test(manifest.version), "version must be exact semver");
  assert(manifest.version === pkg.version, `manifest version (${manifest.version}) must match package.json (${pkg.version})`);
  assert(typeof manifest.description === "string" && manifest.description.trim().length > 0, "description is required");

  assert(
    Array.isArray(manifest.privacy_policies) &&
      manifest.privacy_policies.length > 0 &&
      manifest.privacy_policies.every((u) => typeof u === "string" && u.startsWith("https://")),
    "privacy_policies must contain at least one https:// URL"
  );

  assert(manifest.server && typeof manifest.server === "object", "server section is required");
  assert(manifest.server.type === "node", `server.type must be "node", got ${JSON.stringify(manifest.server.type)}`);
  assert(typeof manifest.server.entry_point === "string" && manifest.server.entry_point.length > 0, "server.entry_point is required");

  const entryAbs = path.resolve(REPO_ROOT, manifest.server.entry_point);
  assert(entryAbs.startsWith(REPO_ROOT + path.sep), "server.entry_point must stay inside repository root");
  assert(fs.existsSync(entryAbs), `server.entry_point not found: ${entryAbs}`);

  const mcpCfg = manifest.server.mcp_config;
  assert(mcpCfg && typeof mcpCfg === "object", "server.mcp_config is required");
  assert(typeof mcpCfg.command === "string" && mcpCfg.command.length > 0, "server.mcp_config.command is required");
  assert(Array.isArray(mcpCfg.args) && mcpCfg.args.length > 0, "server.mcp_config.args must be a non-empty array");

  assert(manifest.user_config && typeof manifest.user_config === "object", "user_config is required");
  assert(manifest.user_config.api_key?.sensitive === true, "user_config.api_key must mark sensitive: true");
  assert(manifest.user_config.allowed_dirs?.type === "directory", "user_config.allowed_dirs must have type 'directory'");

  assert(typeof manifest.icon === "string" && manifest.icon.endsWith(".png"), "icon must reference a .png filename");
  assert(fs.existsSync(iconSrc), `icon source PNG not found: ${iconSrc}`);
  const iconBuf = fs.readFileSync(iconSrc);
  assert(
    iconBuf.length > 8 && iconBuf.subarray(0, 8).equals(PNG_SIGNATURE),
    `icon source is not a valid PNG: ${iconSrc}`
  );

  const payloadFiles = [
    { relPath: "manifest.json", fullPath: MANIFEST_PATH },
    { relPath: "package.json", fullPath: PACKAGE_PATH },
    { relPath: "README.md", fullPath: path.join(REPO_ROOT, "README.md") },
    { relPath: "LICENSE", fullPath: path.join(REPO_ROOT, "LICENSE") },
    ...collectFilesRecursive(REPO_ROOT, "bin"),
    ...collectFilesRecursive(REPO_ROOT, "src"),
    ...collectFilesRecursive(REPO_ROOT, "data"),
  ];

  for (const f of payloadFiles) {
    assert(fs.existsSync(f.fullPath), `payload file missing: ${f.fullPath}`);
  }

  return { manifest, pkg, iconBuf, payloadFiles };
}

function parseArgs(argv) {
  let checkOnly = false;
  let outputPath = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") {
      checkOnly = true;
    } else if (arg === "--output" || arg === "-o") {
      outputPath = argv[i + 1];
      if (!outputPath) {
        throw new Error(`${arg} requires a file path argument.`);
      }
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage:\n  node scripts/build-mcpb.mjs --check\n  node scripts/build-mcpb.mjs --output <path.mcpb>\n"
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { checkOnly, outputPath };
}

function main() {
  const { checkOnly, outputPath } = parseArgs(process.argv.slice(2));
  const { manifest, iconBuf, payloadFiles } = validateManifestAndInputs();

  if (checkOnly) {
    process.stdout.write(
      `OK: manifest.json (v${manifest.manifest_version}, ${manifest.name}@${manifest.version}) + ${payloadFiles.length + 1} bundle entries validated.\n`
    );
    return;
  }

  const dest = path.resolve(
    outputPath ?? path.join(REPO_ROOT, `${manifest.name}-${manifest.version}.mcpb`)
  );
  const zipEntries = payloadFiles.map(({ relPath, fullPath }) => {
    const st = fs.statSync(fullPath);
    const isExec = (st.mode & 0o111) !== 0 || relPath.startsWith("bin/");
    return {
      name: relPath,
      data: fs.readFileSync(fullPath),
      mode: isExec ? 0o100755 : 0o100644,
    };
  });
  zipEntries.push({
    name: manifest.icon,
    data: iconBuf,
    mode: 0o100644,
  });
  zipEntries.sort((a, b) => a.name.localeCompare(b.name));

  const zipBuf = buildZipBuffer(zipEntries);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, zipBuf);

  const sha256 = crypto.createHash("sha256").update(zipBuf).digest("hex");
  process.stdout.write(
    `Built ${dest} (${zipEntries.length} entries, ${zipBuf.length} bytes, sha256=${sha256})\n`
  );
}

main();
