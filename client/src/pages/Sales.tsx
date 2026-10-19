import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWorld } from '../store';
import { inr, num, pct } from '../format';
import { PageHeader } from '../components/Shell';
import { KpiStrip } from '../components/Kpi';
import { BarsChart } from '../components/Charts';
import { Badge, DataTypeBadge, Empty, Panel, Seg, Table } from '../components/ui';

export default function Sales() {
  const { view, catalog, base } = useWorld();
  const c = view!.company!;
  const [market, setMarket] = useState<'all' | 'IN' | 'export'>('all');
  const rows = useMemo(() => c.sales.filter((s) => market === 'all' || (market === 'IN' ? s.market === 'IN' : s.market !== 'IN')), [c.sales, market]);
  const byMonth = useMemo(() => {
    const ticks = [...new Set(rows.map((r) => r.tick))].slice(-12);
    return ticks.map((t) => {
      const rs = rows.filter((r) => r.tick === t);
      return { label: `M${t + 1}`, sold: rs.reduce((a, r) => a + r.sold, 0), lost: rs.reduce((a, r) => a + r.lostSales, 0) };
    });
  }, [rows]);
  const last = view!.world.tick - 1;
  const lastRows = rows.filter((r) => r.tick === last);
  const openAR = c.receivables.filter((r) => r.status === 'open');
  if (!catalog) return null;
  return (
    <>
      <PageHeader title="Sales & customers" module="sales" />
      <KpiStrip keys={['revenue', 'share', 'gross_margin', 'inventory']} />
      <div className="grid g2 mt">
        <Panel title="Units sold vs lost sales" actions={<><Seg label="Market" value={market} onChange={setMarket} options={[{ id: 'all', label: 'All' }, { id: 'IN', label: 'India' }, { id: 'export', label: 'Export' }]} /><DataTypeBadge type="actual" /></>}>
          {byMonth.length === 0 ? <Empty title="No sales yet">Sales happen when you have finished goods in stock at month end.</Empty> : <BarsChart data={byMonth} bars={[{ key: 'sold', name: 'Sold', color: '#22d6b0' }, { key: 'lost', name: 'Lost (stockout)', color: '#e85c67' }]} stacked format={(v) => num(v)} />}
        </Panel>
        <Panel title="Customers & channels">
          <dl className="kv">
            <dt>Customer satisfaction</dt><dd>{c.satisfaction.toFixed(0)} / 100</dd>
            <dt>Domestic channel mix</dt><dd>40% online (cash, 2% fee) · 60% distributors (net 30)</dd>
            <dt>Export terms</dt><dd>Importers, net 60</dd>
            <dt>Open receivables</dt><dd>{inr(openAR.reduce((a, r) => a + r.amount, 0))} ({openAR.length})</dd>
            <dt>Sales & marketing headcount</dt><dd>{num(c.teams.filter((t) => t.department === 'sales_marketing').reduce((a, t) => a + t.headcount, 0))}</dd>
          </dl>
          <p className="small faint mt">Satisfaction rises with quality and falls with stockouts; it feeds next month's market share. Sales coverage below ~12 effective sales staff reduces domestic share.</p>
        </Panel>
      </div>
      <Panel className="mt" title="Product performance — last closed month" actions={<Link to={`${base}/markets`}>Competitive view →</Link>}>
        {lastRows.length === 0 ? <Empty title="No sales in the last closed month" /> : (
          <Table head={<tr><th>Product</th><th>Market</th><th className="r">Demand</th><th className="r">Sold</th><th className="r">Lost</th><th className="r">Price</th><th className="r">Revenue</th><th className="r">COGS</th><th className="r">Gross margin</th><th className="r">Share</th></tr>}>
            {lastRows.map((r, i) => {
              const p = c.products.find((x) => x.id === r.productId);
              return (
                <tr key={i}>
                  <td>{p?.name}</td>
                  <td>{catalog.countries[r.market].name}</td>
                  <td className="r">{num(r.demand)}</td>
                  <td className="r">{num(r.sold)}</td>
                  <td className={`r ${r.lostSales ? 'neg' : ''}`}>{num(r.lostSales)}</td>
                  <td className="r">{inr(r.price)}</td>
                  <td className="r">{inr(r.revenue, { compact: true })}</td>
                  <td className="r">{inr(r.cogs, { compact: true })}</td>
                  <td className="r">{r.revenue ? pct((r.revenue - r.cogs) / r.revenue) : '—'}</td>
                  <td className="r">{pct(r.share)}</td>
                </tr>
              );
            })}
          </Table>
        )}
        <p className="small faint mt">Gross margin here is revenue minus absorbed product cost; the income statement also includes scrap and idle-capacity cost.</p>
      </Panel>
      <Panel className="mt" title="Products">
        <Table head={<tr><th>Product</th><th>Segment</th><th className="r">Price</th><th className="r">Quality</th><th>Export markets</th><th className="r">Last fill rate</th><th>Status</th></tr>}>
          {c.products.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td className="small">{catalog.segments[p.segmentId].name}</td>
              <td className="r">{inr(p.price)}</td>
              <td className="r">{p.quality}</td>
              <td className="small">{p.exportMarkets.length ? p.exportMarkets.map((m) => catalog.countries[m].name).join(', ') : <Link to={`${base}/trade`}>None — enable in Global Trade</Link>}</td>
              <td className={`r ${p.lastFillRate < 0.9 ? 'neg' : ''}`}>{pct(p.lastFillRate, 0)}</td>
              <td><Badge tone={p.status === 'active' ? 'ok' : 'neutral'}>{p.status}</Badge></td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
