/**
 * World creation and the monthly simulation step.
 *
 * advanceMonth() processes month T with the economy and events visible to
 * the player while they decided, then evolves the world into month T+1 and
 * generates new events so the player can respond before the next advance.
 *
 * Order within a month (per operating company unless noted):
 *   policies in force (world) → facilities complete → workforce → payroll
 *   → facility costs & depreciation → inbound arrivals → production
 *   → marketing → market clearing (world) → sales posting → R&D
 *   → compliance & storage → collections → payables → debt service
 *   → deposits → unabsorbed conversion → tax → overdraft sweep
 *   → covenants → lifecycle → period summary
 *   then: competitors react (world) → tick+1 → economy → events
 */
import type { Company, PeriodSummary, WorldState } from './types';
import { RULESET_VERSION } from './types';
import { BASE_EXPORT_TARIFFS, BASE_TARIFFS, initialCompetitors, initialPolicies } from './catalog';
import { initialEconomy, snapshotEconomy, stepEconomy } from './economy';
import { refreshSupplierStatus, stepEvents } from './events';
import { balance, cashBalance, incomeStatement, postEntry, rawBalance } from './ledger';
import { inventoryValue, storageCapacity, storageUsed } from './inventory';
import { createRng } from './rng';
import type { Rng } from './rng';
import { processArrivals } from './procurement';
import { laborHoursAvailable, runProduction } from './production';
import { clearMarkets, postSales } from './market';
import type { CompanyMarketing } from './market';
import { stepMarketing } from './marketing';
import { stepRnd } from './rnd';
import { headcount, stepWorkforce } from './workforce';
import { stepCompetitors } from './competitors';
import {
  accrueDeposits,
  accrueTax,
  addPayable,
  checkCovenants,
  clearProductionPool,
  collectReceivables,
  completeFacilities,
  formatRs,
  runFacilityCosts,
  runPayroll,
  serviceDebt,
  settlePayables,
  sweepOverdraft,
} from './finance';
import { notify, tickLabel } from './world';

export interface CreateWorldInput {
  name: string;
  seed: number;
  startYear?: number;
  startMonth?: number;
  scriptedEvents?: boolean;
  eventFrequency?: 'low' | 'normal' | 'high';
  id?: string;
}

export function createWorld(input: CreateWorldInput): WorldState {
  const economy = initialEconomy();
  const world: WorldState = {
    id: input.id ?? `world-${input.seed}`,
    name: input.name,
    seed: input.seed,
    rngState: input.seed >>> 0,
    ruleset: RULESET_VERSION,
    tick: 0,
    startYear: input.startYear ?? 2027,
    startMonth: input.startMonth ?? 0,
    status: 'paused',
    counters: {},
    economy,
    economyHistory: [snapshotEconomy({ economy } as WorldState)],
    companies: [],
    competitors: initialCompetitors(),
    events: [],
    policies: initialPolicies(),
    notifications: [],
    tariffs: JSON.parse(JSON.stringify(BASE_TARIFFS)),
    exportTariffs: { ...BASE_EXPORT_TARIFFS },
    supplierStatus: {},
    options: { scriptedEvents: input.scriptedEvents ?? true, eventFrequency: input.eventFrequency ?? 'normal' },
  };
  refreshSupplierStatus(world);
  return world;
}

function activeCompanies(world: WorldState): Company[] {
  return world.companies.filter((c) => c.lifecycle === 'operating' || c.lifecycle === 'distressed');
}

function stepCompliance(world: WorldState, company: Company): void {
  for (const comp of company.compliance) {
    const pol = world.policies.find((p) => p.id === comp.policyId);
    if (!pol || pol.kind === 'tax' || comp.status === 'compliant') continue;
    if (pol.effectiveTick > world.tick) continue;
    if (comp.status === 'pending') {
      comp.status = 'non_compliant';
      notify(world, { companyId: company.id, severity: 'high', title: `Non-compliant: ${pol.title}`, body: `Penalties of ${formatRs(pol.monthlyPenalty)} per month apply until compliance is completed.`, kind: 'compliance', link: { module: 'law', id: pol.id } });
    }
    if (pol.monthlyPenalty > 0) {
      postEntry(company, world.counters, {
        tick: world.tick,
        memo: `Penalty: non-compliance with ${pol.title}`,
        source: { type: 'policy', id: pol.id },
        cashFlow: 'none',
        lines: [
          { account: '6900', debit: pol.monthlyPenalty, credit: 0 },
          { account: '2300', debit: 0, credit: pol.monthlyPenalty },
        ],
        idempotencyKey: `penalty:${company.id}:${pol.id}:${world.tick}`,
      });
      addPayable(world, company, { counterparty: 'Regulator', amount: pol.monthlyPenalty, dueTick: world.tick, sourceId: pol.id, kind: 'levy', account: '2300' });
      comp.penaltiesPaid += pol.monthlyPenalty;
    }
  }
}

function stepStorage(world: WorldState, company: Company): void {
  const overflow = storageUsed(company) - storageCapacity(company);
  if (overflow <= 0) return;
  const cost = overflow * 4000; // ₹40 per storage unit per month at a 3PL
  postEntry(company, world.counters, {
    tick: world.tick,
    memo: `Overflow storage at third-party warehouse (${overflow.toLocaleString('en-IN')} units over capacity)`,
    source: { type: 'storage', id: `storage-${world.tick}` },
    cashFlow: 'none',
    lines: [
      { account: '6300', debit: cost, credit: 0 },
      { account: '2000', debit: 0, credit: cost },
    ],
    idempotencyKey: `storage:${company.id}:${world.tick}`,
  });
  addPayable(world, company, { counterparty: '3PL warehouse', amount: cost, dueTick: world.tick + 1, sourceId: `storage-${world.tick}`, kind: 'supplier', account: '2000' });
  notify(world, { companyId: company.id, severity: 'medium', title: 'Warehouse over capacity', body: `${overflow.toLocaleString('en-IN')} storage units moved to a 3PL at ${formatRs(cost)}/month. Reduce stock or expand the warehouse.`, kind: 'operations', link: { module: 'inventory' } });
}

function stepLifecycle(world: WorldState, company: Company): void {
  const overdue = company.payables.filter((p) => p.status === 'overdue');
  const defaulted = company.loans.some((l) => l.status === 'defaulted');
  if (overdue.length || defaulted) {
    company.overdueMonths += 1;
    if (company.lifecycle === 'operating') {
      company.lifecycle = 'distressed';
      company.milestones.push({ tick: world.tick, text: 'Entered financial distress (overdue obligations)' });
    }
    if (company.overdueMonths >= 4 && cashBalance(company) < overdue.reduce((a, p) => a + p.amount, 0)) {
      company.lifecycle = 'insolvent';
      for (const l of company.lines) l.plannedUnits = 0;
      company.milestones.push({ tick: world.tick, text: 'Declared insolvent after four months of unpaid obligations' });
      notify(world, { companyId: company.id, severity: 'critical', title: `${company.name} is insolvent`, body: 'Operations have stopped. Records remain available for review.', kind: 'finance', link: { module: 'company' } });
    }
  } else {
    company.overdueMonths = 0;
    if (company.lifecycle === 'distressed') {
      company.lifecycle = 'operating';
      company.milestones.push({ tick: world.tick, text: 'Recovered from financial distress' });
    }
  }
}

function summarize(world: WorldState, company: Company, unitsProduced: number): PeriodSummary {
  const is = incomeStatement(company, world.tick, world.tick);
  const cash = cashBalance(company);
  const indiaSales = company.sales.filter((s) => s.tick === world.tick && s.market === 'IN');
  const share = indiaSales.length ? indiaSales.reduce((a, s) => a + s.share, 0) / new Set(company.products.map((p) => p.segmentId)).size : 0;
  return {
    tick: world.tick,
    revenue: is.revenue,
    cogs: is.cogs,
    grossProfit: is.grossProfit,
    opex: is.opex,
    operatingProfit: is.operatingProfit,
    netIncome: is.netIncome,
    cash,
    debt: balance(company, '2500') + balance(company, '2510'),
    netCashFlow: cash - (world.tick > 0 ? rawBalance(company, '1000', world.tick - 1) : 0),
    unitsSold: company.sales.filter((s) => s.tick === world.tick).reduce((a, s) => a + s.sold, 0),
    unitsProduced,
    headcount: headcount(company),
    awareness: company.brandAwareness,
    satisfaction: company.satisfaction,
    marketShare: +share.toFixed(4),
    inventoryValue: inventoryValue(company, 'raw') + inventoryValue(company, 'finished'),
  };
}

export interface AdvanceReport {
  fromTick: number;
  toTick: number;
  label: string;
  companies: { companyId: string; name: string; lines: string[]; exceptions: string[] }[];
  newEvents: { id: string; title: string; severity: string }[];
}

export function advanceMonth(world: WorldState, opts: { stochastic?: boolean } = {}): AdvanceReport {
  const stochastic = opts.stochastic ?? true;
  const rng: Rng = createRng(world.rngState, stochastic);
  const T = world.tick;
  const report: AdvanceReport = { fromTick: T, toTick: T + 1, label: tickLabel(world, T), companies: [], newEvents: [] };

  for (const p of world.policies) if (p.status === 'announced' && p.effectiveTick <= T) p.status = 'in_force';

  const marketing: Record<string, CompanyMarketing> = {};
  const produced: Record<string, number> = {};
  const exceptions: Record<string, string[]> = {};
  const companies = activeCompanies(world);
  for (const c of companies) {
    exceptions[c.id] = [];
    completeFacilities(world, c);
    stepWorkforce(world, c, rng);
    const payroll = runPayroll(world, c);
    if (!payroll.paid) exceptions[c.id].push('Payroll unpaid — salary arrears accrued');
    const overheadPool = runFacilityCosts(world, c);
    const arrivals = processArrivals(world, c, rng);
    for (const po of arrivals.delayed) exceptions[c.id].push(`${po.id} delayed (${po.delayReason})`);
    for (const po of arrivals.blocked) exceptions[c.id].push(`${po.id} blocked (${po.delayReason})`);
    const records = runProduction(world, c, { laborPool: payroll.production, laborHoursAvailable: laborHoursAvailable(c), overheadPool });
    produced[c.id] = records.reduce((a, r) => a + r.produced, 0);
    for (const r of records) {
      if (r.status !== 'completed') {
        const product = c.products.find((p) => p.id === r.productId);
        exceptions[c.id].push(`${product?.name ?? r.productId}: produced ${r.produced.toLocaleString('en-IN')} of ${r.planned.toLocaleString('en-IN')} planned — ${r.bottleneck}`);
        notify(world, { companyId: c.id, severity: r.status === 'blocked' ? 'high' : 'medium', title: `Production ${r.status === 'blocked' ? 'blocked' : 'short'}: ${product?.name ?? ''}`, body: `${r.produced.toLocaleString('en-IN')} of ${r.planned.toLocaleString('en-IN')} planned units. Bottleneck: ${r.bottleneck}.`, kind: 'operations', link: { module: 'manufacturing', id: r.lineId } });
      }
    }
    const mk = stepMarketing(world, c);
    marketing[c.id] = { promoted: mk.promoted, tradeShow: mk.tradeShow };
  }

  const results = clearMarkets(world, marketing);
  for (const c of companies) {
    const sales = postSales(world, c, results);
    for (const p of c.products) {
      if (p.lastFillRate < 0.9 && sales.some((s) => s.productId === p.id && s.demand > 0)) {
        const lost = sales.filter((s) => s.productId === p.id).reduce((a, s) => a + s.lostSales, 0);
        exceptions[c.id].push(`Stockout: ${p.name} served ${(p.lastFillRate * 100).toFixed(0)}% of demand (${lost.toLocaleString('en-IN')} units lost)`);
        notify(world, { companyId: c.id, severity: 'medium', title: `Stockout: ${p.name}`, body: `Only ${(p.lastFillRate * 100).toFixed(0)}% of demand was served; ${lost.toLocaleString('en-IN')} units of sales were lost.`, kind: 'market', link: { module: 'sales', id: p.id } });
      }
    }
    stepRnd(world, c, rng);
    stepCompliance(world, c);
    stepStorage(world, c);
    collectReceivables(world, c);
    const settled = settlePayables(world, c);
    if (settled.overdue > 0) exceptions[c.id].push(`${formatRs(settled.overdue)} of payables overdue`);
    serviceDebt(world, c);
    accrueDeposits(world, c);
    clearProductionPool(world, c);
    accrueTax(world, c);
    sweepOverdraft(world, c);
    checkCovenants(world, c);
    stepLifecycle(world, c);
    const summary = summarize(world, c, produced[c.id] ?? 0);
    c.history.push(summary);
    report.companies.push({
      companyId: c.id,
      name: c.name,
      lines: [
        `Revenue ${formatRs(summary.revenue)} · gross profit ${formatRs(summary.grossProfit)} · net income ${formatRs(summary.netIncome)}`,
        `Produced ${summary.unitsProduced.toLocaleString('en-IN')} units, sold ${summary.unitsSold.toLocaleString('en-IN')}`,
        `Cash ${formatRs(summary.cash)} (${summary.netCashFlow >= 0 ? '+' : ''}${formatRs(summary.netCashFlow)} this month)`,
      ],
      exceptions: exceptions[c.id],
    });
  }

  stepCompetitors(world, results, rng);

  // move into the next month
  world.tick = T + 1;
  stepEconomy(world, rng);
  world.economyHistory.push(snapshotEconomy(world));
  const created = stepEvents(world, rng);
  report.newEvents = created.map((e) => ({ id: e.id, title: e.title, severity: e.severity }));
  world.rngState = rng.state();
  world.lastAdvance = { tick: T, summary: report.companies.flatMap((c) => c.lines) };
  return report;
}
