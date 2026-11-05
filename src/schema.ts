export type SafeChatVertical = 'legal' | 'recruitment' | 'clinical' | 'finance' | 'general';
export type SafeChatJurisdiction = 'IE' | 'UK' | 'EU' | 'US' | 'AU';
export type SafeChatPricingModel =
	| 'free'
	| 'included_in_plan'
	| 'per_call'
	| 'monthly_org'
	| 'monthly_seat';
export type SafeChatTokenMetaField =
	| 'entityType'
	| 'authority'
	| 'formatValid'
	| 'dateOrderIndex'
	| 'granularity';
export type SafeChatOutputFormat =
	| 'markdown'
	| 'json'
	| 'html-preview'
	| 'docx-base64'
	| 'csv';

export interface SafeChatMcpToolPricing {
	model: SafeChatPricingModel;
	creatorPriceEurCents: number;
	trial?: {
		trialDays?: number;
		trialFreeCalls?: number;
	};
}

export interface SafeChatMcpToolDefinition {
	name: string;
	title: string;
	description: string;
	verticals: SafeChatVertical[];
	pricing: SafeChatMcpToolPricing;
	requiredTokenMeta: SafeChatTokenMetaField[];
	inputSchema: Record<string, unknown>;
	outputFormat: SafeChatOutputFormat;
}

export interface SafeChatMcpServerManifest {
	schemaVersion: '1.0';
	serverId: string;
	name: string;
	isOfficial?: boolean;
	vendor: {
		name: string;
		supportEmail: string;
		websiteUrl?: string;
	};
	tools: SafeChatMcpToolDefinition[];
}

export interface TokenMeta {
	entityType?: string;
	authority?: string;
	formatValid?: boolean;
	dateOrderIndex?: number;
	granularity?: 'year' | 'month' | 'day' | 'unknown';
}

export type TokenMetadataMap = Record<string, TokenMeta>;

export interface SanitisedContext {
	orgInstallId?: string;
	vertical?: SafeChatVertical;
	jurisdiction?: SafeChatJurisdiction;
	zdrRequired?: boolean;
}

export interface SanitisedEnvelope<TInput = Record<string, any>> {
	input: TInput;
	tokenMetadata?: TokenMetadataMap;
	context: SanitisedContext;
}

export interface OrgToolSubscription {
	toolId: string;
	enabled: boolean;
	status: 'trialing' | 'active' | 'paused' | 'cancelled';
	billingModel: SafeChatPricingModel;
	orgInstallId: string;
	installedAt: string;
	installedByUserId: string;
	trialEndsAt?: string | null;
	remainingTrialCalls?: number | null;
}

const VALID_VERTICALS = new Set(['legal', 'recruitment', 'clinical', 'finance', 'general']);
const VALID_PRICING_MODELS = new Set([
	'free',
	'included_in_plan',
	'per_call',
	'monthly_org',
	'monthly_seat'
]);
const VALID_TOKEN_META = new Set([
	'entityType',
	'authority',
	'formatValid',
	'dateOrderIndex',
	'granularity'
]);
const VALID_OUTPUT_FORMATS = new Set([
	'markdown',
	'json',
	'html-preview',
	'docx-base64',
	'csv'
]);

/**
 * Validates a SafeChatMcpServerManifest object and returns `{ valid, errors }`.
 */
export function validateSafeChatManifest(manifest: any): {
	valid: boolean;
	errors: string[];
} {
	const errors: string[] = [];
	if (!manifest || typeof manifest !== 'object') {
		return { valid: false, errors: ['Manifest must be a JSON object'] };
	}

	if (manifest.schemaVersion !== '1.0') {
		errors.push('schemaVersion must be "1.0"');
	}
	if (
		typeof manifest.serverId !== 'string' ||
		!/^[a-z0-9][a-z0-9-]{2,62}$/.test(manifest.serverId)
	) {
		errors.push('serverId must be a 3-63 char kebab-case identifier');
	}
	if (typeof manifest.name !== 'string' || manifest.name.trim().length < 3) {
		errors.push('name must be at least 3 characters');
	}
	if (
		!manifest.vendor ||
		typeof manifest.vendor.name !== 'string' ||
		typeof manifest.vendor.supportEmail !== 'string'
	) {
		errors.push('vendor.name and vendor.supportEmail are required');
	}

	if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) {
		errors.push('tools must be a non-empty array');
	} else {
		manifest.tools.forEach((tool: any, idx: number) => {
			const prefix = `tools[${idx}]`;
			if (typeof tool.name !== 'string' || !/^[a-z0-9_]{2,64}$/.test(tool.name)) {
				errors.push(`${prefix}.name must be a valid snake_case identifier`);
			}
			if (typeof tool.title !== 'string' || !tool.title.trim()) {
				errors.push(`${prefix}.title is required`);
			}
			if (typeof tool.description !== 'string' || !tool.description.trim()) {
				errors.push(`${prefix}.description is required`);
			}
			if (
				!Array.isArray(tool.verticals) ||
				tool.verticals.length === 0 ||
				!tool.verticals.every((v: string) => VALID_VERTICALS.has(v))
			) {
				errors.push(`${prefix}.verticals must contain valid SafeChat verticals`);
			}
			if (
				!tool.pricing ||
				!VALID_PRICING_MODELS.has(tool.pricing.model) ||
				typeof tool.pricing.creatorPriceEurCents !== 'number' ||
				tool.pricing.creatorPriceEurCents < 0
			) {
				errors.push(`${prefix}.pricing must specify a valid model and non-negative creatorPriceEurCents`);
			}
			if (
				!Array.isArray(tool.requiredTokenMeta) ||
				!tool.requiredTokenMeta.every((m: string) => VALID_TOKEN_META.has(m))
			) {
				errors.push(`${prefix}.requiredTokenMeta contains unsupported metadata keys`);
			}
			if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
				errors.push(`${prefix}.inputSchema must be a JSON Schema object`);
			}
			if (!VALID_OUTPUT_FORMATS.has(tool.outputFormat)) {
				errors.push(`${prefix}.outputFormat must be a supported output format`);
			}
		});
	}

	return {
		valid: errors.length === 0,
		errors
	};
}

/**
 * Strips any tokenMetadata fields not explicitly requested in `requiredTokenMeta`.
 */
export function filterTokenMetadata(
	tokenMetadata: TokenMetadataMap | undefined,
	requiredFields: SafeChatTokenMetaField[]
): TokenMetadataMap {
	if (!tokenMetadata || typeof tokenMetadata !== 'object') return {};
	const allowed = new Set(requiredFields);
	const out: TokenMetadataMap = {};

	for (const [token, meta] of Object.entries(tokenMetadata)) {
		const filtered: TokenMeta = {};
		if (allowed.has('entityType') && meta.entityType !== undefined) {
			filtered.entityType = meta.entityType;
		}
		if (allowed.has('authority') && meta.authority !== undefined) {
			filtered.authority = meta.authority;
		}
		if (allowed.has('formatValid') && meta.formatValid !== undefined) {
			filtered.formatValid = meta.formatValid;
		}
		if (allowed.has('dateOrderIndex') && meta.dateOrderIndex !== undefined) {
			filtered.dateOrderIndex = meta.dateOrderIndex;
		}
		if (allowed.has('granularity') && meta.granularity !== undefined) {
			filtered.granularity = meta.granularity;
		}
		out[token] = filtered;
	}

	return out;
}
