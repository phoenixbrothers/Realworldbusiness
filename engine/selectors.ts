/**
 * Read models for the UI. Every KPI carries its definition, unit, period,
 * data type and the ledger accounts it is derived from, so the UI can drill
 * from a number to the journal lines behind it.
 */
import type { Company, DataType, Money, Severity, WorldState } from './types';
import { COUNTRIES, MATERIALS, PRODUCT_TEMPLATES, SEGMENTS, SUPPLIERS } from './catalog';
import { ACCOUNTS, accountActivity, balance, balanceSheet, cashBalance, cashFlowStatement, incomeStatement, rawBalance } from './ledger';
import { inventoryValue, reconcileInventory, storageCapacity, storageUsed } from './inventory';
import { planFeasibility } from './production';
import { computeExposure, monthlyMaterialNeeds } from './events';
import { committedPurchases } from './procurement';
import { formatRs, overdraft, teamMonthlyCost, valuationEstimate } from './finance';
import { headcount, marketSalary } from './workforce';
import { companyInvariants } from './invariants';
import { tickLabel } from './world';

export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  display: string;
  unit: 'INR' | '%' | 'months' | 'units' | 'index' | 'people';
  period: string;
  dataType: DataType;
  definition: string;
  accounts: string[];
  comparison?: { label: string; value: number | null; display: string; delta: number | null };
  trend: { tick: number; label: string; value: number }[];
  note?: string;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export interface RunwayInfo {
  months: number | null;
  burn: Money;
  meaningful: boolean;
  definition: string;
}

/** Cash ÷ average monthly net burn over the last 3 closed months, excluding financing inflows */
export function runway(company: Company, world: WorldState): RunwayInfo {
  const definition = 'Cash ÷ average monthly net cash outflow over the last 3 closed months. Outflow excludes equity raised, loans and overdraft drawn. "Not meaningful" when the company generated cash on that basis.';
  const closed = world.tick - 1;
  if (closed < company.foundedTick) return { months: null, burn: 0, meaningful: false, definition };
  const from = Math.max(company.foundedTick, closed - 2);
  let net = 0;
  for (const e of company.journal) {
    if (e.tick < from || e.tick > closed) continue;
    const d = e.lines.filter((l) => l.account === '1000').reduce((a, l) => a + l.debit - l.credit, 0);
    if (e.cashFlow === 'financing' && d > 0) continue; // ignore funding inflows
    if (e.source.type === 'setup') continue; // one-off founding entries
    net += d;
  }
  const months = closed - from + 1;
  const burn = Math.round(-net / months);
  if (burn <= 0) return { months: null, burn, meaningful: false, definition };
  return { months: +(cashBalance(company) / burn).toFixed(1), burn, meaningful: true, definition };
}

export function kpis(world: WorldState, company: Company): Kpi[] {
  const last = world.tick - 1;
  const prev = world.tick - 2;
  const h = company.history;
  const trend = (f: (x: (typeof h)[number]) => number) => h.slice(-12).map((x) => ({ tick: x.tick, label: tickLabel(world, x.tick), value: f(x) }));
  const isL = last >= company.foundedTick ? incomeStatement(company, last, last) : null;
  const isP = prev >= company.foundedTick ? incomeStatement(company, prev, prev) : null;
  const period = last >= 0 ? `Month ending ${tickLabel(world, last)}` : 'No closed month yet';
  const delta = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : (a - b) / Math.abs(b));
  const cash = cashBalance(company);
  const prevCash = last >= 0 ? rawBalance(company, '1000', last - 1) : null;
  const rw = runway(company, world);
  const gm = isL && isL.revenue > 0 ? isL.grossProfit / isL.revenue : null;
  const gmP = isP && isP.revenue > 0 ? isP.grossProfit / isP.revenue : null;
  const debt = balance(company, '2500') + balance(company, '2510');
  return [
    {
      key: 'cash', label: 'Cash balance', value: cash, display: formatRs(cash), unit: 'INR', period: `As of now (${tickLabel(world, world.tick)})`, dataType: 'actual',
      definition: 'Spendable balance of GL 1000 Cash & bank. Excludes fixed deposits, undrawn overdraft and any valuation.', accounts: ['1000'],
      comparison: { label: 'vs start of last month', value: prevCash, display: prevCash === null ? '—' : formatRs(prevCash), delta: delta(cash, prevCash) },
      trend: trend((x) => x.cash),
    },
    {
      key: 'revenue', label: 'Monthly revenue', value: isL?.revenue ?? null, display: isL ? formatRs(isL.revenue) : '—', unit: 'INR', period, dataType: 'actual',
      definition: 'Net sales recognized in GL 4000 (domestic) and 4010 (export) for the last closed month. Prices are net of GST (not modeled).', accounts: ['4000', '4010'],
      comparison: { label: 'vs prior month', value: isP?.revenue ?? null, display: isP ? formatRs(isP.revenue) : '—', delta: delta(isL?.revenue ?? null, isP?.revenue ?? null) },
      trend: trend((x) => x.revenue),
    },
    {
      key: 'gross_margin', label: 'Gross margin', value: gm, display: gm === null ? '—' : pct(gm), unit: '%', period, dataType: 'actual',
      definition: '(Revenue − cost of sales) ÷ revenue. Cost of sales = COGS + scrap + idle capacity cost (GL 5000–5060).', accounts: ['4000', '4010', '5000', '5050', '5060'],
      comparison: { label: 'vs prior month', value: gmP, display: gmP === null ? '—' : pct(gmP), delta: gm !== null && gmP !== null ? gm - gmP : null },
      trend: trend((x) => (x.revenue ? x.grossProfit / x.revenue : 0)),
      note: gm === null ? 'Not meaningful until there is revenue.' : undefined,
    },
    {
      key: 'runway', label: 'Cash runway', value: rw.months, display: rw.meaningful ? `${rw.months} months` : 'Not meaningful', unit: 'months', period: 'Based on last 3 closed months', dataType: 'estimate',
      definition: rw.definition, accounts: ['1000'],
      comparison: { label: 'Average monthly net burn', value: rw.burn, display: rw.burn > 0 ? formatRs(rw.burn) : 'Cash generative', delta: null },
      trend: [],
      note: rw.meaningful ? undefined : 'The company was cash-flow positive (or has no closed month), so a burn-based runway does not apply.',
    },
    {
      key: 'operating_profit', label: 'Operating profit', value: isL?.operatingProfit ?? null, display: isL ? formatRs(isL.operatingProfit) : '—', unit: 'INR', period, dataType: 'actual',
      definition: 'Gross profit minus operating expenses (GL 6000–6900). Accounting profit is not cash.', accounts: ['4000', '4010', '5000', '5050', '5060', '6000', '6100', '6200', '6300', '6400', '6500', '6600', '6700', '6800', '6900'],
      comparison: { label: 'vs prior month', value: isP?.operatingProfit ?? null, display: isP ? formatRs(isP.operatingProfit) : '—', delta: delta(isL?.operatingProfit ?? null, isP?.operatingProfit ?? null) },
      trend: trend((x) => x.operatingProfit),
    },
    {
      key: 'debt', label: 'Debt outstanding', value: debt, display: formatRs(debt), unit: 'INR', period: 'As of now', dataType: 'actual',
      definition: 'Term loans (GL 2500) plus drawn overdraft (GL 2510).', accounts: ['2500', '2510'],
      trend: trend((x) => x.debt),
    },
    {
      key: 'inventory', label: 'Inventory value', value: inventoryValue(company, 'raw') + inventoryValue(company, 'finished'), display: formatRs(inventoryValue(company, 'raw') + inventoryValue(company, 'finished')), unit: 'INR', period: 'As of now', dataType: 'actual',
      definition: 'Raw materials at landed moving-average cost (GL 1200) plus finished goods at absorbed cost (GL 1210).', accounts: ['1200', '1210'],
      trend: trend((x) => x.inventoryValue),
    },
    {
      key: 'share', label: 'Market share (India)', value: h.length ? h[h.length - 1].marketShare : null, display: h.length ? pct(h[h.length - 1].marketShare) : '—', unit: '%', period, dataType: 'actual',
      definition: 'Average across your segments of your units sold ÷ all units sold in India (players and simulated competitors).', accounts: [],
      trend: trend((x) => x.marketShare),
    },
  ];
}

export interface Alert {
  id: string;
  severity: Severity;
  title: string;
  reason: string;
  impact: string;
  owner: string;
  module: string;
  targetId?: string;
  dismissed: boolean;
}

export function alerts(world: WorldState, company: Company): Alert[] {
  const out: Alert[] = [];
  const push = (a: Omit<Alert, 'dismissed'>) => out.push({ ...a, dismissed: company.dismissedAlerts.includes(a.id) });
  if (company.lifecycle === 'insolvent' || company.lifecycle === 'closed') {
    push({ id: 'lifecycle', severity: 'critical', title: `Company is ${company.lifecycle}`, reason: 'Operating decisions are disabled.', impact: 'Records remain available read-only.', owner: 'Board', module: 'company' });
    return out;
  }
  const needs = monthlyMaterialNeeds(company);
  for (const [m, need] of Object.entries(needs)) {
    const onHand = company.rawInventory[m]?.qty ?? 0;
    const inbound = company.purchaseOrders.filter((p) => p.materialId === m && (p.status === 'in_transit' || p.status === 'delayed') && p.expectedTick <= world.tick).reduce((a, p) => a + p.qty, 0);
    if (onHand + inbound < need) {
      push({ id: `stockout:${m}`, severity: onHand + inbound === 0 ? 'high' : 'medium', title: `Input stockout risk: ${MATERIALS[m].name}`, reason: `Plan needs ${need.toLocaleString('en-IN')} ${MATERIALS[m].unit} this month; ${onHand.toLocaleString('en-IN')} on hand + ${inbound.toLocaleString('en-IN')} arriving.`, impact: 'Production will be cut to the available material.', owner: 'Operations', module: 'supply-chain', targetId: m });
    }
    const rp = company.reorderPoints[m] ?? 0;
    if (rp > 0 && onHand < rp) push({ id: `reorder:${m}`, severity: 'low', title: `Below reorder point: ${MATERIALS[m].name}`, reason: `${onHand.toLocaleString('en-IN')} on hand < reorder point ${rp.toLocaleString('en-IN')}.`, impact: 'Safety stock is being consumed.', owner: 'Operations', module: 'inventory', targetId: m });
  }
  const rw = runway(company, world);
  if (rw.meaningful && rw.months !== null && rw.months < 6) push({ id: 'runway', severity: rw.months < 3 ? 'critical' : 'high', title: `Cash runway ${rw.months} months`, reason: `Average burn ${formatRs(rw.burn)}/month against ${formatRs(cashBalance(company))} cash (threshold: 6 months).`, impact: 'Mandatory payments will draw the overdraft, then go overdue.', owner: 'Finance', module: 'finance' });
  const od = overdraft(company);
  if (od && od.outstanding > od.principal * 0.75) push({ id: 'overdraft', severity: 'high', title: 'Overdraft above 75% utilized', reason: `${formatRs(od.outstanding)} drawn of ${formatRs(od.principal)}.`, impact: 'Little headroom for mandatory payments.', owner: 'Finance', module: 'finance' });
  const overdue = company.payables.filter((p) => p.status === 'overdue');
  if (overdue.length) push({ id: 'overdue', severity: 'critical', title: `${overdue.length} payment(s) overdue`, reason: `${formatRs(overdue.reduce((a, p) => a + p.amount, 0))} unpaid past due date.`, impact: 'Company is in financial distress; four months of arrears leads to insolvency.', owner: 'Finance', module: 'finance' });
  for (const l of company.loans) {
    if (l.status !== 'active' || l.kind !== 'term_loan') continue;
    if (l.maturityTick - world.tick <= 3) push({ id: `maturity:${l.id}`, severity: 'medium', title: `Debt maturity: ${l.lender}`, reason: `${formatRs(l.outstanding)} due by ${tickLabel(world, l.maturityTick)}.`, impact: 'Final repayment requires cash.', owner: 'Finance', module: 'finance', targetId: l.id });
    if (l.covenantMinCash > 0 && cashBalance(company) < l.covenantMinCash * 1.2) push({ id: `covenant:${l.id}`, severity: 'high', title: `Covenant headroom low: ${l.lender}`, reason: `Cash ${formatRs(cashBalance(company))} vs minimum ${formatRs(l.covenantMinCash)}.`, impact: 'A breach adds 100 bps to the loan margin.', owner: 'Finance', module: 'finance', targetId: l.id });
  }
  for (const p of company.rndProjects) if (p.awaitingGate) push({ id: `gate:${p.id}`, severity: 'medium', title: `Gate decision: ${p.name}`, reason: `Passed ${p.stage.replace('_', ' ')} review; progress halted until you decide.`, impact: 'R&D capacity is idle on this project.', owner: 'R&D', module: 'rnd', targetId: p.id });
  for (const comp of company.compliance) {
    const pol = world.policies.find((x) => x.id === comp.policyId);
    if (!pol || comp.status === 'compliant') continue;
    if (comp.status === 'non_compliant') push({ id: `policy:${pol.id}`, severity: 'high', title: `Non-compliant: ${pol.title}`, reason: `In force since ${tickLabel(world, pol.effectiveTick)}.`, impact: `${formatRs(pol.monthlyPenalty)} penalty every month.`, owner: 'Legal', module: 'law', targetId: pol.id });
    else if (pol.effectiveTick - world.tick <= 2) push({ id: `policy:${pol.id}`, severity: 'medium', title: `Compliance due: ${pol.title}`, reason: `Takes effect ${tickLabel(world, pol.effectiveTick)}.`, impact: `${formatRs(pol.monthlyPenalty)}/month penalty if not compliant.`, owner: 'Legal', module: 'law', targetId: pol.id });
  }
  for (const l of company.lines) if (l.condition < 0.6 && l.status !== 'maintenance') push({ id: `maint:${l.id}`, severity: 'medium', title: `Maintenance needed: ${l.name}`, reason: `Condition ${(l.condition * 100).toFixed(0)}% (threshold 60%).`, impact: 'Capacity and yield are reduced below 70% condition.', owner: 'Operations', module: 'manufacturing', targetId: l.id });
  const cap = storageCapacity(company);
  if (cap > 0 && storageUsed(company) > cap * 0.9) push({ id: 'warehouse', severity: storageUsed(company) > cap ? 'high' : 'low', title: 'Warehouse nearly full', reason: `${storageUsed(company).toLocaleString('en-IN')} of ${cap.toLocaleString('en-IN')} storage units used.`, impact: 'Overflow goes to a 3PL at ₹40/unit/month.', owner: 'Operations', module: 'inventory' });
  const pending = company.transactions.filter((t) => t.status === 'pending_review');
  if (pending.length) push({ id: 'tx-pending', severity: 'low', title: `${pending.length} transaction(s) awaiting review`, reason: 'Proposed financing or capex has not been approved or rejected.', impact: 'No effect until approved.', owner: 'Finance', module: 'transactions' });
  for (const t of company.teams) if (t.headcount > 0 && t.morale < 45) push({ id: `morale:${t.id}`, severity: 'medium', title: `Low morale: ${t.role}`, reason: `Morale ${t.morale.toFixed(0)} (threshold 45); pay ${formatRs(t.salary)} vs market ${formatRs(marketSalary(world, t))}.`, impact: 'Attrition and productivity losses rise.', owner: 'HR', module: 'workforce', targetId: t.id });
  for (const p of company.products) {
    const fg = company.finishedInventory[p.id]?.qty ?? 0;
    const lastSales = company.sales.filter((s) => s.productId === p.id && s.tick === world.tick - 1).reduce((a, s) => a + s.demand, 0);
    if (p.status === 'active' && lastSales > 0 && p.lastFillRate < 0.9) push({ id: `fg:${p.id}`, severity: 'medium', title: `Stockouts: ${p.name}`, reason: `Served ${(p.lastFillRate * 100).toFixed(0)}% of demand last month; ${fg.toLocaleString('en-IN')} units on hand.`, impact: 'Lost sales and lower satisfaction; availability penalty on next month’s share.', owner: 'Operations', module: 'sales', targetId: p.id });
  }
  for (const ev of world.events) {
    if (ev.status !== 'active') continue;
    const ex = computeExposure(world, company, ev);
    if (ex.level === 'high' || ex.level === 'medium') push({ id: `event:${ev.id}`, severity: ex.level === 'high' ? 'high' : 'medium', title: `Exposed: ${ev.title}`, reason: `${ex.items.length} exposed item(s). ${ex.impactBasis}`, impact: `Est. ${formatRs(Math.abs(ex.monthlyImpact))}/month ${ex.monthlyImpact >= 0 ? 'at risk' : 'benefit'} (estimate).`, owner: 'Strategy', module: 'events', targetId: ev.id });
  }
  const rank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function advancePreview(world: WorldState, company: Company) {
  const plans = planFeasibility(world, company);
  const arriving = company.purchaseOrders.filter((p) => (p.status === 'in_transit' || p.status === 'delayed') && p.expectedTick <= world.tick);
  const payroll = company.teams.reduce((a, t) => a + teamMonthlyCost(company, t.id), 0);
  const payablesDue = company.payables.filter((p) => (p.status === 'open' || p.status === 'overdue') && p.dueTick <= world.tick).reduce((a, p) => a + p.amount, 0);
  const receivablesDue = company.receivables.filter((r) => r.status === 'open' && r.dueTick <= world.tick).reduce((a, r) => a + r.amount, 0);
  const pendingDecisions = [
    ...company.rndProjects.filter((p) => p.awaitingGate).map((p) => ({ label: `R&D gate: ${p.name}`, module: 'rnd' })),
    ...company.transactions.filter((t) => t.status === 'pending_review').map((t) => ({ label: `Transaction ${t.id} (${t.kind.replace('_', ' ')})`, module: 'transactions' })),
  ];
  return {
    month: tickLabel(world, world.tick),
    tick: world.tick,
    production: plans.map((p) => ({ lineId: p.lineId, line: company.lines.find((l) => l.id === p.lineId)?.name, product: company.products.find((x) => x.id === p.productId)?.name ?? '—', planned: p.planned, feasible: p.feasible, bottleneck: p.feasible < p.planned ? p.bottleneck?.label : null })),
    arriving: arriving.map((p) => ({ id: p.id, label: `${p.qty.toLocaleString('en-IN')} ${MATERIALS[p.materialId].unit} ${MATERIALS[p.materialId].name}`, supplier: SUPPLIERS[p.supplierId].name })),
    cash: cashBalance(company),
    obligations: { payroll, payablesDue, receivablesDue },
    pendingDecisions,
    risks: alerts(world, company).filter((a) => !a.dismissed && (a.severity === 'critical' || a.severity === 'high')),
  };
}

export function kpiDetail(world: WorldState, company: Company, key: string) {
  const k = kpis(world, company).find((x) => x.key === key);
  if (!k) return null;
  const from = Math.max(0, world.tick - 3);
  const records = k.accounts.flatMap((a) => accountActivity(company, a, from).map((r) => ({ entryId: r.entry.id, tick: r.entry.tick, month: tickLabel(world, r.entry.tick), memo: r.entry.memo, account: a, accountName: ACCOUNTS[a].name, debit: r.debit, credit: r.credit, source: r.entry.source })));
  records.sort((a, b) => b.tick - a.tick || b.entryId.localeCompare(a.entryId));
  return { kpi: k, records: records.slice(0, 200), bridge: key === 'cash' || key === 'runway' ? null : varianceBridge(world, company) };
}

/** explain last month's net income change vs the prior month by driver */
export function varianceBridge(world: WorldState, company: Company, toTick = world.tick - 1) {
  const fromTick = toTick - 1;
  if (fromTick < company.foundedTick) return null;
  const a = incomeStatement(company, fromTick, fromTick);
  const b = incomeStatement(company, toTick, toTick);
  const salesA = company.sales.filter((s) => s.tick === fromTick);
  const salesB = company.sales.filter((s) => s.tick === toTick);
  let priceEffect = 0;
  for (const s of salesB) {
    const prior = salesA.find((x) => x.productId === s.productId && x.market === s.market);
    if (prior) priceEffect += (s.price - prior.price) * s.sold;
  }
  const revenueChange = b.revenue - a.revenue;
  const line = (code: string) => (b.lines.find((l) => l.code === code)?.amount ?? 0) - (a.lines.find((l) => l.code === code)?.amount ?? 0);
  const steps = [
    { label: 'Volume & mix', amount: revenueChange - priceEffect, source: 'Units sold × prior price' },
    { label: 'Price', amount: priceEffect, source: 'Price change × units sold' },
    { label: 'Cost of goods sold', amount: -line('5000'), source: 'GL 5000' },
    { label: 'Scrap & idle capacity', amount: -(line('5050') + line('5060')), source: 'GL 5050, 5060' },
    { label: 'Payroll (non-production)', amount: -line('6000'), source: 'GL 6000' },
    { label: 'Marketing', amount: -line('6100'), source: 'GL 6100' },
    { label: 'R&D', amount: -line('6200'), source: 'GL 6200' },
    { label: 'Logistics & freight', amount: -line('6400'), source: 'GL 6400' },
    { label: 'Other operating', amount: -(line('6300') + line('6500') + line('6600') + line('6700') + line('6800') + line('6900')), source: 'GL 6300, 6500–6900' },
    { label: 'Interest (net)', amount: -line('7000') + line('4900'), source: 'GL 7000, 4900' },
    { label: 'Tax', amount: -line('8000'), source: 'GL 8000' },
  ];
  return { from: tickLabel(world, fromTick), to: tickLabel(world, toTick), start: a.netIncome, end: b.netIncome, steps, reconciles: a.netIncome + steps.reduce((x, s) => x + s.amount, 0) === b.netIncome };
}

export function financeSummary(world: WorldState, company: Company, from: number, to: number) {
  return {
    income: incomeStatement(company, from, to),
    balance: balanceSheet(company, to),
    cashFlow: cashFlowStatement(company, from, to),
    valuation: valuationEstimate(world, company),
    runway: runway(company, world),
    committedPurchases: committedPurchases(company),
    invariants: companyInvariants(company),
    inventoryReconciliation: reconcileInventory(company),
  };
}

export function search(world: WorldState, company: Company | null, q: string) {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const out: { type: string; id: string; label: string; detail: string; module: string }[] = [];
  const m = (t: string) => t.toLowerCase().includes(s);
  const pages: [string, string][] = [['World overview', 'overview'], ['Company', 'company'], ['Finance', 'finance'], ['Manufacturing', 'manufacturing'], ['Inventory', 'inventory'], ['Supply chain', 'supply-chain'], ['R&D', 'rnd'], ['Marketing', 'marketing'], ['Sales', 'sales'], ['Workforce', 'workforce'], ['Markets & competitors', 'markets'], ['Countries & geopolitics', 'countries'], ['Investments', 'investments'], ['Global trade', 'trade'], ['Economics', 'economics'], ['Law & regulation', 'law'], ['Transactions', 'transactions'], ['News & events', 'events'], ['Reports', 'reports'], ['Settings', 'settings']];
  for (const [label, mod] of pages) if (m(label)) out.push({ type: 'page', id: mod, label, detail: 'Module', module: mod });
  if (company) {
    for (const p of company.products) if (m(p.name)) out.push({ type: 'product', id: p.id, label: p.name, detail: SEGMENTS[p.segmentId].name, module: 'sales' });
    for (const po of company.purchaseOrders) if (m(po.id) || m(MATERIALS[po.materialId].name)) out.push({ type: 'purchase_order', id: po.id, label: `${po.id} · ${MATERIALS[po.materialId].name}`, detail: po.status, module: 'supply-chain' });
    for (const e of company.journal) if (m(e.id) || m(e.memo)) out.push({ type: 'journal', id: e.id, label: `${e.id} · ${e.memo}`, detail: tickLabel(world, e.tick), module: 'transactions' });
    for (const t of company.teams) if (m(t.role)) out.push({ type: 'team', id: t.id, label: t.role, detail: `${t.headcount} staff`, module: 'workforce' });
    for (const r of company.rndProjects) if (m(r.name)) out.push({ type: 'rnd', id: r.id, label: r.name, detail: r.stage, module: 'rnd' });
    for (const c of company.campaigns) if (m(c.name)) out.push({ type: 'campaign', id: c.id, label: c.name, detail: c.status, module: 'marketing' });
  }
  for (const sp of Object.values(SUPPLIERS)) if (m(sp.name)) out.push({ type: 'supplier', id: sp.id, label: sp.name, detail: COUNTRIES[sp.country].name, module: 'supply-chain' });
  for (const mat of Object.values(MATERIALS)) if (m(mat.name)) out.push({ type: 'material', id: mat.id, label: mat.name, detail: 'Material', module: 'inventory' });
  for (const c of Object.values(COUNTRIES)) if (m(c.name)) out.push({ type: 'country', id: c.code, label: c.name, detail: c.region, module: 'countries' });
  for (const ev of world.events) if (m(ev.title)) out.push({ type: 'event', id: ev.id, label: ev.title, detail: `${tickLabel(world, ev.tick)} · simulated`, module: 'events' });
  for (const comp of world.competitors) if (m(comp.name)) out.push({ type: 'competitor', id: comp.id, label: comp.name, detail: COUNTRIES[comp.country].name, module: 'markets' });
  for (const t of Object.values(PRODUCT_TEMPLATES)) if (m(t.name) && !out.some((o) => o.label.includes(t.name))) out.push({ type: 'concept', id: t.id, label: t.name, detail: t.unlockedByDefault ? 'Starting product' : 'R&D concept', module: 'rnd' });
  return out.slice(0, 40);
}

export function companyCard(world: WorldState, c: Company) {
  const last = c.history[c.history.length - 1];
  return {
    id: c.id, name: c.name, brand: c.brand, industry: c.industry, city: c.city, lifecycle: c.lifecycle, isDemo: c.isDemo, foundedLabel: tickLabel(world, c.foundedTick),
    cash: cashBalance(c), revenue: last?.revenue ?? 0, netIncome: last?.netIncome ?? 0, headcount: headcount(c), products: c.products.filter((p) => p.status === 'active').length,
    facilities: c.facilities.map((f) => ({ type: f.type, level: f.level, status: f.status })),
    pendingDecisions: c.rndProjects.filter((p) => p.awaitingGate).length + c.transactions.filter((t) => t.status === 'pending_review').length,
    milestones: c.milestones.slice(-3),
  };
}

export { pct as formatPct };
