import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type {
	SafeChatMcpServerManifest,
	SanitisedEnvelope
} from './schema.js';

export type SafeChatToolHandler = (
	envelope: SanitisedEnvelope<Record<string, any>>
) => Promise<Record<string, any>>;

export interface CreateSafeChatMcpHandlerOptions {
	manifest: SafeChatMcpServerManifest;
	webhookSecret?: string;
	handlers: Record<string, SafeChatToolHandler>;
}

export function signSafeChatPayload(
	rawBody: string,
	secret: string,
	timestampSec: number = Math.floor(Date.now() / 1000)
): { signature: string; timestamp: string } {
	const hmac = crypto
		.createHmac('sha256', secret)
		.update(`${timestampSec}.${rawBody}`)
		.digest('hex');
	return {
		signature: `sha256=${hmac}`,
		timestamp: String(timestampSec)
	};
}

export function verifySafeChatSignature(params: {
	rawBody: string;
	signatureHeader?: string | null;
	timestampHeader?: string | null;
	secret: string;
	maxSkewSeconds?: number;
}): boolean {
	const {
		rawBody,
		signatureHeader,
		timestampHeader,
		secret,
		maxSkewSeconds = 300
	} = params;

	if (!signatureHeader || !timestampHeader || !secret) return false;
	const ts = Number(timestampHeader);
	if (!Number.isFinite(ts)) return false;

	const nowSec = Math.floor(Date.now() / 1000);
	if (Math.abs(nowSec - ts) > maxSkewSeconds) {
		return false;
	}

	const expected = signSafeChatPayload(rawBody, secret, ts).signature;
	try {
		return crypto.timingSafeEqual(
			Buffer.from(signatureHeader, 'utf8'),
			Buffer.from(expected, 'utf8')
		);
	} catch {
		return false;
	}
}

export function createSafeChatMcpHandler(options: CreateSafeChatMcpHandlerOptions) {
	const { manifest, webhookSecret, handlers } = options;

	return async (req: IncomingMessage, res: ServerResponse) => {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const pathname = url.pathname.replace(/\/+$/, '') || '/';

		if (req.method === 'GET' && pathname === '/health') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ status: 'ok', serverId: manifest.serverId }));
			return;
		}

		if (req.method === 'GET' && pathname === '/manifest') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(manifest, null, 2));
			return;
		}

		if (req.method === 'POST' && pathname === '/mcp') {
			const chunks: Buffer[] = [];
			for await (const chunk of req) {
				chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			}
			const rawBody = Buffer.concat(chunks).toString('utf8');

			if (webhookSecret) {
				const valid = verifySafeChatSignature({
					rawBody,
					signatureHeader: String(req.headers['x-safechat-signature'] || ''),
					timestampHeader: String(req.headers['x-safechat-timestamp'] || ''),
					secret: webhookSecret
				});
				if (!valid) {
					res.writeHead(401, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							jsonrpc: '2.0',
							id: null,
							error: { code: -32001, message: 'Invalid X-SafeChat-Signature' }
						})
					);
					return;
				}
			}

			let rpc: any;
			try {
				rpc = JSON.parse(rawBody);
			} catch {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						jsonrpc: '2.0',
						id: null,
						error: { code: -32700, message: 'Parse error' }
					})
				);
				return;
			}

			const { id = null, method, params = {} } = rpc || {};

			if (method === 'tools/list') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						jsonrpc: '2.0',
						id,
						result: {
							tools: manifest.tools.map((t) => ({
								name: t.name,
								description: t.description,
								inputSchema: t.inputSchema
							}))
						}
					})
				);
				return;
			}

			if (method === 'tools/call') {
				const toolName = String(params?.name || '');
				const handler = handlers[toolName];
				if (!handler) {
					res.writeHead(404, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							jsonrpc: '2.0',
							id,
							error: { code: -32601, message: `Unknown tool: ${toolName}` }
						})
					);
					return;
				}

				const rawArgs = params?.arguments || {};
				const envelope: SanitisedEnvelope = {
					input: rawArgs.input ?? rawArgs,
					tokenMetadata: rawArgs.tokenMetadata ?? {},
					context: rawArgs.context ?? { vertical: 'general', jurisdiction: 'IE' }
				};

				try {
					const output = await handler(envelope);
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							jsonrpc: '2.0',
							id,
							result: {
								content: [{ type: 'text', text: JSON.stringify(output) }],
								structuredContent: output
							}
						})
					);
				} catch (err: any) {
					res.writeHead(500, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							jsonrpc: '2.0',
							id,
							error: { code: -32000, message: err?.message || 'Tool execution error' }
						})
					);
				}
				return;
			}

			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					jsonrpc: '2.0',
					id,
					error: { code: -32601, message: `Unsupported method: ${method}` }
				})
			);
			return;
		}

		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Not found' }));
	};
}
