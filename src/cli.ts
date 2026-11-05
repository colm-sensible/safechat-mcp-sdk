#!/usr/bin/env node
import { verifyMcpServerEndpoint } from './conformance.js';

async function main() {
	const args = process.argv.slice(2);
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
