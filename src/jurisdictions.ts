import crypto from 'crypto';
import type { SafeChatJurisdiction, TokenMetadataMap } from './schema.js';

export type JurisdictionEntityType =
	| 'PPSN'
	| 'TAX_REF'
	| 'CRO_NUM'
	| 'IBAN'
	| 'REVENUE_REF'
	| 'EIRCODE'
	| 'IMC'
	| 'PSI'
	| 'NINO'
	| 'UTR'
	| 'CRN'
	| 'NHS'
	| 'CLIENT_ENTITY'
	| 'PERSON'
	| 'EMP'
	| 'EMAIL'
	| 'PHONE';

export interface TokenRecord {
	token: string;
	entityType: JurisdictionEntityType;
	rawOriginalValue: string;
	checksumValid?: boolean;
	sha256Fingerprint: string;
}

export interface DpcEvidenceCertificate {
	certificateId: string;
	issuedAtIso: string;
	jurisdiction: SafeChatJurisdiction;
	complianceStandard: string;
	zeroTransitVerified: boolean;
	outboundPayloadSha256: string;
	totalTokensIssued: number;
	tokenBreakdownByType: Record<string, number>;
}

/**
 * Validates an Irish PPSN using the official Mod-23 checksum algorithm.
 * Format: 7 digits followed by 1 or 2 letters (e.g., 1234567T or 1234567TW).
 */
export function validateIrishPpsn(ppsnRaw: string): boolean {
	const cleaned = ppsnRaw.trim().toUpperCase().replace(/[\s-]/g, '');
	const match = /^(\d{7})([A-Z])([A-ZW]?)$/.exec(cleaned);
	if (!match) return false;

	const digits = match[1];
	const checkChar = match[2];
	const secondChar = match[3];

	let sum = 0;
	for (let i = 0; i < 7; i++) {
		sum += parseInt(digits[i], 10) * (8 - i);
	}

	if (secondChar && secondChar !== 'W') {
		const secondVal = secondChar.charCodeAt(0) - 64;
		sum += secondVal * 9;
	}

	const remainder = sum % 23;
	const expectedChar = remainder === 0 ? 'W' : String.fromCharCode(64 + remainder);
	return checkChar === expectedChar;
}

/**
 * Validates an IBAN (Irish IE or international SEPA) using ISO 7064 Mod-97-10.
 */
export function validateIbanMod97(ibanRaw: string): boolean {
	const cleaned = ibanRaw.replace(/[\s-]/g, '').toUpperCase();
	if (cleaned.length < 15 || cleaned.length > 34) return false;
	if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(cleaned)) return false;

	const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
	let numericString = '';
	for (const ch of rearranged) {
		const code = ch.charCodeAt(0);
		if (code >= 65 && code <= 90) {
			numericString += (code - 55).toString();
		} else {
			numericString += ch;
		}
	}

	let remainder = 0n;
	for (let i = 0; i < numericString.length; i += 7) {
		const chunk = remainder.toString() + numericString.slice(i, i + 7);
		remainder = BigInt(chunk) % 97n;
	}

	return remainder === 1n;
}

/**
 * Validates a UK National Insurance Number (NINO).
 */
export function validateUkNino(ninoRaw: string): boolean {
	const cleaned = ninoRaw.replace(/[\s-]/g, '').toUpperCase();
	return /^(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/.test(
		cleaned
	);
}

/**
 * Boundary 1 (Browser Edge & Test Harness) Jurisdiction Scrubber & Rehydrator.
 * Tokenizes statutory identifiers and named entities into value-consistent `[TYPE_xxx]` tokens,
 * builds zero-PII `TokenMetadataMap`, and rehydrates responses at the edge.
 */
export class EdgeJurisdictionScrubber {
	private valueToToken = new Map<string, TokenRecord>();
	private tokenToRecord = new Map<string, TokenRecord>();
	private typeCounters = new Map<JurisdictionEntityType, number>();
	private customEntities = new Map<string, JurisdictionEntityType>();

	constructor(public readonly jurisdiction: SafeChatJurisdiction = 'IE') {}

	public registerKnownEntity(
		rawText: string,
		type: 'CLIENT_ENTITY' | 'PERSON' | 'EMP' = 'CLIENT_ENTITY'
	): string {
		const trimmed = rawText.trim();
		if (!trimmed) return rawText;
		this.customEntities.set(trimmed, type);
		return this.getOrCreateToken(trimmed, type);
	}

	public getOrCreateToken(
		rawValue: string,
		entityType: JurisdictionEntityType,
		checksumValid?: boolean
	): string {
		const normalizedKey = `${entityType}::${rawValue.trim().toUpperCase()}`;
		const existing = this.valueToToken.get(normalizedKey);
		if (existing) {
			return existing.token;
		}

		const nextIdx = (this.typeCounters.get(entityType) || 0) + 1;
		this.typeCounters.set(entityType, nextIdx);

		const padded = String(nextIdx).padStart(3, '0');
		const token = `[${entityType}_${padded}]`;
		const sha256Fingerprint = crypto
			.createHash('sha256')
			.update(rawValue.trim().toUpperCase())
			.digest('hex')
			.slice(0, 16);

		const record: TokenRecord = {
			token,
			entityType,
			rawOriginalValue: rawValue.trim(),
			checksumValid,
			sha256Fingerprint
		};

		this.valueToToken.set(normalizedKey, record);
		this.tokenToRecord.set(token, record);
		return token;
	}

	public scrubText(input: string): string {
		if (!input) return input;
		let output = input;

		// 1. Registered custom entities (longest match first)
		const sortedCustom = Array.from(this.customEntities.entries()).sort(
			(a, b) => b[0].length - a[0].length
		);
		for (const [rawEntity, entityType] of sortedCustom) {
			const escaped = rawEntity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const regex = new RegExp(escaped, 'gi');
			output = output.replace(regex, () => this.getOrCreateToken(rawEntity, entityType));
		}

		// 2. IBAN (IE & SEPA)
		output = output.replace(
			/\b([A-Z]{2}\d{2}[\s-]?[A-Z0-9]{4}[\s-]?\d{4,6}[\s-]?\d{4,8}[\s-]?\d{0,4})\b/g,
			(match) => {
				const compact = match.replace(/[\s-]/g, '');
				if (compact.length >= 15 && compact.length <= 34) {
					return this.getOrCreateToken(compact, 'IBAN', validateIbanMod97(compact));
				}
				return match;
			}
		);

		// 3. Irish VAT / IE Tax Reference
		output = output.replace(/\b(IE[\s-]?\d{7}[A-Z]{1,2})\b/gi, (match) => {
			return this.getOrCreateToken(match, 'TAX_REF', true);
		});

		// 4. Irish PPSN (7 digits + 1-2 letters)
		output = output.replace(/\b(\d{7}[A-Z]{1,2})\b/g, (match) => {
			const isValidPpsn = validateIrishPpsn(match);
			return this.getOrCreateToken(match, 'PPSN', isValidPpsn);
		});

		// 5. UK NINO
		output = output.replace(
			/\b([A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z][\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2}[\s-]?[A-D])\b/gi,
			(match) => {
				return this.getOrCreateToken(match, 'NINO', validateUkNino(match));
			}
		);

		// 6. Revenue Case / Aspect Query / Intervention IDs
		output = output.replace(
			/\b((?:ROS|REV|AQ|INT|CASE)[\s-]?\d{4}[\s-]?\d{3,8})\b/gi,
			(match) => {
				return this.getOrCreateToken(match, 'REVENUE_REF', true);
			}
		);

		// 7. Irish Eircode
		output = output.replace(/\b([AC-FHKNPRTV-Y]\d{2}[\s-]?[0-9AC-FHKNPRTV-Y]{4})\b/gi, (match) => {
			return this.getOrCreateToken(match, 'EIRCODE', true);
		});

		// 8. Irish CRO Number (prefixed)
		output = output.replace(/\b(CRO[\s#:-]*\d{5,6})\b/gi, (match) => {
			return this.getOrCreateToken(match, 'CRO_NUM', true);
		});

		// 9. Email addresses
		output = output.replace(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, (match) => {
			return this.getOrCreateToken(match, 'EMAIL', true);
		});

		// 10. Irish Ltd / DAC / Co-op / Teoranta company names
		output = output.replace(
			/\b([A-Z][A-Za-z0-9&'\s]{2,40}\s(?:Limited|Ltd\.?|DAC|Designated Activity Company|Teoranta|Co-Operative|PLC))\b/g,
			(match) => {
				return this.getOrCreateToken(match, 'CLIENT_ENTITY', true);
			}
		);

		return output;
	}

	/**
	 * Scrubs any JSON-serializable object recursively while leaving all numeric values untouched.
	 */
	public scrubObject<T>(value: T): T {
		if (typeof value === 'string') {
			return this.scrubText(value) as unknown as T;
		}
		if (Array.isArray(value)) {
			return value.map((item) => this.scrubObject(item)) as unknown as T;
		}
		if (value && typeof value === 'object') {
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
				out[k] = this.scrubObject(v);
			}
			return out as T;
		}
		return value;
	}

	public rehydrateText(sanitizedText: string): string {
		if (!sanitizedText) return sanitizedText;
		return sanitizedText.replace(/\[([A-Z_]+_\d{3})\]/g, (fullToken) => {
			const record = this.tokenToRecord.get(fullToken);
			return record ? record.rawOriginalValue : fullToken;
		});
	}

	public buildTokenMetadata(): TokenMetadataMap {
		const map: TokenMetadataMap = {};
		for (const [token, rec] of this.tokenToRecord.entries()) {
			map[token] = {
				entityType: rec.entityType,
				formatValid: rec.checksumValid ?? true,
				authority:
					rec.entityType === 'IMC' ? 'IMC' : rec.entityType === 'PSI' ? 'PSI' : undefined
			};
		}
		return map;
	}

	public assertZeroPiiLeakage(serializedPayload: string): {
		passed: boolean;
		leakedValues: string[];
	} {
		const leakedValues: string[] = [];
		for (const record of this.tokenToRecord.values()) {
			if (
				record.rawOriginalValue.length >= 4 &&
				serializedPayload.toLowerCase().includes(record.rawOriginalValue.toLowerCase())
			) {
				leakedValues.push(`${record.entityType}(${record.rawOriginalValue})`);
			}
		}
		return {
			passed: leakedValues.length === 0,
			leakedValues
		};
	}

	public generateDpcEvidenceCertificate(serializedOutboundPayload: string): DpcEvidenceCertificate {
		const leakCheck = this.assertZeroPiiLeakage(serializedOutboundPayload);
		if (!leakCheck.passed) {
			throw new Error(
				`CRITICAL GDPR / ZERO-TRANSIT VIOLATION: Unredacted PII detected in outbound payload: ${leakCheck.leakedValues.join(', ')}`
			);
		}

		const breakdown: Record<string, number> = {};
		for (const rec of this.tokenToRecord.values()) {
			breakdown[rec.entityType] = (breakdown[rec.entityType] || 0) + 1;
		}

		const payloadHash = crypto
			.createHash('sha256')
			.update(serializedOutboundPayload)
			.digest('hex');

		const standardsByJurisdiction: Record<SafeChatJurisdiction, string> = {
			IE: 'GDPR Art. 25 & 32 / Irish DPC / Chartered Accountants Ireland',
			UK: 'UK GDPR / Data Protection Act 2018 / ICAEW',
			DE: 'DSGVO Art. 25 & 32 / § 203 StGB / GoBD',
			EU: 'EU GDPR Art. 25 & 32 / EU AI Act',
			US: 'SOC 2 Type II / Zero-Data-Retention',
			AU: 'Australian Privacy Principles (APPs)'
		};

		return {
			certificateId: `DPC-ZDR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
			issuedAtIso: new Date().toISOString(),
			jurisdiction: this.jurisdiction,
			complianceStandard: standardsByJurisdiction[this.jurisdiction],
			zeroTransitVerified: true,
			outboundPayloadSha256: payloadHash,
			totalTokensIssued: this.tokenToRecord.size,
			tokenBreakdownByType: breakdown
		};
	}

	public getAllTokens(): TokenRecord[] {
		return Array.from(this.tokenToRecord.values());
	}
}
