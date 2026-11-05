import { describe, it, expect } from 'vitest';
import {
	validateSafeChatManifest,
	filterTokenMetadata,
	verifyMcpServerEndpoint
} from './index.js';
import { createStarterServer, starterManifest } from '../examples/starter-server/server.js';

describe('@safechat/mcp-sdk & Automated Conformance Verifier', () => {
	it('validates a compliant SafeChatMcpServerManifest and rejects malformed manifests', () => {
		const validRes = validateSafeChatManifest(starterManifest);
		expect(validRes.valid).toBe(true);
		expect(validRes.errors).toHaveLength(0);

		const invalidRes = validateSafeChatManifest({
			schemaVersion: '1.0',
			serverId: 'BAD_ID!',
			name: 'A',
			tools: []
		});
		expect(invalidRes.valid).toBe(false);
		expect(invalidRes.errors.length).toBeGreaterThan(0);
	});

	it('filters tokenMetadata strictly to the tool requiredTokenMeta allowlist', () => {
		const rawMeta = {
			'[DATE_1]': {
				entityType: 'DATE',
				dateOrderIndex: 1,
				granularity: 'day' as const,
				authority: 'IMC'
			}
		};

		const filtered = filterTokenMetadata(rawMeta, ['entityType', 'dateOrderIndex']);
		expect(filtered['[DATE_1]']).toEqual({
			entityType: 'DATE',
			dateOrderIndex: 1
		});
		expect(filtered['[DATE_1]'].granularity).toBeUndefined();
		expect(filtered['[DATE_1]'].authority).toBeUndefined();
	});

	it('passes all 5 automated conformance checks against the starter server with HMAC verification', async () => {
		const secret = 'whsec_test_secret_123';
		const server = createStarterServer(secret);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
		const addr = server.address() as { port: number };

		try {
			const report = await verifyMcpServerEndpoint({
				baseUrl: `http://127.0.0.1:${addr.port}`,
				webhookSecret: secret
			});

			expect(report.passed).toBe(true);
			expect(report.checks).toHaveLength(5);
			expect(report.checks.every((c) => c.passed)).toBe(true);
		} finally {
			server.closeAllConnections?.();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});
