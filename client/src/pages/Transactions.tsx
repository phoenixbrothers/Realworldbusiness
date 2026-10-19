/**
 * Transactions (plan §9): review queue with terms, counterparties, effects
 * before confirmation, approvals and status; the immutable journal; the
 * action audit trail; and controlled manual adjustments / reversals.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useWorld, useWorldQuery } from '../store';
import { inr } from '../format';
import { PageHeader } from '../components/Shell';
import { Badge, Button, Callout, Confirm, DataTypeBadge, Empty, ErrorState, Field, Loading, MoneyInput, Panel, Pager, Table, Tabs } from '../components/ui';
import type { JournalEntry } from '../types';

type Kind = 'equity_round' | 'term_loan' | 'loan_prepayment' | 'facility_build' | 'facility_upgrade' | 'deposit_open' | 'deposit_withdraw';
const KIND_LABEL: Record<Kind, string> = { equity_round: 'Equity funding round', term_loan: 'Term loan', loan_prepayment: 'Loan prepayment', facility_build: 'Build / lease facility', facility_upgrade: 'Upgrade facility', deposit_open: 'Open fixed deposit', deposit_withdraw: 'Withdraw deposit early' };

interface PreviewResp {
  ok: boolean;
  error?: string;
  counterparty?: string;
  terms?: Record<string, string | number>;
  warnings?: string[];
  preview?: { cashDelta: number; debtDelta: number; equityDelta: number; assetDelta: number; dilutionPct: number; ownershipAfter: { name: string; pct: number }[]; notes: string[] };
}

export default function Transactions() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'queue' | 'new' | 'journal' | 'audit' | 'adjust'>(params.get('new') ? 'new' : params.get('entry') ? 'journal' : 'queue');
  return (
    <>
      <PageHeader title="Transactions" module="transactions" />
      <Tabs label="Transaction sections" value={tab} onChange={setTab} tabs={[{ id: 'queue', label: 'Review queue' }, { id: 'new', label: 'New transaction' }, { id: 'journal', label: 'Journal' }, { id: 'audit', label: 'Audit trail' }, { id: 'adjust', label: 'Adjustments' }]} />
      {tab === 'queue' && <Queue />}
      {tab === 'new' && <NewTx initialKind={(params.get('new') as Kind) ?? 'term_loan'} onDone={() => setTab('queue')} />}
      {tab === 'journal' && <Journal focus={params.get('entry')} />}
      {tab === 'audit' && <Audit />}
      {tab === 'adjust' && <Adjust />}
    </>
  );
}

function Effects({ p }: { p: NonNullable<PreviewResp['preview']> }) {
  return (
    <div className="stack">
      <div className="grid g4">
        <div className="stat"><span className="l">Cash</span><span className={`v num ${p.cashDelta < 0 ? 'neg' : 'pos'}`}>{inr(p.cashDelta, { sign: true, compact: true })}</span></div>
        <div className="stat"><span className="l">Debt</span><span className="v num">{inr(p.debtDelta, { sign: true, compact: true })}</span></div>
        <div className="stat"><span className="l">Equity</span><span className="v num">{inr(p.equityDelta, { sign: true, compact: true })}</span></div>
        <div className="stat"><span className="l">Dilution</span><span className="v num">{p.dilutionPct}%</span></div>
      </div>
      <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{p.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      {p.dilutionPct > 0 && (
        <Table compact head={<tr><th>Ownership after</th><th className="r">%</th></tr>}>
          {p.ownershipAfter.map((o) => <tr key={o.name}><td>{o.name}</td><td className="r">{o.pct}%</td></tr>)}
        </Table>
      )}
    </div>
  );
}

function Queue() {
  const { view, act, canAct } = useWorld();
  const c = view!.company!;
  const [decide, setDecide] = useState<{ id: string; decision: 'approve' | 'reject' } | null>(null);
  const pending = c.transactions.filter((t) => t.status === 'pending_review');
  const done = c.transactions.filter((t) => t.status !== 'pending_review').reverse();
  return (
    <div className="stack">
      <Panel title="Awaiting review" actions={<Badge tone={pending.length ? 'warn' : 'ok'}>{pending.length}</Badge>}>
        {pending.length === 0 ? <Empty title="Nothing awaiting review">Proposed financing and capital projects appear here with their effects before you approve them.</Empty> : (
          <div className="stack">
            {pending.map((t) => (
              <div key={t.id} className="panel" style={{ background: 'var(--panel-2)' }}>
                <div className="row between">
                  <div>
                    <b>{KIND_LABEL[t.kind as Kind]}</b> <span className="mono small">{t.id}</span>
                    <div className="small muted">Counterparty: {t.counterparty} · proposed M{t.createdTick + 1}</div>
                  </div>
                  <div className="row">
                    <Button variant="danger" size="sm" disabled={!canAct} onClick={() => setDecide({ id: t.id, decision: 'reject' })}>Reject</Button>
                    <Button variant="primary" size="sm" disabled={!canAct} onClick={() => setDecide({ id: t.id, decision: 'approve' })}>Approve & execute</Button>
                  </div>
                </div>
                <div className="mt"><Effects p={t.preview} /></div>
                {t.warnings.map((w) => <Callout key={w} tone="warn">{w}</Callout>)}
                <p className="small faint mt">Terms are re-validated against the latest state at approval; if conditions changed the transaction is recorded as failed with the reason.</p>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="History">
        {done.length === 0 ? <p className="small muted">No decided transactions yet.</p> : (
          <Table compact head={<tr><th>ID</th><th>Type</th><th>Counterparty</th><th>Decided</th><th>Status</th><th>Journal</th><th>Note</th></tr>}>
            {done.map((t) => (
              <tr key={t.id}>
                <td className="mono">{t.id}</td><td>{KIND_LABEL[t.kind as Kind]}</td><td className="small">{t.counterparty}</td><td>{t.decidedTick !== undefined ? `M${t.decidedTick + 1}` : '—'}</td>
                <td><Badge tone={t.status === 'executed' ? 'ok' : t.status === 'failed' ? 'bad' : 'neutral'}>{t.status}</Badge></td>
                <td className="mono small">{t.journalIds.join(', ') || '—'}</td>
                <td className="small">{t.failureReason ?? ''}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <Confirm open={!!decide} onClose={() => setDecide(null)} title={decide?.decision === 'approve' ? 'Approve and execute?' : 'Reject this proposal?'} danger={decide?.decision === 'reject'} confirmLabel={decide?.decision === 'approve' ? 'Approve & execute' : 'Reject'} onConfirm={async () => { if (decide) await act('decide_transaction', { transactionId: decide.id, decision: decide.decision }); setDecide(null); }}>
        <p>{decide?.decision === 'approve' ? 'The transaction will be posted to the ledger immediately and recorded in the audit trail. It cannot be undone, only offset by a new transaction.' : 'The proposal is closed with no financial effect.'}</p>
      </Confirm>
    </div>
  );
}

function NewTx({ initialKind, onDone }: { initialKind: Kind; onDone: () => void }) {
  const { view, catalog, worldId, companyId, act, canAct } = useWorld();
  const [params] = useSearchParams();
  const c = view!.company!;
  const [kind, setKind] = useState<Kind>(initialKind in KIND_LABEL ? initialKind : 'term_loan');
  const [terms, setTerms] = useState<Record<string, string | number>>({});
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  useEffect(() => {
    const defaults: Record<Kind, Record<string, string | number>> = {
      equity_round: { amount: 5_00_00_000 * 100, counterparty: catalog?.investors[0] ?? 'Konkan Ventures' },
      term_loan: { amount: 1_00_00_000 * 100, termMonths: 36, counterparty: catalog?.lenders[0] ?? 'State Bank (simulated)' },
      loan_prepayment: { loanId: c.loans.find((l) => l.status === 'active' && l.outstanding > 0)?.id ?? '', amount: 10_00_000 * 100 },
      facility_build: { type: 'warehouse', city: c.city, mode: 'lease' },
      facility_upgrade: { facilityId: params.get('facility') ?? c.facilities.find((f) => f.type === 'factory')?.id ?? '' },
      deposit_open: { amount: 1_00_00_000 * 100, months: 6 },
      deposit_withdraw: { depositId: params.get('deposit') ?? c.deposits.find((d) => d.status === 'active')?.id ?? '' },
    };
    setTerms(defaults[kind]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  useEffect(() => {
    const t = setTimeout(() => api.post<PreviewResp>(`/api/worlds/${worldId}/companies/${companyId}/transaction-preview`, { kind, terms }).then(setPreview).catch((e) => setPreview({ ok: false, error: e.message })), 250);
    return () => clearTimeout(t);
  }, [kind, terms, worldId, companyId, view?.version]);
  const set = (k: string, v: string | number) => setTerms((t) => ({ ...t, [k]: v }));
  if (!catalog) return <Loading />;
  return (
    <div className="grid g2">
      <Panel title="Propose a transaction" sub="Proposals go to the review queue; nothing is posted until approved.">
        <div className="stack">
          <Field label="Transaction type" htmlFor="txk">
            <select id="txk" className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {(kind === 'equity_round' || kind === 'term_loan' || kind === 'loan_prepayment' || kind === 'deposit_open') && (
            <Field label="Amount" htmlFor="txa"><MoneyInput id="txa" value={Number(terms.amount ?? 0)} onChange={(v) => set('amount', v)} step={100000} /></Field>
          )}
          {kind === 'equity_round' && (
            <Field label="Investor" htmlFor="txi"><select id="txi" className="input" value={String(terms.counterparty)} onChange={(e) => set('counterparty', e.target.value)}>{catalog.investors.map((i) => <option key={i}>{i}</option>)}</select></Field>
          )}
          {kind === 'term_loan' && (
            <>
              <Field label="Lender" htmlFor="txl"><select id="txl" className="input" value={String(terms.counterparty)} onChange={(e) => set('counterparty', e.target.value)}>{catalog.lenders.map((i) => <option key={i}>{i}</option>)}</select></Field>
              <Field label="Term" htmlFor="txt"><select id="txt" className="input" value={String(terms.termMonths)} onChange={(e) => set('termMonths', Number(e.target.value))}>{[12, 24, 36, 60].map((m) => <option key={m} value={m}>{m} months</option>)}</select></Field>
              <p className="small faint">Credit limit available: {inr(c.computed.creditLimit, { compact: true })}</p>
            </>
          )}
          {kind === 'loan_prepayment' && (
            <Field label="Loan" htmlFor="txln"><select id="txln" className="input" value={String(terms.loanId)} onChange={(e) => set('loanId', e.target.value)}>{c.loans.filter((l) => l.status === 'active' && l.outstanding > 0).map((l) => <option key={l.id} value={l.id}>{l.lender} · {inr(l.outstanding, { compact: true })} outstanding</option>)}</select></Field>
          )}
          {kind === 'facility_build' && (
            <>
              <Field label="Facility type" htmlFor="txf"><select id="txf" className="input" value={String(terms.type)} onChange={(e) => set('type', e.target.value)}>{['factory', 'warehouse', 'rnd_lab', 'logistics_hub'].map((t) => <option key={t} value={t}>{catalog.facilitySpecs[t as 'factory'].label}</option>)}</select></Field>
              <Field label="City" htmlFor="txc"><select id="txc" className="input" value={String(terms.city)} onChange={(e) => set('city', e.target.value)}>{catalog.cities.map((ci) => <option key={ci.name}>{ci.name}</option>)}</select></Field>
              <Field label="Ownership" htmlFor="txm"><select id="txm" className="input" value={String(terms.mode)} onChange={(e) => set('mode', e.target.value)}><option value="lease">Lease</option><option value="build">Build (capex)</option></select></Field>
            </>
          )}
          {kind === 'facility_upgrade' && (
            <Field label="Facility" htmlFor="txfu"><select id="txfu" className="input" value={String(terms.facilityId)} onChange={(e) => set('facilityId', e.target.value)}>{c.facilities.filter((f) => f.type !== 'hq').map((f) => <option key={f.id} value={f.id}>{f.name} (level {f.level})</option>)}</select></Field>
          )}
          {kind === 'deposit_open' && (
            <Field label="Tenor" htmlFor="txd"><select id="txd" className="input" value={String(terms.months)} onChange={(e) => set('months', Number(e.target.value))}>{[3, 6, 12].map((m) => <option key={m} value={m}>{m} months</option>)}</select></Field>
          )}
          {kind === 'deposit_withdraw' && (
            <Field label="Deposit" htmlFor="txdw"><select id="txdw" className="input" value={String(terms.depositId)} onChange={(e) => set('depositId', e.target.value)}>{c.deposits.filter((d) => d.status === 'active').map((d) => <option key={d.id} value={d.id}>{d.id} · {inr(d.principal + d.accrued, { compact: true })}</option>)}</select></Field>
          )}
          <Button variant="primary" disabled={!canAct || !preview?.ok} onClick={async () => { if (await act('propose_transaction', { kind, terms })) onDone(); }}>Submit for review</Button>
        </div>
      </Panel>
      <Panel title="Effects before confirmation" actions={kind === 'equity_round' ? <DataTypeBadge type="estimate" label="Valuation estimate" /> : undefined}>
        {!preview ? <Loading label="Validating…" /> : !preview.ok ? <Callout tone="bad" title="Not possible as proposed">{preview.error}</Callout> : (
          <div className="stack">
            <p className="small">Counterparty: <b>{preview.counterparty}</b></p>
            <Effects p={preview.preview!} />
            {preview.warnings?.map((w) => <Callout key={w} tone="warn">{w}</Callout>)}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Journal({ focus }: { focus: string | null }) {
  const { worldId, companyId } = useWorld();
  const [q, setQ] = useState(focus ?? '');
  const [offset, setOffset] = useState(0);
  const path = `/api/worlds/${worldId}/companies/${companyId}/ledger?limit=40&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const { data, error, loading } = useWorldQuery<{ total: number; entries: (JournalEntry & { monthLabel: string })[] }>(path, [path]);
  return (
    <Panel title="Journal entries" sub="Immutable record of every financial posting with its source document.">
      <Field label="Search" htmlFor="jq"><input id="jq" className="input" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Entry id, memo or source id" /></Field>
      <div className="mt">
        {error ? <ErrorState error={error} /> : loading && !data ? <Loading /> : !data?.entries.length ? <Empty title="No entries" /> : (
          <>
            {data.entries.map((e) => (
              <details key={e.id} className="panel" style={{ background: 'var(--panel-2)', marginBottom: 8 }} open={e.id === focus}>
                <summary className="row between" style={{ cursor: 'pointer' }}>
                  <span><span className="mono">{e.id}</span> · {e.memo}</span>
                  <span className="small faint">{e.monthLabel} · {inr(e.lines.reduce((a, l) => a + l.debit, 0))} {e.status === 'reversed' && <Badge tone="warn">Reversed</Badge>}</span>
                </summary>
                <Table compact head={<tr><th>Account</th><th className="r">Debit</th><th className="r">Credit</th><th>Memo</th></tr>}>
                  {e.lines.map((l, i) => <tr key={i}><td className="mono">{l.account}</td><td className="r">{l.debit ? inr(l.debit) : ''}</td><td className="r">{l.credit ? inr(l.credit) : ''}</td><td className="small">{l.memo}</td></tr>)}
                </Table>
                <p className="small faint">Source {e.source.type}:{e.source.id} · cash flow: {e.cashFlow}{e.cashFlowLine ? ` (${e.cashFlowLine})` : ''} · idempotency key <span className="mono">{e.idempotencyKey}</span>{e.actionId ? ` · action ${e.actionId}` : ''}</p>
              </details>
            ))}
            <Pager total={data.total} offset={offset} limit={40} onChange={setOffset} />
          </>
        )}
      </div>
    </Panel>
  );
}

function Audit() {
  const { worldId } = useWorld();
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('');
  const { data, error } = useWorldQuery<{ total: number; rows: { id: string; seq: number | null; type: string; user: string; status: string; error: string | null; effects: string[]; tickBefore: number; createdAt: string }[] }>(`/api/worlds/${worldId}/audit?limit=50&offset=${offset}${status ? `&status=${status}` : ''}`, [offset, status]);
  return (
    <Panel title="Audit trail" sub="Every submitted action — accepted or rejected — with who submitted it and what changed. Accepted actions are replayable." actions={<select className="input" style={{ width: 'auto' }} aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}><option value="">All</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option></select>}>
      {error ? <ErrorState error={error} /> : !data ? <Loading /> : (
        <>
          <Table compact head={<tr><th>Seq</th><th>When (real time)</th><th>Sim month</th><th>User</th><th>Action</th><th>Result</th></tr>}>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.seq ?? '—'}</td>
                <td className="small">{new Date(r.createdAt).toLocaleString()}</td>
                <td>M{r.tickBefore + 1}</td>
                <td className="small">{r.user}</td>
                <td className="mono small">{r.type}</td>
                <td className="small">{r.status === 'accepted' ? <><Badge tone="ok">accepted</Badge> {r.effects[0]}</> : <><Badge tone="bad">rejected</Badge> {r.error}</>}</td>
              </tr>
            ))}
          </Table>
          <Pager total={data.total} offset={offset} limit={50} onChange={setOffset} />
        </>
      )}
    </Panel>
  );
}

function Adjust() {
  const { act, canAct, catalog, worldId, companyId } = useWorld();
  const [memo, setMemo] = useState('');
  const [from, setFrom] = useState('6000');
  const [to, setTo] = useState('6700');
  const [amount, setAmount] = useState(0);
  const [rev, setRev] = useState<{ id: string; reason: string } | null>(null);
  const { data } = useWorldQuery<{ entries: (JournalEntry & { monthLabel: string })[] }>(`/api/worlds/${worldId}/companies/${companyId}/ledger?source=adjustment&limit=50`);
  if (!catalog) return <Loading />;
  const pl = Object.values(catalog.accounts).filter((a) => a.type === 'expense' || a.type === 'revenue');
  return (
    <div className="grid g2">
      <Panel title="Reclassification adjustment" sub="Move an amount between income-statement accounts (e.g. a cost booked to the wrong expense line).">
        <Callout tone="info">Cash, inventory, receivables, payables, loans and equity can only change through their originating business transactions. Adjustments are restricted to revenue and expense accounts and are fully audited.</Callout>
        <div className="stack mt">
          <div className="grid g2">
            <Field label="Debit (increase expense)" htmlFor="adjd"><select id="adjd" className="input" value={to} onChange={(e) => setTo(e.target.value)}>{pl.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></Field>
            <Field label="Credit (decrease expense)" htmlFor="adjc"><select id="adjc" className="input" value={from} onChange={(e) => setFrom(e.target.value)}>{pl.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></Field>
          </div>
          <Field label="Amount" htmlFor="adja"><MoneyInput id="adja" value={amount} onChange={setAmount} /></Field>
          <Field label="Reason" htmlFor="adjm"><input id="adjm" className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Explain the correction" /></Field>
          <Button variant="primary" disabled={!canAct || amount <= 0 || from === to || memo.trim().length < 5} onClick={async () => { if (await act('post_adjustment', { memo, lines: [{ account: to, debit: amount }, { account: from, credit: amount }] })) { setAmount(0); setMemo(''); } }}>Post adjustment</Button>
        </div>
      </Panel>
      <Panel title="Adjustments posted">
        {!data?.entries.length ? <p className="small muted">None.</p> : (
          <Table compact head={<tr><th>Entry</th><th>Memo</th><th className="r">Amount</th><th></th></tr>}>
            {data.entries.map((e) => (
              <tr key={e.id}>
                <td className="mono">{e.id}</td>
                <td className="small">{e.memo}</td>
                <td className="r">{inr(e.lines.reduce((a, l) => a + l.debit, 0))}</td>
                <td>{e.status === 'reversed' ? <Badge tone="warn">Reversed by {e.reversedBy}</Badge> : <Button size="sm" variant="ghost" disabled={!canAct} onClick={() => setRev({ id: e.id, reason: '' })}>Reverse</Button>}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="small faint mt">Reversal posts a mirror entry and flags the original; history is never deleted.</p>
      </Panel>
      <Confirm open={!!rev} onClose={() => setRev(null)} title={`Reverse ${rev?.id}?`} confirmLabel="Post reversal" onConfirm={async () => { if (rev && (await act('reverse_entry', { entryId: rev.id, reason: rev.reason }))) setRev(null); }}>
        <Field label="Reason for reversal" htmlFor="revr"><input id="revr" className="input" value={rev?.reason ?? ''} onChange={(e) => setRev((r) => (r ? { ...r, reason: e.target.value } : r))} data-autofocus /></Field>
        <p className="small faint">A mirror entry with debits and credits swapped is posted; the original stays in the journal flagged as reversed.</p>
      </Confirm>
    </div>
  );
}
