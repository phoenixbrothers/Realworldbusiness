/**
 * Supply chain (plan §7): network schematic, supplier cards with cost /
 * capacity / quality / reliability / lead time / currency / terms, purchase
 * orders with live landed-cost quotes, and disruption detail with mitigation
 * trade-offs (alternative sourcing is never instant or free).
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plane, X } from 'lucide-react';
import { api } from '../api';
import { useWorld } from '../store';
import { inr, num, pct } from '../format';
import { PageHeader } from '../components/Shell';
import { EventDetail, exposureTone } from '../components/EventDetail';
import { Badge, Button, Callout, Confirm, DataTypeBadge, Empty, Field, Loading, Panel, Seg, Table, Tabs } from '../components/ui';
import type { LandedQuote } from '../../../engine/world';

export default function SupplyChain() {
  const { view, catalog } = useWorld();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'network' | 'suppliers' | 'orders'>(params.get('focus')?.startsWith('PO') ? 'orders' : 'network');
  if (!catalog || !view?.company) return <Loading />;
  return (
    <>
      <PageHeader title="Supply chain network" module="supply-chain" />
      <Tabs label="Supply chain sections" value={tab} onChange={setTab} tabs={[{ id: 'network', label: 'Network & disruptions' }, { id: 'suppliers', label: 'Suppliers' }, { id: 'orders', label: 'Purchase orders' }]} />
      {tab === 'network' && <Network />}
      {tab === 'suppliers' && <Suppliers />}
      {tab === 'orders' && <Orders />}
    </>
  );
}

function Network() {
  const { view, catalog } = useWorld();
  const c = view!.company!;
  const w = view!.world;
  const [evId, setEvId] = useState<string | null>(null);
  const used = new Set([...c.purchaseOrders.filter((p) => p.orderedTick >= w.tick - 6).map((p) => p.supplierId)]);
  const qualified = c.qualifiedSuppliers.map((q) => q.supplierId);
  const suppliers = [...new Set([...used, ...qualified])].map((id) => catalog!.suppliers[id]).filter(Boolean);
  const routeRisk = Object.fromEntries(w.routeStatus.map((r) => [r.routeId, r]));
  const supplyExposures = c.computed.exposures.filter((x) => x.level !== 'none' && x.items.some((i) => i.type === 'purchase_order' || i.type === 'supplier' || i.type === 'material'));
  // schematic coordinates
  const cols = { supplier: 70, port: 330, warehouse: 560, factory: 760, customer: 940 };
  const routes = [...new Set(suppliers.map((s) => s.routeId))];
  return (
    <div className="stack">
      <Panel title="Network schematic" sub="Suppliers → routes/ports → warehouse → factory → customers. Line colour shows current route risk.">
        <svg viewBox="0 0 1000 300" style={{ width: '100%', minHeight: 240 }} role="img" aria-label="Supply network schematic">
          {routes.map((rid, i) => {
            const y = 40 + (i * 220) / Math.max(1, routes.length - 1 || 1);
            const r = catalog!.routes[rid];
            const risk = routeRisk[rid];
            const color = risk?.risk === 'high' ? '#e85c67' : risk?.risk === 'medium' ? '#f5b94c' : '#22d6b0';
            const sups = suppliers.filter((s) => s.routeId === rid);
            return (
              <g key={rid}>
                {sups.map((s, j) => {
                  const sy = y + (j - (sups.length - 1) / 2) * 26;
                  return (
                    <g key={s.id}>
                      <line x1={cols.supplier + 14} y1={sy} x2={cols.port - 14} y2={y} stroke={color} strokeWidth={2} />
                      <circle cx={cols.supplier} cy={sy} r={12} fill="var(--panel-3)" stroke={color} strokeWidth={2} />
                      <text x={cols.supplier + 18} y={sy - 14} fontSize={11} fill="var(--text-2)">{s.name.split(' ').slice(0, 2).join(' ')} ({s.country})</text>
                    </g>
                  );
                })}
                <line x1={cols.port + 14} y1={y} x2={cols.warehouse - 16} y2={150} stroke={color} strokeWidth={2} strokeDasharray={risk?.risk === 'high' ? '6 4' : undefined} />
                <circle cx={cols.port} cy={y} r={14} fill="var(--panel-3)" stroke={color} strokeWidth={3} />
                <text x={cols.port} y={y + 28} textAnchor="middle" fontSize={11} fill="var(--text)">{r.mode === 'road' ? 'Road' : r.toPort}</text>
                {risk?.risk === 'high' && <text x={cols.port} y={y - 20} textAnchor="middle" fontSize={11} fill="#e85c67">+{risk.delay} mo delay</text>}
              </g>
            );
          })}
          <line x1={cols.warehouse + 16} y1={150} x2={cols.factory - 16} y2={150} stroke="#22d6b0" strokeWidth={2} />
          <line x1={cols.factory + 16} y1={150} x2={cols.customer - 16} y2={150} stroke="#22d6b0" strokeWidth={2} />
          {[['warehouse', 'Warehouse'], ['factory', 'Factory'], ['customer', 'Customers']].map(([k, label]) => (
            <g key={k}>
              <circle cx={cols[k as keyof typeof cols]} cy={150} r={16} fill="var(--panel-3)" stroke="#4e91ff" strokeWidth={3} />
              <text x={cols[k as keyof typeof cols]} y={180} textAnchor="middle" fontSize={12} fill="var(--text)">{label}</text>
            </g>
          ))}
        </svg>
        {suppliers.length === 0 && <p className="small muted">No suppliers in use yet.</p>}
      </Panel>
      <Panel title="Disruptions affecting your supply chain" actions={<DataTypeBadge type="simulated" />}>
        {supplyExposures.length === 0 ? (
          <Callout tone="ok">No active event is exposed to your suppliers, routes or materials.</Callout>
        ) : (
          <div className="list">
            {supplyExposures.map((x) => {
              const ev = w.events.find((e) => e.id === x.eventId)!;
              return (
                <button key={x.eventId} className="list-item" onClick={() => setEvId(ev.id)}>
                  <Badge tone={exposureTone(x.level)}>{x.level}</Badge>
                  <span style={{ flex: 1 }}>
                    <b className="small" style={{ display: 'block' }}>{ev.title}</b>
                    <span className="small muted">{x.operational[0] ?? x.impactBasis}</span>
                  </span>
                  <span className="small">{inr(Math.abs(x.monthlyImpact))}/mo <DataTypeBadge type="estimate" /></span>
                </button>
              );
            })}
          </div>
        )}
      </Panel>
      {evId && <EventDetail event={w.events.find((e) => e.id === evId)!} exposure={c.computed.exposures.find((x) => x.eventId === evId)} onClose={() => setEvId(null)} />}
    </div>
  );
}

function Suppliers() {
  const { view, catalog, act, canAct } = useWorld();
  const c = view!.company!;
  const w = view!.world;
  const [mat, setMat] = useState<string>('all');
  const needed = new Set(c.products.flatMap((p) => p.bom.map((b) => b.materialId)));
  const list = Object.values(catalog!.suppliers).filter((s) => (mat === 'all' ? s.materials.some((m) => needed.has(m)) : s.materials.includes(mat)));
  return (
    <div className="stack">
      <div className="row">
        <label className="field" style={{ minWidth: 240 }}>
          <span className="label">Material</span>
          <select className="input" value={mat} onChange={(e) => setMat(e.target.value)}>
            <option value="all">All materials I use</option>
            {[...needed].map((m) => <option key={m} value={m}>{catalog!.materials[m].name}</option>)}
          </select>
        </label>
      </div>
      <div className="cards">
        {list.map((s) => {
          const q = c.qualifiedSuppliers.find((x) => x.supplierId === s.id);
          const status = w.supplierStatus[s.id];
          const ready = q && q.readyTick <= w.tick;
          const country = catalog!.countries[s.country];
          return (
            <div key={s.id} className="panel" style={{ background: 'var(--panel-2)' }}>
              <div className="row between">
                <b>{s.name}</b>
                {ready ? <Badge tone="ok">Qualified</Badge> : q ? <Badge tone="info">Qualifying</Badge> : <Badge>Not qualified</Badge>}
              </div>
              <p className="small muted">{country.name} · invoices in {country.currency} · {catalog!.routes[s.routeId].name}</p>
              <Table compact head={<tr><th>Material</th><th className="r">Landed / unit</th><th className="r">Duty</th></tr>}>
                {s.materials.map((m) => {
                  const qt = c.computed.quotes[s.id]?.[m];
                  return (
                    <tr key={m}>
                      <td className="small">{catalog!.materials[m].name}{qt?.banned && <Badge tone="bad">Banned</Badge>}</td>
                      <td className="r small">{qt ? inr(qt.landedUnit) : '—'}</td>
                      <td className="r small">{qt ? pct(qt.tariffRate, 1) : '—'}</td>
                    </tr>
                  );
                })}
              </Table>
              <dl className="kv small mt">
                <dt>Reliability (now)</dt><dd className={status.reliability < s.reliability ? 'warn' : ''}>{pct(status.reliability, 0)}</dd>
                <dt>Quality score</dt><dd>{s.quality}</dd>
                <dt>Lead time</dt><dd>{s.leadTime === 0 ? 'Same month' : `${s.leadTime} month(s)`}</dd>
                <dt>Capacity</dt><dd>{num(s.capacityPerMonth)}/mo per material</dd>
                <dt>Payment terms</dt><dd>{s.paymentTermsMonths ? 'Net 30' : 'On receipt'}</dd>
                <dt>Status</dt><dd>{status.online ? 'Shipping' : <span className="neg">Halted</span>}</dd>
              </dl>
              {!q && (
                <Button size="sm" className="mt" disabled={!canAct} onClick={() => act('qualify_supplier', { supplierId: s.id })} style={{ width: '100%' }}>
                  Qualify (1 month, ₹1.5 L)
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Orders() {
  const { view, catalog, act, canAct, worldId, companyId } = useWorld();
  const c = view!.company!;
  const w = view!.world;
  const [params] = useSearchParams();
  const needed = [...new Set(c.products.flatMap((p) => p.bom.map((b) => b.materialId)))];
  const [materialId, setMaterialId] = useState(needed[0] ?? '');
  const options = useMemo(() => Object.values(catalog!.suppliers).filter((s) => s.materials.includes(materialId)), [catalog, materialId]);
  const [supplierId, setSupplierId] = useState('');
  const [qty, setQty] = useState(c.computed.materialNeeds[needed[0]] ?? 1000);
  const [expedited, setExpedited] = useState(false);
  const [quote, setQuote] = useState<LandedQuote | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [cancel, setCancel] = useState<string | null>(null);
  useEffect(() => {
    const q = options.filter((s) => c.qualifiedSuppliers.some((x) => x.supplierId === s.id && x.readyTick <= w.tick));
    setSupplierId((cur) => (options.some((o) => o.id === cur) ? cur : q[0]?.id ?? options[0]?.id ?? ''));
  }, [options, c.qualifiedSuppliers, w.tick]);
  useEffect(() => {
    if (!supplierId || !materialId || qty <= 0) return setQuote(null);
    const t = setTimeout(() => api.post<LandedQuote>(`/api/worlds/${worldId}/companies/${companyId}/quote`, { supplierId, materialId, qty: Math.floor(qty), expedited }).then(setQuote).catch(() => setQuote(null)), 200);
    return () => clearTimeout(t);
  }, [supplierId, materialId, qty, expedited, worldId, companyId]);
  const qualified = c.qualifiedSuppliers.some((x) => x.supplierId === supplierId && x.readyTick <= w.tick);
  const available = c.computed.cash - c.computed.committedPurchases;
  const orders = [...c.purchaseOrders].reverse().filter((p) => filter === 'all' || p.status === 'in_transit' || p.status === 'delayed');
  const focus = params.get('focus');
  return (
    <div className="grid g-main">
      <Panel title="Purchase orders" actions={<Seg label="Filter orders" value={filter} onChange={setFilter} options={[{ id: 'open', label: 'Open' }, { id: 'all', label: 'All' }]} />}>
        {orders.length === 0 ? <Empty title={filter === 'open' ? 'No open orders' : 'No orders yet'}>Domestic suppliers deliver in the same month; imports take 1–2 months plus any disruption.</Empty> : (
          <Table compact head={<tr><th>PO</th><th>Material</th><th>Supplier</th><th className="r">Qty</th><th className="r">Landed cost</th><th>Due</th><th>Status</th><th></th></tr>}>
            {orders.slice(0, 60).map((p) => (
              <tr key={p.id} style={focus === p.id ? { outline: '2px solid var(--teal)' } : undefined}>
                <td className="mono">{p.id}</td>
                <td className="small">{catalog!.materials[p.materialId].name}</td>
                <td className="small">{catalog!.suppliers[p.supplierId].name}</td>
                <td className="r">{num(p.qty)}</td>
                <td className="r">{inr(p.totalCost)}<div className="small faint">duty {pct(p.tariffRate, 0)}</div></td>
                <td className="small">M{p.expectedTick + 1}{p.mode === 'expedited' && <Badge tone="purple">Air</Badge>}</td>
                <td><Badge tone={p.status === 'received' ? 'ok' : p.status === 'delayed' ? 'warn' : p.status === 'blocked' || p.status === 'cancelled' ? 'bad' : 'info'}>{p.status.replace('_', ' ')}</Badge>{p.delayReason && <div className="small faint">{p.delayReason}</div>}</td>
                <td>
                  {(p.status === 'in_transit' || p.status === 'delayed') && (
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      {p.mode !== 'expedited' && catalog!.suppliers[p.supplierId].leadTime > 0 && (
                        <button className="btn ghost icon sm" title="Expedite by air (6% of goods + ₹50,000)" aria-label={`Expedite ${p.id}`} disabled={!canAct} onClick={() => act('expedite_po', { poId: p.id })}><Plane aria-hidden /></button>
                      )}
                      <button className="btn ghost icon sm" aria-label={`Cancel ${p.id}`} title="Cancel order" disabled={!canAct} onClick={() => setCancel(p.id)}><X aria-hidden /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <Panel title="New purchase order" sub="Paid on receipt: goods per supplier terms, duty and freight immediately.">
        <div className="stack">
          <Field label="Material" htmlFor="pomat">
            <select id="pomat" className="input" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
              {Object.values(catalog!.materials).map((m) => <option key={m.id} value={m.id}>{m.name}{needed.includes(m.id) ? '' : ' (not in your BOMs)'}</option>)}
            </select>
          </Field>
          <Field label="Supplier" htmlFor="posup" error={supplierId && !qualified ? 'Not qualified yet — qualify on the Suppliers tab first.' : null}>
            <select id="posup" className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              {options.map((s) => {
                const q = c.qualifiedSuppliers.find((x) => x.supplierId === s.id);
                return <option key={s.id} value={s.id}>{s.name} ({s.country}) {q ? (q.readyTick <= w.tick ? '✓' : '· qualifying') : '· not qualified'}</option>;
              })}
            </select>
          </Field>
          <Field label="Quantity" htmlFor="poqty" hint={`Monthly need at current plan: ${num(c.computed.materialNeeds[materialId] ?? 0)} ${catalog!.materials[materialId]?.unit ?? ''}`}>
            <input id="poqty" className="input num" type="number" min={1} step={100} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          </Field>
          <label className="check small">
            <input type="checkbox" checked={expedited} onChange={(e) => setExpedited(e.target.checked)} />
            Ship by air (arrives this month, bypasses port delays; +6% + ₹50,000)
          </label>
          {quote && (
            <div className="panel" style={{ background: 'var(--panel-2)' }}>
              <dl className="kv small">
                <dt>Goods ({inr(quote.unitPrice)}/unit)</dt><dd>{inr(quote.goods)}</dd>
                <dt>Import duty ({pct(quote.tariffRate, 1)})</dt><dd>{inr(quote.tariff)}</dd>
                <dt>Freight</dt><dd>{inr(quote.freight)}</dd>
                {quote.expediteFee > 0 && (<><dt>Air premium</dt><dd>{inr(quote.expediteFee)}</dd></>)}
                <dt><b>Landed total</b></dt><dd><b>{inr(quote.total)}</b> ({inr(quote.landedUnitCost)}/unit)</dd>
                <dt>Expected arrival</dt><dd>M{w.tick + 1 + quote.leadTime + quote.routeDelay}{quote.routeDelay ? ` (+${quote.routeDelay} disruption)` : ''}</dd>
                <dt>On-time probability</dt><dd>{pct(quote.reliability, 0)}</dd>
              </dl>
              {quote.banned && <Callout tone="bad">Export restriction in force — this order would be rejected.</Callout>}
              {!quote.supplierOnline && <Callout tone="bad">Supplier has halted operations.</Callout>}
              {quote.total > available && <Callout tone="warn">Exceeds uncommitted cash ({inr(available)}).</Callout>}
            </div>
          )}
          <Button variant="primary" disabled={!canAct || !qualified || !quote || quote.banned || qty <= 0} onClick={() => act('place_po', { supplierId, materialId, qty: Math.floor(qty), expedited })}>
            Place order
          </Button>
        </div>
      </Panel>
      <Confirm open={!!cancel} onClose={() => setCancel(null)} title={`Cancel ${cancel}?`} danger confirmLabel="Cancel order" onConfirm={async () => { await act('cancel_po', { poId: cancel }); setCancel(null); }}>
        <p>Orders placed in an earlier month have already shipped and carry a 10% cancellation fee. Orders placed this month can be cancelled free of charge.</p>
      </Confirm>
    </div>
  );
}
