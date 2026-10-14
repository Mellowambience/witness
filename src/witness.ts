/**
 * witness.ts — the evidence kernel: an in-memory store enforcing the six
 * invariants from SPEC.md.
 *
 * 1. limitations required non-empty (schema)
 * 2. confidence only upgrades via new evidence (new record + supersede; never mutate)
 * 3. derivation takes the floor: stepDown(min(parent confidences))
 * 4. content-addressed identity (evidence.ts)
 * 5. history never erased (superseded/contested stay queryable via get/all/trace)
 * 6. unknown stays unknown (whatIsKnown returns [] for unrecorded claims)
 */
import {
  buildEvidence,
  confidenceRank,
  stepDown,
  WitnessError,
  type Authority,
  type Confidence,
  type Evidence,
  type NewEvidence,
} from './evidence.js';

export interface ObserveInput {
  claim: string;
  sources?: string[];
  limitations: string[];
  createdAt?: string;
}

export interface DeriveInput {
  from: string[];
  claim: string;
  limitations: string[];
  createdAt?: string;
}

export interface InferInput {
  from: string[];
  claim: string;
  limitations: string[];
  createdAt?: string;
}

export interface RecordInput {
  claim: string;
  confidence: Confidence;
  authority: Authority;
  sources?: string[];
  limitations: string[];
  createdAt?: string;
  supersedes?: string[];
}

function now(): string {
  return new Date().toISOString();
}

export class Witness {
  private readonly records = new Map<string, Evidence>();

  /** Number of records held (history included — nothing is ever erased). */
  get size(): number {
    return this.records.size;
  }

  /** Fetch one record by ID. Throws NOT_FOUND for unknown IDs. */
  get(id: string): Evidence {
    const rec = this.records.get(id);
    if (!rec) throw new WitnessError('NOT_FOUND', `unknown evidence id: ${id}`);
    return rec;
  }

  /** Every record ever stored, in insertion order — the full history. */
  all(): Evidence[] {
    return [...this.records.values()];
  }

  /**
   * Record arbitrary evidence. Idempotent: identical content yields the
   * identical ID, and the first write wins (content addressing — the same
   * knowledge re-recorded is the same knowledge).
   */
  record(input: RecordInput): Evidence {
    const rec = buildEvidence({
      claim: input.claim,
      confidence: input.confidence,
      authority: input.authority,
      sources: input.sources ?? [],
      limitations: input.limitations,
      createdAt: input.createdAt ?? now(),
      ...(input.supersedes ? { supersedes: input.supersedes } : {}),
    });
    const existing = this.records.get(rec.id);
    if (existing) return existing;
    this.records.set(rec.id, rec);
    return rec;
  }

  /** Convenience: a direct observation. Confidence observed, authority direct-sense. */
  observe(input: ObserveInput): Evidence {
    return this.record({
      claim: input.claim,
      confidence: 'observed',
      authority: 'direct-sense',
      sources: input.sources,
      limitations: input.limitations,
      createdAt: input.createdAt,
    });
  }

  /**
   * Derive a record from parent records. Confidence = one step below the
   * weakest parent (invariant 3): a derivation is never an observation, so
   * uncertainty can never be laundered upward through computation.
   */
  derive(input: DeriveInput): Evidence {
    const parents = this.requireParents(input.from, 'derive');
    let weakest: Confidence = 'observed';
    let allDirectSense = true;
    for (const p of parents) {
      if (confidenceRank(p.confidence) < confidenceRank(weakest)) weakest = p.confidence;
      if (p.authority !== 'direct-sense') allDirectSense = false;
    }
    return this.record({
      claim: input.claim,
      confidence: stepDown(weakest),
      authority: allDirectSense ? 'direct-sense' : 'agent-reasoning',
      sources: input.from,
      limitations: input.limitations,
      createdAt: input.createdAt,
    });
  }

  /**
   * Infer a record from parent records. Always confidence inferred —
   * inference is guessing, no matter how strong the parents.
   */
  infer(input: InferInput): Evidence {
    this.requireParents(input.from, 'infer');
    return this.record({
      claim: input.claim,
      confidence: 'inferred',
      authority: 'agent-reasoning',
      sources: input.from,
      limitations: input.limitations,
      createdAt: input.createdAt,
    });
  }

  /**
   * Challenge a record. The record stays (invariant 5); it gains
   * contested: true and the reason joins its limitations. The ID is
   * unaffected — lifecycle flags are not part of identity.
   */
  contest(id: string, reason: string): Evidence {
    const rec = this.get(id);
    const updated: Evidence = {
      ...rec,
      contested: true,
      limitations: [...rec.limitations, `Contested: ${reason.trim()}`],
    };
    this.records.set(id, updated);
    return updated;
  }

  /**
   * Link a newer record as the replacement for an older one. Nothing is
   * deleted (invariant 5): the old record remains queryable, and the new
   * record's supersedes trail shows what it replaced. This is the only
   * legitimate path for confidence to move — new evidence, never mutation
   * (invariant 2).
   */
  supersede(oldId: string, newRecord: Evidence): void {
    const old = this.records.get(oldId);
    if (!old) throw new WitnessError('NOT_FOUND', `cannot supersede unknown evidence id: ${oldId}`);
    const current = this.records.get(newRecord.id);
    if (!current)
      throw new WitnessError(
        'NOT_FOUND',
        `superseding record is not in this store; record it first: ${newRecord.id}`,
      );
    if (oldId === newRecord.id)
      throw new WitnessError('VALIDATION', 'a record cannot supersede itself');
    const supersedes = [...(current.supersedes ?? [])];
    if (!supersedes.includes(oldId)) supersedes.push(oldId);
    this.records.set(newRecord.id, { ...current, supersedes });
  }

  /**
   * What does the runtime actually know about `about`?
   *
   * Case-insensitive substring match on the claim, filtered to records at or
   * above minConfidence (default: everything). Contested and superseded
   * records are excluded — this is the "act on as fact" query; history stays
   * available via get()/all()/trace(). Unrecorded claims return [] —
   * unknown stays unknown (invariant 6).
   */
  whatIsKnown(about: string, minConfidence: Confidence = 'inferred'): Evidence[] {
    const needle = about.trim().toLowerCase();
    const minRank = confidenceRank(minConfidence);
    const superseded = this.supersededIds();
    const hits = [...this.records.values()].filter(
      (r) =>
        r.claim.toLowerCase().includes(needle) &&
        confidenceRank(r.confidence) >= minRank &&
        !r.contested &&
        !superseded.has(r.id),
    );
    hits.sort(
      (a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence) || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0),
    );
    return hits;
  }

  /**
   * Full provenance chain for a record, depth-first: the record itself,
   * then its ancestors back to the roots. Sources that are not stored
   * record IDs (tool names, URLs) are leaves and stop the walk.
   */
  trace(id: string): Evidence[] {
    const root = this.get(id);
    const visited = new Set<string>();
    const chain: Evidence[] = [];
    const walk = (rec: Evidence): void => {
      if (visited.has(rec.id)) return;
      visited.add(rec.id);
      chain.push(rec);
      for (const src of rec.sources) {
        const parent = this.records.get(src);
        if (parent) walk(parent);
      }
    };
    walk(root);
    return chain;
  }

  private requireParents(from: string[], op: string): Evidence[] {
    if (from.length === 0)
      throw new WitnessError('VALIDATION', `${op} requires at least one parent record`);
    return from.map((id) => {
      const p = this.records.get(id);
      if (!p) throw new WitnessError('NOT_FOUND', `${op} parent not in store: ${id}`);
      return p;
    });
  }

  private supersededIds(): Set<string> {
    const ids = new Set<string>();
    for (const r of this.records.values()) {
      for (const s of r.supersedes ?? []) ids.add(s);
    }
    return ids;
  }
}

export type { Confidence, Authority, Evidence, NewEvidence };
export { WitnessError };
