import { describe, expect, it } from 'vitest';
import {
  buildEvidence,
  computeId,
  parseEvidence,
  Witness,
  WitnessError,
  type Evidence,
} from '../src/index.js';

function obs(claim: string, limitations = ['sensor could be miscalibrated']) {
  return new Witness().observe({ claim, limitations });
}

describe('schema — invariant 1: limitations required', () => {
  it('rejects an empty limitations array', () => {
    const w = new Witness();
    expect(() =>
      w.record({
        claim: 'the bridge is out',
        confidence: 'observed',
        authority: 'direct-sense',
        limitations: [],
      }),
    ).toThrow(WitnessError);
  });

  it('rejects blank limitation strings', () => {
    const w = new Witness();
    expect(() =>
      w.record({
        claim: 'the bridge is out',
        confidence: 'observed',
        authority: 'direct-sense',
        limitations: ['   '],
      }),
    ).toThrow(WitnessError);
  });

  it('rejects unknown fields (strict schema)', () => {
    expect(() =>
      buildEvidence({
        claim: 'x',
        confidence: 'observed',
        authority: 'direct-sense',
        limitations: ['could be wrong'],
        sources: [],
        createdAt: new Date().toISOString(),
        // @ts-expect-error — not part of the schema
        mood: 'confident',
      }),
    ).toThrow();
  });

  it('rejects invalid confidence and authority values', () => {
    const w = new Witness();
    expect(() =>
      w.record({
        claim: 'x',
        // @ts-expect-error — invalid enum
        confidence: 'certain',
        authority: 'direct-sense',
        limitations: ['could be wrong'],
      }),
    ).toThrow();
    expect(() =>
      w.record({
        claim: 'x',
        confidence: 'observed',
        // @ts-expect-error — invalid enum
        authority: 'vibes',
        limitations: ['could be wrong'],
      }),
    ).toThrow();
  });
});

describe('identity — invariant 4: content-addressed ids', () => {
  it('produces ev_ + 64 hex chars, deterministic for identical content', () => {
    const input = {
      claim: 'the bridge is out',
      confidence: 'observed' as const,
      authority: 'direct-sense' as const,
      sources: ['sensor:watchtower'],
      limitations: ['could be wrong'],
      createdAt: '2026-10-12T12:00:00.000Z',
    };
    const a = computeId(input);
    const b = computeId(input);
    expect(a).toBe(b);
    expect(a).toMatch(/^ev_[0-9a-f]{64}$/);
  });

  it('is order-independent for sources', () => {
    const base = {
      claim: 'x',
      confidence: 'observed' as const,
      authority: 'direct-sense' as const,
      limitations: ['could be wrong'],
      createdAt: '2026-10-12T12:00:00.000Z',
    };
    expect(computeId({ ...base, sources: ['b', 'a'] })).toBe(computeId({ ...base, sources: ['a', 'b'] }));
  });

  it('changes when the claim changes', () => {
    const base = {
      confidence: 'observed' as const,
      authority: 'direct-sense' as const,
      sources: [] as string[],
      limitations: ['could be wrong'],
      createdAt: '2026-10-12T12:00:00.000Z',
    };
    expect(computeId({ ...base, claim: 'x' })).not.toBe(computeId({ ...base, claim: 'y' }));
  });

  it('record() is idempotent: same content, same record, store unchanged', () => {
    const w = new Witness();
    const input = {
      claim: 'the bridge is out',
      confidence: 'observed' as const,
      authority: 'direct-sense' as const,
      limitations: ['could be wrong'],
    };
    const a = w.record(input);
    const b = w.record(input);
    expect(a.id).toBe(b.id);
    expect(w.size).toBe(1);
  });

  it('parse() rejects tampered records (id/content mismatch)', () => {
    const rec = obs('the bridge is out');
    const tampered: Evidence = { ...rec, claim: 'the bridge is fine' };
    expect(() => parseEvidence(tampered)).toThrow(WitnessError);
    try {
      parseEvidence(tampered);
    } catch (e) {
      expect((e as WitnessError).code).toBe('ID_MISMATCH');
    }
  });

  it('parse() rejects records with malformed ids', () => {
    expect(() => parseEvidence({ ...obs('x'), id: 'nope' })).toThrow(WitnessError);
  });

  it('parse() accepts a genuine record', () => {
    const rec = obs('the bridge is out');
    expect(parseEvidence(JSON.parse(JSON.stringify(rec)))).toEqual(rec);
  });
});

describe('observe / record constructors', () => {
  it('observe() pins observed + direct-sense', () => {
    const rec = obs('saw the river rise');
    expect(rec.confidence).toBe('observed');
    expect(rec.authority).toBe('direct-sense');
  });

  it('record() allows charter authority (given, not learned)', () => {
    const w = new Witness();
    const rec = w.record({
      claim: 'protect earth and everything living on it',
      confidence: 'observed',
      authority: 'charter',
      limitations: ['interpretation of scope may evolve'],
    });
    expect(rec.authority).toBe('charter');
  });
});

describe('derive — invariant 3: the floor', () => {
  it('deriving from observed parents yields derived, never observed', () => {
    const w = new Witness();
    const a = w.observe({ claim: 'sensor read 21.5C', limitations: ['sensor drift'] });
    const b = w.observe({ claim: 'sensor read 22.0C', limitations: ['sensor drift'] });
    const d = w.derive({ from: [a.id, b.id], claim: 'mean is 21.75C', limitations: ['rounding'] });
    expect(d.confidence).toBe('derived');
    expect(d.sources).toEqual([a.id, b.id]);
  });

  it('deriving from mixed parents floors to the weakest, stepped down', () => {
    const w = new Witness();
    const o = w.observe({ claim: 'saw the bridge', limitations: ['fog'] });
    const i = w.infer({ from: [o.id], claim: 'trolls did it', limitations: ['pure guess'] });
    const d = w.derive({ from: [o.id, i.id], claim: 'bridge out, cause unclear', limitations: ['mixed'] });
    // weakest parent is inferred -> stepped down stays inferred
    expect(d.confidence).toBe('inferred');
  });

  it('deriving from a derived parent steps down to inferred', () => {
    const w = new Witness();
    const o = w.observe({ claim: 'saw the bridge', limitations: ['fog'] });
    const d1 = w.derive({ from: [o.id], claim: 'bridge load estimated', limitations: ['model'] });
    expect(d1.confidence).toBe('derived');
    const d2 = w.derive({ from: [d1.id], claim: 'load re-estimated', limitations: ['model again'] });
    expect(d2.confidence).toBe('inferred');
  });

  it('derive keeps direct-sense authority only for pure observation transforms', () => {
    const w = new Witness();
    const o = w.observe({ claim: 'read 21.5C', limitations: ['drift'] });
    const pure = w.derive({ from: [o.id], claim: '294.65K', limitations: ['rounding'] });
    expect(pure.authority).toBe('direct-sense');

    const ext = w.record({
      claim: 'traveler says the bridge is out',
      confidence: 'observed',
      authority: 'external-claim',
      limitations: ['traveler may lie'],
    });
    const mixed = w.derive({ from: [o.id, ext.id], claim: 'combined reading', limitations: ['mixed'] });
    expect(mixed.authority).toBe('agent-reasoning');
  });

  it('derive rejects unknown parents and empty parent lists', () => {
    const w = new Witness();
    expect(() => w.derive({ from: ['ev_0000'], claim: 'x', limitations: ['y'] })).toThrow(WitnessError);
    expect(() => w.derive({ from: [], claim: 'x', limitations: ['y'] })).toThrow(WitnessError);
  });
});

describe('infer', () => {
  it('is always inferred, even from observed parents', () => {
    const w = new Witness();
    const o = w.observe({ claim: 'saw the bridge', limitations: ['fog'] });
    const i = w.infer({ from: [o.id], claim: 'the trolls are restless', limitations: ['no evidence'] });
    expect(i.confidence).toBe('inferred');
    expect(i.authority).toBe('agent-reasoning');
  });
});

describe('contest — flag, never erase', () => {
  it('marks contested, keeps the record queryable, records the reason', () => {
    const w = new Witness();
    const rec = w.observe({ claim: 'the bridge is out', limitations: ['fog'] });
    const c = w.contest(rec.id, 'traveler now claims it was repaired');
    expect(c.contested).toBe(true);
    expect(c.id).toBe(rec.id); // identity untouched
    expect(c.limitations.some((l) => l.includes('traveler now claims'))).toBe(true);
    expect(w.get(rec.id).contested).toBe(true); // still in the store
  });

  it('contested records are excluded from whatIsKnown', () => {
    const w = new Witness();
    const rec = w.observe({ claim: 'the bridge is out', limitations: ['fog'] });
    expect(w.whatIsKnown('bridge')).toHaveLength(1);
    w.contest(rec.id, 'doubt');
    expect(w.whatIsKnown('bridge')).toHaveLength(0);
  });

  it('contest on unknown id throws', () => {
    expect(() => new Witness().contest('ev_0000', 'nope')).toThrow(WitnessError);
  });
});

describe('supersede — invariant 2 & 5: new evidence, never mutation or erasure', () => {
  it('full upgrade path: infer -> observe -> supersede', () => {
    const w = new Witness();
    const guess = w.record({
      claim: 'the bridge is out',
      confidence: 'inferred',
      authority: 'agent-reasoning',
      limitations: ['only a rumor'],
    });
    // fresh evidence arrives: the agent goes and looks
    const seen = w.observe({ claim: 'the bridge is out', limitations: ['saw it myself'] });
    w.supersede(guess.id, seen);

    expect(w.get(seen.id).supersedes).toContain(guess.id);
    // history intact
    expect(w.get(guess.id).confidence).toBe('inferred');
    // but current knowledge reflects the upgrade
    const known = w.whatIsKnown('bridge', 'observed');
    expect(known.map((r) => r.id)).toEqual([seen.id]);
  });

  it('whatIsKnown excludes superseded records at any confidence', () => {
    const w = new Witness();
    const oldR = w.observe({ claim: 'the bridge is out', limitations: ['fog'] });
    // distinct content (different sources) so it gets its own id
    const newR = w.observe({
      claim: 'the bridge is out',
      sources: ['patrol:second-look'],
      limitations: ['clear day'],
    });
    expect(newR.id).not.toBe(oldR.id);
    w.supersede(oldR.id, newR);
    const known = w.whatIsKnown('bridge');
    expect(known.map((r) => r.id)).toEqual([newR.id]);
  });

  it('supersede rejects unknown ids and self-links', () => {
    const w = new Witness();
    const r = w.observe({ claim: 'x', limitations: ['y'] });
    expect(() => w.supersede('ev_0000', r)).toThrow(WitnessError);
    expect(() => w.supersede(r.id, r)).toThrow(WitnessError);
    const ghost = { ...r, id: 'ev_' + '0'.repeat(64) };
    expect(() => w.supersede(r.id, ghost)).toThrow(WitnessError);
  });
});

describe('whatIsKnown — invariant 6: unknown stays unknown', () => {
  it('returns [] for unrecorded claims, not false', () => {
    const w = new Witness();
    w.observe({ claim: 'the bridge is out', limitations: ['fog'] });
    expect(w.whatIsKnown('dragons')).toEqual([]);
  });

  it('matches case-insensitively on substrings', () => {
    const w = new Witness();
    w.observe({ claim: 'The Old Bridge is out', limitations: ['fog'] });
    expect(w.whatIsKnown('old bridge')).toHaveLength(1);
    expect(w.whatIsKnown('BRIDGE')).toHaveLength(1);
  });

  it('filters by minimum confidence: observed > derived > inferred', () => {
    const w = new Witness();
    const o = w.observe({ claim: 'bridge stone count', limitations: ['miscount'] });
    const d = w.derive({ from: [o.id], claim: 'bridge load rating', limitations: ['model'] });
    const i = w.infer({ from: [o.id], claim: 'bridge troll mood', limitations: ['guess'] });

    expect(w.whatIsKnown('bridge', 'observed').map((r) => r.id)).toEqual([o.id]);
    expect(w.whatIsKnown('bridge', 'derived').map((r) => r.id)).toEqual([o.id, d.id]);
    expect(w.whatIsKnown('bridge').map((r) => r.id)).toEqual([o.id, d.id, i.id]);
    expect(w.whatIsKnown('bridge', 'inferred')).toHaveLength(3);
  });

  it('orders strongest confidence first', () => {
    const w = new Witness();
    const o = w.observe({ claim: 'bridge fact', limitations: ['x'] });
    w.infer({ from: [o.id], claim: 'bridge hunch', limitations: ['y'] });
    const known = w.whatIsKnown('bridge');
    expect(known[0]?.confidence).toBe('observed');
    expect(known[1]?.confidence).toBe('inferred');
  });
});

describe('trace — provenance to the roots', () => {
  it('walks sources depth-first back to root observations', () => {
    const w = new Witness();
    const o1 = w.observe({ claim: 'saw the bridge', limitations: ['fog'] });
    const o2 = w.observe({ claim: 'saw the river', limitations: ['dark'] });
    const d = w.derive({ from: [o1.id, o2.id], claim: 'crossing risky', limitations: ['model'] });
    const i = w.infer({ from: [d.id], claim: 'trolls restless', limitations: ['guess'] });

    const chain = w.trace(i.id).map((r) => r.id);
    expect(chain[0]).toBe(i.id);
    expect(chain).toContain(d.id);
    expect(chain).toContain(o1.id);
    expect(chain).toContain(o2.id);
    expect(chain).toHaveLength(4);
  });

  it('skips non-record sources (tool names, urls) as leaves', () => {
    const w = new Witness();
    const o = w.observe({ claim: 'x', sources: ['sensor:cam-1', 'https://example.com'], limitations: ['y'] });
    expect(w.trace(o.id).map((r) => r.id)).toEqual([o.id]);
  });

  it('throws on unknown id and survives diamond ancestry without dupes', () => {
    const w = new Witness();
    expect(() => w.trace('ev_0000')).toThrow(WitnessError);
    const o = w.observe({ claim: 'root', limitations: ['x'] });
    const d1 = w.derive({ from: [o.id], claim: 'd1', limitations: ['x'] });
    const d2 = w.derive({ from: [o.id], claim: 'd2', limitations: ['x'] });
    const d3 = w.derive({ from: [d1.id, d2.id], claim: 'd3', limitations: ['x'] });
    const ids = w.trace(d3.id).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(4);
  });
});

describe('store basics', () => {
  it('get/all/size behave; get throws on unknown id', () => {
    const w = new Witness();
    expect(w.size).toBe(0);
    const r = w.observe({ claim: 'x', limitations: ['y'] });
    expect(w.size).toBe(1);
    expect(w.get(r.id)).toEqual(r);
    expect(w.all()).toHaveLength(1);
    expect(() => w.get('ev_0000')).toThrow(WitnessError);
  });
});
