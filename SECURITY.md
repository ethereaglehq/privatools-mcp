# Security Policy

`@privatools/mcp` is the MIT-licensed, zero-dependency Model Context Protocol (MCP) client/server for the PrivaTools file-processing API. This policy explains how to report security issues and what to expect after a report.

## Reporting a Vulnerability

Please report suspected vulnerabilities by email:

- Contact: hello@privatools.me
- Subject prefix: `[Security]`
- Public policy page: https://privatools.me/security

You can also report privately through GitHub: **Security → Report a vulnerability** on this repository ([direct link](https://github.com/ethereaglehq/privatools-mcp/security/advisories/new)).

Include enough detail for us to reproduce the issue safely:

- Affected package version (`@privatools/mcp`), container digest (`ghcr.io/ethereaglehq/privatools-mcp`), or endpoint (`https://api.privatools.me/mcp`)
- Node.js version, MCP host/client, operating system, and approximate time of testing
- Steps to reproduce
- Impact, including whether local files outside `PRIVATOOLS_MCP_ALLOWED_DIRS`, API credentials (`PRIVATOOLS_API_KEY`), temporary outputs, or user metadata could be exposed
- Proof-of-concept details that avoid exposing another person's data

Do not publicly disclose a vulnerability before we have had a reasonable chance to investigate and ship a fix.

## Scope

In scope:

- `@privatools/mcp` stdio server, JSON-RPC protocol handling, and API client in `ethereaglehq/privatools-mcp`
- Filesystem sandboxing (`PRIVATOOLS_MCP_ALLOWED_DIRS` / `fs.realpath` containment) and output-file overwrite protection
- Secret/header handling (`PRIVATOOLS_API_KEY` / `X-API-Key` redaction and stdout isolation)
- `.mcpb` bundle packaging (`scripts/build-mcpb.mjs`), `Dockerfile`, and `ghcr.io/ethereaglehq/privatools-mcp` container images
- Hosted MCP endpoint (`https://api.privatools.me/mcp`) and MCP documentation (`https://privatools.me/mcp`)

Out of scope:

- Denial-of-service testing, volumetric load testing, or automated scanning that degrades service
- Social engineering, phishing, or physical attacks
- Vulnerabilities in third-party MCP hosts or services outside our control unless they create a concrete `@privatools/mcp` exposure
- Reports that rely only on missing best-practice headers without a practical exploit path

## Response Expectations

We aim to acknowledge security reports within 72 hours. Fix timing depends on severity, reproducibility, and release risk. High-impact issues involving filesystem sandbox escape, credential leakage, arbitrary file overwrite, remote code execution, or supply-chain compromise are prioritized first.

## Supported Versions

Security fixes ship in a new `@privatools/mcp` release on npm (published with Sigstore provenance via GitHub Actions OIDC) and a corresponding signed `ghcr.io/ethereaglehq/privatools-mcp` image rather than being backported to older releases.

## Safe Harbor

Good-faith research is welcome when it avoids privacy harm, data destruction, service disruption, and access to data that is not yours. If you accidentally access sensitive data while testing, stop immediately and include only the minimum evidence needed in your report.
