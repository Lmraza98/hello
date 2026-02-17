/**
 * Zod-based schema validation and normalization for skill param extraction.
 *
 * Takes a skill's `extractFields` definition and:
 *   1. Builds a Zod schema dynamically
 *   2. Validates and strips unknown keys
 *   3. Normalizes industry tokens (lowercase, trim, plural→singular)
 */

import { z } from 'zod';
import type { SkillExtractField } from '../domain/types';

// ── Industry normalization ──────────────────────────────────

const PLURAL_SUFFIXES: Array<[RegExp, string]> = [
  [/ies$/i, 'y'],       // "companies" → "company"
  [/ves$/i, 'f'],       // "halves" → "half" (rare but safe)
  [/ses$/i, 's'],       // "businesses" → "business" (keep trailing s)
  [/s$/i, ''],           // "banks" → "bank"
];

/**
 * Normalize an industry keyword:
 *   - lowercase, trim
 *   - simple plural→singular heuristic
 *   - "banks" → "bank", "veterinarians" → "veterinarian"
 */
export function normalizeIndustry(raw: string): string {
  let normalized = raw.trim().toLowerCase();
  if (!normalized) return normalized;

  // Don't singularize short words or words ending in 'ss' (e.g., "business")
  if (normalized.length <= 3 || normalized.endsWith('ss')) return normalized;

  // Try plural→singular rules
  for (const [pattern, replacement] of PLURAL_SUFFIXES) {
    if (pattern.test(normalized)) {
      const candidate = normalized.replace(pattern, replacement);
      // Sanity check: don't produce empty strings or single chars
      if (candidate.length >= 2) return candidate;
    }
  }

  return normalized;
}

// ── Schema builder ──────────────────────────────────────────

function buildFieldSchema(field: SkillExtractField): z.ZodTypeAny {
  const fieldType = field.type || 'string';

  // All fields are optional at the Zod level.  Required-field checks happen
  // in the post-validation step (validateAndNormalizeParams) by inspecting the
  // raw input keys.  This avoids z.coerce silently converting undefined → ""
  // for required string fields.
  switch (fieldType) {
    case 'number':
      return z.coerce.number().optional();
    case 'boolean':
      return z.coerce.boolean().optional();
    default:
      return z.coerce.string().transform((s) => s.trim()).optional();
  }
}

/**
 * Build a Zod schema from skill extractFields.
 * All fields are optional at the Zod level; required checks happen
 * post-validation so that coercion of undefined → "" doesn't mask
 * missing required fields.
 */
export function buildExtractSchema(fields: SkillExtractField[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.name] = buildFieldSchema(field);
  }
  return z.object(shape).strip();
}

// ── Validation result type ──────────────────────────────────

export type ValidationResult =
  | { ok: true; params: Record<string, unknown> }
  | { ok: false; errors: string[]; missing: string[] };

/**
 * Validate and normalize extracted params against a skill's field definitions.
 *
 * - Strips unknown keys (no extra data leaks through)
 * - Coerces types (string "123" → number 123 for number fields)
 * - Normalizes industry fields (lowercase, trim, plural→singular)
 * - Reports missing required fields
 */
export function validateAndNormalizeParams(
  raw: unknown,
  fields: SkillExtractField[]
): ValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const required = fields.filter((f) => f.required).map((f) => f.name);
    return {
      ok: false,
      errors: ['Extracted params is not an object'],
      missing: required,
    };
  }

  const schema = buildExtractSchema(fields);
  const result = schema.safeParse(raw);

  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    const providedKeys = new Set(Object.keys(raw as Record<string, unknown>));
    const missing = fields
      .filter((f) => f.required && !providedKeys.has(f.name))
      .map((f) => f.name);
    return { ok: false, errors, missing };
  }

  // Apply industry normalization to string fields named "industry", "vertical", or "query"
  const params = result.data as Record<string, unknown>;
  const industryFieldNames = new Set(['industry', 'vertical', 'query', 'sector']);
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && industryFieldNames.has(key)) {
      params[key] = normalizeIndustry(value);
    }
  }

  // Check required fields against the RAW input keys (not the coerced output).
  // z.coerce can silently convert undefined → "" or undefined → 0, masking
  // genuinely missing required fields.
  const rawKeys = new Set(Object.keys(raw as Record<string, unknown>));
  const missing: string[] = [];
  for (const field of fields) {
    if (!field.required) continue;
    const rawVal = (raw as Record<string, unknown>)[field.name];
    const coercedVal = params[field.name];
    const isMissing =
      !rawKeys.has(field.name) ||
      rawVal === undefined ||
      rawVal === null ||
      (typeof rawVal === 'string' && !rawVal.trim()) ||
      coercedVal === undefined ||
      (typeof coercedVal === 'string' && !coercedVal.trim());
    if (isMissing) missing.push(field.name);
  }

  if (missing.length > 0) {
    return { ok: false, errors: [`Missing required fields: ${missing.join(', ')}`], missing };
  }

  return { ok: true, params };
}
