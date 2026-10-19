/**
 * Double-entry general ledger.
 *
 * Rules enforced by postEntry():
 *  - every line is one-sided, non-negative integer paise
 *  - total debits === total credits and > 0
 *  - accounts must exist in the chart of accounts
 *  - an idempotency key may only be posted once per company (no duplicate posting)
 *  - the cash account may never go negative
 * Entries are never edited or deleted; corrections are made with reverseEntry().
 * Financial statements are always derived from posted entries.
 */
import type { AccountDef, CashFlowCategory, Company, JournalEntry, JournalLine, Money, Tick } from './types';
import { DomainError } from './types';

export const ACCOUNTS: Record<string, AccountDef> = {
  '1000': { code: '1000', name: 'Cash & bank', type: 'asset', group: 'Current assets', description: 'Spendable cash in operating bank accounts.' },
  '1050': { code: '1050', name: 'Fixed deposits', type: 'asset', group: 'Current assets', description: 'Bank term deposits; not spendable until matured or withdrawn.' },
  '1100': { code: '1100', name: 'Accounts receivable', type: 'asset', group: 'Current assets', description: 'Amounts owed by distributors for goods delivered.' },
  '1200': { code: '1200', name: 'Raw materials inventory', type: 'asset', group: 'Current assets', description: 'Landed cost of materials on hand (moving average).' },
  '1210': { code: '1210', name: 'Finished goods inventory', type: 'asset', group: 'Current assets', description: 'Absorbed production cost of finished units on hand.' },
  '1295': { code: '1295', name: 'Production cost pool', type: 'asset', group: 'Current assets', description: 'Clearing account for conversion costs; absorbed into production and cleared to zero every month.' },
  '1500': { code: '1500', name: 'Property, plant & equipment', type: 'asset', group: 'Non-current assets', description: 'Capitalized facility and machinery cost.' },
  '1510': { code: '1510', name: 'Accumulated depreciation', type: 'contra_asset', group: 'Non-current assets', description: 'Straight-line depreciation charged to date.' },
  '1590': { code: '1590', name: 'Construction in progress', type: 'asset', group: 'Non-current assets', description: 'Capital spent on facilities not yet in service.' },
  '2000': { code: '2000', name: 'Accounts payable', type: 'liability', group: 'Current liabilities', description: 'Amounts owed to suppliers, customs and freight forwarders.' },
  '2100': { code: '2100', name: 'Accrued salaries', type: 'liability', group: 'Current liabilities', description: 'Unpaid salary arrears.' },
  '2200': { code: '2200', name: 'Income tax payable', type: 'liability', group: 'Current liabilities', description: 'Tax accrued and due at quarter end.' },
  '2300': { code: '2300', name: 'Statutory levies payable', type: 'liability', group: 'Current liabilities', description: 'EPR levies and regulatory penalties due.' },
  '2500': { code: '2500', name: 'Term loans', type: 'liability', group: 'Non-current liabilities', description: 'Amortizing bank borrowings.' },
  '2510': { code: '2510', name: 'Overdraft', type: 'liability', group: 'Current liabilities', description: 'Revolving overdraft drawn automatically to meet mandatory payments.' },
  '3000': { code: '3000', name: 'Share capital', type: 'equity', group: 'Equity', description: 'Capital contributed by founders and investors.' },
  '4000': { code: '4000', name: 'Sales revenue — domestic', type: 'revenue', group: 'Revenue', description: 'Net sales to Indian customers and distributors.' },
  '4010': { code: '4010', name: 'Sales revenue — export', type: 'revenue', group: 'Revenue', description: 'Net sales shipped to export markets.' },
  '4900': { code: '4900', name: 'Interest income', type: 'revenue', group: 'Other income', description: 'Interest earned on fixed deposits.' },
  '5000': { code: '5000', name: 'Cost of goods sold', type: 'expense', group: 'Cost of sales', description: 'Absorbed cost of finished units sold.' },
  '5050': { code: '5050', name: 'Scrap & rework', type: 'expense', group: 'Cost of sales', description: 'Cost of units scrapped during production.' },
  '5060': { code: '5060', name: 'Idle capacity cost', type: 'expense', group: 'Cost of sales', description: 'Conversion cost not absorbed because capacity or labor was unused.' },
  '6000': { code: '6000', name: 'Salaries & benefits', type: 'expense', group: 'Operating expenses', description: 'Non-production payroll incl. employer contributions.' },
  '6100': { code: '6100', name: 'Marketing', type: 'expense', group: 'Operating expenses', description: 'Campaign spend.' },
  '6200': { code: '6200', name: 'Research & development', type: 'expense', group: 'Operating expenses', description: 'R&D project spend (expensed as incurred).' },
  '6300': { code: '6300', name: 'Facilities, maintenance & storage', type: 'expense', group: 'Operating expenses', description: 'Non-production facility costs, line maintenance and overflow storage.' },
  '6400': { code: '6400', name: 'Outbound logistics', type: 'expense', group: 'Operating expenses', description: 'Distribution and export freight.' },
  '6500': { code: '6500', name: 'Depreciation', type: 'expense', group: 'Operating expenses', description: 'Depreciation of non-production facilities.' },
  '6600': { code: '6600', name: 'Channel & payment fees', type: 'expense', group: 'Operating expenses', description: 'Marketplace and payment gateway fees.' },
  '6700': { code: '6700', name: 'Recruitment & training', type: 'expense', group: 'Operating expenses', description: 'Hiring fees, training programs and severance.' },
  '6800': { code: '6800', name: 'Disruption & mitigation', type: 'expense', group: 'Operating expenses', description: 'Expediting, generators, supplier qualification and other mitigation costs.' },
  '6900': { code: '6900', name: 'Compliance & regulatory', type: 'expense', group: 'Operating expenses', description: 'Certification, levies and penalties.' },
  '7000': { code: '7000', name: 'Interest expense', type: 'expense', group: 'Finance costs', description: 'Interest on loans and overdraft.' },
  '8000': { code: '8000', name: 'Income tax expense', type: 'expense', group: 'Tax', description: 'Corporate income tax accrued.' },
};

export const ACCOUNT_CODES = Object.keys(ACCOUNTS);

export interface PostInput {
  tick: Tick;
  memo: string;
  source: { type: string; id: string };
  cashFlow: CashFlowCategory;
  cashFlowLine?: string;
  lines: JournalLine[];
  idempotencyKey: string;
  actionId?: string;
}

export function nextId(counters: Record<string, number>, prefix: string): string {
  counters[prefix] = (counters[prefix] ?? 0) + 1;
  return `${prefix}-${String(counters[prefix]).padStart(5, '0')}`;
}

export function validateLines(lines: JournalLine[]): void {
  if (lines.length < 2) throw new DomainError('A journal entry needs at least two lines', 'UNBALANCED');
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    if (!ACCOUNTS[l.account]) throw new DomainError(`Unknown account ${l.account}`, 'BAD_ACCOUNT');
    if (!Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit)) throw new DomainError('Journal amounts must be integer paise', 'NOT_INTEGER');
    if (l.debit < 0 || l.credit < 0) throw new DomainError('Journal amounts cannot be negative', 'NEGATIVE');
    if (l.debit > 0 && l.credit > 0) throw new DomainError('A journal line must be either a debit or a credit', 'TWO_SIDED');
    dr += l.debit;
    cr += l.credit;
  }
  if (dr !== cr) throw new DomainError(`Unbalanced entry: debits ${dr} ≠ credits ${cr}`, 'UNBALANCED');
  if (dr === 0) throw new DomainError('Journal entry total must be greater than zero', 'ZERO');
}

/** debit-positive balance of an account across all posted entries (optionally up to a tick) */
export function rawBalance(company: Company, account: string, uptoTick?: Tick): Money {
  let b = 0;
  for (const e of company.journal) {
    if (uptoTick !== undefined && e.tick > uptoTick) continue;
    for (const l of e.lines) if (l.account === account) b += l.debit - l.credit;
  }
  return b;
}

/** natural-sign balance: assets/expenses debit-positive, others credit-positive */
export function balance(company: Company, account: string, uptoTick?: Tick): Money {
  const raw = rawBalance(company, account, uptoTick);
  const t = ACCOUNTS[account].type;
  return t === 'asset' || t === 'expense' ? raw : -raw;
}

export function cashBalance(company: Company): Money {
  return rawBalance(company, '1000');
}

export function postEntry(company: Company, counters: Record<string, number>, input: PostInput): JournalEntry {
  const lines = input.lines.filter((l) => l.debit > 0 || l.credit > 0);
  validateLines(lines);
  if (company.journal.some((e) => e.idempotencyKey === input.idempotencyKey)) {
    throw new DomainError(`Duplicate posting rejected (${input.idempotencyKey})`, 'DUPLICATE');
  }
  const cashDelta = lines.filter((l) => l.account === '1000').reduce((a, l) => a + l.debit - l.credit, 0);
  if (cashDelta < 0 && cashBalance(company) + cashDelta < 0) {
    throw new DomainError('Insufficient cash: posting would make the cash balance negative', 'INSUFFICIENT_CASH');
  }
  const entry: JournalEntry = {
    id: nextId(counters, 'JE'),
    companyId: company.id,
    tick: input.tick,
    seq: company.journal.length + 1,
    memo: input.memo,
    source: input.source,
    cashFlow: input.cashFlow,
    cashFlowLine: input.cashFlowLine,
    lines,
    status: 'posted',
    idempotencyKey: input.idempotencyKey,
    actionId: input.actionId,
  };
  company.journal.push(entry);
  return entry;
}

/** Reverse a posted entry. The original is kept and flagged; a mirror entry is posted. */
export function reverseEntry(company: Company, counters: Record<string, number>, entryId: string, tick: Tick, reason: string): JournalEntry {
  const original = company.journal.find((e) => e.id === entryId);
  if (!original) throw new DomainError('Journal entry not found', 'NOT_FOUND');
  if (original.status === 'reversed') throw new DomainError('Entry has already been reversed', 'ALREADY_REVERSED');
  if (original.reversalOf) throw new DomainError('A reversal cannot itself be reversed', 'INVALID');
  const rev = postEntry(company, counters, {
    tick,
    memo: `Reversal of ${original.id}: ${reason}`,
    source: { type: 'reversal', id: original.id },
    cashFlow: original.cashFlow,
    cashFlowLine: original.cashFlowLine,
    lines: original.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit, memo: l.memo })),
    idempotencyKey: `reversal:${original.id}`,
  });
  rev.reversalOf = original.id;
  original.status = 'reversed';
  original.reversedBy = rev.id;
  return rev;
}

export function trialBalance(company: Company, uptoTick?: Tick): { account: AccountDef; debit: Money; credit: Money }[] {
  return ACCOUNT_CODES.map((code) => {
    const raw = rawBalance(company, code, uptoTick);
    return { account: ACCOUNTS[code], debit: raw > 0 ? raw : 0, credit: raw < 0 ? -raw : 0 };
  }).filter((r) => r.debit !== 0 || r.credit !== 0);
}

function sumBy(company: Company, from: Tick, to: Tick, pred: (code: string) => boolean): Record<string, Money> {
  const out: Record<string, Money> = {};
  for (const e of company.journal) {
    if (e.tick < from || e.tick > to) continue;
    for (const l of e.lines) {
      if (!pred(l.account)) continue;
      out[l.account] = (out[l.account] ?? 0) + l.debit - l.credit;
    }
  }
  return out;
}

export interface StatementLine {
  code?: string;
  label: string;
  amount: Money;
  kind?: 'subtotal' | 'total' | 'line';
  accounts?: string[];
}

export interface IncomeStatement {
  from: Tick;
  to: Tick;
  revenue: Money;
  cogs: Money;
  grossProfit: Money;
  opex: Money;
  operatingProfit: Money;
  otherIncome: Money;
  financeCosts: Money;
  profitBeforeTax: Money;
  tax: Money;
  netIncome: Money;
  lines: StatementLine[];
}

export function incomeStatement(company: Company, from: Tick, to: Tick): IncomeStatement {
  const raw = sumBy(company, from, to, (c) => ACCOUNTS[c].type === 'revenue' || ACCOUNTS[c].type === 'expense');
  const val = (code: string) => {
    const r = raw[code] ?? 0;
    return ACCOUNTS[code].type === 'revenue' ? -r : r;
  };
  const codes = (group: string) => ACCOUNT_CODES.filter((c) => ACCOUNTS[c].group === group);
  const revenue = val('4000') + val('4010');
  const cogs = codes('Cost of sales').reduce((a, c) => a + val(c), 0);
  const opex = codes('Operating expenses').reduce((a, c) => a + val(c), 0);
  const otherIncome = val('4900');
  const financeCosts = val('7000');
  const tax = val('8000');
  const grossProfit = revenue - cogs;
  const operatingProfit = grossProfit - opex;
  const profitBeforeTax = operatingProfit + otherIncome - financeCosts;
  const netIncome = profitBeforeTax - tax;
  const line = (code: string): StatementLine => ({ code, label: ACCOUNTS[code].name, amount: val(code), kind: 'line', accounts: [code] });
  const lines: StatementLine[] = [
    line('4000'),
    line('4010'),
    { label: 'Total revenue', amount: revenue, kind: 'subtotal', accounts: ['4000', '4010'] },
    ...codes('Cost of sales').map(line),
    { label: 'Gross profit', amount: grossProfit, kind: 'subtotal' },
    ...codes('Operating expenses').map(line),
    { label: 'Operating profit (EBIT)', amount: operatingProfit, kind: 'subtotal' },
    line('4900'),
    line('7000'),
    { label: 'Profit before tax', amount: profitBeforeTax, kind: 'subtotal' },
    line('8000'),
    { label: 'Net income', amount: netIncome, kind: 'total' },
  ];
  return { from, to, revenue, cogs, grossProfit, opex, operatingProfit, otherIncome, financeCosts, profitBeforeTax, tax, netIncome, lines };
}

export interface BalanceSheet {
  asOf: Tick;
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  totalAssets: Money;
  totalLiabilities: Money;
  totalEquity: Money;
  retainedEarnings: Money;
  balanced: boolean;
  difference: Money;
}

export function balanceSheet(company: Company, asOf: Tick): BalanceSheet {
  const b = (c: string) => balance(company, c, asOf);
  const assetCodes = ACCOUNT_CODES.filter((c) => ACCOUNTS[c].type === 'asset' || ACCOUNTS[c].type === 'contra_asset');
  const liabCodes = ACCOUNT_CODES.filter((c) => ACCOUNTS[c].type === 'liability');
  // debit-positive balance; contra assets (accumulated depreciation) appear as negative assets
  const assets: StatementLine[] = assetCodes.map((c) => ({ code: c, label: ACCOUNTS[c].name, amount: rawBalance(company, c, asOf), kind: 'line', accounts: [c] }));
  const liabilities: StatementLine[] = liabCodes.map((c) => ({ code: c, label: ACCOUNTS[c].name, amount: b(c), kind: 'line', accounts: [c] }));
  const totalAssets = assets.reduce((a, l) => a + l.amount, 0);
  const totalLiabilities = liabilities.reduce((a, l) => a + l.amount, 0);
  const shareCapital = b('3000');
  // retained earnings = cumulative net income (income accounts are not closed)
  let retained = 0;
  for (const c of ACCOUNT_CODES) {
    const t = ACCOUNTS[c].type;
    if (t === 'revenue') retained += balance(company, c, asOf);
    if (t === 'expense') retained -= balance(company, c, asOf);
  }
  const equity: StatementLine[] = [
    { code: '3000', label: 'Share capital', amount: shareCapital, kind: 'line', accounts: ['3000'] },
    { label: 'Retained earnings (cumulative net income)', amount: retained, kind: 'line' },
  ];
  const totalEquity = shareCapital + retained;
  const difference = totalAssets - totalLiabilities - totalEquity;
  return { asOf, assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, retainedEarnings: retained, balanced: difference === 0, difference };
}

export interface CashFlowStatement {
  from: Tick;
  to: Tick;
  opening: Money;
  closing: Money;
  sections: { category: CashFlowCategory; label: string; lines: { label: string; amount: Money }[]; total: Money }[];
  netChange: Money;
  reconciles: boolean;
}

/** Direct-method cash flow statement built from cash account lines. */
export function cashFlowStatement(company: Company, from: Tick, to: Tick): CashFlowStatement {
  const opening = from <= 0 ? 0 : rawBalance(company, '1000', from - 1);
  const closing = rawBalance(company, '1000', to);
  const cats: Record<string, Record<string, Money>> = { operating: {}, investing: {}, financing: {} };
  for (const e of company.journal) {
    if (e.tick < from || e.tick > to) continue;
    const delta = e.lines.filter((l) => l.account === '1000').reduce((a, l) => a + l.debit - l.credit, 0);
    if (delta === 0) continue;
    const cat = e.cashFlow === 'none' ? 'operating' : e.cashFlow;
    const key = e.cashFlowLine ?? e.source.type;
    cats[cat][key] = (cats[cat][key] ?? 0) + delta;
  }
  const labels: Record<string, string> = { operating: 'Operating activities', investing: 'Investing activities', financing: 'Financing activities' };
  const sections = (['operating', 'investing', 'financing'] as const).map((c) => {
    const lines = Object.entries(cats[c]).map(([label, amount]) => ({ label, amount })).sort((a, b) => a.label.localeCompare(b.label));
    return { category: c, label: labels[c], lines, total: lines.reduce((a, l) => a + l.amount, 0) };
  });
  const netChange = sections.reduce((a, s) => a + s.total, 0);
  return { from, to, opening, closing, sections, netChange, reconciles: opening + netChange === closing };
}

/** all journal lines touching an account (drill-down) */
export function accountActivity(company: Company, account: string, from = 0, to = Number.MAX_SAFE_INTEGER) {
  const out: { entry: JournalEntry; debit: Money; credit: Money }[] = [];
  for (const e of company.journal) {
    if (e.tick < from || e.tick > to) continue;
    for (const l of e.lines) if (l.account === account) out.push({ entry: e, debit: l.debit, credit: l.credit });
  }
  return out;
}
