/**
 * Treasury, financing and recurring finance postings.
 *
 * Cash rules:
 *  - Cash can never go negative (enforced by the ledger).
 *  - Mandatory payments (payroll, supplier/tax payables, debt service) may
 *    draw on the overdraft facility up to its limit.
 *  - Discretionary spending (marketing, R&D, training, capex) never uses the
 *    overdraft; it is skipped or rejected when cash is short.
 *  - Valuation is an ESTIMATE and is never added to cash.
 */
import type { Company, Loan, Money, Payable, TransactionKind, TransactionRecord, WorldState } from './types';
import { DomainError } from './types';
import { CITIES, CORPORATE_TAX_RATE, EMPLOYER_CONTRIBUTION_RATE, FACILITY_SPECS, PRODUCT_TEMPLATES } from './catalog';
import { balance, cashBalance, incomeStatement, nextId, postEntry, rawBalance } from './ledger';
import { annuityPayment, monthlyInterest, mul, rupees } from './money';
import { notify, tickLabel } from './world';

export function overdraft(company: Company): Loan | undefined {
  return company.loans.find((l) => l.kind === 'overdraft' && l.status === 'active');
}

export function loanRateBps(world: WorldState, loan: Loan): number {
  return loan.floating ? Math.round(world.economy.countries.IN.policyRate * 100) + loan.spreadBps : loan.fixedRateBps;
}

/** make sure `amount` of cash is available, drawing overdraft if allowed */
export function ensureCash(world: WorldState, company: Company, amount: Money, allowOverdraft: boolean, purpose: string): boolean {
  const cash = cashBalance(company);
  if (cash >= amount) return true;
  if (!allowOverdraft) return false;
  const od = overdraft(company);
  if (!od) return false;
  const need = amount - cash;
  if (od.principal - od.outstanding < need) return false;
  od.outstanding += need;
  postEntry(company, world.counters, {
    tick: world.tick,
    memo: `Overdraft drawn to fund ${purpose}`,
    source: { type: 'loan', id: od.id },
    cashFlow: 'financing',
    cashFlowLine: 'Overdraft drawn',
    lines: [
      { account: '1000', debit: need, credit: 0 },
      { account: '2510', debit: 0, credit: need },
    ],
    idempotencyKey: `od-draw:${od.id}:${world.counters.JE ?? 0}`,
  });
  return true;
}

export function addPayable(world: WorldState, company: Company, p: Omit<Payable, 'id' | 'status'>): Payable {
  const payable: Payable = { ...p, id: nextId(world.counters, 'AP'), status: 'open' };
  company.payables.push(payable);
  return payable;
}

export function teamMonthlyCost(company: Company, teamId: string): Money {
  const t = company.teams.find((x) => x.id === teamId);
  if (!t) return 0;
  const gross = t.salary * t.headcount;
  const overtime = company.overtime && t.department === 'production' ? mul(gross, 0.375) : 0;
  return gross + mul(gross, EMPLOYER_CONTRIBUTION_RATE) + overtime;
}

/** pay monthly payroll; production payroll goes to the production cost pool */
export function runPayroll(world: WorldState, company: Company): { production: Money; other: Money; paid: boolean } {
  let production = 0;
  let other = 0;
  for (const t of company.teams) {
    const c = teamMonthlyCost(company, t.id);
    if (t.department === 'production') production += c;
    else other += c;
  }
  const total = production + other;
  if (total === 0) return { production, other, paid: true };
  const paid = ensureCash(world, company, total, true, 'payroll');
  postEntry(company, world.counters, {
    tick: world.tick,
    memo: paid ? `Payroll ${tickLabel(world, world.tick)}` : `Payroll ${tickLabel(world, world.tick)} accrued — unpaid (insufficient funds)`,
    source: { type: 'payroll', id: `payroll-${world.tick}` },
    cashFlow: 'operating',
    cashFlowLine: 'Salaries paid',
    lines: [
      { account: '1295', debit: production, credit: 0, memo: 'Production labor' },
      { account: '6000', debit: other, credit: 0, memo: 'Non-production salaries' },
      { account: paid ? '1000' : '2100', debit: 0, credit: total },
    ],
    idempotencyKey: `payroll:${company.id}:${world.tick}`,
  });
  if (!paid) {
    addPayable(world, company, { counterparty: 'Employees (salary arrears)', amount: total, dueTick: world.tick, sourceId: `payroll-${world.tick}`, kind: 'salary', account: '2100' });
    for (const t of company.teams) t.morale = Math.max(0, t.morale - 20);
    notify(world, { companyId: company.id, severity: 'critical', title: 'Payroll could not be paid', body: 'Salaries were accrued as arrears. Morale fell sharply; raise funds or cut costs.', kind: 'finance', link: { module: 'finance' } });
  }
  return { production, other, paid };
}

/** facility running costs and depreciation; factory costs feed the production pool */
export function runFacilityCosts(world: WorldState, company: Company): Record<string, Money> {
  const overhead: Record<string, Money> = {};
  for (const f of company.facilities) {
    if (f.status === 'under_construction') continue;
    const isFactory = f.type === 'factory';
    if (f.monthlyFixedCost > 0) {
      const ok = ensureCash(world, company, f.monthlyFixedCost, true, `${f.name} running costs`);
      postEntry(company, world.counters, {
        tick: world.tick,
        memo: `${f.name}: ${f.owned ? 'utilities, security & upkeep' : 'lease & utilities'}`,
        source: { type: 'facility', id: f.id },
        cashFlow: 'operating',
        cashFlowLine: 'Facility costs paid',
        lines: [
          { account: isFactory ? '1295' : '6300', debit: f.monthlyFixedCost, credit: 0 },
          { account: ok ? '1000' : '2000', debit: 0, credit: f.monthlyFixedCost },
        ],
        idempotencyKey: `facility-cost:${f.id}:${world.tick}`,
      });
      if (!ok) addPayable(world, company, { counterparty: `${f.name} landlord/utilities`, amount: f.monthlyFixedCost, dueTick: world.tick, sourceId: f.id, kind: 'other', account: '2000' });
      if (isFactory) overhead[f.id] = (overhead[f.id] ?? 0) + f.monthlyFixedCost;
    }
    if (f.owned && f.cost > 0 && f.usefulLifeMonths > 0) {
      const accumulated = depreciationToDate(company, f.id);
      const monthly = Math.min(Math.round(f.cost / f.usefulLifeMonths), f.cost - accumulated);
      if (monthly > 0) {
        postEntry(company, world.counters, {
          tick: world.tick,
          memo: `Depreciation: ${f.name}`,
          source: { type: 'depreciation', id: f.id },
          cashFlow: 'none',
          lines: [
            { account: isFactory ? '1295' : '6500', debit: monthly, credit: 0 },
            { account: '1510', debit: 0, credit: monthly },
          ],
          idempotencyKey: `depreciation:${f.id}:${world.tick}`,
        });
        if (isFactory) overhead[f.id] = (overhead[f.id] ?? 0) + monthly;
      }
    }
  }
  return overhead;
}

export function depreciationToDate(company: Company, facilityId: string): Money {
  let d = 0;
  for (const e of company.journal) if (e.source.type === 'depreciation' && e.source.id === facilityId) d += e.lines.find((l) => l.account === '1510')?.credit ?? 0;
  return d;
}

/** clear whatever conversion cost was not absorbed into production */
export function clearProductionPool(world: WorldState, company: Company): Money {
  const left = rawBalance(company, '1295');
  if (left > 0) {
    postEntry(company, world.counters, {
      tick: world.tick,
      memo: 'Unabsorbed conversion cost (idle labor and capacity)',
      source: { type: 'production_pool', id: `pool-${world.tick}` },
      cashFlow: 'none',
      lines: [
        { account: '5060', debit: left, credit: 0 },
        { account: '1295', debit: 0, credit: left },
      ],
      idempotencyKey: `pool-clear:${company.id}:${world.tick}`,
    });
  }
  return left;
}

const PAYABLE_PRIORITY: Record<Payable['kind'], number> = { salary: 0, tax: 1, levy: 2, supplier: 3, other: 4 };

/** pay due payables in priority order; unpaid ones become overdue */
export function settlePayables(world: WorldState, company: Company): { paid: Money; overdue: Money } {
  let paid = 0;
  let overdue = 0;
  const due = company.payables.filter((p) => (p.status === 'open' || p.status === 'overdue') && p.dueTick <= world.tick).sort((a, b) => PAYABLE_PRIORITY[a.kind] - PAYABLE_PRIORITY[b.kind] || a.dueTick - b.dueTick);
  for (const p of due) {
    if (!ensureCash(world, company, p.amount, true, `payable ${p.id}`)) {
      if (p.status !== 'overdue') {
        p.status = 'overdue';
        notify(world, { companyId: company.id, severity: 'high', title: `Payment overdue: ${p.counterparty}`, body: `${formatRs(p.amount)} could not be paid when due.`, kind: 'finance', link: { module: 'finance' } });
      }
      overdue += p.amount;
      continue;
    }
    postEntry(company, world.counters, {
      tick: world.tick,
      memo: `Payment to ${p.counterparty} (${p.id})`,
      source: { type: 'payable', id: p.id },
      cashFlow: 'operating',
      cashFlowLine: p.kind === 'tax' ? 'Income tax paid' : p.kind === 'salary' ? 'Salaries paid' : p.kind === 'levy' ? 'Levies & penalties paid' : 'Payments to suppliers',
      lines: [
        { account: p.account, debit: p.amount, credit: 0 },
        { account: '1000', debit: 0, credit: p.amount },
      ],
      idempotencyKey: `pay:${p.id}`,
    });
    p.status = 'paid';
    p.paidTick = world.tick;
    paid += p.amount;
  }
  return { paid, overdue };
}

export function collectReceivables(world: WorldState, company: Company): Money {
  let collected = 0;
  for (const r of company.receivables) {
    if (r.status !== 'open' || r.dueTick > world.tick) continue;
    postEntry(company, world.counters, {
      tick: world.tick,
      memo: `Collection from ${r.counterparty} (${r.id})`,
      source: { type: 'receivable', id: r.id },
      cashFlow: 'operating',
      cashFlowLine: 'Receipts from customers',
      lines: [
        { account: '1000', debit: r.amount, credit: 0 },
        { account: '1100', debit: 0, credit: r.amount },
      ],
      idempotencyKey: `collect:${r.id}`,
    });
    r.status = 'collected';
    collected += r.amount;
  }
  return collected;
}

export function serviceDebt(world: WorldState, company: Company): void {
  for (const loan of company.loans) {
    if (loan.status !== 'active' || loan.outstanding <= 0) continue;
    const rate = loanRateBps(world, loan);
    const interest = monthlyInterest(loan.outstanding, rate);
    let principal = 0;
    if (loan.kind === 'term_loan') {
      const remaining = Math.max(1, loan.maturityTick - world.tick + 1);
      principal = Math.min(loan.outstanding, Math.max(0, annuityPayment(loan.outstanding, rate, remaining) - interest));
      if (world.tick >= loan.maturityTick) principal = loan.outstanding;
    }
    const total = interest + principal;
    if (total <= 0) continue;
    if (!ensureCash(world, company, total, loan.kind === 'term_loan', `${loan.lender} debt service`)) {
      // overdraft interest is capitalized when cash is short
      if (loan.kind === 'overdraft' && interest > 0) {
        postEntry(company, world.counters, {
          tick: world.tick,
          memo: `Overdraft interest capitalized (${(rate / 100).toFixed(2)}% p.a.)`,
          source: { type: 'loan', id: loan.id },
          cashFlow: 'none',
          lines: [
            { account: '7000', debit: interest, credit: 0 },
            { account: '2510', debit: 0, credit: interest },
          ],
          idempotencyKey: `interest:${loan.id}:${world.tick}`,
        });
        loan.outstanding += interest;
        continue;
      }
      notify(world, { companyId: company.id, severity: 'critical', title: `Missed debt service: ${loan.lender}`, body: 'The loan is in default. Lenders will refuse new credit until it is cured.', kind: 'finance', link: { module: 'finance' } });
      loan.status = 'defaulted';
      continue;
    }
    postEntry(company, world.counters, {
      tick: world.tick,
      memo: `${loan.lender} ${loan.kind === 'overdraft' ? 'overdraft interest' : 'loan installment'} (${(rate / 100).toFixed(2)}% p.a.)`,
      source: { type: 'loan', id: loan.id },
      cashFlow: 'financing',
      cashFlowLine: principal > 0 ? 'Loan repayments & interest' : 'Interest paid',
      lines: [
        { account: '7000', debit: interest, credit: 0 },
        { account: loan.kind === 'overdraft' ? '2510' : '2500', debit: principal, credit: 0 },
        { account: '1000', debit: 0, credit: total },
      ],
      idempotencyKey: `interest:${loan.id}:${world.tick}`,
    });
    loan.outstanding -= principal;
    if (loan.kind === 'term_loan' && loan.outstanding === 0) {
      loan.status = 'repaid';
      company.milestones.push({ tick: world.tick, text: `Repaid ${loan.lender} term loan` });
    }
  }
}

/** repay overdraft with surplus cash above one month of payroll */
export function sweepOverdraft(world: WorldState, company: Company): void {
  const od = overdraft(company);
  if (!od || od.outstanding <= 0) return;
  const buffer = company.teams.reduce((a, t) => a + teamMonthlyCost(company, t.id), 0);
  const surplus = cashBalance(company) - buffer;
  const repay = Math.min(od.outstanding, surplus);
  if (repay <= 0) return;
  postEntry(company, world.counters, {
    tick: world.tick,
    memo: 'Overdraft repaid from surplus cash',
    source: { type: 'loan', id: od.id },
    cashFlow: 'financing',
    cashFlowLine: 'Overdraft repaid',
    lines: [
      { account: '2510', debit: repay, credit: 0 },
      { account: '1000', debit: 0, credit: repay },
    ],
    idempotencyKey: `od-sweep:${od.id}:${world.tick}`,
  });
  od.outstanding -= repay;
}

export function checkCovenants(world: WorldState, company: Company): void {
  const cash = cashBalance(company);
  for (const loan of company.loans) {
    if (loan.status !== 'active' || loan.kind !== 'term_loan' || loan.covenantMinCash <= 0) continue;
    if (cash < loan.covenantMinCash) {
      loan.spreadBps += 100;
      notify(world, { companyId: company.id, severity: 'high', title: `Covenant breach: ${loan.lender}`, body: `Cash ${formatRs(cash)} is below the ${formatRs(loan.covenantMinCash)} minimum. Lender added a 100 bps penalty margin.`, kind: 'finance', link: { module: 'finance' } });
    }
  }
}

export function accrueDeposits(world: WorldState, company: Company): void {
  for (const d of company.deposits) {
    if (d.status !== 'active') continue;
    const interest = monthlyInterest(d.principal + d.accrued, d.rateBps);
    if (interest > 0) {
      postEntry(company, world.counters, {
        tick: world.tick,
        memo: `Interest accrued on ${d.bank} deposit ${d.id}`,
        source: { type: 'deposit', id: d.id },
        cashFlow: 'none',
        lines: [
          { account: '1050', debit: interest, credit: 0 },
          { account: '4900', debit: 0, credit: interest },
        ],
        idempotencyKey: `deposit-interest:${d.id}:${world.tick}`,
      });
      d.accrued += interest;
    }
    if (world.tick >= d.maturityTick) {
      const amount = d.principal + d.accrued;
      postEntry(company, world.counters, {
        tick: world.tick,
        memo: `Deposit ${d.id} matured`,
        source: { type: 'deposit', id: d.id },
        cashFlow: 'investing',
        cashFlowLine: 'Deposits matured / withdrawn',
        lines: [
          { account: '1000', debit: amount, credit: 0 },
          { account: '1050', debit: 0, credit: amount },
        ],
        idempotencyKey: `deposit-mature:${d.id}`,
      });
      d.status = 'matured';
    }
  }
}

/** monthly corporate tax with loss carry-forward; paid at quarter end */
export function accrueTax(world: WorldState, company: Company): Money {
  const is = incomeStatement(company, world.tick, world.tick);
  const pbt = is.profitBeforeTax;
  if (pbt <= 0) {
    company.taxLossCarryforward += -pbt;
    return 0;
  }
  const offset = Math.min(company.taxLossCarryforward, pbt);
  company.taxLossCarryforward -= offset;
  const tax = mul(pbt - offset, CORPORATE_TAX_RATE);
  if (tax <= 0) return 0;
  postEntry(company, world.counters, {
    tick: world.tick,
    memo: `Corporate tax accrued at ${CORPORATE_TAX_RATE * 100}% on ${formatRs(pbt - offset)} taxable profit`,
    source: { type: 'tax', id: `tax-${world.tick}` },
    cashFlow: 'none',
    lines: [
      { account: '8000', debit: tax, credit: 0 },
      { account: '2200', debit: 0, credit: tax },
    ],
    idempotencyKey: `tax:${company.id}:${world.tick}`,
  });
  const dueTick = world.tick + (2 - (world.tick % 3));
  addPayable(world, company, { counterparty: 'Income Tax Department', amount: tax, dueTick, sourceId: `tax-${world.tick}`, kind: 'tax', account: '2200' });
  return tax;
}

// ---------------------------------------------------------------- valuation & capacity

export function monthlyRevenueAvg(company: Company, months = 3): Money {
  const h = company.history.slice(-months);
  return h.length ? Math.round(h.reduce((a, x) => a + x.revenue, 0) / h.length) : 0;
}

export function totalShares(company: Company): number {
  return company.shareholders.reduce((a, s) => a + s.shares, 0);
}

export function netDebt(company: Company): Money {
  return balance(company, '2500') + balance(company, '2510') - cashBalance(company) - balance(company, '1050');
}

export interface ValuationEstimate {
  preMoney: Money;
  method: string;
  revenueRunRate: Money;
  multiple: number;
  bookEquity: Money;
  dataType: 'estimate';
}

export function valuationEstimate(world: WorldState, company: Company): ValuationEstimate {
  const runRate = monthlyRevenueAvg(company) * 12;
  const base = { electronics: 1.4, ev: 2.4, food: 1.8 }[company.industry];
  const h = company.history;
  const recent = h.slice(-3).reduce((a, x) => a + x.revenue, 0);
  const prior = h.slice(-6, -3).reduce((a, x) => a + x.revenue, 0);
  const growth = prior > 0 ? Math.max(-0.5, Math.min(1, recent / prior - 1)) : 0;
  const margin = h.slice(-3).reduce((a, x) => a + x.operatingProfit, 0) / Math.max(1, recent);
  const multiple = +(base * (1 + growth) * (margin > 0 ? 1 + Math.min(0.5, margin) : 1 + Math.max(-0.4, margin))).toFixed(2);
  const book = balanceSheetEquity(company);
  const revenueBased = mul(runRate, multiple);
  const preMoney = Math.max(mul(Math.max(book, 0), 1.2), revenueBased, rupees(10_00_00_000)); // ₹10 Cr floor
  void world;
  return {
    preMoney,
    method: runRate > 0 ? `max(1.2× book equity, ${multiple}× annualized revenue, ₹10 Cr floor). Multiple = industry base ${base}× adjusted for 3-month growth ${(growth * 100).toFixed(0)}% and operating margin ${(margin * 100).toFixed(0)}%.` : 'Pre-revenue: max(1.2× book equity, ₹10 Cr floor).',
    revenueRunRate: runRate,
    multiple,
    bookEquity: book,
    dataType: 'estimate',
  };
}

export function balanceSheetEquity(company: Company): Money {
  let equity = balance(company, '3000');
  for (const e of company.journal) {
    for (const l of e.lines) {
      const c = l.account[0];
      if (c === '4') equity += l.credit - l.debit;
      if (c === '5' || c === '6' || c === '7' || c === '8') equity -= l.debit - l.credit;
    }
  }
  return equity;
}

export function creditLimit(company: Company): Money {
  const ppe = balance(company, '1500') - balance(company, '1510');
  const existing = company.loans.filter((l) => l.kind === 'term_loan' && l.status === 'active').reduce((a, l) => a + l.outstanding, 0);
  return Math.max(0, mul(ppe, 0.7) + monthlyRevenueAvg(company) * 3 + rupees(1_00_00_000) - existing); // + ₹1 Cr
}

export function loanSpreadBps(company: Company): number {
  let spread = 300;
  const equity = balanceSheetEquity(company);
  const debt = balance(company, '2500') + balance(company, '2510');
  if (equity > 0 && debt / equity > 1) spread += 200;
  const recent = company.history.slice(-3);
  if (recent.length && recent.reduce((a, h) => a + h.netIncome, 0) < 0) spread += 150;
  if (company.lifecycle === 'distressed') spread += 400;
  return spread;
}

// ---------------------------------------------------------------- transactions

export const INVESTORS = ['Konkan Ventures', 'Deccan Growth Partners', 'Gulf Sovereign Tech Fund', 'Coromandel Angels'];
export const LENDERS = ['State Bank (simulated)', 'Coastal Commercial Bank', 'SIDBI-style development lender'];

export function previewTransaction(world: WorldState, company: Company, kind: TransactionKind, terms: Record<string, string | number>): Pick<TransactionRecord, 'counterparty' | 'terms' | 'preview' | 'warnings'> {
  const warnings: string[] = [];
  const notes: string[] = [];
  const total = totalShares(company);
  const ownership = (extra = 0, investor = '') => {
    const rows = company.shareholders.map((s) => ({ name: s.name, pct: +((s.shares / (total + extra)) * 100).toFixed(2) }));
    if (extra > 0) rows.push({ name: investor, pct: +((extra / (total + extra)) * 100).toFixed(2) });
    return rows;
  };
  const cash = cashBalance(company);
  switch (kind) {
    case 'equity_round': {
      const amount = Number(terms.amount);
      const investor = String(terms.counterparty ?? INVESTORS[0]);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new DomainError('Enter a positive raise amount', 'VALIDATION');
      if (company.lifecycle === 'insolvent') throw new DomainError('Investors will not fund an insolvent company', 'DECLINED');
      const v = valuationEstimate(world, company);
      const post = v.preMoney + amount;
      if (amount > mul(post, 0.4)) throw new DomainError(`Investors cap a single round at 40% of post-money (max ${formatRs(Math.floor(v.preMoney * 0.4 / 0.6))})`, 'DECLINED');
      const pricePerShare = v.preMoney / total;
      const newShares = Math.floor(amount / pricePerShare);
      notes.push(`Pre-money valuation (estimate): ${formatRs(v.preMoney)} — ${v.method}`);
      notes.push(`${newShares.toLocaleString('en-IN')} new shares at ${formatRs(Math.round(pricePerShare))} per share.`);
      notes.push('Valuation is not cash. Only the amount raised is added to cash.');
      if (company.history.length < 3) warnings.push('Less than 3 months of trading history: valuation relies on the floor and book equity.');
      return {
        counterparty: investor,
        terms: { amount, preMoney: v.preMoney, newShares, pricePerShare: Math.round(pricePerShare) },
        warnings,
        preview: { cashDelta: amount, debtDelta: 0, equityDelta: amount, assetDelta: amount, dilutionPct: +((newShares / (total + newShares)) * 100).toFixed(2), ownershipAfter: ownership(newShares, investor), notes },
      };
    }
    case 'term_loan': {
      const amount = Number(terms.amount);
      const termMonths = Number(terms.termMonths ?? 36);
      const lender = String(terms.counterparty ?? LENDERS[0]);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new DomainError('Enter a positive loan amount', 'VALIDATION');
      if (![12, 24, 36, 60].includes(termMonths)) throw new DomainError('Term must be 12, 24, 36 or 60 months', 'VALIDATION');
      if (company.loans.some((l) => l.status === 'defaulted')) throw new DomainError('Lenders decline: an existing loan is in default', 'DECLINED');
      if (company.lifecycle !== 'operating') throw new DomainError('Lenders decline: company is not in good standing', 'DECLINED');
      const limit = creditLimit(company);
      if (amount > limit) throw new DomainError(`Requested amount exceeds the credit limit of ${formatRs(limit)} (70% of net PP&E + 3 months revenue + ₹1 Cr, less existing term debt)`, 'DECLINED');
      const spread = loanSpreadBps(company);
      const rate = Math.round(world.economy.countries.IN.policyRate * 100) + spread;
      const payment = annuityPayment(amount, rate, termMonths);
      notes.push(`Floating rate: repo ${world.economy.countries.IN.policyRate.toFixed(2)}% + ${(spread / 100).toFixed(2)}% = ${(rate / 100).toFixed(2)}% p.a. today.`);
      notes.push(`Indicative monthly installment ${formatRs(payment)} over ${termMonths} months.`);
      notes.push(`Covenant: keep cash above ${formatRs(mul(amount, 0.1))} at every month end (breach adds 100 bps).`);
      return { counterparty: lender, terms: { amount, termMonths, spreadBps: spread, rateBps: rate, payment }, warnings, preview: { cashDelta: amount, debtDelta: amount, equityDelta: 0, assetDelta: amount, dilutionPct: 0, ownershipAfter: ownership(), notes } };
    }
    case 'loan_prepayment': {
      const loan = company.loans.find((l) => l.id === terms.loanId && l.status === 'active');
      if (!loan) throw new DomainError('Loan not found or not active', 'NOT_FOUND');
      const amount = Math.min(Number(terms.amount), loan.outstanding);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new DomainError('Enter a positive prepayment amount', 'VALIDATION');
      if (amount > cash) throw new DomainError('Not enough cash for this prepayment', 'INSUFFICIENT_CASH');
      notes.push(`Outstanding after prepayment: ${formatRs(loan.outstanding - amount)}.`);
      if (cash - amount < loan.covenantMinCash) warnings.push('Cash after prepayment would be below the covenant minimum.');
      return { counterparty: loan.lender, terms: { loanId: loan.id, amount }, warnings, preview: { cashDelta: -amount, debtDelta: -amount, equityDelta: 0, assetDelta: -amount, dilutionPct: 0, ownershipAfter: ownership(), notes } };
    }
    case 'facility_build': {
      const type = String(terms.type) as keyof typeof FACILITY_SPECS;
      const spec = FACILITY_SPECS[type];
      if (!spec || type === 'hq') throw new DomainError('Choose a factory, warehouse, R&D lab or logistics hub', 'VALIDATION');
      const city = CITIES.find((c) => c.name === terms.city) ?? CITIES[0];
      const mode = terms.mode === 'lease' ? 'lease' : 'build';
      const cost = mode === 'build' ? mul(spec.buildCost, city.costFactor) : 0;
      if (cost > cash) throw new DomainError(`Not enough cash: build cost ${formatRs(cost)} exceeds cash ${formatRs(cash)}`, 'INSUFFICIENT_CASH');
      if (company.budget.capex > 0 && cost > company.budget.capex) warnings.push(`Exceeds the monthly capex budget of ${formatRs(company.budget.capex)}.`);
      const monthly = mode === 'build' ? mul(spec.leaseMonthly, 0.35 * city.costFactor) : mul(spec.leaseMonthly, city.costFactor);
      notes.push(mode === 'build' ? `Capitalized ${formatRs(cost)} (construction ${spec.buildMonths} month(s)), depreciated over ${spec.life} months. Running costs ${formatRs(monthly)}/month.` : `Leased: no capex, ${formatRs(monthly)}/month from completion (${spec.buildMonths} month fit-out).`);
      return { counterparty: mode === 'build' ? 'EPC contractor (simulated)' : 'Industrial landlord (simulated)', terms: { type, city: city.name, mode, cost, monthly }, warnings, preview: { cashDelta: -cost, debtDelta: 0, equityDelta: 0, assetDelta: 0, dilutionPct: 0, ownershipAfter: ownership(), notes } };
    }
    case 'facility_upgrade': {
      const f = company.facilities.find((x) => x.id === terms.facilityId);
      if (!f) throw new DomainError('Facility not found', 'NOT_FOUND');
      if (f.type === 'hq') throw new DomainError('Headquarters cannot be upgraded', 'VALIDATION');
      if (f.status !== 'operational') throw new DomainError('Facility is not operational', 'VALIDATION');
      if (f.level >= 4) throw new DomainError('Facility is already at the maximum level', 'VALIDATION');
      const spec = FACILITY_SPECS[f.type];
      const city = CITIES.find((c) => c.name === f.city) ?? CITIES[0];
      const cost = mul(spec.buildCost, 0.6 * f.level * city.costFactor);
      if (cost > cash) throw new DomainError(`Not enough cash: upgrade costs ${formatRs(cost)}`, 'INSUFFICIENT_CASH');
      const effect = { factory: 'adds a production line and +50% energy supply', warehouse: '+60% storage capacity', rnd_lab: '+25% R&D throughput', logistics_hub: '-5 pts additional freight discount' }[f.type as 'factory'];
      notes.push(`Level ${f.level} → ${f.level + 1}: ${effect}. Ready next month. Capitalized ${formatRs(cost)}.`);
      return { counterparty: 'EPC contractor (simulated)', terms: { facilityId: f.id, cost }, warnings, preview: { cashDelta: -cost, debtDelta: 0, equityDelta: 0, assetDelta: 0, dilutionPct: 0, ownershipAfter: ownership(), notes } };
    }
    case 'deposit_open': {
      const amount = Number(terms.amount);
      const months = Number(terms.months ?? 6);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new DomainError('Enter a positive deposit amount', 'VALIDATION');
      if (![3, 6, 12].includes(months)) throw new DomainError('Tenor must be 3, 6 or 12 months', 'VALIDATION');
      if (amount > cash) throw new DomainError('Not enough cash for this deposit', 'INSUFFICIENT_CASH');
      const rate = Math.round(world.economy.countries.IN.policyRate * 100) - 50 + (months === 12 ? 25 : 0);
      notes.push(`Fixed ${(rate / 100).toFixed(2)}% p.a., compounding monthly; matures ${tickLabel(world, world.tick + months)}. Early withdrawal forfeits up to 1% of principal.`);
      notes.push('Deposits are not spendable cash until withdrawn.');
      return { counterparty: 'Coastal Commercial Bank', terms: { amount, months, rateBps: rate }, warnings, preview: { cashDelta: -amount, debtDelta: 0, equityDelta: 0, assetDelta: 0, dilutionPct: 0, ownershipAfter: ownership(), notes } };
    }
    case 'deposit_withdraw': {
      const d = company.deposits.find((x) => x.id === terms.depositId && x.status === 'active');
      if (!d) throw new DomainError('Deposit not found or not active', 'NOT_FOUND');
      const penalty = Math.min(d.accrued, mul(d.principal, 0.01));
      const amount = d.principal + d.accrued - penalty;
      notes.push(`Early withdrawal: principal ${formatRs(d.principal)} + interest ${formatRs(d.accrued)} − penalty ${formatRs(penalty)}.`);
      return { counterparty: d.bank, terms: { depositId: d.id, amount, penalty }, warnings, preview: { cashDelta: amount, debtDelta: 0, equityDelta: -penalty, assetDelta: -penalty, dilutionPct: 0, ownershipAfter: ownership(), notes } };
    }
  }
}

export function executeTransaction(world: WorldState, company: Company, tx: TransactionRecord, actionId?: string): string[] {
  // re-validate against the current state; terms can change between proposal and approval
  const fresh = previewTransaction(world, company, tx.kind, tx.terms);
  const t = fresh.terms;
  const effects: string[] = [];
  const post = (memo: string, lines: { account: string; debit: number; credit: number }[], cashFlow: 'operating' | 'investing' | 'financing' | 'none', cashFlowLine: string, key: string) => {
    const e = postEntry(company, world.counters, { tick: world.tick, memo, source: { type: 'transaction', id: tx.id }, cashFlow, cashFlowLine, lines, idempotencyKey: key, actionId });
    tx.journalIds.push(e.id);
  };
  switch (tx.kind) {
    case 'equity_round': {
      const amount = Number(t.amount);
      post(`Equity raised from ${fresh.counterparty}`, [{ account: '1000', debit: amount, credit: 0 }, { account: '3000', debit: 0, credit: amount }], 'financing', 'Equity raised', `tx:${tx.id}`);
      company.shareholders.push({ id: nextId(world.counters, 'SH'), name: fresh.counterparty, kind: 'investor', shares: Number(t.newShares), invested: amount, acquiredTick: world.tick });
      company.milestones.push({ tick: world.tick, text: `Raised ${formatRs(amount)} from ${fresh.counterparty} at ${formatRs(Number(t.preMoney))} pre-money (estimate)` });
      effects.push(`Cash +${formatRs(amount)}; ${fresh.preview.dilutionPct}% dilution`);
      break;
    }
    case 'term_loan': {
      const amount = Number(t.amount);
      const months = Number(t.termMonths);
      const loan: Loan = { id: nextId(world.counters, 'LN'), lender: fresh.counterparty, kind: 'term_loan', principal: amount, outstanding: amount, spreadBps: Number(t.spreadBps), floating: true, fixedRateBps: 0, termMonths: months, startTick: world.tick, maturityTick: world.tick + months, status: 'active', covenantMinCash: mul(amount, 0.1) };
      company.loans.push(loan);
      post(`Term loan ${loan.id} drawn from ${loan.lender}`, [{ account: '1000', debit: amount, credit: 0 }, { account: '2500', debit: 0, credit: amount }], 'financing', 'Loans drawn', `tx:${tx.id}`);
      effects.push(`Cash +${formatRs(amount)}; debt +${formatRs(amount)}`);
      break;
    }
    case 'loan_prepayment': {
      const loan = company.loans.find((l) => l.id === t.loanId)!;
      const amount = Number(t.amount);
      post(`Prepayment of ${loan.id}`, [{ account: loan.kind === 'overdraft' ? '2510' : '2500', debit: amount, credit: 0 }, { account: '1000', debit: 0, credit: amount }], 'financing', 'Loan repayments & interest', `tx:${tx.id}`);
      loan.outstanding -= amount;
      if (loan.kind === 'term_loan' && loan.outstanding === 0) loan.status = 'repaid';
      effects.push(`Debt −${formatRs(amount)}`);
      break;
    }
    case 'facility_build': {
      const type = String(t.type) as keyof typeof FACILITY_SPECS;
      const spec = FACILITY_SPECS[type];
      const city = String(t.city);
      const cost = Number(t.cost);
      const id = nextId(world.counters, 'FC');
      const count = company.facilities.filter((f) => f.type === type).length + 1;
      const firstTemplate = company.products[0] ? PRODUCT_TEMPLATES[company.products[0].templateId] : undefined;
      const capacity = type === 'factory' ? Math.round((firstTemplate?.lineCapacity ?? 1000) * (firstTemplate?.energyKwh ?? 10) * 1.6) : spec.capacity;
      company.facilities.push({ id, type, name: `${city} ${spec.label}${count > 1 ? ` ${count}` : ''}`, city, level: 1, status: 'under_construction', readyTick: world.tick + spec.buildMonths, owned: t.mode === 'build', cost: 0, pendingCapex: cost, usefulLifeMonths: spec.life, monthlyFixedCost: Number(t.monthly), capacity });
      if (cost > 0) post(`Construction of ${spec.label} in ${city}`, [{ account: '1590', debit: cost, credit: 0 }, { account: '1000', debit: 0, credit: cost }], 'investing', 'Capital expenditure', `tx:${tx.id}`);
      if (type === 'factory' && firstTemplate) {
        company.lines.push({ id: nextId(world.counters, 'LINE'), facilityId: id, name: `${city} Line 1`, productId: null, plannedUnits: 0, capacity: firstTemplate.lineCapacity, condition: 1, automation: 0, status: 'idle', maintenanceUntil: -1 });
      }
      effects.push(`${spec.label} in ${city} under construction until ${tickLabel(world, world.tick + spec.buildMonths)}`);
      break;
    }
    case 'facility_upgrade': {
      const f = company.facilities.find((x) => x.id === t.facilityId)!;
      const cost = Number(t.cost);
      post(`Upgrade of ${f.name} to level ${f.level + 1}`, [{ account: '1590', debit: cost, credit: 0 }, { account: '1000', debit: 0, credit: cost }], 'investing', 'Capital expenditure', `tx:${tx.id}`);
      f.status = 'upgrading';
      f.readyTick = world.tick + 1;
      f.pendingCapex += cost;
      effects.push(`${f.name} upgrade completes ${tickLabel(world, f.readyTick)}`);
      break;
    }
    case 'deposit_open': {
      const amount = Number(t.amount);
      const months = Number(t.months);
      const d = { id: nextId(world.counters, 'FD'), bank: fresh.counterparty, principal: amount, rateBps: Number(t.rateBps), startTick: world.tick, maturityTick: world.tick + months, accrued: 0, status: 'active' as const };
      company.deposits.push(d);
      post(`Fixed deposit ${d.id} opened`, [{ account: '1050', debit: amount, credit: 0 }, { account: '1000', debit: 0, credit: amount }], 'investing', 'Deposits placed', `tx:${tx.id}`);
      effects.push(`${formatRs(amount)} moved to a ${months}-month deposit`);
      break;
    }
    case 'deposit_withdraw': {
      const d = company.deposits.find((x) => x.id === t.depositId)!;
      const penalty = Number(t.penalty);
      const amount = d.principal + d.accrued - penalty;
      post(`Deposit ${d.id} withdrawn early`, [{ account: '1000', debit: amount, credit: 0 }, { account: '4900', debit: penalty, credit: 0 }, { account: '1050', debit: 0, credit: d.principal + d.accrued }], 'investing', 'Deposits matured / withdrawn', `tx:${tx.id}`);
      d.status = 'withdrawn';
      effects.push(`Cash +${formatRs(amount)}`);
      break;
    }
  }
  tx.status = 'executed';
  tx.decidedTick = world.tick;
  return effects;
}

/** facilities finishing construction or upgrade this tick */
export function completeFacilities(world: WorldState, company: Company): void {
  for (const f of company.facilities) {
    if (f.status === 'operational' || f.readyTick > world.tick) continue;
    const toCapitalize = f.pendingCapex;
    if (toCapitalize > 0) {
      postEntry(company, world.counters, {
        tick: world.tick,
        memo: `${f.name} placed in service`,
        source: { type: 'facility_commission', id: f.id },
        cashFlow: 'none',
        lines: [
          { account: '1500', debit: toCapitalize, credit: 0 },
          { account: '1590', debit: 0, credit: toCapitalize },
        ],
        idempotencyKey: `commission:${f.id}:${world.tick}`,
      });
    }
    f.cost += toCapitalize;
    f.pendingCapex = 0;
    if (f.status === 'upgrading') {
      f.level += 1;
      f.owned = f.owned || toCapitalize > 0;
      if (f.usefulLifeMonths === 0) f.usefulLifeMonths = 120;
      if (f.type === 'factory') {
        f.capacity = Math.round(f.capacity * 1.5);
        const template = company.products[0] ? PRODUCT_TEMPLATES[company.products[0].templateId] : undefined;
        company.lines.push({ id: nextId(world.counters, 'LINE'), facilityId: f.id, name: `${f.city} Line ${company.lines.filter((l) => l.facilityId === f.id).length + 1}`, productId: null, plannedUnits: 0, capacity: template?.lineCapacity ?? 1000, condition: 1, automation: 0, status: 'idle', maintenanceUntil: -1 });
      }
      if (f.type === 'warehouse') f.capacity = Math.round(f.capacity * 1.6);
      company.milestones.push({ tick: world.tick, text: `${f.name} upgraded to level ${f.level}` });
    } else {
      company.milestones.push({ tick: world.tick, text: `${f.name} became operational` });
    }
    f.status = 'operational';
    notify(world, { companyId: company.id, severity: 'low', title: `${f.name} is operational`, body: f.type === 'factory' ? 'Assign a product and plan output for its new line.' : 'Capacity is available from this month.', kind: 'operations', link: { module: 'company' } });
  }
}

export function formatRs(p: Money): string {
  const r = p / 100;
  const a = Math.abs(r);
  const s = r < 0 ? '−' : '';
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
  return `${s}₹${a.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
