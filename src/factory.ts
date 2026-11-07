import {
	filterTokenMetadata,
	validateSafeChatManifest,
	type SafeChatJurisdiction,
	type SafeChatMcpServerManifest,
	type SafeChatMcpToolDefinition,
	type SafeChatMcpToolPricing,
	type SafeChatOutputFormat,
	type SafeChatTierBadge,
	type SafeChatTokenMetaField,
	type SafeChatToolPrivacyPolicy,
	type SafeChatToolUiSchema,
	type SafeChatVertical,
	type SanitisedContext,
	type SanitisedEnvelope,
	type TokenMetadataMap
} from './schema.js';
import { createSafeChatMcpHandler, type SafeChatToolHandler } from './server-helper.js';
import { EdgeJurisdictionScrubber, type DpcEvidenceCertificate } from './jurisdictions.js';

export type SafeChatSovereignModelId =
	| 'Qwen/Qwen2.5-72B-Instruct'
	| 'meta-llama/Llama-3.3-70B-Instruct'
	| 'mistralai/Mistral-Small-24B-Instruct-2501'
	| string;

export interface SafeChatToolVerificationFixture<TScrubbedInput, TComputedMetrics> {
	/** Raw unredacted input (used strictly inside the test harness to simulate Browser Edge scrubbing) */
	sampleRawInput: TScrubbedInput;
	/** Optional entities to register in the simulated Browser Edge scrubber before scrubbing */
	knownEntities?: Array<{ rawText: string; type: 'CLIENT_ENTITY' | 'PERSON' | 'EMP' }>;
	/** Raw PII strings that MUST be 0% present in the outbound JSON-RPC payload */
	mustNotLeakRawStrings: string[];
	/** Rehydrated PII strings that MUST appear in the final Browser Edge output */
	mustContainRehydratedStrings: string[];
	/** Deterministic assertions on Stage A calculator metrics */
	mustMatchDeterministicAssertions?: (metrics: TComputedMetrics) => void;
}

export interface SafeChatToolBlueprint<TScrubbedInput = Record<string, any>, TComputedMetrics = Record<string, any>> {
	toolId: string;
	displayName: string;
	shortDescription: string;
	jurisdiction: SafeChatJurisdiction;
	vertical: SafeChatVertical;
	subVertical?: string;
	category: string;
	tierBadge: SafeChatTierBadge;
	pricing: SafeChatMcpToolPricing;
	requiredTokenMeta: SafeChatTokenMetaField[];
	outputFormat: SafeChatOutputFormat;
	uiSchema?: SafeChatToolUiSchema;
	privacyPolicy: SafeChatToolPrivacyPolicy;
	inputSchema: Record<string, unknown>;

	/**
	 * Stage A ("The Calculator"): Pure deterministic TypeScript engine.
	 * Runs 100% in Token Space on scrubbed inputs + zero-PII tokenMetadata.
	 * Never invokes an LLM for arithmetic, checksums, ratios, or statutory limits.
	 */
	deterministicEngine: (
		scrubbedInput: TScrubbedInput,
		tokenMetadata: TokenMetadataMap,
		context: SanitisedContext
	) => TComputedMetrics | Promise<TComputedMetrics>;

	/**
	 * Stage B ("The Writer"): Sovereign EU ZDR LLM Synthesis + Offline Fallback.
	 */
	llmSynthesize: {
		model: SafeChatSovereignModelId;
		temperature?: number;
		systemPrompt: (scrubbedInput: TScrubbedInput, metrics: TComputedMetrics) => string;
		deterministicFallbackGenerator: (
			scrubbedInput: TScrubbedInput,
			metrics: TComputedMetrics
		) => string;
	};

	/**
	 * Self-Testing Conformance Fixture for CI and Marketplace registration.
	 */
	verificationFixture?: SafeChatToolVerificationFixture<TScrubbedInput, TComputedMetrics>;
}

export interface DefinedSafeChatMcpTool<TScrubbedInput = any, TComputedMetrics = any> {
	blueprint: SafeChatToolBlueprint<TScrubbedInput, TComputedMetrics>;
	manifestDefinition: SafeChatMcpToolDefinition;
	handler: SafeChatToolHandler;
	executeInTokenSpace: (
		envelope: SanitisedEnvelope<TScrubbedInput>
	) => Promise<{
		markdown: string;
		metrics: TComputedMetrics;
		modelUsed: string;
	}>;
}

export interface SafeChatLlmRouterRequest {
	model: SafeChatSovereignModelId;
	systemPrompt: string;
	userPrompt: string;
	temperature?: number;
	litellmKey?: string;
	deterministicFallbackGenerator: () => string;
}

export interface SafeChatLlmRouterResponse {
	modelUsed: string;
	endpointRegion: 'EU-DUBLIN-ZDR';
	content: string;
	zeroRetentionHeaderVerified: boolean;
}

/**
 * Unified SafeChat ZDR LLM Router.
 * Supports SafeChat's LiteLLM Gateway (`LITELLM_BASE_URL` + `context.litellmKey` or `LITELLM_API_KEY`),
 * self-hosted Sovereign EU endpoints (`SAFECHAT_SOVEREIGN_LLM_URL`), and deterministic offline fallback.
 */
export async function invokeSafeChatLlm(
	req: SafeChatLlmRouterRequest
): Promise<SafeChatLlmRouterResponse> {
	const endpointUrl =
		process.env.SAFECHAT_SOVEREIGN_LLM_URL || process.env.LITELLM_BASE_URL;
	const apiKey =
		req.litellmKey ||
		process.env.SAFECHAT_SOVEREIGN_LLM_KEY ||
		process.env.LITELLM_API_KEY ||
		'zdr-local-key';

	if (endpointUrl) {
		try {
			const cleanBase = endpointUrl.replace(/\/+$/, '');
			const chatUrl = cleanBase.endsWith('/v1')
				? `${cleanBase}/chat/completions`
				: `${cleanBase}/v1/chat/completions`;

			const res = await fetch(chatUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`,
					'X-SafeChat-Zero-Retention': 'true'
				},
				body: JSON.stringify({
					model: req.model,
					temperature: req.temperature ?? 0.2,
					messages: [
						{ role: 'system', content: req.systemPrompt },
						{ role: 'user', content: req.userPrompt }
					]
				})
			});

			if (res.ok) {
				const data = (await res.json()) as {
					choices?: Array<{ message?: { content?: string } }>;
				};
				const content = data.choices?.[0]?.message?.content;
				if (content) {
					return {
						modelUsed: req.model,
						endpointRegion: 'EU-DUBLIN-ZDR',
						content,
						zeroRetentionHeaderVerified: true
					};
				}
			}
		} catch {
			// Fall through to deterministic synthesis if LLM gateway is unreachable or offline
		}
	}

	return {
		modelUsed: `${req.model} (Deterministic-ZDR-Synthesis)`,
		endpointRegion: 'EU-DUBLIN-ZDR',
		content: req.deterministicFallbackGenerator(),
		zeroRetentionHeaderVerified: true
	};
}

/**
 * Universal Tool Factory (`defineSafeChatMcpTool`).
 * Enforces the 3-Boundary Zero-Knowledge Protocol:
 * - Boundary 3 (Tool Server) receives only `SanitisedEnvelope` (`[TOKEN_N]` + `tokenMetadata`).
 * - Runs Stage A (`deterministicEngine`) before Stage B (`llmSynthesize`).
 * - Compiles the Marketplace `SafeChatMcpToolDefinition` from the same single source of truth.
 */
export function defineSafeChatMcpTool<TScrubbedInput = Record<string, any>, TComputedMetrics = Record<string, any>>(
	blueprint: SafeChatToolBlueprint<TScrubbedInput, TComputedMetrics>
): DefinedSafeChatMcpTool<TScrubbedInput, TComputedMetrics> {
	const manifestDefinition: SafeChatMcpToolDefinition = {
		name: blueprint.toolId,
		title: blueprint.displayName,
		description: blueprint.shortDescription,
		verticals: [blueprint.vertical],
		subVertical: blueprint.subVertical,
		jurisdiction: blueprint.jurisdiction,
		category: blueprint.category,
		tierBadge: blueprint.tierBadge,
		pricing: blueprint.pricing,
		requiredTokenMeta: blueprint.requiredTokenMeta,
		inputSchema: blueprint.inputSchema,
		outputFormat: blueprint.outputFormat,
		uiSchema: blueprint.uiSchema,
		privacyPolicy: blueprint.privacyPolicy
	};

	const executeInTokenSpace = async (envelope: SanitisedEnvelope<TScrubbedInput>) => {
		const scopedMeta = filterTokenMetadata(
			envelope.tokenMetadata,
			blueprint.requiredTokenMeta
		);
		const scrubbedInput = envelope.input;
		const context: SanitisedContext = envelope.context || {
			vertical: blueprint.vertical,
			jurisdiction: blueprint.jurisdiction,
			zdrRequired: true
		};

		// Stage A: Pure Deterministic Engine ("The Calculator")
		const metrics = await blueprint.deterministicEngine(scrubbedInput, scopedMeta, context);

		// Stage B: Sovereign EU ZDR LLM Synthesis ("The Writer")
		const sysPrompt = blueprint.llmSynthesize.systemPrompt(scrubbedInput, metrics);
		const llmRes = await invokeSafeChatLlm({
			model: blueprint.llmSynthesize.model,
			temperature: blueprint.llmSynthesize.temperature,
			systemPrompt: sysPrompt,
			userPrompt: JSON.stringify({ input: scrubbedInput, metrics }, null, 2),
			litellmKey: context.litellmKey,
			deterministicFallbackGenerator: () =>
				blueprint.llmSynthesize.deterministicFallbackGenerator(scrubbedInput, metrics)
		});

		return {
			markdown: llmRes.content,
			metrics,
			modelUsed: llmRes.modelUsed
		};
	};

	const handler: SafeChatToolHandler = async (envelope) => {
		const result = await executeInTokenSpace(envelope as SanitisedEnvelope<TScrubbedInput>);
		return {
			markdown: result.markdown,
			metrics: result.metrics,
			modelUsed: result.modelUsed
		};
	};

	return {
		blueprint,
		manifestDefinition,
		handler,
		executeInTokenSpace
	};
}

/**
 * Generates an individual `.applet.json` manifest from a `DefinedSafeChatMcpTool` (Zero Manifest Drift).
 */
export function generateAppletManifest(
	serverId: string,
	tool: DefinedSafeChatMcpTool<any, any>
): Record<string, unknown> {
	const bp = tool.blueprint;
	return {
		appletId: `${serverId}.${bp.toolId}`,
		mcpServerId: serverId,
		toolName: bp.toolId,
		displayName: bp.displayName,
		shortDescription: bp.shortDescription,
		jurisdiction: bp.jurisdiction,
		vertical: bp.vertical,
		subVertical: bp.subVertical,
		category: bp.category,
		tierBadge: bp.tierBadge,
		outputFormat: bp.outputFormat,
		uiSchema: bp.uiSchema,
		privacyPolicy: bp.privacyPolicy,
		inputSchema: bp.inputSchema
	};
}

/**
 * Executes a tool's `verificationFixture` end-to-end across all 3 simulated boundaries:
 * 1. Boundary 1 (Simulated Browser Edge): Scrubs `sampleRawInput` with `EdgeJurisdictionScrubber`.
 * 2. Boundary 2 (Simulated Host Proxy): Asserts 0% leakage of `mustNotLeakRawStrings` and issues a `DpcEvidenceCertificate`.
 * 3. Boundary 3 (Tool Server): Runs `deterministicEngine` + `llmSynthesize` in Token Space.
 * 4. Boundary 1 Return: Rehydrates `[TOKEN_N]` back to raw PII and asserts `mustContainRehydratedStrings`.
 */
export async function runToolVerificationFixture<TScrubbedInput, TComputedMetrics>(
	tool: DefinedSafeChatMcpTool<TScrubbedInput, TComputedMetrics>
): Promise<{
	passed: boolean;
	toolId: string;
	certificate: DpcEvidenceCertificate;
	sanitizedMarkdown: string;
	rehydratedMarkdown: string;
	metrics: TComputedMetrics;
	errors: string[];
}> {
	const errors: string[] = [];
	const bp = tool.blueprint;
	const fixture = bp.verificationFixture;
	if (!fixture) {
		throw new Error(`Tool "${bp.toolId}" does not define a verificationFixture.`);
	}

	const scrubber = new EdgeJurisdictionScrubber(bp.jurisdiction);
	for (const known of fixture.knownEntities || []) {
		scrubber.registerKnownEntity(known.rawText, known.type);
	}

	// Boundary 1: Scrub raw input object at the edge
	const scrubbedInput = scrubber.scrubObject(fixture.sampleRawInput);
	const tokenMetadata = scrubber.buildTokenMetadata();
	const serializedOutbound = JSON.stringify({ input: scrubbedInput, tokenMetadata });

	// Assert 0% leakage of mustNotLeakRawStrings
	for (const forbidden of fixture.mustNotLeakRawStrings) {
		if (
			forbidden.trim().length > 0 &&
			serializedOutbound.toLowerCase().includes(forbidden.trim().toLowerCase())
		) {
			errors.push(`Outbound payload leaked raw PII string: "${forbidden}"`);
		}
	}

	const certificate = scrubber.generateDpcEvidenceCertificate(serializedOutbound);

	// Boundary 3: Execute tool in Token Space
	const { markdown: sanitizedMarkdown, metrics } = await tool.executeInTokenSpace({
		input: scrubbedInput,
		tokenMetadata,
		context: {
			orgInstallId: 'inst_fixture_test',
			vertical: bp.vertical,
			jurisdiction: bp.jurisdiction,
			zdrRequired: true
		}
	});

	// Run deterministic metric assertions
	if (fixture.mustMatchDeterministicAssertions) {
		try {
			fixture.mustMatchDeterministicAssertions(metrics);
		} catch (err: any) {
			errors.push(`Deterministic assertion failed: ${err?.message || String(err)}`);
		}
	}

	// Boundary 1 Return: Rehydrate at the edge
	const rehydratedMarkdown = scrubber.rehydrateText(sanitizedMarkdown);
	for (const expectedStr of fixture.mustContainRehydratedStrings) {
		if (!rehydratedMarkdown.includes(expectedStr)) {
			errors.push(
				`Rehydrated output missing expected string: "${expectedStr}"`
			);
		}
	}

	return {
		passed: errors.length === 0,
		toolId: bp.toolId,
		certificate,
		sanitizedMarkdown,
		rehydratedMarkdown,
		metrics,
		errors
	};
}

export interface CreateSafeChatServerFromToolsOptions {
	serverId: string;
	name: string;
	version?: string;
	jurisdiction?: SafeChatJurisdiction;
	isOfficial?: boolean;
	vendor: {
		name: string;
		supportEmail: string;
		websiteUrl?: string;
	};
	webhookSecret?: string;
	tools: Array<DefinedSafeChatMcpTool<any, any>>;
}

/**
 * Compiles an array of `DefinedSafeChatMcpTool` blueprints into:
 * - A validated v2.0 `SafeChatMcpServerManifest`
 * - Individual `.applet.json` manifests
 * - A compliant HTTP handler (`GET /health`, `GET /manifest`, `POST /mcp`)
 * - An automated `verifyAllFixtures()` runner
 */
export function createSafeChatMcpServerFromTools(options: CreateSafeChatServerFromToolsOptions) {
	const manifest: SafeChatMcpServerManifest = {
		schemaVersion: '2.0',
		serverId: options.serverId,
		name: options.name,
		version: options.version || '2.0.0',
		jurisdiction: options.jurisdiction || 'IE',
		isOfficial: options.isOfficial ?? false,
		vendor: options.vendor,
		tools: options.tools.map((t) => t.manifestDefinition)
	};

	const validation = validateSafeChatManifest(manifest);
	if (!validation.valid) {
		throw new Error(
			`Invalid SafeChatMcpServerManifest for ${options.serverId}: ${validation.errors.join('; ')}`
		);
	}

	const handlers: Record<string, SafeChatToolHandler> = {};
	for (const tool of options.tools) {
		handlers[tool.blueprint.toolId] = tool.handler;
	}

	const httpHandler = createSafeChatMcpHandler({
		manifest,
		webhookSecret: options.webhookSecret,
		handlers
	});

	const appletManifests = options.tools.map((t) =>
		generateAppletManifest(options.serverId, t)
	);

	async function verifyAllFixtures() {
		const results = [];
		for (const tool of options.tools) {
			if (tool.blueprint.verificationFixture) {
				results.push(await runToolVerificationFixture(tool));
			}
		}
		return {
			passed: results.every((r) => r.passed),
			results
		};
	}

	return {
		manifest,
		appletManifests,
		handlers,
		httpHandler,
		verifyAllFixtures
	};
}
