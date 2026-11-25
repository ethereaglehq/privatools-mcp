# syntax=docker/dockerfile:1
# Hardened, non-root, multi-arch (linux/amd64, linux/arm64) image for @privatools/mcp.
# Pure Node.js ESM with zero external runtime dependencies and zero RUN layers so
# BuildKit builds both architectures natively without QEMU emulation.
# Base tag pinned to Node 24 LTS Alpine (update/pin digest via Dependabot docker ecosystem).
FROM node:24-alpine

LABEL org.opencontainers.image.title="PrivaTools MCP Server" \
      org.opencontainers.image.description="Stateless privacy-first PDF, image, document, and media processing tools via PrivaTools API." \
      org.opencontainers.image.url="https://privatools.me/mcp" \
      org.opencontainers.image.documentation="https://privatools.me/mcp" \
      org.opencontainers.image.source="https://github.com/ethereaglehq/privatools-mcp" \
      org.opencontainers.image.vendor="PrivaTools" \
      org.opencontainers.image.licenses="MIT"

# Official MCP Registry OCI ownership label (canonical GitHub OIDC namespace):
LABEL io.modelcontextprotocol.server.name="io.github.ethereaglehq/privatools"

WORKDIR /app

COPY --chown=node:node package.json README.md LICENSE ./
COPY --chown=node:node bin/ ./bin/
COPY --chown=node:node src/ ./src/
COPY --chown=node:node data/ ./data/

ENV NODE_ENV=production

# Run strictly as the built-in unprivileged node user (UID/GID 1000).
USER node

ENTRYPOINT ["node", "/app/bin/privatools-mcp.mjs"]
