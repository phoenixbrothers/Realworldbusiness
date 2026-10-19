/** Countries & geopolitics (plan §9): map, country profiles, company-specific exposure and causal propagation. */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWorld } from '../store';
import { inr, pct } from '../format';
import { PageHeader } from '../components/Shell';
import { WorldMap } from '../components/WorldMap';
import { EventDetail, exposureTone } from '../components/EventDetail';
import { Badge, DataTypeBadge, Loading, Panel, SeverityBadge, Table } from '../components/ui';

export default function Countries() {
  const { view, catalog } = useWorld();
  const [params] = useSearchParams();
  const [sel, setSel] = useState<string>(params.get('focus') && params.get('focus')!.length === 2 ? params.get('focus')! : 'CN');
  const [evId, setEvId] = useState<string | null>(null);
  if (!catalog || !view) return <Loading />;
  const w = view.world;
  const c = view.company;
  const country = catalog.countries[sel as keyof typeof catalog.countries];
  const eco = w.economy.countries[sel as keyof typeof w.economy.countries];
  const anchor = w.economyHistory[0]?.countries[sel as keyof typeof w.economy.countries];
  const events = w.events.filter((e) => e.countries.includes(sel as never));
  const suppliers = Object.values(catalog.suppliers).filter((s) => s.country === sel);
  const tariffs = w.tariffs[sel as keyof typeof w.tariffs];
  const myPOs = c?.purchaseOrders.filter((p) => catalog.suppliers[p.supplierId].country === sel && (p.status === 'in_transit' || p.status === 'delayed')) ?? [];
  const exportProducts = c?.products.filter((p) => p.exportMarkets.includes(sel as never)) ?? [];
  const ev = w.events.find((e) => e.id === evId);
  return (
    <>
      <PageHeader title="Countries & geopolitics" module="countries" />
      <div className="grid g-main">
        <Panel title="World map" sub="Select a country. Dashed routes are disrupted; rings mark countries with active events." actions={<DataTypeBadge type="simulated" />}>
          <WorldMap world={w} catalog={catalog} selected={sel} onSelect={setSel} />
        </Panel>
        <Panel title={country.name} sub={`${country.region} · ${country.currency} · ports: ${country.ports.join(', ')}`}>
          <dl className="kv">
            <dt>GDP growth</dt><dd>{eco.gdpGrowth.toFixed(2)}%</dd>
            <dt>Inflation</dt><dd>{eco.inflation.toFixed(2)}%</dd>
            <dt>Policy rate</dt><dd>{eco.policyRate.toFixed(2)}%</dd>
            <dt>FX</dt><dd>{sel === 'IN' ? 'Home currency' : `${eco.fxPerINR.toPrecision(4)} ${country.currency}/₹ (${pct(eco.fxPerINR / (anchor?.fxPerINR ?? eco.fxPerINR) - 1)} vs start)`}</dd>
            <dt>Political stability</dt><dd className={eco.stability < 60 ? 'neg' : eco.stability < 72 ? 'warn' : 'pos'}>{eco.stability.toFixed(0)} / 100</dd>
            <dt>Relations with India</dt><dd>{sel === 'IN' ? '—' : eco.relationsWithIndia.toFixed(0)}</dd>
            {sel !== 'IN' && (<><dt>Duty on Indian exports</dt><dd>{pct(w.exportTariffs[sel as keyof typeof w.exportTariffs] ?? 0)}</dd></>)}
          </dl>
          {c && sel !== 'IN' && (
            <div className="mt">
              <h3 className="mb">{c.name}'s exposure</h3>
              <ul className="small" style={{ margin: 0, paddingLeft: 16 }}>
                <li>{suppliers.filter((s) => c.qualifiedSuppliers.some((q) => q.supplierId === s.id)).length} qualified supplier(s) based here</li>
                <li>{myPOs.length} open purchase order(s) worth {inr(myPOs.reduce((a, p) => a + p.totalCost, 0), { compact: true })}</li>
                <li>{exportProducts.length ? `Exports: ${exportProducts.map((p) => p.name).join(', ')}` : 'No exports to this market'}</li>
              </ul>
            </div>
          )}
        </Panel>
      </div>
      <div className="grid g2 mt">
        <Panel title={`Events involving ${country.name}`} actions={<DataTypeBadge type="simulated" />}>
          {events.length === 0 ? <p className="small muted">No events recorded for this country.</p> : (
            <div className="list">
              {[...events].reverse().map((e) => {
                const ex = c?.computed.exposures.find((x) => x.eventId === e.id);
                return (
                  <button key={e.id} className="list-item" onClick={() => setEvId(e.id)}>
                    <SeverityBadge severity={e.severity} />
                    <span style={{ flex: 1 }}>
                      <b className="small" style={{ display: 'block' }}>{e.title}</b>
                      <span className="small faint">{e.tickLabel} · {e.status}</span>
                    </span>
                    {ex && <Badge tone={exposureTone(ex.level)}>{ex.level}</Badge>}
                  </button>
                );
              })}
            </div>
          )}
        </Panel>
        <Panel title={sel === 'IN' ? 'Import duties into India (by origin)' : `India's import duty on goods from ${country.name}`} sub="Fractions of goods value; approximations of published rates.">
          {sel === 'IN' ? (
            <Table compact head={<tr><th>Origin</th>{Object.keys(w.tariffs.CN).map((k) => <th key={k} className="r">{k.replace('_', ' ')}</th>)}</tr>}>
              {Object.entries(w.tariffs).filter(([k]) => k !== 'IN').map(([k, v]) => (
                <tr key={k}><td>{catalog.countries[k as keyof typeof catalog.countries].name}</td>{Object.values(v).map((x, i) => <td key={i} className="r">{pct(x, 1)}</td>)}</tr>
              ))}
            </Table>
          ) : (
            <Table compact head={<tr><th>Category</th><th className="r">Duty</th></tr>}>
              {Object.entries(tariffs).map(([k, v]) => <tr key={k}><td>{k.replace('_', ' ')}</td><td className="r">{pct(v, 1)}</td></tr>)}
            </Table>
          )}
        </Panel>
      </div>
      {ev && <EventDetail event={ev} exposure={c?.computed.exposures.find((x) => x.eventId === ev.id)} onClose={() => setEvId(null)} />}
    </>
  );
}
