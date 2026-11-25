# PrivaTools MCP — Verified One-Click Install Links (Cursor & VS Code)

> Every link below is generated programmatically from canonical `@privatools/mcp` and `https://api.privatools.me/mcp` configurations.

---

## Cursor One-Click Deeplinks

**Verified Schema Gotcha ([`cursor.com/docs/mcp/install-links`](https://cursor.com/docs/mcp/install-links)):**  
Cursor's `config` query parameter MUST Base64-encode the **unwrapped inner server configuration object** — NEVER wrapped in `{"privatools": { ... }}`.

### 1. Cursor — Local Stdio (`@privatools/mcp`)

- **Unwrapped JSON before Base64:**
  ```json
  {"command":"npx","args":["-y","@privatools/mcp"]}
  ```
- **Base64 Payload:** `eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBwcml2YXRvb2xzL21jcCJdfQ==`
- **Deeplink URI:**
  ```text
  cursor://anysphere.cursor-deeplink/mcp/install?name=privatools&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBwcml2YXRvb2xzL21jcCJdfQ%3D%3D
  ```

### 2. Cursor — Remote Streamable HTTP (`https://api.privatools.me/mcp`)

- **Unwrapped JSON before Base64:**
  ```json
  {"url":"https://api.privatools.me/mcp"}
  ```
- **Base64 Payload:** `eyJ1cmwiOiJodHRwczovL2FwaS5wcml2YXRvb2xzLm1lL21jcCJ9`
- **Deeplink URI:**
  ```text
  cursor://anysphere.cursor-deeplink/mcp/install?name=privatools&config=eyJ1cmwiOiJodHRwczovL2FwaS5wcml2YXRvb2xzLm1lL21jcCJ9
  ```

---

## VS Code & VS Code Insiders One-Click Deeplinks

**Verified Specification ([`code.visualstudio.com/api/extension-guides/ai/mcp`](https://code.visualstudio.com/api/extension-guides/ai/mcp)):**  
GitHub READMEs strip custom URI schemes (`vscode:` / `cursor:`), so always wrap VS Code links through the `https://vscode.dev/redirect` wrapper with a URL-encoded `url` parameter for Markdown badges and web docs.

### 1. VS Code — Local Stdio (`@privatools/mcp`)

- **Config JSON:**
  ```json
  {"name":"privatools","command":"npx","args":["-y","@privatools/mcp"]}
  ```
- **Direct URI (Stable):**
  ```text
  vscode:mcp/install?%7B%22name%22%3A%22privatools%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40privatools%2Fmcp%22%5D%7D
  ```
- **Shareable Redirect Link (VS Code Stable):**
  ```text
  https://vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522privatools%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540privatools%252Fmcp%2522%255D%257D
  ```
- **Shareable Redirect Link (VS Code Insiders):**
  ```text
  https://vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522privatools%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540privatools%252Fmcp%2522%255D%257D
  ```

### 2. VS Code — Remote Streamable HTTP (`https://api.privatools.me/mcp`)

- **Config JSON:**
  ```json
  {"name":"privatools","type":"http","url":"https://api.privatools.me/mcp"}
  ```
- **Direct URI (Stable):**
  ```text
  vscode:mcp/install?%7B%22name%22%3A%22privatools%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fapi.privatools.me%2Fmcp%22%7D
  ```
- **Shareable Redirect Link (VS Code Stable):**
  ```text
  https://vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522privatools%2522%252C%2522type%2522%253A%2522http%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fapi.privatools.me%252Fmcp%2522%257D
  ```
- **Shareable Redirect Link (VS Code Insiders):**
  ```text
  https://vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522privatools%2522%252C%2522type%2522%253A%2522http%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fapi.privatools.me%252Fmcp%2522%257D
  ```

### 3. VS Code — Official MCP Registry Lookup (After Registry Publish)

Canonical namespace published to `registry.modelcontextprotocol.io` (`io.github.ethereaglehq/privatools`):

- **VS Code Stable:**
  ```text
  https://vscode.dev/redirect?url=vscode%3Amcp%2Fby-name%2Fio.github.ethereaglehq%2Fprivatools
  ```
- **VS Code Insiders:**
  ```text
  https://vscode.dev/redirect?url=vscode-insiders%3Amcp%2Fby-name%2Fio.github.ethereaglehq%2Fprivatools
  ```

---

## Ready-to-Paste Markdown Badges (for `README.md` & `https://privatools.me/mcp`)

```markdown
[![Install in VS Code (Local)](https://img.shields.io/badge/VS_Code-Install_PrivaTools_MCP-0098FF?style=flat-square&logo=visualstudiocode)](https://vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522privatools%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540privatools%252Fmcp%2522%255D%257D)
[![Install in VS Code (Remote)](https://img.shields.io/badge/VS_Code-Install_PrivaTools_Remote-0098FF?style=flat-square&logo=visualstudiocode)](https://vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522privatools%2522%252C%2522type%2522%253A%2522http%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fapi.privatools.me%252Fmcp%2522%257D)
```

> **Note on Cursor badges:** On `https://privatools.me/mcp` (where custom `cursor://` links are permitted), link directly to the Cursor deeplink URIs listed above. On GitHub Markdown (which strips non-HTTP(S) schemes), link to `https://privatools.me/mcp` or provide the `.cursor/mcp.json` snippet directly.
