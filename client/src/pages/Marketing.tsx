/** Marketing & branding (plan §8): awareness funnel, campaigns with diminishing returns, pricing with elasticity. */
import { useState } from 'react';
import { useWorld } from '../store';
import { inr, num, pct, toPaise } from '../format';
import { PageHeader } from '../components/Shell';
import { BarsChart, LinesChart } from '../components/Charts';
import { Badge, Button, Callout, Confirm, DataTypeBadge, Empty, Field, Modal, MoneyInput, Panel, Table } from '../components/ui';

export default function Marketing() {
  const { view, catalog, act, canAct } = useWorld();
  const c = view!.company!;
  const w = view!.world;
  const [open, setOpen] = useState(false);
  const [cancel, setCancel] = useState<string | null>(null);
  const [form, setForm] = useState({ name: 'Brand awareness push', channel: 'digital' as 'digital' | 'tv' | 'retail_promo' | 'trade_show', productId: '' as string, monthlyBudget: 10_00_000 * 100, months: 3 });
  const [prices, setPrices] = useState<Record<string, string>>(Object.fromEntries(c.products.map((p) => [p.id, String(p.price / 100)])));
  if (!catalog) return null;
  const ch = catalog.channels[form.channel];
  const response = c.computed.awarenessResponse[form.channel] ?? [];
  const active = c.campaigns.filter((x) => x.status === 'active' || x.status === 'scheduled');
  const awarenessTrend = c.history.map((h) => ({ label: `M${h.tick + 1}`, awareness: h.awareness, satisfaction: h.satisfaction }));
  const lastIndia = (pid: string) => c.sales.filter((s) => s.productId === pid && s.market === 'IN').at(-1);
  return (
    <>
      <PageHeader title="Marketing & branding" module="marketing" actions={<Button variant="primary" onClick={() => setOpen(true)} disabled={!canAct}>New campaign</Button>} />
      <div className="grid g-main">
        <Panel title="Customer funnel (India)" sub="Awareness drives consideration; quality, price and availability decide purchase." actions={<DataTypeBadge type="actual" />}>
          {c.products.map((p) => {
            const s = lastIndia(p.id);
            const seg = catalog.segments[p.segmentId];
            const total = s && s.share > 0 ? Math.round(s.sold / s.share) : null;
            const stages = [
              { label: 'Category buyers (last month)', value: total },
              { label: `Aware of ${c.brand} (${c.brandAwareness.toFixed(0)}%)`, value: total !== null ? Math.round(total * (c.brandAwareness / 100)) : null },
              { label: 'Demanded your product', value: s?.demand ?? null },
              { label: 'Purchased (stock-limited)', value: s?.sold ?? null },
            ];
            const max = stages[0].value || 1;
            return (
              <div key={p.id} className="mb">
                <div className="row between"><b className="small">{p.name}</b><span className="small faint">{seg.name}</span></div>
                {stages.map((st) => (
                  <div key={st.label} className="row small" style={{ marginTop: 4 }}>
                    <span style={{ width: 210 }}>{st.label}</span>
                    <div className="meter blue" style={{ flex: 1 }}><i style={{ width: `${st.value !== null ? Math.max(2, (st.value / max) * 100) : 0}%` }} /></div>
                    <span className="num" style={{ width: 90, textAlign: 'right' }}>{num(st.value)}</span>
                  </div>
                ))}
              </div>
            );
          })}
          {c.history.length === 0 && <p className="small muted">The funnel fills after the first month of sales.</p>}
        </Panel>
        <Panel title="Brand health">
          <div className="grid g2">
            <div className="stat"><span className="l">Awareness</span><span className="v num">{c.brandAwareness.toFixed(1)}</span><span className="small faint">Decays 3%/month</span></div>
            <div className="stat"><span className="l">Satisfaction</span><span className="v num">{c.satisfaction.toFixed(0)}</span><span className="small faint">Quality & stockouts</span></div>
          </div>
          {awarenessTrend.length > 1 && <LinesChart data={awarenessTrend} series={[{ key: 'awareness', name: 'Awareness' }, { key: 'satisfaction', name: 'Satisfaction' }]} height={170} />}
        </Panel>
      </div>
      <Panel className="mt" title="Campaigns" actions={<span className="small faint">Budget {inr(c.budget.marketing)}/mo · committed {inr(active.reduce((a, x) => a + x.monthlyBudget, 0))}/mo</span>}>
        {c.campaigns.length === 0 ? <Empty title="No campaigns yet" action={<Button onClick={() => setOpen(true)} disabled={!canAct}>Plan a campaign</Button>}>Spending is expensed monthly to GL 6100 and is skipped if cash is short.</Empty> : (
          <Table head={<tr><th>Campaign</th><th>Channel</th><th>Promotes</th><th>Period</th><th className="r">Monthly</th><th className="r">Spent</th><th className="r">Awareness added</th><th>Status</th><th></th></tr>}>
            {[...c.campaigns].reverse().map((x) => (
              <tr key={x.id}>
                <td>{x.name}</td>
                <td>{catalog.channels[x.channel].label}</td>
                <td className="small">{c.products.find((p) => p.id === x.productId)?.name ?? 'Brand'}</td>
                <td className="small">M{x.startTick + 1}–M{x.endTick + 1}</td>
                <td className="r">{inr(x.monthlyBudget, { compact: true })}</td>
                <td className="r">{inr(x.spent, { compact: true })}</td>
                <td className="r">{x.reach.toFixed(1)} pts</td>
                <td><Badge tone={x.status === 'active' ? 'ok' : x.status === 'scheduled' ? 'info' : 'neutral'}>{x.status}</Badge></td>
                <td>{(x.status === 'active' || x.status === 'scheduled') && <Button size="sm" variant="ghost" disabled={!canAct} onClick={() => setCancel(x.id)}>Cancel</Button>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <Panel className="mt" title="Pricing" sub="Price changes apply from the next month. Demand responds through segment price elasticity; see Markets for the share model.">
        <Table head={<tr><th>Product</th><th>Segment</th><th className="r">Reference</th><th style={{ width: 170 }}>Price (₹)</th><th className="r">vs reference</th><th className="r">Quality</th><th className="r">Last share</th><th></th></tr>}>
          {c.products.map((p) => {
            const seg = catalog.segments[p.segmentId];
            const draft = toPaise(prices[p.id] ?? 0);
            return (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="small">{seg.name}<div className="faint">elasticity {seg.priceElasticity}</div></td>
                <td className="r">{inr(seg.referencePrice)}</td>
                <td><input className="input num" type="number" min={1} step={seg.referencePrice > 100000 ? 100 : 1} aria-label={`Price for ${p.name}`} value={prices[p.id] ?? ''} onChange={(e) => setPrices((x) => ({ ...x, [p.id]: e.target.value }))} disabled={!canAct} /></td>
                <td className={`r ${draft > seg.referencePrice ? 'warn' : 'pos'}`}>{pct(draft / seg.referencePrice - 1, 1)}</td>
                <td className="r">{p.quality}</td>
                <td className="r">{pct(lastIndia(p.id)?.share ?? null)}</td>
                <td><Button size="sm" disabled={!canAct || draft === p.price} onClick={() => act('set_price', { productId: p.id, price: draft })}>Update</Button></td>
              </tr>
            );
          })}
        </Table>
      </Panel>
      <Modal open={open} onClose={() => setOpen(false)} title="Plan a campaign" wide footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={async () => { if (await act('create_campaign', { ...form, productId: form.productId || null })) setOpen(false); }}>Schedule campaign</Button></>}>
        <div className="grid g2">
          <div className="stack">
            <Field label="Name" htmlFor="cpn"><input id="cpn" className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={60} /></Field>
            <Field label="Channel" htmlFor="cpch" hint={ch.note}>
              <select id="cpch" className="input" value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value as typeof f.channel }))}>
                {Object.entries(catalog.channels).map(([k, v]) => <option key={k} value={k}>{v.label} (min {inr(v.minBudget, { compact: true })}/mo)</option>)}
              </select>
            </Field>
            <Field label="Promoted product (optional)" htmlFor="cpp">
              <select id="cpp" className="input" value={form.productId} onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}>
                <option value="">Whole brand</option>
                {c.products.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <div className="grid g2">
              <Field label="Monthly budget" htmlFor="cpb"><MoneyInput id="cpb" value={form.monthlyBudget} onChange={(v) => setForm((f) => ({ ...f, monthlyBudget: v }))} step={50000} /></Field>
              <Field label="Months (1–12)" htmlFor="cpm"><input id="cpm" className="input" type="number" min={1} max={12} value={form.months} onChange={(e) => setForm((f) => ({ ...f, months: Number(e.target.value) }))} /></Field>
            </div>
            <Callout tone="info">Total commitment {inr(form.monthlyBudget * form.months)} starting {w.label}. Spend is skipped in any month without enough cash.</Callout>
          </div>
          <div>
            <h3>Diminishing returns <DataTypeBadge type="estimate" /></h3>
            <p className="small muted mb">Awareness points added per month at different budgets for this channel, before decay.</p>
            <BarsChart data={response.map((r) => ({ label: inr(r.spend, { compact: true }), gain: r.gain }))} bars={[{ key: 'gain', name: 'Awareness points / month' }]} height={200} format={(v) => v.toFixed(1)} />
          </div>
        </div>
      </Modal>
      <Confirm open={!!cancel} onClose={() => setCancel(null)} title="Cancel campaign?" confirmLabel="Cancel campaign" danger onConfirm={async () => { await act('cancel_campaign', { campaignId: cancel }); setCancel(null); }}>
        <p>No further spend. Awareness already built decays normally.</p>
      </Confirm>
    </>
  );
}
