/** Economics: simulated macro indicators and commodity indices with provenance. Not real-world data or a prediction. */
import { useState } from 'react';
import { useWorld } from '../store';
import { PageHeader } from '../components/Shell';
import { LinesChart } from '../components/Charts';
import { Callout, DataTypeBadge, Loading, Panel, Seg, Table } from '../components/ui';

export default function Economics() {
  const { view, catalog } = useWorld();
  const [metric, setMetric] = useState<'gdpGrowth' | 'inflation' | 'policyRate' | 'consumerConfidence' | 'stability'>('inflation');
  if (!view || !catalog) return <Loading />;
  const w = view.world;
  const hist = w.economyHistory;
  const label = (t: number) => `M${t + 1}`;
  const countryCodes = Object.keys(catalog.countries) as (keyof typeof catalog.countries)[];
  const macro = hist.map((h) => ({ label: label(h.tick), ...Object.fromEntries(countryCodes.map((c) => [c, h.countries[c][metric]])) }));
  const commodities = hist.map((h) => ({ label: label(h.tick), ...h.commodities }));
  const other = hist.map((h) => ({ label: label(h.tick), energy: h.energyPriceINRPerKwh / 100, freight: h.freightIndex, wage: h.wageIndex }));
  const fx = hist.map((h) => ({ label: label(h.tick), ...Object.fromEntries(countryCodes.filter((c) => c !== 'IN').map((c) => [c, +((h.countries[c].fxPerINR / hist[0].countries[c].fxPerINR) * 100).toFixed(2)])) }));
  return (
    <>
      <PageHeader title="Economics" module="economics" />
      <Callout tone="warn" title="Simulated economy">{catalog.provenance} Indicators follow mean-reverting random walks with explicit event shocks. They are not forecasts of the real economy.</Callout>
      <div className="grid g2 mt">
        <Panel title="Macro indicators by country" actions={<Seg label="Indicator" value={metric} onChange={setMetric} options={[{ id: 'gdpGrowth', label: 'GDP' }, { id: 'inflation', label: 'CPI' }, { id: 'policyRate', label: 'Rates' }, { id: 'consumerConfidence', label: 'Confidence' }, { id: 'stability', label: 'Stability' }]} />}>
          <LinesChart data={macro} series={countryCodes.map((c) => ({ key: c, name: catalog.countries[c].name }))} format={(v) => (metric === 'consumerConfidence' || metric === 'stability' ? v.toFixed(0) : `${v.toFixed(1)}%`)} />
        </Panel>
        <Panel title="Commodity indices (100 = start)" actions={<DataTypeBadge type="simulated" />}>
          <LinesChart data={commodities} series={Object.keys(catalog.commodities).map((k) => ({ key: k, name: catalog.commodities[k as keyof typeof catalog.commodities].name }))} format={(v) => v.toFixed(0)} />
        </Panel>
        <Panel title="Exchange rates (local currency per ₹, index 100 = start)" sub="Below 100 = rupee weaker against that currency → imports dearer, exports cheaper.">
          <LinesChart data={fx} series={countryCodes.filter((c) => c !== 'IN').map((c) => ({ key: c, name: catalog.countries[c].currency }))} format={(v) => v.toFixed(1)} />
        </Panel>
        <Panel title="Operating cost indices (India)">
          <LinesChart data={other} series={[{ key: 'energy', name: 'Industrial power ₹/kWh' }, { key: 'freight', name: 'Freight index' }, { key: 'wage', name: 'Wage index' }]} format={(v) => v.toFixed(1)} />
        </Panel>
      </div>
      <Panel className="mt" title={`Current readings · ${w.label}`}>
        <Table compact head={<tr><th>Country</th><th className="r">GDP growth</th><th className="r">Inflation</th><th className="r">Policy rate</th><th className="r">FX per ₹</th><th className="r">Confidence</th><th className="r">Stability</th></tr>}>
          {countryCodes.map((c) => {
            const e = w.economy.countries[c];
            return <tr key={c}><td>{catalog.countries[c].name}</td><td className="r">{e.gdpGrowth.toFixed(2)}%</td><td className="r">{e.inflation.toFixed(2)}%</td><td className="r">{e.policyRate.toFixed(2)}%</td><td className="r">{c === 'IN' ? '1' : e.fxPerINR.toPrecision(4)}</td><td className="r">{e.consumerConfidence.toFixed(0)}</td><td className="r">{e.stability.toFixed(0)}</td></tr>;
          })}
        </Table>
        <p className="small faint mt">How these feed the simulation: India GDP, confidence and inflation scale category demand; the repo rate sets floating loan and deposit rates; FX moves import costs and export competitiveness; commodity indices set supplier prices; the wage index sets market salaries; power prices feed production cost.</p>
      </Panel>
    </>
  );
}
