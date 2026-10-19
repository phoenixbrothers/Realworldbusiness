/**
 * Manufacturing (plan §7): factory-floor visual of lines beside readable
 * capacity / yield / on-time indicators, and the change-production journey:
 * select line → inspect feasible capacity & bottleneck → edit plan →
 * preview consequences (before/after) → validate & submit.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import { api } from '../api';
import { useWorld } from '../store';
import { inr, num, pct } from '../format';
import { PageHeader } from '../components/Shell';
import { BarsChart } from '../components/Charts';
import { Badge, Button, Callout, Confirm, DataTypeBadge, Empty, Field, Meter, Panel, Table } from '../components/ui';
import type { Feasibility } from '../types';

export default function Manufacturing() {
  const { view, worldId, companyId, act, canAct, catalog } = useWorld();
  const c = view!.company!;
  const [params] = useSearchParams();
  const [sel, setSel] = useState<string>(params.get('focus') && c.lines.some((l) => l.id === params.get('focus')) ? params.get('focus')! : c.lines[0]?.id ?? '');
  const line = c.lines.find((l) => l.id === sel);
  const feas = c.computed.feasibility;
  const [planned, setPlanned] = useState(line?.plannedUnits ?? 0);
  const [productId, setProductId] = useState<string | null>(line?.productId ?? null);
  const [overtime, setOvertime] = useState(c.overtime);
  const [preview, setPreview] = useState<{ before: Feasibility[]; after: Feasibility[] } | null>(null);
  const [maint, setMaint] = useState(false);
  useEffect(() => {
    setPlanned(line?.plannedUnits ?? 0);
    setProductId(line?.productId ?? null);
  }, [sel, line?.plannedUnits, line?.productId]);
  useEffect(() => setOvertime(c.overtime), [c.overtime]);
  useEffect(() => {
    if (!sel) return;
    const t = setTimeout(() => {
      api.post<{ before: Feasibility[]; after: Feasibility[] }>(`/api/worlds/${worldId}/companies/${companyId}/plan-preview`, { lineId: sel, plannedUnits: Math.max(0, Math.floor(planned || 0)), productId, overtime }).then(setPreview).catch(() => setPreview(null));
    }, 200);
    return () => clearTimeout(t);
  }, [sel, planned, productId, overtime, worldId, companyId, view?.version]);
  const after = preview?.after.find((x) => x.lineId === sel);
  const over = after ? planned > after.maxFeasible : false;
  const recent = c.production.slice(-60);
  const lastTick = recent.length ? recent[recent.length - 1].tick : -1;
  const lastMonth = recent.filter((r) => r.tick === lastTick);
  const totals = lastMonth.reduce((a, r) => ({ planned: a.planned + r.planned, produced: a.produced + r.produced, scrap: a.scrap + r.scrap }), { planned: 0, produced: 0, scrap: 0 });
  const capacityTotal = c.lines.reduce((a, l) => a + l.capacity, 0);
  const utilization = capacityTotal ? (totals.produced + totals.scrap) / capacityTotal : 0;
  const yieldRate = totals.produced + totals.scrap ? totals.produced / (totals.produced + totals.scrap) : 0;
  const onTime = totals.planned ? Math.min(1, totals.produced / totals.planned) : 0;
  const history = useMemo(() => {
    const ticks = [...new Set(c.production.map((p) => p.tick))].slice(-12);
    return ticks.map((t) => {
      const rs = c.production.filter((p) => p.tick === t);
      return { label: `M${t + 1}`, planned: rs.reduce((a, r) => a + r.planned, 0), produced: rs.reduce((a, r) => a + r.produced, 0), scrap: rs.reduce((a, r) => a + r.scrap, 0) };
    });
  }, [c.production]);
  const product = c.products.find((p) => p.id === productId);
  const submit = async () => {
    await act('set_production_plan', { lineId: sel, plannedUnits: Math.floor(planned), productId });
    if (overtime !== c.overtime) await act('set_overtime', { enabled: overtime }, { quiet: true });
  };
  return (
    <>
      <PageHeader title="Manufacturing operations" module="manufacturing" />
      <div className="grid g-main">
        <Panel title="Factory floor · visual plan" sub="Select a line to inspect and plan it. Each square is ~1/4 of line capacity; amber = constrained or worn, grey = idle.">
          {c.lines.length === 0 ? <Empty title="No production lines" /> : (
            <div className="floor" role="listbox" aria-label="Production lines">
              {c.lines.map((l) => {
                const fx = feas.find((x) => x.lineId === l.id);
                const p = c.products.find((x) => x.id === l.productId);
                const fac = c.facilities.find((x) => x.id === l.facilityId);
                const constrained = fx && fx.feasible < fx.planned;
                const machines = 4;
                const active = l.plannedUnits > 0 ? Math.max(1, Math.round((Math.min(l.plannedUnits, fx?.maxFeasible ?? 0) / l.capacity) * machines)) : 0;
                return (
                  <button key={l.id} role="option" className="line-card" aria-pressed={sel === l.id} aria-selected={sel === l.id} onClick={() => setSel(l.id)}>
                    <div className="row between">
                      <b>{l.name}</b>
                      {l.status === 'maintenance' ? <Badge tone="info">Maintenance</Badge> : constrained ? <Badge tone="warn">Constrained</Badge> : l.plannedUnits ? <Badge tone="ok">Running</Badge> : <Badge>Idle</Badge>}
                    </div>
                    <div className="small faint">{fac?.name}</div>
                    <div className="machine-row" aria-hidden>
                      {Array.from({ length: machines }).map((_, i) => (
                        <span key={i} className={`machine ${i >= active ? 'off' : constrained || l.condition < 0.7 ? 'warn' : ''}`}><i /></span>
                      ))}
                    </div>
                    <div className="small">{p?.name ?? 'No product'}</div>
                    <div className="small muted">Plan {num(l.plannedUnits)} / cap {num(l.capacity)} · condition {pct(l.condition, 0)} · automation {pct(l.automation, 0)}</div>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>
        <Panel title="Production status" sub={lastTick >= 0 ? `Last closed month (M${lastTick + 1})` : 'No production yet'} actions={<DataTypeBadge type="actual" />}>
          <div className="stack">
            <div><div className="row between small"><span>Capacity utilization</span><b>{pct(utilization, 0)}</b></div><Meter value={utilization} label="Capacity utilization" /></div>
            <div><div className="row between small"><span>Yield (good / started)</span><b>{pct(yieldRate, 1)}</b></div><Meter value={yieldRate} tone="blue" label="Yield" /></div>
            <div><div className="row between small"><span>Plan attainment (on-time)</span><b>{pct(onTime, 0)}</b></div><Meter value={onTime} tone="amber" label="Plan attainment" /></div>
            <dl className="kv small">
              <dt>Produced (good)</dt><dd>{num(totals.produced)}</dd>
              <dt>Scrapped</dt><dd>{num(totals.scrap)}</dd>
              <dt>Labor hours available</dt><dd>{num(c.computed.laborHours)}</dd>
              <dt>Extra shift</dt><dd>{c.overtime ? 'On (+25% hours, 1.5× pay)' : 'Off'}</dd>
            </dl>
          </div>
        </Panel>
      </div>
      {line && (
        <Panel className="mt" title={`Plan ${line.name}`} sub="The engine rejects any plan above the feasible maximum. Inputs arriving this month count as available.">
          <div className="grid g2">
            <div className="stack">
              <div className="grid g2">
                <Field label="Product" htmlFor="pprod">
                  <select id="pprod" className="input" value={productId ?? ''} onChange={(e) => setProductId(e.target.value || null)} disabled={!canAct}>
                    <option value="">— none (idle) —</option>
                    {c.products.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Planned units / month" htmlFor="punits" error={over ? `Above feasible maximum (${num(after?.maxFeasible)}) — limited by ${after?.bottleneck?.label}` : null}>
                  <input id="punits" className="input num" type="number" min={0} step={100} value={planned} onChange={(e) => setPlanned(Number(e.target.value))} aria-invalid={over} disabled={!canAct} />
                </Field>
              </div>
              <div className="row">
                <Button size="sm" onClick={() => after && setPlanned(after.maxFeasible)} disabled={!after || !canAct}>Use feasible max ({num(after?.maxFeasible)})</Button>
                <Button size="sm" onClick={() => setPlanned(Math.round(line.capacity * 0.75))} disabled={!canAct}>75% of capacity</Button>
                <label className="check small">
                  <input type="checkbox" checked={overtime} onChange={(e) => setOvertime(e.target.checked)} disabled={!canAct} />
                  Extra shift (company-wide)
                </label>
              </div>
              {after && (
                <div>
                  <h3 className="mb">Constraints for this line</h3>
                  <Table compact head={<tr><th>Constraint</th><th className="r">Max units</th><th></th></tr>}>
                    {after.constraints.filter((k) => k.key !== 'plan').sort((a, b) => a.limit - b.limit).map((k) => (
                      <tr key={k.label}>
                        <td>{k.key === 'material' && catalog ? `Material: ${catalog.materials[k.label.replace('Material: ', '')]?.name ?? k.label}` : k.label}</td>
                        <td className="r">{k.limit >= Number.MAX_SAFE_INTEGER ? '∞' : num(k.limit)}</td>
                        <td>{after.bottleneck?.label === k.label && <Badge tone="warn">Bottleneck</Badge>}</td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}
            </div>
            <div className="stack">
              <h3>Before → after preview</h3>
              {preview ? (
                <Table compact head={<tr><th>Line</th><th className="r">Feasible now</th><th className="r">After change</th></tr>}>
                  {preview.after.map((a) => {
                    const b = preview.before.find((x) => x.lineId === a.lineId)!;
                    const changed = a.feasible !== b.feasible;
                    return (
                      <tr key={a.lineId}>
                        <td>{c.lines.find((l) => l.id === a.lineId)?.name}</td>
                        <td className="r">{num(b.feasible)}</td>
                        <td className={`r ${changed ? (a.feasible > b.feasible ? 'pos' : 'neg') : ''}`}>{num(a.feasible)}</td>
                      </tr>
                    );
                  })}
                </Table>
              ) : <p className="small muted">Calculating…</p>}
              {after && product && (
                <>
                  <h3>Material requirement</h3>
                  <Table compact head={<tr><th>Material</th><th className="r">Per unit</th><th className="r">Required</th><th className="r">Available*</th></tr>}>
                    {after.materialNeeds.map((m) => (
                      <tr key={m.materialId}>
                        <td>{catalog?.materials[m.materialId]?.name}</td>
                        <td className="r">{m.perUnit}</td>
                        <td className={`r ${m.required > m.available ? 'neg' : ''}`}>{num(m.required)}</td>
                        <td className="r">{num(m.available)}</td>
                      </tr>
                    ))}
                  </Table>
                  <p className="small faint">*On hand + purchase orders due this month, before other lines take their share.</p>
                  <dl className="kv small">
                    <dt>Labor hours / unit</dt><dd>{after.laborHoursPerUnit.toFixed(2)}</dd>
                    <dt>Material + energy cost / unit</dt><dd>{inr(after.estUnitCost)} <DataTypeBadge type="estimate" /></dd>
                    <dt>Est. material spend for plan</dt><dd>{inr(after.estUnitCost * Math.min(planned, after.maxFeasible))}</dd>
                  </dl>
                </>
              )}
              <div className="row">
                <Button variant="primary" onClick={submit} disabled={!canAct || over || planned < 0}>Validate & submit plan</Button>
                <Button onClick={() => setMaint(true)} disabled={!canAct || line.status === 'maintenance'}>
                  <Wrench aria-hidden /> Schedule maintenance
                </Button>
              </div>
              {line.condition < 0.7 && <Callout tone="warn">Condition {pct(line.condition, 0)}: capacity is reduced below 70% and scrap rises as the line wears.</Callout>}
            </div>
          </div>
        </Panel>
      )}
      <div className="grid g2 mt">
        <Panel title="Output history" actions={<DataTypeBadge type="actual" />}>
          {history.length ? <BarsChart data={history} bars={[{ key: 'planned', name: 'Planned', color: '#7f97b0' }, { key: 'produced', name: 'Produced', color: '#22d6b0' }, { key: 'scrap', name: 'Scrap', color: '#e85c67' }]} format={(v) => num(v)} /> : <Empty title="No production history yet" />}
        </Panel>
        <Panel title="Production orders">
          {recent.length === 0 ? <Empty title="No production orders yet" /> : (
            <Table compact head={<tr><th>Order</th><th>Month</th><th>Product</th><th className="r">Plan</th><th className="r">Good</th><th className="r">Unit cost</th><th>Bottleneck</th></tr>}>
              {[...recent].reverse().slice(0, 20).map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td>M{r.tick + 1}</td>
                  <td className="small">{c.products.find((p) => p.id === r.productId)?.name}</td>
                  <td className="r">{num(r.planned)}</td>
                  <td className="r">{num(r.produced)}</td>
                  <td className="r">{inr(r.unitCost)}</td>
                  <td className="small">{r.status === 'completed' ? <Badge tone="ok">Met plan</Badge> : <Badge tone="warn">{r.bottleneck}</Badge>}</td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>
      <Confirm open={maint} onClose={() => setMaint(false)} title={`Schedule maintenance on ${line?.name}`} confirmLabel="Schedule & pay" onConfirm={async () => { await act('schedule_maintenance', { lineId: sel }); setMaint(false); }}>
        <p>The line will produce nothing this month and its condition returns to 100% afterwards. Cost: ₹2.5 L per factory level, paid now and expensed to facilities & maintenance.</p>
      </Confirm>
    </>
  );
}
