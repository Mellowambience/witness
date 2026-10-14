# Witness — the evidence kernel for agent runtimes

*Infrastructure for machine honesty.*

Every thing an agent "knows" is an **Evidence record** carrying its confidence
(`observed` | `derived` | `inferred`), its authority, required limitations,
and a content-addressed ID. Six invariants enforced in code, not prompts.

## Why this exists

AI agents remember, plan, decide — and every one of them has the same
structural flaw: **they cannot tell what they saw from what they guessed.**
Something observed, something inferred, something somebody told them — all
stored the same, all trusted the same.

That's how confabulation cascades happen: one inferred "fact" becomes the
premise for the next inference, and the world quietly stops being true.
Across agents it compounds — one agent's guess becomes another agent's
premise, and soon you have economies of confident machines acting on things
nobody ever verified.

Witness is the layer that fixes it. Not a product — a protocol-shaped kernel
any agent runtime can adopt: every claim carrying its confidence, its
receipts, its doubts. Epistemics, not oracle. It tracks *the agent's
relationship to a claim*, never whether the claim is true.

## 30 seconds

```ts
import { Witness } from 'witness';

const w = new Witness();

// Record what was seen — with what could be wrong, required.
const seen = w.observe({
  claim: 'the old bridge is out',
  sources: ['eyes:villager-maren'],
  limitations: ['dusk light, ~200m away'],
});

// Derive: computed from evidence. Confidence steps DOWN, never up.
const risky = w.derive({
  from: [seen.id],
  claim: 'crossing the gorge is risky tonight',
  limitations: ['assumes no hidden ford'],
});

// Infer: a guess, labeled as one. Always.
const guess = w.infer({
  from: [seen.id],
  claim: 'trolls broke the bridge',
  limitations: ['no evidence whatsoever'],
});

// The whole product in one call: what can the runtime act on as fact?
w.whatIsKnown('bridge', 'observed'); // [seen] — only what was seen
w.whatIsKnown('bridge');             // [seen, risky, guess] — strongest first

// Provenance: how do we know this? All the way to the roots.
w.trace(risky.id);                    // [risky] → [seen]

// Challenge without erasing. Upgrade only with NEW evidence.
w.contest(guess.id, 'traveler disputes this');

const confirmed = w.observe({
  claim: 'the old bridge is out',
  sources: ['patrol:dawn'],
  limitations: ['load test to 200kg'],
});
w.supersede(seen.id, confirmed);       // history kept, never mutated
```

## The six invariants (enforced in code)

1. **Limitations are required.** A record without a non-empty `limitations`
   array is rejected. If you can't say what could be wrong, you don't know it.
2. **Confidence only moves on new evidence.** `inferred` never becomes
   `observed` by re-reading. A fresh observation creates a new record that
   supersedes the old — never an in-place upgrade.
3. **Derivation steps down.** A derived record sits one step below its weakest
   parent (`observed→derived`, `derived→inferred`). A computed claim is never
   labeled observed — inference can't launder uncertainty.
4. **Content-addressed identity.** IDs are `ev_` + sha256 of the canonical
   projection (claim + confidence + authority + sorted sources). `parseEvidence`
   rejects records whose ID doesn't match their content — tamper-evident by
   construction.
5. **History is never erased.** Superseded and contested records stay
   queryable via `get`, `all`, `trace`. The runtime can see what it *used* to
   believe and why it changed.
6. **Unknown stays unknown.** Absence of a record is not evidence of absence.
   `whatIsKnown` returns `[]` for unrecorded claims — never `false`.

`whatIsKnown` is the "act on as fact" query: it also excludes contested and
superseded records. The full history is always one `trace` away.

## API

```ts
w.record({ claim, confidence, authority, limitations, sources })  // explicit record
w.observe({ claim, sources, limitations })                        // confidence: observed
w.derive({ from, claim, limitations })                            // confidence: one step below weakest parent
w.infer({ from, claim, limitations })                             // confidence: inferred, always
w.contest(id, reason)                                            // flag challenged, keep record
w.supersede(oldId, newRecord)                                    // link, never delete
w.whatIsKnown(about, minConfidence = 'inferred')                 // case-insensitive match, strongest first
w.trace(id)                                                      // provenance chain to the roots
w.get(id) / w.all() / w.size                                     // direct store access
```

Authorities: `direct-sense` · `agent-memory` · `agent-reasoning` ·
`external-claim` · `charter`. Recording the same content twice is idempotent —
the content-addressed ID is the identity.

## Install

```bash
npm install
npm run typecheck   # tsc --noEmit, strict
npm test            # vitest run — 33/33
npm run demo        # build + run the story demo
```

Requires Node 18+. One runtime dependency: `zod`.

## What it is not

- **Not a reverse-engineering tool.** No providers, no decompilers. The
  evidence-record pattern was proven inside RE workstations; Witness is that
  pattern extracted as a standalone layer.
- **Not a vector DB or a memory system.** It's the epistemic layer *under*
  memory: memory stores, Witness judges.
- **Not a truth machine.** Unknowns stay unknown until evidence arrives.

## Where this goes

**v0.2 — inquiry, transport, persistence.** `whatIsKnown` returning empty
shouldn't be a dead end — it's an *inquiry*: tracked work with strategies
(`observe` → go look, `research` → go ask, `reverse-engineer` → go dissect).
Plus the MCP transport wrapper (oversized results retained server-side under
an evidence ID; bounded summaries in context) and append-only JSONL
persistence.

**v0.3 — the skill.** A `witness` agent skill teaching any agent the
invariants as hard rules: record before you reason, never upgrade confidence
without new evidence, cite evidence IDs not vibes.

**The full loop, when it's all built:**

```
unknown → inquiry → investigate → [capability gap?] → engineer the tool →
verify → new observations → evidence → known → inquiry closes
```

The runtime doesn't just learn facts — it grows instruments. With one
constitutional boundary: it may engineer **tools and skills**, never the
kernel, the invariants, or its own charter. Hands that build tools, not hands
that rewrite the self.

## License

MIT. See [LICENSE](LICENSE).
