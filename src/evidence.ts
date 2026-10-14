/**
 * evidence.ts — the Evidence record: schema, identity, and parsing.
 *
 * Every thing an agent "knows" is an Evidence record carrying its confidence
 * (observed | derived | inferred), its authority, required limitations, and a
 * content-addressed ID. Unknown stays unknown: nothing here decides truth,
 * only the agent's relationship to a claim.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Ordered weakest-first: inferred < derived < observed. */
export const CONFIDENCES = ['inferred', 'derived', 'observed'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const AUTHORITIES = [
  'direct-sense',
  'agent-memory',
  'agent-reasoning',
  'external-claim',
  'charter',
] as const;
export type Authority = (typeof AUTHORITIES)[number];

/** Numeric rank for confidence ordering. Higher = stronger. */
export function confidenceRank(c: Confidence): number {
  switch (c) {
    case 'inferred':
      return 0;
    case 'derived':
      return 1;
    case 'observed':
      return 2;
  }
}

/** One step down the confidence ladder. Derivation is never an observation. */
export function stepDown(c: Confidence): Confidence {
  switch (c) {
    case 'observed':
      return 'derived';
    case 'derived':
    case 'inferred':
      return 'inferred';
  }
}

const confidenceSchema = z.enum(CONFIDENCES);
const authoritySchema = z.enum(AUTHORITIES);

/**
 * The Evidence record, strict: unknown fields are rejected, limitations are
 * required and non-empty. Invariant 1 lives here.
 */
export const EvidenceSchema = z
  .object({
    id: z.string().regex(/^ev_[0-9a-f]{64}$/),
    claim: z.string().trim().min(1),
    confidence: confidenceSchema,
    authority: authoritySchema,
    limitations: z.array(z.string().trim().min(1)).min(1),
    sources: z.array(z.string()).default([]),
    createdAt: z.string().datetime({ offset: true }),
    supersedes: z.array(z.string()).optional(),
    contested: z.boolean().optional(),
  })
  .strict();

export type Evidence = z.infer<typeof EvidenceSchema>;

/** Input for creating a record: everything except the computed identity. */
export const NewEvidenceSchema = EvidenceSchema.omit({ id: true }).strict();
export type NewEvidence = z.infer<typeof NewEvidenceSchema>;

const ID_VERSION = 'witness-evidence-v1';

/**
 * Canonical projection for content addressing (SPEC §identity):
 * claim + confidence + authority + sorted sources.
 *
 * Deliberately excludes createdAt, limitations, supersedes, contested:
 * the same knowledge re-recorded later is the same knowledge (idempotent),
 * and lifecycle flags must not invalidate identity.
 */
export function canonicalProjection(input: {
  claim: string;
  confidence: Confidence;
  authority: Authority;
  sources: readonly string[];
}): string {
  const sorted = [...input.sources].sort();
  return [ID_VERSION, input.claim.trim(), input.confidence, input.authority, ...sorted].join('\n');
}

/** 'ev_' + sha256 hex of the canonical projection. Invariant 4. */
export function computeId(input: {
  claim: string;
  confidence: Confidence;
  authority: Authority;
  sources: readonly string[];
}): string {
  const digest = createHash('sha256').update(canonicalProjection(input), 'utf8').digest('hex');
  return `ev_${digest}`;
}

export class WitnessError extends Error {
  readonly code: 'VALIDATION' | 'ID_MISMATCH' | 'NOT_FOUND';
  constructor(code: WitnessError['code'], message: string) {
    super(message);
    this.name = 'WitnessError';
    this.code = code;
  }
}

/**
 * Parse and verify an Evidence record. Rejects anything whose ID does not
 * match its content — tamper-evident by construction (invariant 4).
 */
export function parseEvidence(data: unknown): Evidence {
  let parsed: Evidence;
  try {
    parsed = EvidenceSchema.parse(data);
  } catch (err) {
    throw new WitnessError(
      'VALIDATION',
      `invalid evidence record: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const expected = computeId(parsed);
  if (parsed.id !== expected) {
    throw new WitnessError(
      'ID_MISMATCH',
      `evidence id does not match content (got ${parsed.id}, expected ${expected})`,
    );
  }
  return parsed;
}

/** Build a fully-formed record from caller input, assigning its identity. */
export function buildEvidence(input: NewEvidence): Evidence {
  const validated = parseNewEvidence(input);
  return { ...validated, id: computeId(validated) };
}

/** Validate new-record input, raising WitnessError (not raw ZodError). */
export function parseNewEvidence(data: unknown): NewEvidence {
  try {
    return NewEvidenceSchema.parse(data);
  } catch (err) {
    throw new WitnessError(
      'VALIDATION',
      `invalid evidence input: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
