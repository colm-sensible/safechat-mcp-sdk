#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { verifyMcpServerEndpoint } from './conformance.js';

function printScaffoldTemplate(jurisdiction: string, vertical: string, slug: string): string {
	const jurUpper = jurisdiction.toUpperCase();
	const toolId = slug.startsWith('mcp-') ? slug : `mcp-${slug}`;
	return `import { defineSafeChatMcpTool } from '@safechat/mcp-sdk';

export interface SampleToolInput {
	clientToken: string;
	taxRefToken: string;
	grossAmountEur: number;
}

export interface SampleToolMetrics {
	netEstimateEur: number;
	taxEstimateEur: number;
}

export const ${slug.replace(/[^a-zA-Z0-9]/g, '_')}Tool = defineSafeChatMcpTool<SampleToolInput, SampleToolMetrics>({
	toolId: '${toolId}',
	displayName: '${slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}',
	shortDescription: 'Zero-Transit ${jurUpper} ${vertical} MCP tool built on @safechat/mcp-sdk v2.0',
	jurisdiction: '${jurUpper}' as any,
	vertical: '${vertical}' as any,
	category: 'Compliance & Advisory',
	tierBadge: 'PARTNER_VERIFIED',
	pricing: {
		model: 'included_in_plan',
		creatorPriceEurCents: 0
	},
	requiredTokenMeta: ['entityType', 'formatValid'],
	outputFormat: 'markdown',
	privacyPolicy: {
		requiredScrubbers: ['CLIENT_ENTITY', 'TAX_REF', 'PERSON'],
		regulatoryStandards: ['GDPR Art. 25 & 32']
	},
	inputSchema: {
		type: 'object',
		required: ['clientToken', 'taxRefToken', 'grossAmountEur'],
		properties: {
			clientToken: { type: 'string' },
			taxRefToken: { type: 'string' },
			grossAmountEur: { type: 'number' }
		}
	},
	deterministicEngine: (input) => {
		const taxEstimateEur = Math.round(input.grossAmountEur * 12.5) / 100;
		return {
			netEstimateEur: Math.round((input.grossAmountEur - taxEstimateEur) * 100) / 100,
			taxEstimateEur
		};
	},
	llmSynthesize: {
		model: 'Qwen/Qwen2.5-72B-Instruct',
		systemPrompt: (input) =>
			\`Draft a concise compliance summary for \${input.clientToken} (\${input.taxRefToken}). Preserve all [TOKEN_N] placeholders.\`,
		deterministicFallbackGenerator: (input, metrics) =>
			\`# Compliance Summary for \${input.clientToken} (\${input.taxRefToken})\\n- **Gross:** €\${input.grossAmountEur.toFixed(2)}\\n- **Estimated Tax:** €\${metrics.taxEstimateEur.toFixed(2)}\\n- **Estimated Net:** €\${metrics.netEstimateEur.toFixed(2)}\`
	},
	verificationFixture: {
		sampleRawInput: {
			clientToken: 'Ballymore Precision Engineering Limited',
			taxRefToken: 'IE3456789T',
			grossAmountEur: 100000
		},
		knownEntities: [
			{ rawText: 'Ballymore Precision Engineering Limited', type: 'CLIENT_ENTITY' }
		],
		mustNotLeakRawStrings: ['Ballymore Precision Engineering Limited', 'IE3456789T'],
		mustContainRehydratedStrings: ['Ballymore Precision Engineering Limited', 'IE3456789T']
	}
});
`;
}

async function main() {
	const args = process.argv.slice(2);
	const command = args[0];

	if (command === 'create-tool') {
		const jurIdx = args.indexOf('--jurisdiction');
		const vertIdx = args.indexOf('--vertical');
		const nameIdx = args.indexOf('--name');
		const outIdx = args.indexOf('--out');

		const jurisdiction = jurIdx !== -1 && args[jurIdx + 1] ? args[jurIdx + 1] : 'IE';
		const vertical = vertIdx !== -1 && args[vertIdx + 1] ? args[vertIdx + 1] : 'finance';
		const slug = nameIdx !== -1 && args[nameIdx + 1] ? args[nameIdx + 1] : 'sample-tool';
		const content = printScaffoldTemplate(jurisdiction, vertical, slug);

		if (outIdx !== -1 && args[outIdx + 1]) {
			const outPath = path.resolve(args[outIdx + 1]);
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			fs.writeFileSync(outPath, content, 'utf8');
			console.log(`✅ Scaffolded SafeChat v2.0 MCP tool at ${outPath}`);
		} else {
			console.log(content);
		}
		return;
	}

	const targetUrl = args.find((a) => a.startsWith('http')) || 'http://localhost:4200';
	const secret = process.env.SAFECHAT_WEBHOOK_SECRET;

	console.log(`\n🔍 Verifying SafeChat MCP Server at ${targetUrl} ...\n`);
	const report = await verifyMcpServerEndpoint({
		baseUrl: targetUrl,
		webhookSecret: secret
	});

	for (const check of report.checks) {
		const icon = check.passed ? '✅' : '❌';
		console.log(`${icon} [${check.name}] ${check.detail}`);
	}

	console.log(`\n⏱️  Total time: ${report.latencyMs}ms`);
	if (!report.passed) {
		console.error('\n❌ Conformance check failed. Fix the issues above before submitting.\n');
		process.exit(1);
	}
	console.log('\n🎉 All 5 SafeChat Marketplace conformance checks passed!\n');
}

main();
