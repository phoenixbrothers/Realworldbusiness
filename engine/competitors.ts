/**
 * Rule-based competitor agents. After each market clears they react to
 * their own utilisation and to input-cost inflation:
 *  - under-utilised offers cut price (aggressive 4%, balanced 2%, premium holds)
 *  - sold-out offers raise price 2% and add 5% capacity
 *  - prices drift with Indian inflation
 *  - occasionally (seeded) they launch an improved product, which is
 *    published as a SIMULATED market event
 */
import type { WorldState } from './types';
import { SEGMENTS } from './catalog';
import type { MarketResult } from './market';
import { mul } from './money';
import type { Rng } from './rng';
import { createEvent } from './events';
import { notify } from './world';

export function stepCompetitors(world: WorldState, results: MarketResult[], rng: Rng): void {
  for (const r of results) {
    if (r.market !== 'IN') continue;
    for (const p of r.participants) {
      if (p.kind !== 'competitor') continue;
      const comp = world.competitors.find((c) => c.id === p.competitorId);
      const offer = comp?.offers.find((o) => o.name === p.name);
      if (offer) offer.lastSold = p.sold;
    }
  }
  const inflation = world.economy.countries.IN.inflation / 100 / 12;
  for (const comp of world.competitors) {
    const active = results.some((r) => r.market === 'IN' && r.participants.some((p) => p.competitorId === comp.id));
    for (const o of comp.offers) {
      o.price = mul(o.price, 1 + inflation);
      if (!active) continue;
      const util = o.capacity > 0 ? o.lastSold / o.capacity : 0;
      if (util < 0.6 && comp.posture !== 'premium') {
        const cut = comp.posture === 'aggressive' ? 0.04 : 0.02;
        const floor = mul(SEGMENTS[o.segmentId].referencePrice, 0.7);
        const next = Math.max(floor, mul(o.price, 1 - cut));
        if (next < o.price) {
          o.price = next;
          comp.recentMoves.push({ tick: world.tick, text: `Cut ${o.name} price ${Math.round(cut * 100)}% to defend volume` });
        }
      } else if (util >= 0.95) {
        o.price = mul(o.price, 1.02);
        o.capacity = Math.round(o.capacity * 1.05);
        comp.recentMoves.push({ tick: world.tick, text: `${o.name} sold out: price +2%, capacity +5%` });
      }
    }
    const lastLaunch = comp.recentMoves.filter((m) => m.text.startsWith('Launched')).map((m) => m.tick).pop() ?? -99;
    if (active && world.tick - lastLaunch >= 6 && rng.chance(0.03)) {
      const o = rng.pick(comp.offers);
      const gain = rng.int(4, 7);
      o.quality = Math.min(92, o.quality + gain);
      o.price = mul(o.price, 1.05);
      o.name = o.name.replace(/( Gen \d+)?$/, ` Gen ${Math.floor(world.tick / 6) + 2}`);
      comp.awareness = Math.min(90, comp.awareness + 3);
      comp.recentMoves.push({ tick: world.tick, text: `Launched ${o.name} (quality +${gain})` });
      createEvent(world, {
        kind: 'competitor_launch',
        title: `${comp.name} launches ${o.name}`,
        summary: `${comp.name} released an upgraded ${SEGMENTS[o.segmentId].name.toLowerCase()} product (quality ${o.quality}). Expect share pressure in this segment.`,
        trigger: 'Competitor product cycle (simulated agent)',
        endTick: world.tick + 2,
        severity: 'medium',
        confidence: 0.8,
        countries: ['IN'],
        routes: [],
        effects: {},
        sentiment: 'risk',
        sourceRef: { type: 'segment', id: o.segmentId },
      });
      notify(world, { severity: 'medium', title: `${comp.name} launched ${o.name}`, body: `New competitor product in ${SEGMENTS[o.segmentId].name}.`, kind: 'market', link: { module: 'markets' } });
    }
    comp.awareness = +Math.max(20, Math.min(90, comp.awareness + rng.normal(0, 0.5))).toFixed(2);
    if (comp.recentMoves.length > 12) comp.recentMoves.splice(0, comp.recentMoves.length - 12);
  }
}
