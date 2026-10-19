/**
 * Market clearing. For every segment and market (India + export markets):
 *
 *   total demand = base × trend × seasonality × macro × event multipliers × price-level effect
 *   utility_i    = qW·(quality−60)/10 + bW·(awareness−50)/30 − 2.5·elasticity·ln(effective price / reference)
 *                  + satisfaction, availability, sales-coverage and promotion terms
 *   share_i      = exp(utility_i) / Σ exp(utility_j)     (multinomial logit)
 *
 * Sales are capped by finished-goods stock (players) or capacity
 * (competitors); 40% of unmet demand spills to rivals with stock. Export
 * prices include destination tariffs and the exchange-rate move since tick 0.
 */
import type { Company, CountryCode, Money, SalesRecord, WorldState } from './types';
import { EXPORT_ROUTE, PRODUCT_TEMPLATES, ROUTES, SEGMENTS } from './catalog';
import { macroDemandMultiplier } from './economy';
import { removeStock } from './inventory';
import { nextId, postEntry } from './ledger';
import { mul } from './money';
import { addPayable } from './finance';
import { routeDelay } from './world';

export interface Participant {
  key: string;
  kind: 'player' | 'competitor' | 'incumbents';
  companyId?: string;
  productId?: string;
  competitorId?: string;
  name: string;
  owner: string;
  price: Money; // price customers pay in INR terms (incl. tariff/fx effect)
  listPrice: Money;
  quality: number;
  awareness: number;
  available: number;
  utility: number;
  share: number;
  demand: number;
  sold: number;
}

export interface MarketResult {
  segmentId: string;
  market: CountryCode;
  totalDemand: number;
  participants: Participant[];
}

export interface CompanyMarketing {
  promoted: Set<string>;
  tradeShow: boolean;
}

function segmentEventMult(world: WorldState, segmentId: string): number {
  let m = 1;
  for (const e of world.events) if (e.status === 'active' && e.effects.demandMult?.[segmentId]) m *= e.effects.demandMult[segmentId];
  return m;
}

function salesCoverage(company: Company): number {
  const sales = company.teams.filter((t) => t.department === 'sales_marketing').reduce((a, t) => a + t.headcount * (0.6 + t.skill / 250), 0);
  const needed = 12;
  return Math.max(0.3, Math.min(1.2, sales / needed));
}

export function computeUtility(seg: { qualityWeight: number; brandWeight: number; priceElasticity: number; referencePrice: number }, quality: number, awareness: number, price: number): number {
  return seg.qualityWeight * ((quality - 60) / 10) + seg.brandWeight * ((awareness - 50) / 30) - 2.5 * seg.priceElasticity * Math.log(price / seg.referencePrice);
}

/** clear all markets; `stockCap` lets forecasts reuse the same model */
export function clearMarkets(world: WorldState, marketing: Record<string, CompanyMarketing>): MarketResult[] {
  const results: MarketResult[] = [];
  const monthOfYear = (world.startMonth + world.tick) % 12;
  const active = world.companies.filter((c) => c.lifecycle === 'operating' || c.lifecycle === 'distressed');
  // remaining stock per player product, shared across markets
  const stock: Record<string, number> = {};
  for (const c of active) for (const p of c.products) stock[`${c.id}:${p.id}`] = c.finishedInventory[p.id]?.qty ?? 0;

  const segIds = new Set<string>();
  for (const c of active) for (const p of c.products) if (p.status === 'active') segIds.add(p.segmentId);

  // first pass: demands per market
  const pending: MarketResult[] = [];
  for (const segId of segIds) {
    const seg = SEGMENTS[segId];
    const markets: CountryCode[] = ['IN', ...(Object.keys(seg.exportDemand) as CountryCode[])];
    for (const market of markets) {
      const parts: Participant[] = [];
      for (const c of active) {
        const mk = marketing[c.id] ?? { promoted: new Set<string>(), tradeShow: false };
        for (const p of c.products) {
          if (p.status !== 'active' || p.segmentId !== segId) continue;
          if (market !== 'IN' && !p.exportMarkets.includes(market)) continue;
          let price = p.price;
          let awareness = c.brandAwareness;
          if (market !== 'IN') {
            const fx0 = world.economyHistory[0]?.countries[market].fxPerINR ?? 1;
            const fxNow = world.economy.countries[market].fxPerINR;
            price = mul(p.price, (1 + (world.exportTariffs[market] ?? 0)) * (fxNow / fx0));
            awareness = awareness * 0.5 + (mk.tradeShow ? 10 : 0);
          }
          let u = computeUtility(seg, p.quality, awareness, price);
          u += (c.satisfaction - 70) / 30;
          if (p.lastFillRate < 0.9) u -= 0.3 * (1 - p.lastFillRate);
          if (market === 'IN') u += Math.log(salesCoverage(c));
          if (mk.promoted.has(p.id)) u += 0.15;
          parts.push({ key: `${c.id}:${p.id}`, kind: 'player', companyId: c.id, productId: p.id, name: p.name, owner: c.name, price, listPrice: p.price, quality: p.quality, awareness, available: 0, utility: u, share: 0, demand: 0, sold: 0 });
        }
      }
      if (!parts.length) continue;
      if (market === 'IN') {
        for (const comp of world.competitors) {
          for (const o of comp.offers) {
            if (o.segmentId !== segId) continue;
            const u = computeUtility(seg, o.quality, comp.awareness, o.price);
            parts.push({ key: `${comp.id}:${o.name}`, kind: 'competitor', competitorId: comp.id, name: o.name, owner: comp.name, price: o.price, listPrice: o.price, quality: o.quality, awareness: comp.awareness, available: o.capacity, utility: u, share: 0, demand: 0, sold: 0 });
          }
        }
      } else {
        // local incumbents represent the rest of the export market
        const u = computeUtility(seg, 66, 60, seg.referencePrice);
        parts.push({ key: `incumbents:${market}`, kind: 'incumbents', name: 'Local brands', owner: 'Local incumbents', price: seg.referencePrice, listPrice: seg.referencePrice, quality: 66, awareness: 60, available: Number.MAX_SAFE_INTEGER, utility: u, share: 0, demand: 0, sold: 0 });
      }
      const maxU = Math.max(...parts.map((p) => p.utility));
      const exps = parts.map((p) => Math.exp(p.utility - maxU));
      const sumE = exps.reduce((a, b) => a + b, 0);
      parts.forEach((p, i) => (p.share = exps[i] / sumE));
      const avgPrice = parts.reduce((a, p) => a + p.share * p.price, 0);
      const priceLevel = Math.pow(avgPrice / seg.referencePrice, -0.5);
      const trend = 1 + 0.004 * world.tick;
      const base = market === 'IN' ? seg.baseDemand : seg.exportDemand[market] ?? 0;
      const totalDemand = Math.round(base * trend * seg.seasonality[monthOfYear] * macroDemandMultiplier(world, market) * segmentEventMult(world, segId) * Math.max(0.6, Math.min(1.4, priceLevel)));
      for (const p of parts) p.demand = Math.round(totalDemand * p.share);
      pending.push({ segmentId: segId, market, totalDemand, participants: parts });
    }
  }

  // allocate shared player stock across markets in proportion to demand
  const totalPlayerDemand: Record<string, number> = {};
  for (const r of pending) for (const p of r.participants) if (p.kind === 'player') totalPlayerDemand[p.key] = (totalPlayerDemand[p.key] ?? 0) + p.demand;
  for (const r of pending) {
    for (const p of r.participants) {
      if (p.kind !== 'player') continue;
      const s = stock[p.key] ?? 0;
      const td = totalPlayerDemand[p.key] || 1;
      let avail = td <= s ? p.demand : Math.floor((s * p.demand) / td);
      // export lanes hit by a route disruption can only ship half the volume
      if (r.market !== 'IN') {
        const routeId = EXPORT_ROUTE[r.market];
        if (routeId && routeDelay(world, routeId) > 0) avail = Math.floor(avail * 0.5);
      }
      p.available = avail;
    }
    // first-round sales
    for (const p of r.participants) p.sold = Math.min(p.demand, p.available);
    // spillover: 40% of unmet demand goes to rivals with spare availability
    const unmet = r.participants.reduce((a, p) => a + (p.demand - p.sold), 0);
    const spill = Math.floor(unmet * 0.4);
    if (spill > 0) {
      const spare = r.participants.filter((p) => p.available > p.sold);
      const spareShare = spare.reduce((a, p) => a + p.share, 0);
      for (const p of spare) {
        const extra = Math.min(p.available - p.sold, Math.floor((spill * p.share) / (spareShare || 1)));
        p.sold += extra;
      }
    }
    for (const p of r.participants) if (p.kind === 'player') stock[p.key] = (stock[p.key] ?? 0) - p.sold;
    results.push(r);
  }
  return results;
}

/** post the sales of one company from cleared markets */
export function postSales(world: WorldState, company: Company, results: MarketResult[]): SalesRecord[] {
  const records: SalesRecord[] = [];
  const hub = company.facilities.some((f) => f.type === 'logistics_hub' && f.status !== 'under_construction');
  const hubLevel = Math.max(0, ...company.facilities.filter((f) => f.type === 'logistics_hub').map((f) => f.level));
  const levyPolicies = world.policies.filter((p) => p.kind === 'per_unit_levy' && p.status === 'in_force' && (p.industries === 'all' || p.industries.includes(company.industry)));
  let logisticsDue = 0;
  let leviesDue = 0;
  const demandByProduct: Record<string, { demand: number; sold: number }> = {};
  for (const r of results) {
    const totalSold = r.participants.reduce((a, p) => a + p.sold, 0);
    for (const p of r.participants) {
      if (p.companyId !== company.id || !p.productId) continue;
      const product = company.products.find((x) => x.id === p.productId)!;
      const d = (demandByProduct[product.id] ??= { demand: 0, sold: 0 });
      d.demand += p.demand;
      d.sold += p.sold;
      const rec: SalesRecord = { tick: world.tick, productId: product.id, market: r.market, demand: p.demand, sold: p.sold, lostSales: Math.max(0, p.demand - p.sold), price: product.price, revenue: product.price * p.sold, cogs: 0, share: totalSold ? +(p.sold / totalSold).toFixed(4) : 0 };
      if (p.sold > 0) {
        const saleId = nextId(world.counters, 'SL');
        const domestic = r.market === 'IN';
        const cogs = removeStock(company, world.counters, world.tick, 'finished', product.id, p.sold, domestic ? 'sale' : 'export_sale', saleId);
        rec.cogs = cogs;
        const revenue = rec.revenue;
        const lines = [] as { account: string; debit: number; credit: number; memo?: string }[];
        if (domestic) {
          // 40% online (cash, 2% gateway fee), 60% via distributors on net-30 terms
          const online = mul(revenue, 0.4);
          const fee = mul(online, 0.02);
          const distributors = revenue - online;
          lines.push({ account: '1000', debit: online - fee, credit: 0, memo: 'Online sales (net of gateway fee)' });
          lines.push({ account: '6600', debit: fee, credit: 0, memo: 'Gateway fee' });
          lines.push({ account: '1100', debit: distributors, credit: 0, memo: 'Distributor receivable (net 30)' });
          lines.push({ account: '4000', debit: 0, credit: revenue });
          if (distributors > 0) company.receivables.push({ id: nextId(world.counters, 'AR'), counterparty: 'Domestic distributors', amount: distributors, dueTick: world.tick + 1, status: 'open', sourceId: saleId });
          logisticsDue += mul(revenue, hub ? Math.max(0.01, 0.03 - 0.005 * hubLevel) : 0.03);
          for (const pol of levyPolicies) leviesDue += pol.perUnitLevy * p.sold;
        } else {
          lines.push({ account: '1100', debit: revenue, credit: 0, memo: `Export receivable ${r.market} (net 60)` });
          lines.push({ account: '4010', debit: 0, credit: revenue });
          company.receivables.push({ id: nextId(world.counters, 'AR'), counterparty: `Importer (${r.market})`, amount: revenue, dueTick: world.tick + 2, status: 'open', sourceId: saleId });
          const route = ROUTES[EXPORT_ROUTE[r.market] ?? 'AE-MUM'];
          logisticsDue += mul(revenue, route.freightRate * (world.economy.freightIndex / 100) * (hub ? 0.85 : 1));
        }
        lines.push({ account: '5000', debit: cogs, credit: 0, memo: 'Cost of goods sold' });
        lines.push({ account: '1210', debit: 0, credit: cogs });
        postEntry(company, world.counters, {
          tick: world.tick,
          memo: `${domestic ? 'Domestic' : `Export (${r.market})`} sales ${saleId}: ${p.sold.toLocaleString('en-IN')} × ${product.name}`,
          source: { type: 'sale', id: saleId },
          cashFlow: 'operating',
          cashFlowLine: 'Receipts from customers',
          lines,
          idempotencyKey: `sale:${product.id}:${r.market}:${world.tick}`,
        });
      }
      records.push(rec);
      company.sales.push(rec);
    }
  }
  if (logisticsDue > 0) {
    postEntry(company, world.counters, {
      tick: world.tick,
      memo: 'Outbound distribution and export freight',
      source: { type: 'logistics', id: `logistics-${world.tick}` },
      cashFlow: 'none',
      lines: [
        { account: '6400', debit: logisticsDue, credit: 0 },
        { account: '2000', debit: 0, credit: logisticsDue },
      ],
      idempotencyKey: `logistics:${company.id}:${world.tick}`,
    });
    addPayable(world, company, { counterparty: 'Logistics partners', amount: logisticsDue, dueTick: world.tick + 1, sourceId: `logistics-${world.tick}`, kind: 'supplier', account: '2000' });
  }
  if (leviesDue > 0) {
    postEntry(company, world.counters, {
      tick: world.tick,
      memo: 'EPR levy on units sold in India',
      source: { type: 'levy', id: `levy-${world.tick}` },
      cashFlow: 'none',
      lines: [
        { account: '6900', debit: leviesDue, credit: 0 },
        { account: '2300', debit: 0, credit: leviesDue },
      ],
      idempotencyKey: `levy:${company.id}:${world.tick}`,
    });
    addPayable(world, company, { counterparty: 'EPR compliance authority', amount: leviesDue, dueTick: world.tick + 1, sourceId: `levy-${world.tick}`, kind: 'levy', account: '2300' });
  }
  // service level feeds next month's availability and satisfaction
  let wD = 0;
  let wS = 0;
  let qSum = 0;
  for (const p of company.products) {
    const d = demandByProduct[p.id];
    if (!d) continue;
    p.lastFillRate = d.demand > 0 ? +(d.sold / d.demand).toFixed(3) : 1;
    wD += d.demand;
    wS += d.sold;
    qSum += p.quality * d.demand;
  }
  if (wD > 0) {
    const fill = wS / wD;
    const avgQ = qSum / wD;
    const target = 70 + (avgQ - 62) * 0.8 - (1 - fill) * 40;
    company.satisfaction = +Math.max(0, Math.min(100, company.satisfaction + 0.35 * (target - company.satisfaction))).toFixed(1);
  }
  return records;
}

export function productVolume(templateId: string): number {
  return PRODUCT_TEMPLATES[templateId]?.volume ?? 0.05;
}
