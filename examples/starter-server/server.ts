import http from 'http';
import {
	createSafeChatMcpHandler,
	type SafeChatMcpServerManifest
} from '../../src/index.js';

export const starterManifest: SafeChatMcpServerManifest = {
	schemaVersion: '1.0',
	serverId: 'acme-irish-conveyancing',
	name: 'Irish Conveyancing & Requisitions Suite',
	vendor: {
		name: 'Acme LegalTech Ltd',
		supportEmail: 'support@acmelegal.ie',
		websiteUrl: 'https://acmelegal.ie'
	},
	tools: [
		{
			name: 'draft_requisitions_on_title',
			title: 'Requisitions on Title Drafter',
			description: 'Analyses a sanitised Contract for Sale and drafts Law Society standard Requisitions on Title.',
			verticals: ['legal'],
			pricing: {
				model: 'per_call',
				creatorPriceEurCents: 40,
				trial: {
					trialDays: 30,
					trialFreeCalls: 5
				}
			},
			requiredTokenMeta: ['entityType', 'dateOrderIndex', 'granularity'],
			inputSchema: {
				type: 'object',
				required: ['text'],
				properties: {
					text: { type: 'string', description: 'Sanitised Contract for Sale text' }
				}
			},
			outputFormat: 'markdown'
		}
	]
};

export function createStarterServer(webhookSecret?: string) {
	const handler = createSafeChatMcpHandler({
		manifest: starterManifest,
		webhookSecret,
		handlers: {
			async draft_requisitions_on_title({ input, tokenMetadata, context }) {
				const text = String(input.text || '');
				const orderedDates = Object.entries(tokenMetadata || {})
					.filter(([, meta]) => meta.dateOrderIndex !== undefined)
					.sort((a, b) => (a[1].dateOrderIndex || 0) - (b[1].dateOrderIndex || 0))
					.map(([tok]) => tok);

				return {
					outputFormat: 'markdown',
					markdown: [
						`### Requisitions on Title (${context.jurisdiction || 'IE'})`,
						`**Timeline Order:** ${orderedDates.join(' → ') || 'N/A'}`,
						'',
						`> ${text}`
					].join('\n')
				};
			}
		}
	});

	return http.createServer(handler);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
	const port = Number(process.env.PORT || 4200);
	createStarterServer(process.env.SAFECHAT_WEBHOOK_SECRET).listen(port, () => {
		console.log(`Starter SafeChat MCP Server listening on http://localhost:${port}`);
	});
}
