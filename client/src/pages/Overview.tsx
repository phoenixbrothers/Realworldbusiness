import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, ArrowRight, Factory, Globe2, Megaphone, Wallet, AlertTriangle, CheckCircle2, EyeOff } from 'lucide-react';
import { useWorld, useWorldQuery } from '../store';
import { inr, pct } from '../format';
import { PageHeader } from '../components/Shell';
import { KpiStrip } from '../components/Kpi';
import { Campus } from '../components/Campus';
import { PerformanceChart } from '../components/Charts';
import type { PerfPoint } from '../components/Charts';
import { EventDetail, exposureTone } from '../components/EventDetail';
import { Badge, DataTypeBadge, Empty, Panel, Seg, SeverityBadge } from '../components/ui';
import { OnboardingTour } from '../components/Tour';
import type { Projection } from '../types';

/** words that fit a pending decision (not a risk) so the banner doesn't call a choice a "risk" */
function actionVerb(id: string): string {
  if (id.startsWith('gate:')) return 'Decision needed';
  if (id === 'tx-pending') return 'Needs review';
  return 'Top risk';
}

export default function Overview() {
  const { view, worldId, companyId, base, act } = useWorld();
  const c = view!.company!;
  const w = view!.world;
  const [range, setRange] = useState<'6' | '12' | 'all'>('12');
  const [show, setShow] = useState({ revenue: true, profit: true, forecast: true });
  const [eventId, setEventId] = useState<string | null>(null);
  const forecast = useWorldQuery<Projection>(companyId ? `/api/worlds/${worldId}/companies/${companyId}/forecast?months=6` : null);
  const alerts = c.computed.alerts.filter((a) => !a.dismissed);
  const dismissed = c.computed.alerts.filter((a) => a.dismissed);
  const perf: PerfPoint[] = useMemo(() => {
    const hist = range === 'all' ? c.history : c.history.slice(-Number(range));
    const pts: PerfPoint[] = hist.map((h) => ({ label: monthLabel(w, h.tick), revenue: h.revenue, profit: h.netIncome }));
    if (forecast.data && pts.length) {
      pts[pts.length - 1].forecastRevenue = pts[pts.length - 1].revenue;
      pts[pts.length - 1].forecastProfit = pts[pts.length - 1].profit;
    }
    for (const p of forecast.data?.points ?? []) pts.push({ label: p.label, forecastRevenue: p.revenue, forecastProfit: p.netIncome });
    return pts;
  }, [c.history, range, forecast.data, w]);
  const events = [...w.events].reverse().slice(0, 6);
  const ev = w.events.find((e) => e.id === eventId);
  const exposureFor = (id: string) => c.computed.exposures.find((x) => x.eventId === id);
  // single source of truth for "what needs attention" — alerts already cover risks AND
  // pending decisions (R&D gates, transaction reviews), so nothing is computed twice here
  const topItem = alerts[0];
  const noPlanYet = c.lines.every((l) => l.plannedUnits === 0);
  const nextAction = topItem ? topItem.title : noPlanYet ? 'Order materials and set a production plan' : 'Review the month ahead and run the next month';
  const nextLink = topItem ? `${topItem.module}${topItem.targetId ? `?focus=${topItem.targetId}` : ''}` : noPlanYet ? 'manufacturing' : 'overview';
  const india = w.economy.countries.IN;
  return (
    <>
      <PageHeader title="World overview" module="overview" />
      <OnboardingTour />
      <section className="panel mb" aria-label="Company status summary" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="row">
          {c.lifecycle === 'operating' ? <CheckCircle2 aria-hidden className="pos" /> : <AlertTriangle aria-hidden className="neg" />}
          <span>
            <b>{c.name}</b> is <b>{c.lifecycle}</b> with {inr(c.computed.cash, { compact: true })} cash
            {c.computed.runway.meaningful ? ` and ${c.computed.runway.months} months of runway` : ''}.
          </span>
        </div>
        <span className="small muted">{topItem ? actionVerb(topItem.id) : 'Status'}: {topItem ? <Link to={`${base}/${topItem.module}`}>{topItem.title}</Link> : 'nothing flagged'}</span>
        <Link to={`${base}/${nextLink}`} className="btn sm primary wrap" style={{ marginLeft: 'auto' }} data-tour="next-action">
          Next: {nextAction} <ArrowRight aria-hidden />
        </Link>
      </section>
      <div data-tour="kpi-strip">
        <KpiStrip keys={['cash', 'revenue', 'gross_margin', 'runway']} />
      </div>
      <div className="grid g-main mt">
        <div data-tour="campus">
          <Campus />
        </div>
        <div className="stack" data-tour="actions-panel">
          <Panel title="What should I do next?" sub="Every item here is generated from your company's actual state — nothing is shown just to fill space." actions={<span className="small faint">{alerts.length} open</span>}>
            {alerts.length === 0 ? (
              <p className="small muted">Nothing needs your attention right now. Checks run on stock cover, cash runway, overdue payments, loan covenants, compliance dates, line condition, staff morale, pending R&D gates, pending transactions and event exposure.</p>
            ) : (
              <div className="list" style={{ maxHeight: 420, overflowY: 'auto' }}>
                {alerts.slice(0, 8).map((a) => (
                  <div key={a.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                    <span className={`sev-icon sev-${a.severity}`} aria-hidden>
                      <AlertTriangle />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <SeverityBadge severity={a.severity} />
                        <b>{a.title}</b>
                      </div>
                      <div className="small muted mt" style={{ marginTop: 2 }}>{a.reason}</div>
                      <div className="small faint">Why it matters: {a.impact} · Owner: {a.owner}</div>
                      <div className="row mt" style={{ marginTop: 6 }}>
                        <Link to={`${base}/${a.module}${a.targetId ? `?focus=${a.targetId}` : ''}`} className="btn sm primary">
                          Review
                        </Link>
                        <button className="btn ghost icon sm" aria-label={`Dismiss: ${a.title}`} title="Dismiss from this list (still tracked in its module)" onClick={() => act('dismiss_alert', { alertId: a.id }, { quiet: true })}>
                          <EyeOff aria-hidden />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {dismissed.length > 0 && <p className="small faint mt">{dismissed.length} item(s) dismissed from this list — still visible in their own module.</p>}
          </Panel>
          <Panel title="Global economy" sub="Simulated macro indicators for the world's reference market." actions={<DataTypeBadge type="simulated" />}>
            <dl className="kv small">
              <dt>India GDP growth</dt><dd>{india.gdpGrowth.toFixed(1)}%</dd>
              <dt>Inflation (CPI)</dt><dd>{india.inflation.toFixed(1)}%</dd>
              <dt>RBI repo rate</dt><dd>{india.policyRate.toFixed(2)}%</dd>
              <dt>Consumer confidence</dt><dd>{india.consumerConfidence.toFixed(0)}</dd>
              <dt>Active world events</dt><dd>{w.events.filter((e) => e.status === 'active').length}</dd>
            </dl>
            <Link to={`${base}/countries`} className="btn sm mt" style={{ width: '100%' }}>
              <Globe2 aria-hidden /> View global map
            </Link>
          </Panel>
        </div>
      </div>
      <Panel
        className="mt"
        title="Financial performance"
        sub="Revenue and net income from your closed months, plus a forecast of the months ahead under your current plan."
        actions={
          <>
            <Seg label="Time range" value={range} onChange={setRange} options={[{ id: '6', label: '6M' }, { id: '12', label: '12M' }, { id: 'all', label: 'All' }]} />
            <DataTypeBadge type="actual" />
            <DataTypeBadge type="forecast" label="Forecast (6M)" />
          </>
        }
      >
        <div className="row mb small">
          {(['revenue', 'profit', 'forecast'] as const).map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={show[k]} onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))} />
              {k === 'profit' ? 'Net income' : k[0].toUpperCase() + k.slice(1)}
            </label>
          ))}
        </div>
        {c.history.length === 0 ? (
          <Empty title="No closed months yet">Run your first month to see actuals. The dashed line shows the engine forecast under current plans.</Empty>
        ) : (
          <PerformanceChart data={perf} show={show} />
        )}
        {forecast.data && <p className="small faint mt">Forecast assumptions: {forecast.data.assumptions.slice(0, 2).join(' ')}</p>}
      </Panel>
      <div className="grid g2 mt">
        <Panel title="Recent events" actions={<Link to={`${base}/events`}>View all</Link>}>
          {events.length === 0 ? (
            <p className="small muted">No world events yet. Events appear after each month is run.</p>
          ) : (
            <div className="list">
              {events.map((e) => {
                const ex = exposureFor(e.id);
                return (
                  <button key={e.id} className="list-item" onClick={() => setEventId(e.id)}>
                    <span className={`sev-icon ${e.sentiment === 'opportunity' ? 'sev-opportunity' : `sev-${e.severity}`}`} aria-hidden>
                      <AlertTriangle />
                    </span>
                    <span style={{ flex: 1 }}>
                      <b className="small" style={{ display: 'block' }}>{e.title}</b>
                      <span className="small muted">{e.tickLabel} · {e.status === 'active' ? 'active' : 'expired'}</span>
                    </span>
                    {ex && <Badge tone={exposureTone(ex.level)}>exposure: {ex.level}</Badge>}
                  </button>
                );
              })}
            </div>
          )}
        </Panel>
        <Panel title="Company snapshot">
          <dl className="kv">
            <dt>Last month revenue</dt><dd>{inr(c.computed.lastMonth?.revenue ?? null, { compact: true })}</dd>
            <dt>Last month net income</dt><dd className={(c.computed.lastMonth?.netIncome ?? 0) >= 0 ? 'pos' : 'neg'}>{inr(c.computed.lastMonth?.netIncome ?? null, { compact: true })}</dd>
            <dt>Total assets</dt><dd>{inr(c.computed.balanceSheet.totalAssets, { compact: true })}</dd>
            <dt>Liabilities</dt><dd>{inr(c.computed.balanceSheet.totalLiabilities, { compact: true })}</dd>
            <dt>Inventory (raw + finished)</dt><dd>{inr(c.computed.rawValue + c.computed.finishedValue, { compact: true })}</dd>
            <dt>Brand awareness</dt><dd>{c.brandAwareness.toFixed(1)} / 100</dd>
            <dt>Customer satisfaction</dt><dd>{c.satisfaction.toFixed(0)} / 100</dd>
            <dt>Market share (India)</dt><dd>{pct(c.history.at(-1)?.marketShare ?? null)}</dd>
            <dt>Valuation</dt><dd>{inr(c.computed.valuation.preMoney, { compact: true })} <DataTypeBadge type="estimate" /></dd>
          </dl>
        </Panel>
      </div>
      <nav className="quick mt" aria-label="Quick actions">
        <Link to={`${base}/rnd`}><Box aria-hidden style={{ color: '#22d6b0' }} /><span>Develop product<small>Start an R&D project</small></span></Link>
        <Link to={`${base}/manufacturing`}><Factory aria-hidden style={{ color: '#4e91ff' }} /><span>Adjust production<small>Plan lines and capacity</small></span></Link>
        <Link to={`${base}/marketing`}><Megaphone aria-hidden style={{ color: '#9b7bff' }} /><span>Run marketing<small>Campaigns and pricing</small></span></Link>
        <Link to={`${base}/finance`}><Wallet aria-hidden style={{ color: '#f5b94c' }} /><span>Manage finances<small>Statements, debt, funding</small></span></Link>
        <Link to={`${base}/markets`}><Globe2 aria-hidden style={{ color: '#22d6b0' }} /><span>Explore markets<small>Competitors and demand</small></span></Link>
      </nav>
      {ev && <EventDetail event={ev} exposure={exposureFor(ev.id)} onClose={() => setEventId(null)} />}
      {c.lines.every((l) => l.plannedUnits === 0) && c.lifecycle === 'operating' && (
        <div className="callout info mt">
          <Factory aria-hidden style={{ color: 'var(--blue)' }} />
          <div className="small">
            <b>Getting started:</b> your lines have no production plan. Order materials in <Link to={`${base}/supply-chain`}>Supply chain</Link> (domestic suppliers deliver this month), then plan output in <Link to={`${base}/manufacturing`}>Manufacturing</Link>, then run the month.
          </div>
        </div>
      )}
    </>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthLabel(w: { startMonth: number; startYear: number }, tick: number) {
  const m = w.startMonth + tick;
  return `${MONTHS[m % 12]} ${String((w.startYear + Math.floor(m / 12)) % 100).padStart(2, '0')}`;
}
