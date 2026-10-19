/** Global trade: routes and their status, import mix by origin, export market configuration and FX exposure. */
import { useMemo } from 'react';
import { useWorld } from '../store';
import { inr, num, pct } from '../format';
import { PageHeader } from '../components/Shell';
import { WorldMap } from '../components/WorldMap';
import { BarsChart } from '../components/Charts';
import { Badge, Callout, DataTypeBadge, Empty, Loading, Panel, Table } from '../components/ui';

export default function Trade() {
  const { view, catalog, act, canAct } = useWorld();
  const c = view?.company;
  const imports = useMemo(() => {
    if (!catalog) return [];
    const by: Record<string, number> = {};
    for (const p of c?.purchaseOrders ?? []) if (p.status === 'received') by[catalog.suppliers[p.supplierId].country] = (by[catalog.suppliers[p.supplierId].country] ?? 0) + p.totalCost;
    return Object.entries(by).map(([k, v]) => ({ label: catalog.countries[k as keyof typeof catalog.countries].name, value: v }));
  }, [c, catalog]);
  if (!catalog || !view) return <Loading />;
  const w = view.world;
  const exports = (c?.sales ?? []).filter((s) => s.market !== 'IN');
  const exportRevenue = exports.reduce((a, s) => a + s.revenue, 0);
  return (
    <>
      <PageHeader title="Global trade" module="trade" />
      <div className="grid g-main">
        <Panel title="Trade corridors" actions={<DataTypeBadge type="simulated" />}>
          <WorldMap world={w} catalog={catalog} height={320} highlightRoutes={[...new Set((c?.qualifiedSuppliers ?? []).map((q) => catalog.suppliers[q.supplierId].routeId))]} />
        </Panel>
        <Panel title="Route status">
          <Table compact head={<tr><th>Route</th><th>Mode</th><th className="r">Freight</th><th>Status</th></tr>}>
            {w.routeStatus.map((r) => {
              const def = catalog.routes[r.routeId];
              return (
                <tr key={r.routeId}>
                  <td className="small">{def.name}</td>
                  <td>{def.mode}</td>
                  <td className="r">{pct(def.freightRate, 1)}</td>
                  <td><Badge tone={r.risk === 'high' ? 'bad' : r.risk === 'medium' ? 'warn' : 'ok'}>{r.risk === 'high' ? `+${r.delay} mo delay` : r.risk}</Badge></td>
                </tr>
              );
            })}
          </Table>
          <p className="small faint mt">Freight index {w.economy.freightIndex.toFixed(0)} (100 = base). A logistics hub cuts freight by 15%.</p>
        </Panel>
      </div>
      {c && (
        <div className="grid g2 mt">
          <Panel title="Imports by origin (received, landed cost)" actions={<DataTypeBadge type="actual" />}>
            {imports.length === 0 ? <Empty title="No imports received yet" /> : <BarsChart layout="vertical" height={Math.max(160, imports.length * 44)} data={imports} bars={[{ key: 'value', name: 'Landed cost' }]} format={(v) => inr(v, { compact: true })} />}
            <Callout tone="info">Foreign suppliers price in their own currency: a weaker rupee raises your INR cost on the next order. Domestic suppliers remove FX risk but may cost more.</Callout>
          </Panel>
          <Panel title="Export markets" sub={`Export revenue to date: ${inr(exportRevenue, { compact: true })} · invoiced in INR, net 60`}>
            <Table head={<tr><th>Product</th>{['AE', 'US', 'DE', 'VN'].map((m) => <th key={m} className="r">{catalog.countries[m as 'AE'].name}</th>)}</tr>}>
              {c.products.map((p) => {
                const allowed = Object.keys(catalog.segments[p.segmentId].exportDemand);
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    {(['AE', 'US', 'DE', 'VN'] as const).map((m) => (
                      <td key={m} className="r">
                        {allowed.includes(m) ? (
                          <label className="check" style={{ justifyContent: 'flex-end' }}>
                            <input type="checkbox" checked={p.exportMarkets.includes(m)} disabled={!canAct} aria-label={`Export ${p.name} to ${catalog.countries[m].name}`} onChange={(e) => act('set_export_markets', { productId: p.id, markets: e.target.checked ? [...p.exportMarkets, m] : p.exportMarkets.filter((x) => x !== m) })} />
                            <span className="small faint">{pct(w.exportTariffs[m] ?? 0, 0)} duty</span>
                          </label>
                        ) : <span className="faint small">—</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </Table>
            <p className="small faint mt">Export demand: price incl. destination duty and FX move since start vs local incumbents. Disrupted export lanes ship only half the volume. Last month export units: {num(exports.filter((s) => s.tick === w.tick - 1).reduce((a, s) => a + s.sold, 0))}.</p>
          </Panel>
        </div>
      )}
    </>
  );
}
