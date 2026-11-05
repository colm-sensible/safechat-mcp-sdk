# `@safechat/mcp-sdk`

## Purpose
Public MIT-licensed Developer SDK, Manifest JSON Schema, Server Handler, and 5-Point Automated Conformance Verifier for external developers building commercial or free tools for the SafeChat MCP Marketplace.

## Ownership
- `safechat-mcp-manifest.schema.json` — Canonical JSON Schema (`v1.0`) for `GET /manifest`.
- `src/schema.ts` — TypeScript types (`SafeChatMcpServerManifest`, `SafeChatMcpToolPricing`, `OrgToolSubscription`), manifest validator (`validateSafeChatManifest`), and least-privilege `filterTokenMetadata`.
- `src/server-helper.ts` — `createSafeChatMcpHandler`, `signSafeChatPayload`, and `verifySafeChatSignature` (`X-SafeChat-Signature` HMAC-SHA256).
- `src/conformance.ts` & `src/cli.ts` — Automated 5-point conformance probe (`verifyMcpServerEndpoint`).
- `examples/starter-server/server.ts` — Reference starter MCP server.

## Verification
- Run `npm test` (`vitest run`).
