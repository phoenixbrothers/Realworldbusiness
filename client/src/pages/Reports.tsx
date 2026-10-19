/**
 * Reports & analytics (plan §9): report builder with period selection and
 * CSV export, variance bridge, engine forecast, scenario comparison and a
 * guide to how the simulation works.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { api } from '../api';
import { useWorld, useWorldQuery } from '../store';
import { inr, num } from '../format';
import { PageHeader } from '../components/Shell';
import { LinesChart, Waterfall } from '../components/Charts';
import { usePeriod } from './Finance';
import { Badge, Button, Callout, DataTypeBadge, Empty, Field, Loading, MoneyInput, Panel, Seg, Table, Tabs } from '../components/ui';
import type { Projection } from '../types';

type ReportId = 'pnl' | 'balance' | 'cashflow' | 'trial' | 'sales' | 'production' | 'inventory' | 'suppliers' | 'workforce' | 'rnd' | 'market' | 'exposure' | 'risk';
const REPORTS: { id: ReportId; label: string; group: string }[] = [
  { id: 'pnl', label: 'Income statement', group: 'Financial' },
  { id: 'balance', label: 'Balance sheet', group: 'Financial' },
  { id: 'cashflow', label: 'Cash flow', group: 'Financial' },
  { id: 'trial', label: 'Trial balance', group: 'Financial' },
  { id: 'sales', label: 'Sales by product & market', group: 'Commercial' },
  { id: 'market', label: 'Market analysis', group: 'Commercial' },
  { id: 'production', label: 'Production', group: 'Operations' },
  { id: 'inventory', label: 'Inventory position', group: 'Operations' },
  { id: 'suppliers', label: 'Supplier performance', group: 'Operations' },
  { id: 'workforce', label: 'Workforce', group: 'People' },
  { id: 'rnd', label: 'R&D portfolio', group: 'People' },
  { id: 'exposure', label: 'Country & event exposure', group: 'Risk' },
  { id: 'risk', label: 'Risk register', group: 'Risk' },
];

function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const blob = new Blob([[cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Reports() {
  const [params] = useSearchParams();
  const { view } = useWorld();
  const [tab, setTab] = useState<'builder' | 'variance' | 'forecast' | 'scenario' | 'guide'>((params.get('tab') as 'guide') ?? 'builder');
  return (
    <>
      <PageHeader title="Reports & analytics" module="reports" />
      <Tabs label="Report sections" value={tab} onChange={setTab} tabs={[{ id: 'builder', label: 'Report builder' }, { id: 'variance', label: 'Variance explanation' }, { id: 'forecast', label: 'Forecast' }, { id: 'scenario', label: 'Scenario lab' }, { id: 'guide', label: 'How it works' }]} />
      {!view?.company && tab !== 'guide' ? <Empty title="Create a company to see reports" /> : (
        <>
          {tab === 'builder' && <Builder />}
          {tab === 'variance' && <Variance />}
          {tab === 'forecast' && <Forecast />}
          {tab === 'scenario' && <Scenario />}
        </>
      )}
      {tab === 'guide' && <Guide />}
    </>
  );
}

function Builder() {
  const { view, catalog, worldId, companyId } = useWorld();
  const c = view!.company!;
  const w = view!.world;
  const [rep, setRep] = useState<ReportId>('pnl');
  const p = usePeriod(c.foundedTick, w.tick);
  const st = useWorldQuery<any>(p.closed ? `/api/worlds/${worldId}/companies/${companyId}/statements?from=${p.from}&to=${p.to}` : null, [p.from, p.to]);
  const inPeriod = (t: number) => t >= p.from && t <= p.to;
  const rows: Record<string, unknown>[] = useMemo(() => {
    if (!catalog) return [];
    switch (rep) {
      case 'pnl': return st.data ? st.data.income.lines.map((l: any) => ({ line: l.label, account: l.code ?? '', inr: (l.amount / 100).toFixed(2) })) : [];
      case 'balance': return st.data ? [...st.data.balance.assets, ...st.data.balance.liabilities, ...st.data.balance.equity].map((l: any) => ({ line: l.label, account: l.code ?? '', inr: (l.amount / 100).toFixed(2) })) : [];
      case 'cashflow': return st.data ? st.data.cashFlow.sections.flatMap((s: any) => s.lines.map((l: any) => ({ section: s.label, line: l.label, inr: (l.amount / 100).toFixed(2) }))) : [];
      case 'trial': return st.data ? st.data.trialBalance.map((r: any) => ({ account: r.account.code, name: r.account.name, debit_inr: (r.debit / 100).toFixed(2), credit_inr: (r.credit / 100).toFixed(2) })) : [];
      case 'sales': return c.sales.filter((s) => inPeriod(s.tick)).map((s) => ({ month: `M${s.tick + 1}`, product: c.products.find((x) => x.id === s.productId)?.name, market: s.market, demand: s.demand, sold: s.sold, lost: s.lostSales, price_inr: s.price / 100, revenue_inr: s.revenue / 100, cogs_inr: s.cogs / 100, share_pct: +(s.share * 100).toFixed(2) }));
      case 'production': return c.production.filter((r) => inPeriod(r.tick)).map((r) => ({ order: r.id, month: `M${r.tick + 1}`, line: c.lines.find((l) => l.id === r.lineId)?.name, product: c.products.find((x) => x.id === r.productId)?.name, planned: r.planned, feasible: r.feasible, good: r.produced, scrap: r.scrap, unit_cost_inr: r.unitCost / 100, bottleneck: r.bottleneck, status: r.status }));
      case 'inventory': return [...Object.entries(c.rawInventory).map(([k, v]) => ({ kind: 'raw', item: catalog.materials[k].name, qty: v.qty, value_inr: v.value / 100 })), ...Object.entries(c.finishedInventory).map(([k, v]) => ({ kind: 'finished', item: c.products.find((x) => x.id === k)?.name, qty: v.qty, value_inr: v.value / 100 }))];
      case 'suppliers': {
        const by: Record<string, { orders: number; received: number; late: number; blocked: number; spend: number }> = {};
        for (const po of c.purchaseOrders) {
          const b = (by[po.supplierId] ??= { orders: 0, received: 0, late: 0, blocked: 0, spend: 0 });
          b.orders++;
          if (po.status === 'received') { b.received++; b.spend += po.totalCost; if ((po.receivedTick ?? 0) > po.orderedTick + catalog.suppliers[po.supplierId].leadTime || po.delayReason) b.late++; }
          if (po.status === 'blocked') b.blocked++;
        }
        return Object.entries(by).map(([k, v]) => ({ supplier: catalog.suppliers[k].name, country: catalog.suppliers[k].country, orders: v.orders, received: v.received, late: v.late, blocked: v.blocked, on_time_pct: v.received ? +(((v.received - v.late) / v.received) * 100).toFixed(1) : '', spend_inr: v.spend / 100 }));
      }
      case 'workforce': return c.teams.map((t) => ({ team: t.role, department: t.department, headcount: t.headcount, salary_inr: t.salary / 100, market_inr: c.computed.marketSalary[t.id] / 100, skill: t.skill, morale: t.morale, left_last_month: t.lastLeavers }));
      case 'rnd': return c.rndProjects.map((r) => ({ project: r.name, kind: r.kind, stage: r.stage, progress: r.progress, spent_inr: r.spent / 100, status: r.status, gates_passed: r.gates.filter((g) => g.result === 'passed').length, gates_failed: r.gates.filter((g) => g.result === 'failed').length }));
      case 'market': return c.computed.segments.flatMap((s) => s.offers.map((o) => ({ segment: s.name, offer: o.name, owner: o.owner, price_inr: o.price / 100, quality: o.quality, awareness: +o.awareness.toFixed(1), sold: o.sold, share_pct: +(o.share * 100).toFixed(1) })));
      case 'exposure': return c.computed.exposures.map((x) => ({ event: w.events.find((e) => e.id === x.eventId)?.title, level: x.level, items: x.items.length, est_monthly_impact_inr: x.monthlyImpact / 100, basis: x.impactBasis }));
      case 'risk': return c.computed.alerts.map((a) => ({ severity: a.severity, title: a.title, reason: a.reason, impact: a.impact, owner: a.owner, dismissed: a.dismissed }));
    }
  }, [rep, st.data, c, catalog, p.from, p.to, w.events]); // eslint-disable-line react-hooks/exhaustive-deps
  const needsStatements = ['pnl', 'balance', 'cashflow', 'trial'].includes(rep);
  const periodAware = needsStatements || rep === 'sales' || rep === 'production';
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(200px, 240px) 1fr' }}>
      <Panel title="Reports">
        {['Financial', 'Commercial', 'Operations', 'People', 'Risk'].map((g) => (
          <div key={g} className="mb">
            <div className="label">{g}</div>
            {REPORTS.filter((r) => r.group === g).map((r) => (
              <button key={r.id} className={`nav-link ${rep === r.id ? 'active' : ''}`} style={{ width: '100%', background: rep === r.id ? undefined : 'none', border: 0, cursor: 'pointer' }} aria-pressed={rep === r.id} onClick={() => setRep(r.id)}>{r.label}</button>
            ))}
          </div>
        ))}
      </Panel>
      <Panel title={REPORTS.find((r) => r.id === rep)!.label} actions={<>
        {periodAware && <Seg label="Period" value={p.period} onChange={p.setPeriod} options={[{ id: 'month', label: 'Month' }, { id: 'quarter', label: '3M' }, { id: 'ytd', label: 'YTD' }, { id: 'all', label: 'All' }]} />}
        <DataTypeBadge type={rep === 'exposure' ? 'estimate' : 'actual'} />
        <Button size="sm" disabled={!rows.length} onClick={() => downloadCsv(`${rep}-${c.id}`, rows)}><Download aria-hidden /> CSV</Button>
      </>}>
        <p className="small faint mb">INR (rupees in CSV){periodAware ? ` · M${p.from + 1}–M${p.to + 1}` : ' · as of now'} · source: posted ledger and operational records</p>
        {needsStatements && !p.closed ? <Empty title="No closed period yet" /> : needsStatements && st.loading && !st.data ? <Loading /> : rows.length === 0 ? <Empty title="No data for this report and period" /> : (
          <div className="table-wrap" style={{ maxHeight: 560 }}>
            <table className="t compact">
              <thead><tr>{cols.map((k) => <th key={k} className={typeof rows[0][k] === 'number' ? 'r' : ''}>{k.replace(/_/g, ' ')}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => <tr key={i}>{cols.map((k) => <td key={k} className={typeof r[k] === 'number' ? 'r' : ''}>{typeof r[k] === 'number' ? (k.endsWith('_inr') ? inr(Math.round((r[k] as number) * 100)) : num(r[k] as number, 2)) : String(r[k] ?? '')}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Variance() {
  const { worldId, companyId, view } = useWorld();
  const w = view!.world;
  const c = view!.company!;
  const [to, setTo] = useState(w.tick - 1);
  const { data } = useWorldQuery<{ bridge: { from: string; to: string; start: number; end: number; steps: { label: string; amount: number; source: string }[]; reconciles: boolean } | null }>(`/api/worlds/${worldId}/companies/${companyId}/variance?to=${to}`, [to]);
  const options = c.history.map((h) => h.tick).filter((t) => t - 1 >= c.foundedTick);
  return (
    <Panel title="Why did net income change?" sub="Month-over-month bridge built from ledger accounts. Every step links to a GL account; nothing is inferred." actions={<select className="input" style={{ width: 'auto' }} aria-label="Month to explain" value={to} onChange={(e) => setTo(Number(e.target.value))}>{options.map((t) => <option key={t} value={t}>M{t} → M{t + 1}</option>)}</select>}>
      {!data ? <Loading /> : !data.bridge ? <Empty title="Need two closed months">Run at least two months to compare periods.</Empty> : (
        <div className="grid g-main">
          <Waterfall start={data.bridge.start} end={data.bridge.end} startLabel={data.bridge.from} endLabel={data.bridge.to} steps={data.bridge.steps} height={320} />
          <Table compact head={<tr><th>Driver</th><th className="r">Effect</th><th>Source</th></tr>}>
            {data.bridge.steps.map((s) => <tr key={s.label}><td>{s.label}</td><td className={`r ${s.amount < 0 ? 'neg' : s.amount > 0 ? 'pos' : ''}`}>{inr(s.amount, { sign: true })}</td><td className="small faint">{s.source}</td></tr>)}
            <tr className="total"><td>Reconciles</td><td className="r">{data.bridge.reconciles ? '✓' : '✗'}</td><td></td></tr>
          </Table>
        </div>
      )}
    </Panel>
  );
}

function ProjectionChart({ base, scen }: { base: Projection; scen?: Projection }) {
  const data = base.points.map((p, i) => ({ label: p.label, revenue: p.revenue, cash: p.cash, netIncome: p.netIncome, sRevenue: scen?.points[i]?.revenue, sCash: scen?.points[i]?.cash, sNet: scen?.points[i]?.netIncome }));
  return (
    <LinesChart data={data} format={(v) => inr(v, { compact: true })} yWidth={70} height={280} series={[
      { key: 'revenue', name: 'Revenue (forecast)', color: '#4e91ff', dashed: true },
      { key: 'netIncome', name: 'Net income (forecast)', color: '#22d6b0', dashed: true },
      { key: 'cash', name: 'Cash (forecast)', color: '#f5b94c', dashed: true },
      ...(scen ? [{ key: 'sRevenue', name: 'Revenue (scenario)', color: '#9b7bff' }, { key: 'sNet', name: 'Net income (scenario)', color: '#c7b5ff' }, { key: 'sCash', name: 'Cash (scenario)', color: '#e85c67' }] : []),
    ]} />
  );
}

function Forecast() {
  const { worldId, companyId } = useWorld();
  const [months, setMonths] = useState<'3' | '6' | '12'>('6');
  const { data, loading } = useWorldQuery<Projection>(`/api/worlds/${worldId}/companies/${companyId}/forecast?months=${months}`, [months]);
  return (
    <Panel title="Engine forecast" sub="The real simulation engine run forward on a copy of your world, with no random shocks." actions={<><Seg label="Horizon" value={months} onChange={setMonths} options={[{ id: '3', label: '3M' }, { id: '6', label: '6M' }, { id: '12', label: '12M' }]} /><DataTypeBadge type="forecast" /></>}>
      {loading || !data ? <Loading label="Projecting…" /> : (
        <div className="stack">
          <ProjectionChart base={data} />
          <Callout tone="info" title="Assumptions">
            <ul style={{ margin: 0, paddingLeft: 18 }}>{data.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          </Callout>
          <Table compact head={<tr><th>Month</th><th className="r">Revenue</th><th className="r">Gross profit</th><th className="r">Net income</th><th className="r">Cash</th><th className="r">Units</th></tr>}>
            {data.points.map((p) => <tr key={p.tick}><td>{p.label}</td><td className="r">{inr(p.revenue, { compact: true })}</td><td className="r">{inr(p.grossProfit, { compact: true })}</td><td className="r">{inr(p.netIncome, { compact: true })}</td><td className="r">{inr(p.cash, { compact: true })}</td><td className="r">{num(p.unitsSold)}</td></tr>)}
          </Table>
          <p className="small faint">This is not a prediction. Uncertainty grows with horizon: events, delays and competitor launches are excluded by design.</p>
        </div>
      )}
    </Panel>
  );
}

function Scenario() {
  const { worldId, companyId } = useWorld();
  const [ch, setCh] = useState({ priceChangePct: 0, marketingExtra: 0, productionChangePct: 0, demandShockPct: 0, rupeeShockPct: 0, energyShortage: false, tariffCountry: '', tariffAdd: 0.1, port: '' });
  const [months, setMonths] = useState(6);
  const [res, setRes] = useState<{ baseline: Projection; scenario: Projection } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const changes: Record<string, unknown> = {};
      if (ch.priceChangePct) changes.priceChangePct = ch.priceChangePct;
      if (ch.marketingExtra) changes.marketingExtra = ch.marketingExtra;
      if (ch.productionChangePct) changes.productionChangePct = ch.productionChangePct;
      if (ch.demandShockPct) changes.demandShockPct = ch.demandShockPct;
      if (ch.rupeeShockPct) changes.rupeeShockPct = ch.rupeeShockPct;
      if (ch.energyShortage) changes.energyShortage = true;
      if (ch.tariffCountry) changes.tariffShock = { country: ch.tariffCountry, add: ch.tariffAdd };
      if (ch.port) changes.portStrikeRoute = ch.port;
      setRes(await api.post(`/api/worlds/${worldId}/companies/${companyId}/scenario`, { months, changes }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sum = (p: Projection, k: 'revenue' | 'netIncome') => p.points.reduce((a, x) => a + x[k], 0);
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(260px, 340px) 1fr' }}>
      <Panel title="Scenario assumptions" sub="Hypothetical — the live world is never changed.">
        <div className="stack">
          <Field label={`Price change: ${ch.priceChangePct}%`} htmlFor="s1"><input id="s1" type="range" min={-30} max={30} value={ch.priceChangePct} onChange={(e) => setCh({ ...ch, priceChangePct: Number(e.target.value) })} /></Field>
          <Field label={`Production plan change: ${ch.productionChangePct}%`} htmlFor="s2"><input id="s2" type="range" min={-50} max={50} value={ch.productionChangePct} onChange={(e) => setCh({ ...ch, productionChangePct: Number(e.target.value) })} /></Field>
          <Field label={`Category demand shock: ${ch.demandShockPct}%`} htmlFor="s3"><input id="s3" type="range" min={-40} max={40} value={ch.demandShockPct} onChange={(e) => setCh({ ...ch, demandShockPct: Number(e.target.value) })} /></Field>
          <Field label={`Rupee move: ${ch.rupeeShockPct}%`} htmlFor="s4" hint="Negative = rupee weakens"><input id="s4" type="range" min={-20} max={20} value={ch.rupeeShockPct} onChange={(e) => setCh({ ...ch, rupeeShockPct: Number(e.target.value) })} /></Field>
          <Field label="Extra digital marketing / month" htmlFor="s5"><MoneyInput id="s5" value={ch.marketingExtra} onChange={(v) => setCh({ ...ch, marketingExtra: v })} step={100000} /></Field>
          <Field label="Import duty shock" htmlFor="s6">
            <div className="row"><select id="s6" className="input" style={{ flex: 1 }} value={ch.tariffCountry} onChange={(e) => setCh({ ...ch, tariffCountry: e.target.value })}><option value="">None</option>{['CN', 'VN', 'US', 'DE', 'AE'].map((x) => <option key={x}>{x}</option>)}</select>{ch.tariffCountry && <input className="input" style={{ width: 80 }} type="number" step={0.05} min={-0.3} max={0.5} value={ch.tariffAdd} aria-label="Duty change (fraction)" onChange={(e) => setCh({ ...ch, tariffAdd: Number(e.target.value) })} />}</div>
          </Field>
          <Field label="Port strike" htmlFor="s7"><select id="s7" className="input" value={ch.port} onChange={(e) => setCh({ ...ch, port: e.target.value })}><option value="">None</option>{['CN-CHE', 'VN-CHE', 'DE-MUM', 'US-MUM', 'AE-MUM'].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <label className="check"><input type="checkbox" checked={ch.energyShortage} onChange={(e) => setCh({ ...ch, energyShortage: e.target.checked })} /> Grid power shortage (2 months)</label>
          <Field label="Horizon (months)" htmlFor="s8"><input id="s8" className="input" type="number" min={1} max={12} value={months} onChange={(e) => setMonths(Math.min(12, Math.max(1, Number(e.target.value))))} /></Field>
          <Button variant="primary" loading={busy} onClick={run}>Run scenario vs baseline</Button>
          {err && <Callout tone="bad">{err}</Callout>}
        </div>
      </Panel>
      <Panel title="Scenario comparison" actions={<><DataTypeBadge type="forecast" label="Baseline forecast" /><DataTypeBadge type="scenario" /></>}>
        {!res ? <Empty title="Set assumptions and run">Both runs use the same engine, the same starting state and no random shocks, so the difference is attributable to your assumptions.</Empty> : (
          <div className="stack">
            <ProjectionChart base={res.baseline} scen={res.scenario} />
            <div className="grid g3">
              <div className="stat"><span className="l">Revenue Δ over horizon</span><span className={`v num ${sum(res.scenario, 'revenue') >= sum(res.baseline, 'revenue') ? 'pos' : 'neg'}`}>{inr(sum(res.scenario, 'revenue') - sum(res.baseline, 'revenue'), { sign: true, compact: true })}</span></div>
              <div className="stat"><span className="l">Net income Δ</span><span className={`v num ${sum(res.scenario, 'netIncome') >= sum(res.baseline, 'netIncome') ? 'pos' : 'neg'}`}>{inr(sum(res.scenario, 'netIncome') - sum(res.baseline, 'netIncome'), { sign: true, compact: true })}</span></div>
              <div className="stat"><span className="l">Ending cash Δ</span><span className="v num">{inr((res.scenario.points.at(-1)?.cash ?? 0) - (res.baseline.points.at(-1)?.cash ?? 0), { sign: true, compact: true })}</span></div>
            </div>
            <Callout tone="info" title="Scenario assumptions"><ul style={{ margin: 0, paddingLeft: 18 }}>{res.scenario.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></Callout>
            <Badge tone="purple">Scenario · not the live world</Badge>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Guide() {
  return (
    <div className="grid g2">
      <Panel title="The monthly loop">
        <ol className="small" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.8 }}>
          <li>Review the overview: status, risks and the next action.</li>
          <li>Buy materials (Supply chain). Domestic suppliers deliver this month; imports take 1–2 months.</li>
          <li>Plan production (Manufacturing). Plans above the feasible maximum are rejected.</li>
          <li>Set prices and campaigns (Marketing), hire and train (Workforce), fund R&D.</li>
          <li>Run next month: review the preflight summary and confirm.</li>
          <li>Inspect results and exceptions; respond to new events.</li>
        </ol>
      </Panel>
      <Panel title="Order of processing within a month">
        <p className="small">Facilities complete → hiring & attrition → payroll → facility costs & depreciation → deliveries → production → marketing → market clearing (all companies and competitors) → sales posting → R&D → compliance & storage → collections → payables → debt service → deposits → idle-capacity cost → tax → overdraft sweep → covenants → lifecycle. Then competitors react, the economy moves one month and new simulated events are generated.</p>
      </Panel>
      <Panel title="Accounting rules">
        <ul className="small" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
          <li>Double-entry ledger in integer paise; every entry must balance and cannot be posted twice.</li>
          <li>Cash can never be negative. Mandatory payments may draw the overdraft; discretionary spending cannot.</li>
          <li>Absorption costing: materials, production labor, energy, factory overhead and depreciation flow into finished goods; unused capacity is expensed as idle-capacity cost.</li>
          <li>Statements are derived from the ledger; sub-ledgers (inventory, AP, AR, loans, PP&E) reconcile to the GL after every action.</li>
          <li>Corrections are reversals; history is never deleted.</li>
        </ul>
      </Panel>
      <Panel title="Data labels">
        <div className="stack small">
          <div className="row"><DataTypeBadge type="actual" /> Recorded from posted transactions.</div>
          <div className="row"><DataTypeBadge type="forecast" /> Engine projection with stated assumptions.</div>
          <div className="row"><DataTypeBadge type="estimate" /> Calculated with a stated method from incomplete information.</div>
          <div className="row"><DataTypeBadge type="scenario" /> Hypothetical what-if conditions.</div>
          <div className="row"><DataTypeBadge type="simulated" /> Generated by the simulation, not real-world data.</div>
        </div>
        <p className="small faint mt">Determinism: the same seed and the same ordered decisions reproduce the same world. Settings → Verify replay checks this for your world.</p>
      </Panel>
      <Panel title="Glossary">
        <dl className="kv small">
          <dt>Runway</dt><dd>Cash ÷ average net burn (3 months)</dd>
          <dt>Landed cost</dt><dd>Goods + duty + freight</dd>
          <dt>Fill rate</dt><dd>Sold ÷ demanded</dd>
          <dt>Stage gate</dt><dd>Review between R&D stages</dd>
          <dt>Covenant</dt><dd>Lender's minimum cash rule</dd>
        </dl>
      </Panel>
      <Panel title="Scope">
        <p className="small">Initial scope: India as the home market with China, Vietnam, the UAE, Germany and the United States as trade partners; three industries; single-player companies sharing a world with simulated competitors. Multiplayer negotiation, acquisitions and AI advisers are out of scope for this release.</p>
      </Panel>
    </div>
  );
}
