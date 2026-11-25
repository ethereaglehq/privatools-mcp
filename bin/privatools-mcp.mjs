#!/usr/bin/env node

import fs from "node:fs";
import { createPrivaToolsClient, DEFAULT_API_URL } from "../src/client.mjs";
import { createMcpServer } from "../src/protocol.mjs";
import { createPrivaToolsTools, SERVER_INSTRUCTIONS } from "../src/tools.mjs";

const PKG = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

const SERVER_TITLE = "PrivaTools";
const SERVER_DESCRIPTION =
  "Stateless privacy-first PDF, image, document, and media processing tools via the PrivaTools API.";
const SERVER_WEBSITE_URL = "https://privatools.me";
const SERVER_ICONS = [
  {
    src: "https://privatools.me/icons/icon-512.png",
    mimeType: "image/png",
    sizes: ["512x512"],
  },
  {
    src: "https://privatools.me/icons/icon-192.png",
    mimeType: "image/png",
    sizes: ["192x192"],
  },
];

function printHelp() {
  process.stdout.write(`PrivaTools MCP Server (${PKG.name} v${PKG.version})

Stateless Model Context Protocol (MCP) stdio server for the PrivaTools API.

Usage:
  privatools-mcp              Start the MCP JSON-RPC 2.0 server over stdio
  privatools-mcp --version    Print server version and exit
  privatools-mcp --help       Print this help message and exit

Environment variables:
  PRIVATOOLS_API_URL          PrivaTools-compatible API v1 base URL (default: ${DEFAULT_API_URL})
  PRIVATOOLS_API_KEY          Optional account API key sent as X-API-Key
  PRIVATOOLS_MCP_ALLOWED_DIRS Optional path-delimiter-separated sandbox allowlist for local
                              file reads and writes (':' on Linux/macOS, ';' on Windows)
  PRIVATOOLS_API_TIMEOUT_MS   HTTP timeout in milliseconds (default: 120000)
  PRIVATOOLS_MCP_DEBUG        Set to '1' to emit diagnostic logs to stderr (never stdout)
`);
}

function parseCliArgs(argv) {
  if (argv.length === 0) {
    return { action: "serve" };
  }
  if (argv.length === 1) {
    const arg = argv[0];
    if (arg === "--help" || arg === "-h" || arg === "help") {
      return { action: "help" };
    }
    if (arg === "--version" || arg === "-v") {
      return { action: "version" };
    }
  }
  throw new Error(`Unknown argument(s): ${argv.join(" ")}. Run 'privatools-mcp --help'.`);
}

async function main(argv) {
  const { action } = parseCliArgs(argv);

  if (action === "help") {
    printHelp();
    return 0;
  }

  if (action === "version") {
    process.stdout.write(`${PKG.name} ${PKG.version}\n`);
    return 0;
  }

  const debug = process.env.PRIVATOOLS_MCP_DEBUG === "1";
  const logger = debug
    ? (msg) => process.stderr.write(`[privatools-mcp] ${msg}\n`)
    : null;

  const client = createPrivaToolsClient();
  const tools = createPrivaToolsTools(client);
  const server = createMcpServer({
    name: PKG.name,
    version: PKG.version,
    title: SERVER_TITLE,
    description: SERVER_DESCRIPTION,
    websiteUrl: SERVER_WEBSITE_URL,
    icons: SERVER_ICONS,
    instructions: SERVER_INSTRUCTIONS,
    tools,
    logger,
  });

  const session = server.serveStdio({
    input: process.stdin,
    output: process.stdout,
    error: process.stderr,
  });

  const handleSignal = () => {
    session.close();
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  try {
    await session.done;
    return 0;
  } finally {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`privatools-mcp: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
