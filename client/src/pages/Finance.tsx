import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useWorld, useWorldQuery } from '../store';
import { inr, pct } from '../format';
import { PageHeader } from '../components/Shell';
import { KpiStrip } from '../components/Kpi';
import { Waterfall } from '../components/Charts';
import { Badge, Button, Callout, DataTypeBadge, Empty, ErrorState, Field, Loading, MoneyInput, Panel, Pager, Seg, Table, Tabs } from '../components/ui';
import type { JournalEntry } from '../types';
import type { BalanceSheet, CashFlowStatement, IncomeStatement } from '../../../engine/ledger';
import type { InvariantCheck } from '../../../engine/invariants';

type Tab = 'overview' | 'statements' | 'ledger' | 'budgets' | 'debt';

interface Statements {
  from: number;
  to: number;
  fromLabel: string;
  toLabel: string;
  income: IncomeStatement;
  balance: BalanceSheet;
  cashFlow: CashFlowStatement;
  trialBalance: { account: { code: string; name: string }; debit: number; credit: number }[];
  invariants: InvariantCheck[];
}

export function usePeriod(foundedTick: number, tick: number) {
  const [period, setPeriod] = useState<'month' | 'quarter' | 'ytd' | 'all'>('month');
  const last = Math.max(foundedTick, tick - 1);
  const from = period === 'month' ? last : period === 'quarter' ? Math.max(foundedTick, last - 2) : period === 'ytd' ? Math.max(foundedTick, last - (last % 12)) : foundedTick;
  return { period, setPeriod, from, to: last, closed: tick - 1 >= foundedTick };
}

export default function Finance() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('account') ? 'ledger' : 'overview');
  const { view } = useWorld();
  const c = view!.company!;
  return (
    <>
      <PageHeader title="Finance & accounting" module="finance" actions={<Link to="../transactions" relative="path" className="btn">Raise capital / borrow →</Link>} />
      <Tabs label="Finance sections" value={tab} onChange={(t) => { setTab(t); setParams({}); }} tabs={[{ id: 'overview', label: 'Liquidity' }, { id: 'statements', label: 'Statements' }, { id: 'ledger', label: 'General ledger' }, { id: 'debt', label: 'Debt & obligations' }, { id: 'budgets', label: 'Budgets' }]} />
      {tab === 'overview' && <Liquidity />}
      {tab === 'statements' && <StatementsView foundedTick={c.foundedTick} />}
      {tab === 'ledger' && <Ledger initialAccount={params.get('account') ?? ''} />}
      {tab === 'debt' && <Debt />}
      {tab === 'budgets' && <Budgets />}
    </>
  );
}

function Liquidity() {
  const { view, worldId, companyId } = useWorld();
  const c = view!.company!;
  const w = view!.world;
  const { data } = useWorldQuery<Statements>(`/api/worlds/${worldId}/companies/${companyId}/statements`);
  const upcoming = [
    ...c.payables.filter((p) => p.status === 'open' || p.status === 'overdue').map((p) => ({ label: p.counterparty, amount: -p.amount, due: p.dueTick, status: p.status })),
    ...c.receivables.filter((r) => r.status === 'open').map((r) => ({ label: r.counterparty, amount: r.amount, due: r.dueTick, status: 'receivable' })),
  ].sort((a, b) => a.due - b.due);
  const od = c.computed.overdraft;
  return (
    <div className="stack">
      <KpiStrip keys={['cash', 'operating_profit', 'runway', 'debt']} />
      <div className="grid g-main">
        <Panel title="Cash movement waterfall" sub={data ? `${data.fromLabel} — direct method, from cash account postings` : undefined} actions={<DataTypeBadge type="actual" />}>
          {!data ? (
            <Loading />
          ) : data.cashFlow.sections.every((s) => s.lines.length === 0) ? (
            <Empty title="No cash movements in the last closed month" />
          ) : (
            <>
              <Waterfall start={data.cashFlow.opening} end={data.cashFlow.closing} startLabel="Opening cash" endLabel="Closing cash" steps={data.cashFlow.sections.flatMap((s) => s.lines.map((l) => ({ label: l.label, amount: l.amount })))} />
              <p className="small faint">{data.cashFlow.reconciles ? '✓ Opening cash + movements = closing cash.' : '⚠ Cash flow does not reconcile.'} Cash is not profit: see Statements for accrual results.</p>
            </>
          )}
        </Panel>
        <Panel title="Upcoming obligations" actions={<Badge>{upcoming.length}</Badge>}>
          {upcoming.length === 0 ? (
            <p className="small muted">Nothing outstanding.</p>
          ) : (
            <div className="list" style={{ maxHeight: 330, overflowY: 'auto' }}>
              {upcoming.slice(0, 30).map((u, i) => (
                <div key={i} className="list-item">
                  <span style={{ flex: 1 }}>
                    <span className="small" style={{ display: 'block' }}>{u.label}</span>
                    <span className="small faint">Due {monthName(w, u.due)}{u.due <= w.tick ? ' (this month)' : ''}</span>
                  </span>
                  <span className={`num small ${u.amount < 0 ? 'neg' : 'pos'}`}>{inr(u.amount, { sign: true })}</span>
                  {u.status === 'overdue' && <Badge tone="bad">Overdue</Badge>}
                </div>
              ))}
            </div>
          )}
          {od && (
            <div className="mt">
              <div className="row between small"><span>Overdraft drawn</span><span>{inr(od.outstanding)} of {inr(od.principal)}</span></div>
              <div className="meter amber mt" role="meter" aria-label="Overdraft utilization" aria-valuenow={Math.round((od.outstanding / od.principal) * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${(od.outstanding / od.principal) * 100}%` }} /></div>
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Cash vs profit vs valuation" sub="These are different measures and are never interchangeable.">
        <div className="grid g4">
          <div className="stat"><span className="l">Spendable cash <DataTypeBadge type="actual" /></span><span className="v num">{inr(c.computed.cash, { compact: true })}</span><span className="small faint">GL 1000</span></div>
          <div className="stat"><span className="l">Committed to open purchase orders</span><span className="v num">{inr(c.computed.committedPurchases, { compact: true })}</span><span className="small faint">Payable on receipt</span></div>
          <div className="stat"><span className="l">Last month net income <DataTypeBadge type="actual" /></span><span className="v num">{inr(c.computed.lastMonth?.netIncome ?? null, { compact: true })}</span><span className="small faint">Accrual profit</span></div>
          <div className="stat"><span className="l">Valuation <DataTypeBadge type="estimate" /></span><span className="v num">{inr(c.computed.valuation.preMoney, { compact: true })}</span><span className="small faint">Not cash</span></div>
        </div>
      </Panel>
    </div>
  );
}

function StatementsView({ foundedTick }: { foundedTick: number }) {
  const { view, worldId, companyId, base } = useWorld();
  const p = usePeriod(foundedTick, view!.world.tick);
  const { data, error, loading } = useWorldQuery<Statements>(p.closed ? `/api/worlds/${worldId}/companies/${companyId}/statements?from=${p.from}&to=${p.to}` : null, [p.from, p.to]);
  const allOk = data?.invariants.every((i) => i.ok);
  if (!p.closed) return <Empty title="No closed period yet">Statements cover closed months. Run your first month to see an income statement; the opening balance sheet is available below once a month closes.</Empty>;
  return (
    <div className="stack">
      <div className="row between">
        <Seg label="Reporting period" value={p.period} onChange={p.setPeriod} options={[{ id: 'month', label: 'Last month' }, { id: 'quarter', label: 'Last 3 months' }, { id: 'ytd', label: 'Year to date' }, { id: 'all', label: 'Since founding' }]} />
        <div className="row">
          <DataTypeBadge type="actual" label="Actual · posted" />
          {data && <Badge tone={allOk ? 'ok' : 'bad'}>{allOk ? 'Reconciled' : 'Reconciliation issue'}</Badge>}
          <span className="small faint">INR · {data ? `${data.fromLabel} – ${data.toLabel}` : ''}</span>
        </div>
      </div>
      {error ? <ErrorState error={error} /> : loading || !data ? <Loading /> : (
        <>
          <div className="grid g2">
            <Panel title="Income statement">
              <StatementTable lines={data.income.lines} base={base} />
            </Panel>
            <Panel title={`Balance sheet · ${data.toLabel}`} actions={<Badge tone={data.balance.balanced ? 'ok' : 'bad'}>{data.balance.balanced ? 'Assets = L + E' : `Off by ${inr(data.balance.difference)}`}</Badge>}>
              <Table compact head={<tr><th>Line</th><th className="r">INR</th></tr>}>
                <tr className="sub"><td colSpan={2}>Assets</td></tr>
                {data.balance.assets.filter((a) => a.amount !== 0).map((a) => <StmtRow key={a.code} line={a} base={base} />)}
                <tr className="total"><td>Total assets</td><td className="r">{inr(data.balance.totalAssets)}</td></tr>
                <tr className="sub"><td colSpan={2}>Liabilities</td></tr>
                {data.balance.liabilities.filter((a) => a.amount !== 0).map((a) => <StmtRow key={a.code} line={a} base={base} />)}
                <tr className="total"><td>Total liabilities</td><td className="r">{inr(data.balance.totalLiabilities)}</td></tr>
                <tr className="sub"><td colSpan={2}>Equity</td></tr>
                {data.balance.equity.map((a) => <StmtRow key={a.label} line={a} base={base} />)}
                <tr className="total"><td>Total liabilities & equity</td><td className="r">{inr(data.balance.totalLiabilities + data.balance.totalEquity)}</td></tr>
              </Table>
            </Panel>
          </div>
          <Panel title="Cash flow statement (direct method)" actions={<Badge tone={data.cashFlow.reconciles ? 'ok' : 'bad'}>{data.cashFlow.reconciles ? 'Reconciles to cash' : 'Does not reconcile'}</Badge>}>
            <Table compact head={<tr><th>Line</th><th className="r">INR</th></tr>}>
              <tr><td>Opening cash</td><td className="r">{inr(data.cashFlow.opening)}</td></tr>
              {data.cashFlow.sections.map((s) => (
                <SectionRows key={s.category} section={s} />
              ))}
              <tr className="total"><td>Closing cash</td><td className="r">{inr(data.cashFlow.closing)}</td></tr>
            </Table>
          </Panel>
          <Panel title="Integrity checks" sub="Run against the full ledger and sub-ledgers.">
            <div className="grid g2">
              {data.invariants.map((i) => (
                <div key={i.id} className="row small">
                  <Badge tone={i.ok ? 'ok' : 'bad'}>{i.ok ? 'Pass' : 'Fail'}</Badge>
                  <span>{i.label}</span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function SectionRows({ section }: { section: CashFlowStatement['sections'][number] }) {
  return (
    <>
      <tr className="sub"><td colSpan={2}>{section.label}</td></tr>
      {section.lines.map((l) => (
        <tr key={l.label}><td style={{ paddingLeft: 22 }}>{l.label}</td><td className="r">{inr(l.amount)}</td></tr>
      ))}
      <tr><td style={{ paddingLeft: 22 }}><b>Net {section.category}</b></td><td className="r"><b>{inr(section.total)}</b></td></tr>
    </>
  );
}

function StmtRow({ line, base }: { line: { code?: string; label: string; amount: number }; base: string }) {
  return (
    <tr>
      <td style={{ paddingLeft: 22 }}>{line.code ? <Link to={`${base}/finance?account=${line.code}`}>{line.label}</Link> : line.label}</td>
      <td className="r">{inr(line.amount)}</td>
    </tr>
  );
}

function StatementTable({ lines, base }: { lines: IncomeStatement['lines']; base: string }) {
  return (
    <Table compact head={<tr><th>Line</th><th className="r">INR</th></tr>}>
      {lines.filter((l) => l.kind !== 'line' || l.amount !== 0).map((l, i) => (
        <tr key={i} className={l.kind === 'subtotal' ? 'sub' : l.kind === 'total' ? 'total' : ''}>
          <td style={{ paddingLeft: l.kind === 'line' ? 22 : undefined }}>{l.kind === 'line' && l.code ? <Link to={`${base}/finance?account=${l.code}`}>{l.label}</Link> : l.label}</td>
          <td className={`r ${l.kind !== 'line' && l.amount < 0 ? 'neg' : ''}`}>{inr(l.amount)}</td>
        </tr>
      ))}
    </Table>
  );
}

function Ledger({ initialAccount }: { initialAccount: string }) {
  const { worldId, companyId, catalog } = useWorld();
  const [account, setAccount] = useState(initialAccount);
  const [q, setQ] = useState('');
  const [qDebounced, setQD] = useState('');
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      setQD(q);
      setOffset(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const path = `/api/worlds/${worldId}/companies/${companyId}/ledger?limit=50&offset=${offset}${account ? `&account=${account}` : ''}${qDebounced ? `&q=${encodeURIComponent(qDebounced)}` : ''}`;
  const { data, error, loading } = useWorldQuery<{ total: number; entries: (JournalEntry & { monthLabel: string })[] }>(path, [path]);
  return (
    <Panel
      title="General ledger"
      sub="Every posted journal entry. Entries are immutable; corrections are reversals."
      actions={
        <a className="btn sm" href={`/api/worlds/${worldId}/companies/${companyId}/ledger?format=csv${account ? `&account=${account}` : ''}`} download>
          <Download aria-hidden /> Export CSV
        </a>
      }
    >
      <div className="grid g2 mb">
        <Field label="Account" htmlFor="acct">
          <select id="acct" className="input" value={account} onChange={(e) => { setAccount(e.target.value); setOffset(0); }}>
            <option value="">All accounts</option>
            {catalog && Object.values(catalog.accounts).map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        <Field label="Search memo, entry or source id" htmlFor="lq">
          <input id="lq" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. PO-00012, payroll, JE-00101" />
        </Field>
      </div>
      {account && catalog && <Callout tone="info"><b>{account} {catalog.accounts[account].name}:</b> {catalog.accounts[account].description}</Callout>}
      {error ? <ErrorState error={error} /> : loading && !data ? <Loading /> : !data || data.entries.length === 0 ? <Empty title="No entries match" /> : (
        <>
          <Table head={<tr><th>Entry</th><th>Month</th><th>Memo / source</th><th>Lines</th><th className="r">Amount</th><th>Status</th></tr>}>
            {data.entries.map((e) => (
              <tr key={e.id}>
                <td className="mono">{e.id}</td>
                <td className="small">{e.monthLabel}</td>
                <td className="small">{e.memo}<div className="faint mono">{e.source.type}:{e.source.id}</div></td>
                <td className="small mono">
                  {e.lines.map((l, i) => (
                    <div key={i}>{l.debit ? `Dr ${l.account} ${inr(l.debit)}` : `  Cr ${l.account} ${inr(l.credit)}`}</div>
                  ))}
                </td>
                <td className="r">{inr(e.lines.reduce((a, l) => a + l.debit, 0))}</td>
                <td>{e.status === 'reversed' ? <Badge tone="warn">Reversed by {e.reversedBy}</Badge> : e.reversalOf ? <Badge tone="info">Reverses {e.reversalOf}</Badge> : <Badge tone="ok">Posted</Badge>}</td>
              </tr>
            ))}
          </Table>
          <Pager total={data.total} offset={offset} limit={50} onChange={setOffset} />
        </>
      )}
    </Panel>
  );
}

function Debt() {
  const { view, base } = useWorld();
  const c = view!.company!;
  const w = view!.world;
  return (
    <div className="stack">
      <Panel title="Loans & facilities" actions={<Link to={`${base}/transactions`} className="btn sm">New loan / prepay</Link>}>
        {c.loans.length === 0 ? <Empty title="No borrowings" /> : (
          <Table head={<tr><th>Lender</th><th>Type</th><th className="r">Limit / principal</th><th className="r">Outstanding</th><th className="r">Rate today</th><th>Maturity</th><th>Covenant</th><th>Status</th></tr>}>
            {c.loans.map((l) => (
              <tr key={l.id}>
                <td>{l.lender}<div className="small faint mono">{l.id}</div></td>
                <td>{l.kind === 'overdraft' ? 'Overdraft (auto-drawn for mandatory payments)' : `${l.termMonths}-month amortizing`}</td>
                <td className="r">{inr(l.principal)}</td>
                <td className="r">{inr(l.outstanding)}</td>
                <td className="r">{((c.computed.loanRates[l.id] ?? 0) / 100).toFixed(2)}% {l.floating ? 'floating' : 'fixed'}</td>
                <td>{l.kind === 'overdraft' ? 'Revolving' : monthName(w, l.maturityTick)}</td>
                <td className="small">{l.covenantMinCash ? `Cash ≥ ${inr(l.covenantMinCash, { compact: true })}` : '—'}</td>
                <td><Badge tone={l.status === 'active' ? 'ok' : l.status === 'defaulted' ? 'bad' : 'neutral'}>{l.status}</Badge></td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <Panel title="Payables" sub="Supplier, customs, utilities, tax and levy obligations; paid automatically when due in priority order (salaries, tax, levies, suppliers, other).">
        <Table compact head={<tr><th>ID</th><th>Counterparty</th><th>Kind</th><th>Due</th><th className="r">Amount</th><th>Status</th></tr>}>
          {[...c.payables].reverse().slice(0, 40).map((p) => (
            <tr key={p.id}>
              <td className="mono">{p.id}</td>
              <td>{p.counterparty}</td>
              <td>{p.kind}</td>
              <td>{monthName(w, p.dueTick)}</td>
              <td className="r">{inr(p.amount)}</td>
              <td><Badge tone={p.status === 'paid' ? 'ok' : p.status === 'overdue' ? 'bad' : 'info'}>{p.status}</Badge></td>
            </tr>
          ))}
        </Table>
      </Panel>
      <Panel title="Receivables">
        <Table compact head={<tr><th>ID</th><th>Customer</th><th>Due</th><th className="r">Amount</th><th>Status</th></tr>}>
          {[...c.receivables].reverse().slice(0, 30).map((r) => (
            <tr key={r.id}><td className="mono">{r.id}</td><td>{r.counterparty}</td><td>{monthName(w, r.dueTick)}</td><td className="r">{inr(r.amount)}</td><td><Badge tone={r.status === 'collected' ? 'ok' : 'info'}>{r.status}</Badge></td></tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}

function Budgets() {
  const { view, act, canAct } = useWorld();
  const c = view!.company!;
  const [b, setB] = useState(c.budget);
  const last = c.computed.lastMonth;
  const actual = (code: string) => last?.lines.find((l) => l.code === code)?.amount ?? 0;
  const capexActual = 0;
  const rows = [
    { key: 'marketing' as const, label: 'Marketing', actual: actual('6100'), committed: c.campaigns.filter((x) => x.status === 'active' || x.status === 'scheduled').reduce((a, x) => a + x.monthlyBudget, 0) },
    { key: 'rnd' as const, label: 'Research & development', actual: actual('6200'), committed: c.rndProjects.filter((x) => x.status === 'active').reduce((a, x) => a + x.monthlyBudget, 0) },
    { key: 'hiring' as const, label: 'Recruitment & training', actual: actual('6700'), committed: c.requisitions.filter((r) => r.status === 'open').reduce((a, r) => a + r.costPerHire * r.count, 0) },
    { key: 'capex' as const, label: 'Capital expenditure', actual: capexActual, committed: 0 },
  ];
  return (
    <Panel title="Monthly budgets" sub="Budgets are planning limits. The engine warns when new commitments exceed them; actuals come from the ledger.">
      <Table head={<tr><th>Category</th><th style={{ width: 200 }}>Budget / month</th><th className="r">Committed / month</th><th className="r">Last month actual</th><th className="r">Variance</th></tr>}>
        {rows.map((r) => {
          const variance = c.budget[r.key] - r.actual;
          return (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td><MoneyInput value={b[r.key]} onChange={(v) => setB((x) => ({ ...x, [r.key]: v }))} disabled={!canAct} /></td>
              <td className={`r ${r.committed > c.budget[r.key] && c.budget[r.key] > 0 ? 'warn' : ''}`}>{inr(r.committed)}</td>
              <td className="r">{inr(r.actual)}</td>
              <td className={`r ${variance < 0 ? 'neg' : 'pos'}`}>{c.budget[r.key] ? `${inr(variance, { sign: true })} (${pct(r.actual / c.budget[r.key], 0)} used)` : '—'}</td>
            </tr>
          );
        })}
      </Table>
      <div className="row mt">
        <Button variant="primary" disabled={!canAct} onClick={() => act('set_budget', { ...b })}>Save budgets</Button>
      </div>
    </Panel>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthName(w: { startMonth: number; startYear: number }, tick: number) {
  const m = w.startMonth + tick;
  return `${MONTHS[((m % 12) + 12) % 12]} ${w.startYear + Math.floor(m / 12)}`;
}
