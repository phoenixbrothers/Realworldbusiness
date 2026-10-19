import { useState } from 'react';
import { Download } from 'lucide-react';
import { useWorld, useWorldQuery } from '../store';
import { inr, num, pct } from '../format';
import { PageHeader } from '../components/Shell';
import { Badge, Callout, DataTypeBadge, Empty, Loading, Meter, Panel, Seg, Table } from '../components/ui';

interface Movement { id: string; month: string; kind: string; itemName?: string; qty: number; value: number; reason: string; refId: string }

export default function Inventory() {
  const { view, worldId, companyId, catalog, act, canAct } = useWorld();
  const c = view!.company!;
  const [kind, setKind] = useState<'all' | 'raw' | 'finished'>('all');
  const [rp, setRp] = useState<Record<string, number>>({ ...c.reorderPoints });
  const mv = useWorldQuery<{ total: number; rows: Movement[] }>(`/api/worlds/${worldId}/companies/${companyId}/movements?limit=150${kind !== 'all' ? `&kind=${kind}` : ''}`, [kind]);
  if (!catalog) return <Loading />;
  const needs = c.computed.materialNeeds;
  const materials = [...new Set([...Object.keys(c.rawInventory), ...Object.keys(needs)])];
  const recon = c.computed.reconciliation;
  const used = c.computed.storageUsed;
  const cap = c.computed.storageCapacity;
  const inbound = (m: string) => c.purchaseOrders.filter((p) => p.materialId === m && (p.status === 'in_transit' || p.status === 'delayed')).reduce((a, p) => a + p.qty, 0);
  const lastSales = (pid: string) => c.sales.filter((s) => s.productId === pid && s.tick === view!.world.tick - 1).reduce((a, s) => a + s.sold, 0);
  return (
    <>
      <PageHeader title="Inventory & warehousing" module="inventory" />
      <div className="grid g3">
        <Panel title="Raw materials"><div className="stat"><span className="v num">{inr(c.computed.rawValue, { compact: true })}</span><span className="small faint">GL 1200 · landed moving-average cost</span></div></Panel>
        <Panel title="Work in progress"><div className="stat"><span className="v num">₹0</span><span className="small faint">Production completes within the month; there is no WIP at month end by design.</span></div></Panel>
        <Panel title="Finished goods"><div className="stat"><span className="v num">{inr(c.computed.finishedValue, { compact: true })}</span><span className="small faint">GL 1210 · absorbed production cost</span></div></Panel>
      </div>
      <div className="grid g-main mt">
        <Panel title="Raw materials on hand" sub="Cover = on hand ÷ monthly need at the current plan." actions={<DataTypeBadge type="actual" />}>
          {materials.length === 0 ? <Empty title="No materials" /> : (
            <Table head={<tr><th>Material</th><th className="r">On hand</th><th className="r">Unit cost</th><th className="r">Inbound</th><th className="r">Need / mo</th><th className="r">Cover</th><th style={{ width: 130 }}>Reorder point</th></tr>}>
              {materials.map((m) => {
                const it = c.rawInventory[m];
                const need = needs[m] ?? 0;
                const cover = need ? (it?.qty ?? 0) / need : null;
                return (
                  <tr key={m}>
                    <td>{catalog.materials[m].name}<div className="small faint">{catalog.materials[m].unit}</div></td>
                    <td className="r">{num(it?.qty ?? 0)}</td>
                    <td className="r">{it?.qty ? inr(Math.round(it.value / it.qty)) : '—'}</td>
                    <td className="r">{num(inbound(m))}</td>
                    <td className="r">{num(need)}</td>
                    <td className="r">{cover === null ? '—' : <span className={cover < 1 ? 'neg' : cover < 1.5 ? 'warn' : 'pos'}>{cover.toFixed(1)} mo</span>}</td>
                    <td><input className="input num" type="number" min={0} aria-label={`Reorder point for ${catalog.materials[m].name}`} value={rp[m] ?? 0} onChange={(e) => setRp((x) => ({ ...x, [m]: Math.max(0, Math.floor(Number(e.target.value))) }))} onBlur={() => (rp[m] ?? 0) !== (c.reorderPoints[m] ?? 0) && act('set_reorder_point', { materialId: m, qty: rp[m] ?? 0 }, { quiet: true })} disabled={!canAct} /></td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Panel>
        <div className="stack">
          <Panel title="Warehouse capacity">
            <div className="row between small"><span>{num(used)} of {num(cap)} storage units</span><b>{pct(cap ? used / cap : 0, 0)}</b></div>
            <Meter value={cap ? used / cap : 0} tone={used > cap ? 'red' : used > cap * 0.9 ? 'amber' : undefined} label="Warehouse utilization" />
            <p className="small faint mt">Overflow is stored at a 3PL for ₹40 per storage unit per month. Upgrade or build warehouses in Transactions.</p>
          </Panel>
          <Panel title="Reconciliation" actions={<Badge tone={recon.ok ? 'ok' : 'bad'}>{recon.ok ? 'Reconciled' : 'Mismatch'}</Badge>}>
            <p className="small muted">Stock quantities equal the sum of recorded movements, and stock values equal the general ledger.</p>
            <div className="small mt">
              {recon.checks.filter((x) => x.label.includes('GL')).map((x) => (
                <div key={x.label} className="row between"><span>{x.label}</span><span className={x.ok ? 'pos' : 'neg'}>{x.ok ? '✓' : `${inr(x.expected)} vs ${inr(x.actual)}`}</span></div>
              ))}
            </div>
            {!recon.ok && <Callout tone="bad">Inventory does not reconcile. This should never happen; please report it.</Callout>}
          </Panel>
        </div>
      </div>
      <Panel className="mt" title="Finished goods">
        <Table head={<tr><th>Product</th><th className="r">On hand</th><th className="r">Unit cost</th><th className="r">Sold last month</th><th className="r">Cover</th><th className="r">Fill rate</th></tr>}>
          {c.products.map((p) => {
            const it = c.finishedInventory[p.id];
            const sold = lastSales(p.id);
            return (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="r">{num(it?.qty ?? 0)}</td>
                <td className="r">{it?.qty ? inr(Math.round(it.value / it.qty)) : '—'}</td>
                <td className="r">{num(sold)}</td>
                <td className="r">{sold ? `${((it?.qty ?? 0) / sold).toFixed(1)} mo` : '—'}</td>
                <td className={`r ${p.lastFillRate < 0.9 ? 'neg' : ''}`}>{pct(p.lastFillRate, 0)}</td>
              </tr>
            );
          })}
        </Table>
      </Panel>
      <Panel className="mt" title="Stock movements" sub="Append-only stock ledger; every movement references its purchase order, production order or sale." actions={
        <>
          <Seg label="Movement type" value={kind} onChange={setKind} options={[{ id: 'all', label: 'All' }, { id: 'raw', label: 'Raw' }, { id: 'finished', label: 'Finished' }]} />
          <a className="btn sm" href={`/api/worlds/${worldId}/companies/${companyId}/movements?format=csv`} download><Download aria-hidden /> CSV</a>
        </>
      }>
        {!mv.data ? <Loading /> : mv.data.rows.length === 0 ? <Empty title="No movements yet" /> : (
          <Table compact head={<tr><th>ID</th><th>Month</th><th>Item</th><th>Reason</th><th className="r">Qty</th><th className="r">Value</th><th>Reference</th></tr>}>
            {mv.data.rows.map((m) => (
              <tr key={m.id}>
                <td className="mono">{m.id}</td>
                <td>{m.month}</td>
                <td>{m.itemName}</td>
                <td><Badge tone={m.qty > 0 ? 'ok' : 'info'}>{m.reason.replace(/_/g, ' ')}</Badge></td>
                <td className={`r ${m.qty < 0 ? 'neg' : 'pos'}`}>{m.qty > 0 ? '+' : ''}{num(m.qty)}</td>
                <td className="r">{inr(m.value)}</td>
                <td className="mono">{m.refId}</td>
              </tr>
            ))}
          </Table>
        )}
        {mv.data && mv.data.total > mv.data.rows.length && <p className="small faint mt">Showing latest {mv.data.rows.length} of {num(mv.data.total)}. Export CSV for the full ledger.</p>}
      </Panel>
    </>
  );
}
