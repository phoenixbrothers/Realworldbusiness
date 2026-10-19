/**
 * Accounting and operational invariants. The API runs these after every
 * accepted action; a violation rejects the action and nothing is persisted.
 */
import type { Company, WorldState } from './types';
import { balanceSheet, cashBalance, rawBalance, validateLines } from './ledger';
import { reconcileInventory } from './inventory';

export interface InvariantCheck {
  id: string;
  label: string;
  ok: boolean;
  expected?: number;
  actual?: number;
}

export function companyInvariants(company: Company): InvariantCheck[] {
  const checks: InvariantCheck[] = [];
  let entriesOk = true;
  const keys = new Set<string>();
  let duplicate = false;
  for (const e of company.journal) {
    try {
      validateLines(e.lines);
    } catch {
      entriesOk = false;
    }
    if (keys.has(e.idempotencyKey)) duplicate = true;
    keys.add(e.idempotencyKey);
  }
  checks.push({ id: 'journal.balanced', label: 'Every journal entry balances (debits = credits)', ok: entriesOk });
  checks.push({ id: 'journal.unique', label: 'No journal entry was posted twice', ok: !duplicate });
  let dr = 0;
  let cr = 0;
  for (const e of company.journal) for (const l of e.lines) {
    dr += l.debit;
    cr += l.credit;
  }
  checks.push({ id: 'tb.balanced', label: 'Trial balance: total debits = total credits', ok: dr === cr, expected: dr, actual: cr });
  const bs = balanceSheet(company, Number.MAX_SAFE_INTEGER);
  checks.push({ id: 'bs.balanced', label: 'Balance sheet: assets = liabilities + equity', ok: bs.balanced, expected: bs.totalAssets, actual: bs.totalLiabilities + bs.totalEquity });
  const cash = cashBalance(company);
  checks.push({ id: 'cash.nonnegative', label: 'Cash is never negative', ok: cash >= 0, actual: cash });
  checks.push({ id: 'pool.cleared', label: 'Production cost pool is cleared', ok: rawBalance(company, '1295') === 0, actual: rawBalance(company, '1295'), expected: 0 });
  const inv = reconcileInventory(company);
  checks.push({ id: 'inventory.reconciled', label: 'Inventory balances = Σ movements and = GL 1200/1210', ok: inv.ok });
  const sumOpen = (account: string) => company.payables.filter((p) => p.account === account && (p.status === 'open' || p.status === 'overdue')).reduce((a, p) => a + p.amount, 0);
  for (const [acct, label] of [['2000', 'Accounts payable'], ['2100', 'Accrued salaries'], ['2200', 'Income tax payable'], ['2300', 'Levies payable']] as const) {
    const gl = -rawBalance(company, acct);
    const sub = sumOpen(acct);
    checks.push({ id: `ap.${acct}`, label: `${label}: open items = GL ${acct}`, ok: gl === sub, expected: gl, actual: sub });
  }
  const ar = company.receivables.filter((r) => r.status === 'open').reduce((a, r) => a + r.amount, 0);
  checks.push({ id: 'ar', label: 'Accounts receivable: open invoices = GL 1100', ok: ar === rawBalance(company, '1100'), expected: rawBalance(company, '1100'), actual: ar });
  const term = company.loans.filter((l) => l.kind === 'term_loan' && l.status !== 'repaid').reduce((a, l) => a + l.outstanding, 0);
  checks.push({ id: 'loans.term', label: 'Term loans: outstanding = GL 2500', ok: term === -rawBalance(company, '2500'), expected: -rawBalance(company, '2500'), actual: term });
  const od = company.loans.filter((l) => l.kind === 'overdraft').reduce((a, l) => a + l.outstanding, 0);
  checks.push({ id: 'loans.overdraft', label: 'Overdraft: drawn = GL 2510', ok: od === -rawBalance(company, '2510'), expected: -rawBalance(company, '2510'), actual: od });
  const dep = company.deposits.filter((d) => d.status === 'active').reduce((a, d) => a + d.principal + d.accrued, 0);
  checks.push({ id: 'deposits', label: 'Deposits: principal + accrued = GL 1050', ok: dep === rawBalance(company, '1050'), expected: rawBalance(company, '1050'), actual: dep });
  const ppe = company.facilities.reduce((a, f) => a + f.cost, 0);
  checks.push({ id: 'ppe', label: 'Facilities register cost = GL 1500', ok: ppe === rawBalance(company, '1500'), expected: rawBalance(company, '1500'), actual: ppe });
  const cip = company.facilities.reduce((a, f) => a + f.pendingCapex, 0);
  checks.push({ id: 'cip', label: 'Construction in progress = GL 1590', ok: cip === rawBalance(company, '1590'), expected: rawBalance(company, '1590'), actual: cip });
  const negStock = [...Object.values(company.rawInventory), ...Object.values(company.finishedInventory)].some((i) => i.qty < 0 || i.value < 0);
  checks.push({ id: 'stock.nonnegative', label: 'No negative stock', ok: !negStock });
  const shares = company.shareholders.every((s) => Number.isInteger(s.shares) && s.shares >= 0);
  checks.push({ id: 'captable', label: 'Cap table has whole, non-negative share counts', ok: shares });
  return checks;
}

export function worldInvariants(world: WorldState): { ok: boolean; failures: { companyId: string; check: InvariantCheck }[] } {
  const failures: { companyId: string; check: InvariantCheck }[] = [];
  for (const c of world.companies) for (const ch of companyInvariants(c)) if (!ch.ok) failures.push({ companyId: c.id, check: ch });
  return { ok: failures.length === 0, failures };
}
