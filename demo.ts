/**
 * demo.ts — Witness v0.1 in one story: a villager, a bridge, and what the
 * runtime actually knows.
 *
 * Run: npm run demo
 */
import { Witness } from './src/index.js';

const w = new Witness();
const show = (label: string, r: { id: string; confidence: string; authority: string }) =>
  console.log(`  ${label}: ${r.confidence} / ${r.authority}  ${r.id.slice(0, 13)}…`);

console.log('\n— 1. OBSERVE: the villager sees the bridge is out —');
const seen = w.observe({
  claim: 'the old bridge is out',
  sources: ['eyes:villager-maren'],
  limitations: ['dusk light, ~200m away'],
});
show('sighting ', seen);

console.log('\n— 2. DERIVE: from the sighting, compute the crossing is risky —');
const risky = w.derive({
  from: [seen.id],
  claim: 'crossing the gorge is risky tonight',
  limitations: ['assumes no hidden ford'],
});
show('derived  ', risky);

console.log('\n— 3. INFER: guess at the cause (this is just a guess) —');
const trolls = w.infer({
  from: [seen.id],
  claim: 'trolls broke the bridge',
  limitations: ['no evidence whatsoever; could be rot, flood, anything'],
});
show('inference', trolls);

console.log('\n— 4. whatIsKnown("bridge") at observed floor: only what was seen —');
for (const r of w.whatIsKnown('bridge', 'observed')) show('fact     ', r);

console.log('\n— 5. whatIsKnown("bridge") default: everything, strongest first —');
for (const r of w.whatIsKnown('bridge')) show('known    ', r);

console.log('\n— 6. CONTEST: a traveler disputes the troll story —');
w.contest(trolls.id, 'traveler claims the bridge rotted, no troll sign');
console.log('  troll story contested; whatIsKnown("troll") now returns:',
  w.whatIsKnown('troll').length, 'record(s) — unknown stays unknown, but challenged');

console.log('\n— 7. SUPERSEDE: dawn patrol confirms — new evidence, never mutation —');
const confirmed = w.observe({
  claim: 'the old bridge is out',
  sources: ['patrol:dawn', 'rope:load-test'],
  limitations: ['load test only to 200kg'],
});
w.supersede(seen.id, confirmed);
console.log('  history kept:', w.size, 'records in store (nothing erased)');

console.log('\n— 8. whatIsKnown("bridge", "observed"): the current truth —');
for (const r of w.whatIsKnown('bridge', 'observed')) show('fact     ', r);

console.log('\n— 9. TRACE: how do we know the crossing is risky? —');
for (const r of w.trace(risky.id)) {
  console.log(`  [${r.confidence}] ${r.claim}`);
  if (r.supersedes?.length) console.log(`       supersedes: ${r.supersedes.length} record(s)`);
}
console.log('\nDone. The runtime knows what it saw, what it computed, what it guessed —\nand which of those it should act on.\n');
