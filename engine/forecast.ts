/**
 * Forecasts and scenarios reuse the real engine on a compacted copy of the
 * world with the RNG in non-stochastic mode: no new events, no random
 * delays, no gate failures, mean-reverting macro with zero shocks, and the
 * company's current plan held constant. Results are labelled FORECAST or
 * SCENARIO — never actual.
 */
import type { Company, CountryCode, JournalEntry, Money, WorldState } from './types';
import { ACCOUNT_CODES, rawBalance } from './ledger';
import { advanceMonth } from './simulation';
import { createEvent, buildEvent } from './events';
import { mul } from './money';
import { tickLabel } from './world';

export interface ScenarioChanges {
  priceChangePct?: number; // all active products
  marketingExtra?: Money; // extra monthly digital spend
  productionChangePct?: number; // scale every line's plan (capped by feasibility at run time)
  tariffShock?: { country: CountryCode; add: number };
  energyShortage?: boolean;
  demandShockPct?: number; // all segments of the company
  rupeeShockPct?: number; // e.g. -6 = rupee weakens 6%
  portStrikeRoute?: string;
}

export interface ProjectionPoint {
  tick: number;
  label: string;
  revenue: Money;
  grossProfit: Money;
  operatingProfit: Money;
  netIncome: Money;
  cash: Money;
  debt: Money;
  unitsSold: number;
  marketShare: number;
}

export interface Projection {
  dataType: 'forecast' | 'scenario';
  companyId: string;
  fromTick: number;
  months: number;
  points: ProjectionPoint[];
  assumptions: string[];
}

/** collapse ledger history into one opening-balance entry so projections stay fast */
function compact(world: WorldState): WorldState {
  const w: WorldState = structuredClone({ ...world, companies: [] as Company[], notifications: [], economyHistory: world.economyHistory.slice(0, 1) });
  for (const c of world.companies) {
    const lines = ACCOUNT_CODES.map((a) => ({ account: a, raw: rawBalance(c, a) }))
      .filter((x) => x.raw !== 0)
      .map((x) => ({ account: x.account, debit: x.raw > 0 ? x.raw : 0, credit: x.raw < 0 ? -x.raw : 0 }));
    const opening: JournalEntry[] = lines.length >= 2
      ? [{ id: 'OPEN', companyId: c.id, tick: world.tick - 1, seq: 0, memo: 'Opening balances (projection)', source: { type: 'opening', id: 'OPEN' }, cashFlow: 'none', lines, status: 'posted', idempotencyKey: 'opening' }]
      : [];
    const copy: Company = structuredClone({ ...c, journal: [] as JournalEntry[], movements: [] as Company['movements'], sales: c.sales.slice(-20), production: [], history: c.history.slice(-6) });
    copy.journal = opening;
    // movement history is replaced by synthetic opening movements so reconciliation stays meaningful
    for (const [id, it] of Object.entries(copy.rawInventory)) if (it.qty) copy.movements.push({ id: `OPEN-${id}`, tick: world.tick - 1, kind: 'raw', itemId: id, qty: it.qty, value: it.value, reason: 'purchase_receipt', refId: 'OPEN' });
    for (const [id, it] of Object.entries(copy.finishedInventory)) if (it.qty) copy.movements.push({ id: `OPENF-${id}`, tick: world.tick - 1, kind: 'finished', itemId: id, qty: it.qty, value: it.value, reason: 'production_output', refId: 'OPEN' });
    w.companies.push(copy);
  }
  return w;
}

function applyChanges(w: WorldState, company: Company, ch: ScenarioChanges): string[] {
  const notes: string[] = [];
  if (ch.priceChangePct) {
    for (const p of company.products) if (p.status === 'active') p.price = Math.max(100, mul(p.price, 1 + ch.priceChangePct / 100));
    notes.push(`All prices ${ch.priceChangePct > 0 ? '+' : ''}${ch.priceChangePct}%`);
  }
  if (ch.productionChangePct) {
    for (const l of company.lines) l.plannedUnits = Math.max(0, Math.round(l.plannedUnits * (1 + ch.productionChangePct / 100)));
    notes.push(`Production plan ${ch.productionChangePct > 0 ? '+' : ''}${ch.productionChangePct}% (still capped by feasibility each month)`);
  }
  if (ch.marketingExtra && ch.marketingExtra > 0) {
    company.campaigns.push({ id: 'SCN-CP', name: 'Scenario campaign', channel: 'digital', productId: null, monthlyBudget: ch.marketingExtra, startTick: w.tick, endTick: w.tick + 120, spent: 0, status: 'scheduled', reach: 0 });
    notes.push(`Extra digital marketing ₹${(ch.marketingExtra / 100).toLocaleString('en-IN')}/month`);
  }
  const inject = (draft: ReturnType<typeof buildEvent>, endOffset: number) => {
    if (!draft) return;
    createEvent(w, { ...draft, endTick: w.tick + endOffset, title: `[Scenario] ${draft.title}` });
  };
  if (ch.tariffShock) {
    const d = buildEvent(w, 'tariff_increase', ch.tariffShock.country);
    if (d) {
      d.effects = { tariffAdd: ['electronics', 'energy_storage', 'metals', 'chemicals', 'packaging', 'agri'].map((category) => ({ from: ch.tariffShock!.country, category, add: ch.tariffShock!.add })) };
      inject(d, 24);
      notes.push(`Duty on all imports from ${ch.tariffShock.country} ${ch.tariffShock.add > 0 ? '+' : ''}${Math.round(ch.tariffShock.add * 100)} pts`);
    }
  }
  if (ch.energyShortage) {
    inject(buildEvent(w, 'energy_shortage', 1), 1);
    notes.push('Grid power cut to 60% for 2 months');
  }
  if (ch.portStrikeRoute) {
    inject(buildEvent(w, 'port_strike', ch.portStrikeRoute), 1);
    notes.push(`Port strike on ${ch.portStrikeRoute} for 2 months`);
  }
  if (ch.demandShockPct) {
    const segs = [...new Set(company.products.map((p) => p.segmentId))];
    const d = buildEvent(w, 'demand_shock', segs[0]);
    if (d) {
      d.effects = { demandMult: Object.fromEntries(segs.map((s) => [s, 1 + ch.demandShockPct! / 100])) };
      inject(d, 24);
      notes.push(`Category demand ${ch.demandShockPct > 0 ? '+' : ''}${ch.demandShockPct}%`);
    }
  }
  if (ch.rupeeShockPct) {
    for (const [code, c] of Object.entries(w.economy.countries)) if (code !== 'IN') c.fxPerINR = +(c.fxPerINR * (1 + ch.rupeeShockPct / 100)).toPrecision(6);
    notes.push(`Rupee ${ch.rupeeShockPct < 0 ? 'weakens' : 'strengthens'} ${Math.abs(ch.rupeeShockPct)}% immediately`);
  }
  return notes;
}

export function project(world: WorldState, companyId: string, months: number, changes?: ScenarioChanges): Projection {
  const w = compact(world);
  const company = w.companies.find((c) => c.id === companyId);
  if (!company) throw new Error('Company not found');
  const assumptions = [
    'Current production plan, prices, campaigns, R&D budgets and headcount held constant.',
    'Purchase orders already placed arrive on schedule; no new orders are placed, so materials may run out.',
    'Macro indicators mean-revert with no random shocks; no new world events; competitors do not launch products.',
    'R&D gate reviews are assumed to pass but launches still require your approval, so no launches occur.',
  ];
  if (changes) assumptions.unshift(...applyChanges(w, company, changes));
  const points: ProjectionPoint[] = [];
  for (let i = 0; i < months; i++) {
    if (company.lifecycle === 'insolvent' || company.lifecycle === 'closed') break;
    advanceMonth(w, { stochastic: false });
    const h = company.history[company.history.length - 1];
    points.push({ tick: h.tick, label: tickLabel(w, h.tick), revenue: h.revenue, grossProfit: h.grossProfit, operatingProfit: h.operatingProfit, netIncome: h.netIncome, cash: h.cash, debt: h.debt, unitsSold: h.unitsSold, marketShare: h.marketShare });
  }
  return { dataType: changes ? 'scenario' : 'forecast', companyId, fromTick: world.tick, months, points, assumptions };
}
