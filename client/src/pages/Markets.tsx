/** Markets & competitors (plan §9): share bars, competitor comparison, price/quality positioning and an explained share model. */
import { useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useWorld } from '../store';
import { inr, num, pct } from '../format';
import { PageHeader } from '../components/Shell';
import { BarsChart } from '../components/Charts';
import { Badge, Callout, DataTypeBadge, Empty, Panel, Table } from '../components/ui';

export default function Markets() {
  const { view, catalog } = useWorld();
  const c = view!.company!;
  const w = view!.world;
  const segs = c.computed.segments;
  const [segId, setSegId] = useState(segs[0]?.segmentId ?? '');
  const seg = segs.find((s) => s.segmentId === segId);
  if (!catalog) return null;
  const def = catalog.segments[segId];
  const competitors = w.competitors.filter((x) => x.offers.some((o) => segs.some((s) => s.segmentId === o.segmentId)));
  return (
    <>
      <PageHeader title="Markets & competitors" module="markets" />
      <div className="row mb">
        {segs.map((s) => (
          <button key={s.segmentId} className="btn" aria-pressed={segId === s.segmentId} style={segId === s.segmentId ? { borderColor: 'var(--teal)' } : undefined} onClick={() => setSegId(s.segmentId)}>
            {s.name}
          </button>
        ))}
      </div>
      {!seg || !def ? <Empty title="No segments" /> : (
        <>
          <div className="grid g2">
            <Panel title={`Market share · ${seg.name} (India, last month)`} actions={<DataTypeBadge type="actual" />}>
              {seg.offers.every((o) => o.sold === 0) ? <Empty title="No sales recorded yet in this segment" /> : (
                <BarsChart layout="vertical" height={Math.max(180, seg.offers.length * 40)} data={[...seg.offers].sort((a, b) => b.share - a.share).map((o) => ({ label: `${o.name}${o.mine ? ' (you)' : ''}`, share: +(o.share * 100).toFixed(1), __color: o.mine ? '#22d6b0' : '#4e91ff' }))} bars={[{ key: 'share', name: 'Share %' }]} format={(v) => `${v}%`} />
              )}
            </Panel>
            <Panel title="Price vs quality positioning" sub="Bubble size = units sold last month.">
              <div style={{ width: '100%', height: 260 }} role="img" aria-label="Scatter of price against quality for each offer">
                <ResponsiveContainer>
                  <ScatterChart margin={{ top: 10, right: 12, bottom: 10, left: 0 }}>
                    <CartesianGrid stroke="rgba(127,151,176,0.18)" />
                    <XAxis type="number" dataKey="quality" name="Quality" domain={['dataMin - 5', 'dataMax + 5']} stroke="#7f97b0" fontSize={11} />
                    <YAxis type="number" dataKey="price" name="Price" stroke="#7f97b0" fontSize={11} width={70} tickFormatter={(v) => inr(v, { compact: true })} />
                    <ZAxis type="number" dataKey="sold" range={[60, 600]} />
                    <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12 }} formatter={(v: any, n: any) => [n === 'Price' ? inr(Number(v)) : num(Number(v)), n]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Scatter name="Your products" data={seg.offers.filter((o) => o.mine)} fill="#22d6b0" />
                    <Scatter name="Competitors" data={seg.offers.filter((o) => !o.mine)} fill="#4e91ff" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>
          <Panel className="mt" title="How share is decided" sub="Multinomial logit over all offers in the segment. Higher utility → larger share; then capped by stock or capacity.">
            <Callout tone="info">
              Utility = {def.qualityWeight}×(quality − 60)/10 + {def.brandWeight}×(awareness − 50)/30 − 2.5×{def.priceElasticity}×ln(price ÷ {inr(def.referencePrice)}), plus your satisfaction, stock availability, sales coverage and promotions. Category demand scales with GDP growth, consumer confidence, inflation, seasonality and active events.
            </Callout>
            <Table head={<tr><th>Offer</th><th>Owner</th><th className="r">Price</th><th className="r">Quality</th><th className="r">Awareness</th><th className="r">Base utility</th><th className="r">Sold</th><th className="r">Share</th></tr>}>
              {[...seg.offers].sort((a, b) => b.utility - a.utility).map((o) => (
                <tr key={`${o.owner}-${o.name}`}>
                  <td>{o.name} {o.mine && <Badge tone="ok">You</Badge>}</td>
                  <td>{o.owner}</td>
                  <td className="r">{inr(o.price)}</td>
                  <td className="r">{o.quality}</td>
                  <td className="r">{o.awareness.toFixed(0)}</td>
                  <td className="r">{o.utility.toFixed(2)}</td>
                  <td className="r">{num(o.sold)}</td>
                  <td className="r">{pct(o.share)}</td>
                </tr>
              ))}
            </Table>
          </Panel>
        </>
      )}
      <Panel className="mt" title="Competitors" actions={<DataTypeBadge type="simulated" label="Simulated agents" />}>
        <div className="cards">
          {competitors.map((x) => (
            <div key={x.id} className="panel" style={{ background: 'var(--panel-2)' }}>
              <div className="row between">
                <b>{x.name}</b>
                <Badge tone={x.posture === 'aggressive' ? 'bad' : x.posture === 'premium' ? 'purple' : 'info'}>{x.posture}</Badge>
              </div>
              <p className="small muted">{catalog.countries[x.country].name} · awareness {x.awareness.toFixed(0)}</p>
              <Table compact head={<tr><th>Offer</th><th className="r">Price</th><th className="r">Q</th><th className="r">Capacity</th></tr>}>
                {x.offers.map((o) => (
                  <tr key={o.name}><td className="small">{o.name}</td><td className="r small">{inr(o.price, { compact: true })}</td><td className="r small">{o.quality}</td><td className="r small">{num(o.capacity)}</td></tr>
                ))}
              </Table>
              <h4 className="small mt">Recent moves</h4>
              {x.recentMoves.length === 0 ? <p className="small faint">None yet.</p> : (
                <ul className="small" style={{ margin: 0, paddingLeft: 16 }}>
                  {x.recentMoves.slice(-4).reverse().map((m, i) => <li key={i}>M{m.tick + 1}: {m.text}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
        <p className="small faint mt">Competitor rules: under 60% utilisation → aggressive cut 4% / balanced 2% (premium holds); sold out → +2% price, +5% capacity; prices drift with inflation; occasional product upgrades (at most one per 6 months each).</p>
      </Panel>
    </>
  );
}
