import http from 'http';
import { describe, it, expect } from 'vitest';
import {
	validateSafeChatManifest,
	filterTokenMetadata,
	verifyMcpServerEndpoint,
	defineSafeChatMcpTool,
	createSafeChatMcpServerFromTools,
	runToolVerificationFixture,
	validateIrishPpsn,
	validateIbanMod97,
	validateUkNino,
	EdgeJurisdictionScrubber
} from './index.js';
import { createStarterServer, starterManifest } from '../examples/starter-server/server.js';

describe('@safechat/mcp-sdk v2.0 & Automated Conformance Verifier', () => {
	it('validates both v1.0 and v2.0 SafeChatMcpServerManifests (including reverse-DNS serverIds and kebab-case tools)', () => {
		const validRes = validateSafeChatManifest(starterManifest);
		expect(validRes.valid).toBe(true);
		expect(validRes.errors).toHaveLength(0);

		const v2Res = validateSafeChatManifest({
			schemaVersion: '2.0',
			serverId: 'ie.safechat.mcp.finance',
			name: 'SafeChat Irish Accounting & Tax Compliance MCP Server',
			vendor: {
				name: 'SafeChat Official (Dublin, Ireland)',
				supportEmail: 'support@safechat.ie'
			},
			tools: [
				{
					name: 'mcp-management-accounts-commentary',
					title: 'Management Accounts & Board Commentary',
					description: 'Trial balance to board pack',
					verticals: ['finance'],
					subVertical: 'accounting',
					jurisdiction: 'IE',
					pricing: { model: 'included_in_plan', creatorPriceEurCents: 0 },
					requiredTokenMeta: ['entityType', 'formatValid'],
					inputSchema: { type: 'object' },
					outputFormat: 'markdown'
				}
			]
		});
		expect(v2Res.valid).toBe(true);

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

	it('validates Irish PPSN (Mod-23), IBAN (ISO 7064 Mod-97), and UK NINO checksums and EdgeJurisdictionScrubber', () => {
		expect(validateIrishPpsn('1234567T')).toBe(true);
		expect(validateIrishPpsn('1234567A')).toBe(false);
		expect(validateIbanMod97('IE29AIBK93115212345678')).toBe(true);
		expect(validateIbanMod97('IE00AIBK93115212345678')).toBe(false);
		expect(validateUkNino('AB123456C')).toBe(true);

		const scrubber = new EdgeJurisdictionScrubber('IE');
		const clientToken = scrubber.registerKnownEntity('Ballymore Engineering Limited', 'CLIENT_ENTITY');
		expect(clientToken).toBe('[CLIENT_ENTITY_001]');
		const scrubbed = scrubber.scrubText(
			'Director PPSN 1234567T at Ballymore Engineering Limited paid IBAN IE29AIBK93115212345678'
		);
		expect(scrubbed).not.toContain('1234567T');
		expect(scrubbed).not.toContain('Ballymore Engineering Limited');
		expect(scrubbed).toContain('[PPSN_001]');
		expect(scrubbed).toContain('[IBAN_001]');
		expect(scrubber.rehydrateText(scrubbed)).toContain('Ballymore Engineering Limited');
	});

	it('executes defineSafeChatMcpTool + runToolVerificationFixture + createSafeChatMcpServerFromTools end-to-end', async () => {
		const sampleTool = defineSafeChatMcpTool<
			{ clientToken: string; taxRefToken: string; grossProfitEur: number },
			{ ct1At12_5Pct: number }
		>({
			toolId: 'mcp-ct1-quick-estimate',
			displayName: 'Irish CT1 Quick Estimator',
			shortDescription: 'Computes deterministic 12.5% Irish trading CT1 liability in token space',
			jurisdiction: 'IE',
			vertical: 'finance',
			subVertical: 'accounting',
			category: 'Tax & Statutory Compliance',
			tierBadge: 'HERO_LAUNCH',
			pricing: { model: 'included_in_plan', creatorPriceEurCents: 0 },
			requiredTokenMeta: ['entityType', 'formatValid'],
			outputFormat: 'markdown',
			privacyPolicy: {
				requiredScrubbers: ['CLIENT_ENTITY', 'TAX_REF'],
				regulatoryStandards: ['GDPR Art. 25 & 32', 'Chartered Accountants Ireland']
			},
			inputSchema: {
				type: 'object',
				required: ['clientToken', 'taxRefToken', 'grossProfitEur'],
				properties: {
					clientToken: { type: 'string' },
					taxRefToken: { type: 'string' },
					grossProfitEur: { type: 'number' }
				}
			},
			deterministicEngine: (input) => ({
				ct1At12_5Pct: Math.round((input.grossProfitEur || 0) * 12.5) / 100
			}),
			llmSynthesize: {
				model: 'Qwen/Qwen2.5-72B-Instruct',
				systemPrompt: (input) => `Summarize CT1 for ${input.clientToken}`,
				deterministicFallbackGenerator: (input, metrics) =>
					`CT1 Summary for ${input.clientToken} (${input.taxRefToken}): €${metrics.ct1At12_5Pct.toFixed(2)}`
			},
			verificationFixture: {
				sampleRawInput: {
					clientToken: 'Ballymore Precision Engineering Limited',
					taxRefToken: 'IE3456789T',
					grossProfitEur: 200000
				},
				knownEntities: [
					{ rawText: 'Ballymore Precision Engineering Limited', type: 'CLIENT_ENTITY' }
				],
				mustNotLeakRawStrings: ['Ballymore Precision Engineering Limited', 'IE3456789T'],
				mustContainRehydratedStrings: [
					'Ballymore Precision Engineering Limited',
					'IE3456789T',
					'€25000.00'
				],
				mustMatchDeterministicAssertions: (metrics) => {
					expect(metrics.ct1At12_5Pct).toBe(25000);
				}
			}
		});

		const fixtureReport = await runToolVerificationFixture(sampleTool);
		expect(fixtureReport.passed).toBe(true);
		expect(fixtureReport.certificate.zeroTransitVerified).toBe(true);

		const compiled = createSafeChatMcpServerFromTools({
			serverId: 'ie.safechat.mcp.finance',
			name: 'SafeChat Irish Finance Server',
			isOfficial: true,
			vendor: {
				name: 'SafeChat Official',
				supportEmail: 'support@safechat.ie'
			},
			tools: [sampleTool]
		});

		expect(compiled.manifest.schemaVersion).toBe('2.0');
		expect(compiled.appletManifests).toHaveLength(1);
		const allFixtures = await compiled.verifyAllFixtures();
		expect(allFixtures.passed).toBe(true);

		const srv = http.createServer(compiled.httpHandler);
		await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
		const addr = srv.address() as { port: number };
		try {
			const report = await verifyMcpServerEndpoint({
				baseUrl: `http://127.0.0.1:${addr.port}`
			});
			expect(report.passed).toBe(true);
		} finally {
			srv.closeAllConnections?.();
			await new Promise<void>((resolve) => srv.close(() => resolve()));
		}
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
