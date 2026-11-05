# `@safechat/mcp-sdk` — Official SafeChat MCP Marketplace Developer SDK

Welcome to the **SafeChat Developer Platform**.

SafeChat enables law firms, healthcare providers, recruitment agencies, and financial institutions to use AI tools with **zero GDPR / personal-data exposure**.

When you build a tool for the **SafeChat Marketplace**, **SafeChat handles 100% of the privacy compliance, client-side PII scrubbing, customer authentication, and Stripe billing**—so you can focus purely on your domain logic and get paid automatically.

---

## 1. How It Works (In 60 Seconds)

As a SafeChat Marketplace developer, **your server never touches raw Personal Identifiable Information (PII)**—meaning you carry **zero GDPR sub-processor liability**.

### The Golden Rule for Developers: **"Preserve the Brackets"**
- SafeChat replaces sensitive identifiers in the customer's browser with bracketed tokens like `[PERSON_1]`, `[COMPANY_2]`, `[IMC_1]`, or `[DATE_1]`.
- Your tool processes the text or data and leaves those `[TOKEN_N]` strings intact in your output (whether you return Markdown, JSON, HTML, CSV, or a `.docx` file).
- The moment your response reaches the customer's browser, SafeChat automatically swaps `[PERSON_1]` back to `"Dr Aoife Murphy"` locally on their screen!

---

## 2. What Your Server Needs to Expose

A SafeChat-compatible MCP server is a standard HTTPS web service (hosted anywhere you like—Cloudflare Workers, Vercel, Railway, Fly.io, AWS, or your own VPS) that exposes **two endpoints**:

| Endpoint | Purpose |
| :--- | :--- |
| **`GET /manifest`** | Returns a JSON manifest describing your server, your tools, which industry verticals should see them, your pricing/trial terms, and your input schema. |
| **`POST /mcp`** | Standard Model Context Protocol (JSON-RPC 2.0 `tools/call`) endpoint that receives the sanitised input from SafeChat and returns your tool's output. |

---

## 3. Quick Start

```bash
git clone https://github.com/sensible/safechat-mcp-sdk.git
cd safechat-mcp-sdk
npm install
npm test
npm run example
```

In a second terminal, run the 5-point Automated Conformance Checker against your local server:
```bash
npm run verify -- http://localhost:4200
```

See [`safechat-mcp-manifest.schema.json`](./safechat-mcp-manifest.schema.json) and [`examples/starter-server/server.ts`](./examples/starter-server/server.ts) for a complete, ready-to-deploy template.
