/** Witness — the evidence kernel for agent runtimes. */
export {
  CONFIDENCES,
  AUTHORITIES,
  EvidenceSchema,
  NewEvidenceSchema,
  canonicalProjection,
  computeId,
  parseEvidence,
  parseNewEvidence,
  buildEvidence,
  confidenceRank,
  stepDown,
  WitnessError,
  type Confidence,
  type Authority,
  type Evidence,
  type NewEvidence,
} from './evidence.js';
export { Witness, type ObserveInput, type DeriveInput, type InferInput, type RecordInput } from './witness.js';
