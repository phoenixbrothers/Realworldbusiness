/**
 * Simulated macro economy. Each indicator follows a mean-reverting random
 * walk around its anchor; events apply explicit one-off shocks. In forecast
 * mode (non-stochastic RNG) the walk is pure mean reversion with no shocks.
 */
import type { CommodityId, CountryCode, EconomySnapshot, WorldState } from './types';
import { COMMODITIES, ECONOMY_ANCHORS } from './catalog';
import type { Rng } from './rng';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

export function initialEconomy(): EconomySnapshot {
  const countries = JSON.parse(JSON.stringify(ECONOMY_ANCHORS)) as EconomySnapshot['countries'];
  const commodities = Object.fromEntries(Object.keys(COMMODITIES).map((k) => [k, 100])) as Record<CommodityId, number>;
  return { tick: 0, countries, commodities, energyPriceINRPerKwh: 800, freightIndex: 100, wageIndex: 100 };
}

/** evolve the economy into the current world.tick (call after the tick counter advances) */
export function stepEconomy(world: WorldState, rng: Rng): void {
  const e = world.economy;
  for (const code of Object.keys(e.countries) as CountryCode[]) {
    const c = e.countries[code];
    const a = ECONOMY_ANCHORS[code];
    c.gdpGrowth = r2(clamp(c.gdpGrowth + 0.15 * (a.gdpGrowth - c.gdpGrowth) + rng.normal(0, 0.15), -6, 12));
    c.inflation = r2(clamp(c.inflation + 0.12 * (a.inflation - c.inflation) + rng.normal(0, 0.12), -2, 20));
    // central bank reacts to inflation gap (Taylor-like, slow)
    const targetRate = a.policyRate + 0.5 * (c.inflation - a.inflation);
    c.policyRate = r2(clamp(c.policyRate + 0.1 * (targetRate - c.policyRate), 0, 15));
    // fx: interest/inflation differential vs India plus noise; drifts back towards anchor
    const fxDrift = 0.08 * (a.fxPerINR - c.fxPerINR) / a.fxPerINR + rng.normal(0, 0.006);
    if (code !== 'IN') c.fxPerINR = +(c.fxPerINR * (1 + fxDrift)).toPrecision(6);
    c.stability = r2(clamp(c.stability + 0.1 * (a.stability - c.stability) + rng.normal(0, 0.6), 0, 100));
    c.consumerConfidence = r2(clamp(c.consumerConfidence + 0.15 * (a.consumerConfidence - c.consumerConfidence) + rng.normal(0, 0.8), 60, 140));
    c.relationsWithIndia = code === 'IN' ? 100 : r2(clamp(c.relationsWithIndia + 0.05 * (a.relationsWithIndia - c.relationsWithIndia) + rng.normal(0, 0.5), -100, 100));
  }
  for (const k of Object.keys(e.commodities) as CommodityId[]) {
    const vol = COMMODITIES[k].volatility;
    e.commodities[k] = r2(clamp(e.commodities[k] + 0.1 * (100 - e.commodities[k]) + rng.normal(0, vol * 100), 40, 300));
  }
  const india = e.countries.IN;
  // energy price tracks Indian inflation (monthly) and any active energy events
  const energyMult = world.events.filter((ev) => ev.status === 'active' && ev.effects.energyPriceMult).reduce((m, ev) => Math.max(m, ev.effects.energyPriceMult ?? 1), 1);
  const baseEnergy = Math.round(800 * Math.pow(1 + 0.045 / 12, world.tick));
  e.energyPriceINRPerKwh = Math.round(baseEnergy * energyMult);
  e.freightIndex = r2(clamp(e.freightIndex + 0.15 * (100 - e.freightIndex) + rng.normal(0, 2), 60, 300));
  // wages: grow with inflation each month
  e.wageIndex = r2(e.wageIndex * (1 + Math.max(0, india.inflation) / 100 / 12));
  e.tick = world.tick;
}

export function snapshotEconomy(world: WorldState): EconomySnapshot {
  return JSON.parse(JSON.stringify(world.economy)) as EconomySnapshot;
}

/** India demand multiplier from macro conditions (documented formula) */
export function macroDemandMultiplier(world: WorldState, country: CountryCode = 'IN'): number {
  const c = world.economy.countries[country];
  const a = ECONOMY_ANCHORS[country];
  const growth = 1 + ((c.gdpGrowth - a.gdpGrowth) / 100) * 3;
  const confidence = c.consumerConfidence / 100;
  const inflationDrag = 1 - Math.max(0, c.inflation - (a.inflation + 1)) * 0.02;
  return clamp(growth * confidence * inflationDrag, 0.5, 1.6);
}
