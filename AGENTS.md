# `@safechat/mcp-sdk` (v2.0)

## Purpose
Public MIT-licensed Developer SDK, Universal Tool Factory (`defineSafeChatMcpTool`), Country Jurisdiction Scrubber Packs (`EdgeJurisdictionScrubber`, `validateIrishPpsn`, `validateIbanMod97`, `validateUkNino`), Manifest JSON Schema (`v1.0` & `v2.0`), Server Handler, and 5-Point Automated Conformance Verifier for internal and external developers building tools for the SafeChat MCP Marketplace.

## Ownership
- `safechat-mcp-manifest.schema.json` — Canonical JSON Schema (`v1.0` & `v2.0`) for `GET /manifest`.
- `src/schema.ts` — TypeScript types (`SafeChatMcpServerManifest`, `SafeChatMcpToolDefinition`, `SafeChatToolUiSchema`, `SafeChatToolPrivacyPolicy`, `SanitisedEnvelope`), manifest validator (`validateSafeChatManifest`), and least-privilege `filterTokenMetadata`.
- `src/jurisdictions.ts` — Boundary 1 (Browser Edge & Test Harness) Jurisdiction Scrubber & Rehydrator (`EdgeJurisdictionScrubber`), statutory checksum validators (`validateIrishPpsn`, `validateIbanMod97`, `validateUkNino`), and `DpcEvidenceCertificate` generator.
- `src/factory.ts` — Universal Tool Factory (`defineSafeChatMcpTool`, `createSafeChatMcpServerFromTools`, `runToolVerificationFixture`, `generateAppletManifest`, `invokeSafeChatLlm`) enforcing the 3-Boundary Zero-Knowledge Protocol (Stage A `deterministicEngine` $\rightarrow$ Stage B `llmSynthesize`).
- `src/server-helper.ts` — `createSafeChatMcpHandler`, `signSafeChatPayload`, and `verifySafeChatSignature` (`X-SafeChat-Signature` HMAC-SHA256).
- `src/conformance.ts` & `src/cli.ts` — Automated 5-point conformance probe (`verifyMcpServerEndpoint`) and CLI scaffolder (`npx @safechat/mcp-sdk create-tool`).
- `examples/starter-server/server.ts` — Reference starter MCP server.

## Verification
- Run `npm test` (`vitest run`).
