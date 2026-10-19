/** Investments: capital raised, ownership, valuation (always an ESTIMATE, never cash) and treasury deposits. */
import { Link } from 'react-router-dom';
import { useWorld } from '../store';
import { inr, num, pct } from '../format';
import { PageHeader } from '../components/Shell';
import { Badge, Callout, DataTypeBadge, Empty, Panel, Table } from '../components/ui';

export default function Investments() {
  const { view, base } = useWorld();
  const c = view!.company!;
  const v = c.computed.valuation;
  const total = c.shareholders.reduce((a, s) => a + s.shares, 0);
  const raised = c.shareholders.reduce((a, s) => a + s.invested, 0);
  const rounds = c.transactions.filter((t) => t.kind === 'equity_round');
  const deposits = c.deposits;
  return (
    <>
      <PageHeader title="Investments" module="investments" actions={<><Link className="btn" to={`${base}/transactions?new=deposit_open`}>Open deposit</Link><Link className="btn primary" to={`${base}/transactions?new=equity_round`}>Raise equity</Link></>} />
      <div className="grid g4">
        <Panel><div className="stat"><span className="l">Equity raised</span><span className="v num">{inr(raised, { compact: true })}</span><span className="small faint">Share capital, GL 3000</span></div></Panel>
        <Panel><div className="stat"><span className="l">Pre-money valuation <DataTypeBadge type="estimate" /></span><span className="v num">{inr(v.preMoney, { compact: true })}</span><span className="small faint">Not spendable</span></div></Panel>
        <Panel><div className="stat"><span className="l">Book equity</span><span className="v num">{inr(v.bookEquity, { compact: true })}</span><span className="small faint">Assets − liabilities</span></div></Panel>
        <Panel><div className="stat"><span className="l">Fixed deposits</span><span className="v num">{inr(deposits.filter((d) => d.status === 'active').reduce((a, d) => a + d.principal + d.accrued, 0), { compact: true })}</span><span className="small faint">GL 1050</span></div></Panel>
      </div>
      <div className="grid g2 mt">
        <Panel title="Valuation method" actions={<DataTypeBadge type="estimate" />}>
          <p className="small">{v.method}</p>
          <dl className="kv small mt">
            <dt>Annualized revenue (3-month average × 12)</dt><dd>{inr(v.revenueRunRate, { compact: true })}</dd>
            <dt>Applied multiple</dt><dd>{v.multiple}×</dd>
            <dt>Implied price per share</dt><dd>{inr(Math.round(v.preMoney / total))}</dd>
          </dl>
          <Callout tone="warn">Valuation is an estimate used to price new shares. It never appears in cash and does not change the balance sheet.</Callout>
        </Panel>
        <Panel title="Cap table">
          <Table compact head={<tr><th>Holder</th><th>Type</th><th className="r">Shares</th><th className="r">Ownership</th><th className="r">Invested</th><th>Since</th></tr>}>
            {c.shareholders.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.kind}</td><td className="r">{num(s.shares)}</td><td className="r">{pct(s.shares / total)}</td><td className="r">{inr(s.invested, { compact: true })}</td><td>M{s.acquiredTick + 1}</td></tr>)}
          </Table>
        </Panel>
      </div>
      <div className="grid g2 mt">
        <Panel title="Funding rounds">
          {rounds.length === 0 ? <Empty title="No external rounds yet">Investors price rounds at the estimated pre-money valuation and cap a round at 40% of post-money.</Empty> : (
            <Table compact head={<tr><th>ID</th><th>Investor</th><th className="r">Amount</th><th className="r">Pre-money</th><th className="r">Dilution</th><th>Status</th></tr>}>
              {rounds.map((t) => <tr key={t.id}><td className="mono">{t.id}</td><td>{t.counterparty}</td><td className="r">{inr(Number(t.terms.amount), { compact: true })}</td><td className="r">{inr(Number(t.terms.preMoney), { compact: true })}</td><td className="r">{t.preview.dilutionPct}%</td><td><Badge tone={t.status === 'executed' ? 'ok' : t.status === 'pending_review' ? 'info' : 'neutral'}>{t.status.replace('_', ' ')}</Badge></td></tr>)}
            </Table>
          )}
        </Panel>
        <Panel title="Treasury deposits">
          {deposits.length === 0 ? <Empty title="No deposits">Surplus cash can earn the repo rate minus 0.5% in 3–12 month deposits.</Empty> : (
            <Table compact head={<tr><th>ID</th><th className="r">Principal</th><th className="r">Rate</th><th className="r">Accrued</th><th>Matures</th><th>Status</th><th></th></tr>}>
              {deposits.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.id}</td><td className="r">{inr(d.principal, { compact: true })}</td><td className="r">{(d.rateBps / 100).toFixed(2)}%</td><td className="r">{inr(d.accrued)}</td><td>M{d.maturityTick + 1}</td>
                  <td><Badge tone={d.status === 'active' ? 'ok' : 'neutral'}>{d.status}</Badge></td>
                  <td>{d.status === 'active' && <Link className="btn sm ghost" to={`${base}/transactions?new=deposit_withdraw&deposit=${d.id}`}>Withdraw</Link>}</td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
