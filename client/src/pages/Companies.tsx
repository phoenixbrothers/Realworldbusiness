/** My Companies (plan §8): portfolio cards, company profile, ownership, facilities, org structure and history. */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Plus } from 'lucide-react';
import { useWorld } from '../store';
import { inr, num, pct, titleCase } from '../format';
import { PageHeader } from '../components/Shell';
import { Badge, Button, Confirm, DataTypeBadge, Empty, Field, Modal, Panel, Table } from '../components/ui';

export default function Companies() {
  const { view, catalog, act, canAct, worldId, base } = useWorld();
  const nav = useNavigate();
  const [edit, setEdit] = useState(false);
  const [close, setClose] = useState(false);
  const c = view?.company;
  const [form, setForm] = useState({ name: c?.name ?? '', brand: c?.brand ?? '', strategy: c?.strategy ?? 'focus', businessModel: c?.businessModel ?? '' });
  if (!view || !catalog) return null;
  const w = view.world;
  const total = c ? c.shareholders.reduce((a, s) => a + s.shares, 0) : 0;
  const depts = c ? [...new Set(c.teams.map((t) => t.department))] : [];
  return (
    <>
      <PageHeader title="My companies" module="company" actions={<Link className="btn primary" to={`/w/${worldId}/new-company`}><Plus aria-hidden /> New company</Link>} />
      <div className="cards mb">
        {w.companies.length === 0 && <Empty title="No companies in this world" icon={<Building2 aria-hidden />} action={<Link className="btn primary" to={`/w/${worldId}/new-company`}>Start a company</Link>} />}
        {w.companies.map((x) => (
          <button key={x.id} className="card-sel" aria-pressed={x.id === c?.id} onClick={() => nav(`/w/${worldId}/c/${x.id}/company`)}>
            <div className="row between"><b>{x.name}</b><Badge tone={x.lifecycle === 'operating' ? 'ok' : x.lifecycle === 'distressed' ? 'warn' : 'bad'}>{x.lifecycle}</Badge></div>
            <p className="small muted">{catalog.industries[x.industry].name} · {x.city} · since {x.foundedLabel}</p>
            <div className="row small" style={{ marginTop: 6 }}>
              {x.facilities.map((f, i) => <Badge key={i}>{titleCase(f.type)} L{f.level}</Badge>)}
              {x.isDemo && <Badge tone="purple">Demo</Badge>}
            </div>
            <dl className="kv small" style={{ marginTop: 8 }}>
              <dt>Cash</dt><dd>{inr(x.cash, { compact: true })}</dd>
              <dt>Last month revenue</dt><dd>{inr(x.revenue, { compact: true })}</dd>
              <dt>Net income</dt><dd className={x.netIncome >= 0 ? 'pos' : 'neg'}>{inr(x.netIncome, { compact: true })}</dd>
              <dt>Headcount · products</dt><dd>{num(x.headcount)} · {x.products}</dd>
              <dt>Pending decisions</dt><dd>{x.pendingDecisions}</dd>
            </dl>
            {x.milestones.at(-1) && <p className="small faint" style={{ marginTop: 6 }}>Latest: {x.milestones.at(-1)!.text}</p>}
          </button>
        ))}
      </div>
      {c && (
        <>
          <div className="grid g-main">
            <Panel title={`${c.name} profile`} actions={<><Button size="sm" disabled={!canAct} onClick={() => { setForm({ name: c.name, brand: c.brand, strategy: c.strategy, businessModel: c.businessModel }); setEdit(true); }}>Edit profile</Button><Button size="sm" variant="danger" disabled={!canAct} onClick={() => setClose(true)}>Close company</Button></>}>
              <dl className="kv">
                <dt>Legal form</dt><dd>{c.legalForm}</dd>
                <dt>Jurisdiction · currency</dt><dd>India · {c.currency}</dd>
                <dt>Industry</dt><dd>{catalog.industries[c.industry].name}</dd>
                <dt>Brand</dt><dd>{c.brand}</dd>
                <dt>Strategy</dt><dd>{titleCase(c.strategy)}</dd>
                <dt>Business model</dt><dd style={{ maxWidth: 380 }}>{c.businessModel}</dd>
                <dt>Headquarters</dt><dd>{c.city}</dd>
                <dt>Lifecycle</dt><dd>{c.lifecycle}{c.overdueMonths ? ` (${c.overdueMonths} month(s) with arrears)` : ''}</dd>
                <dt>Valuation</dt><dd>{inr(c.computed.valuation.preMoney, { compact: true })} <DataTypeBadge type="estimate" /></dd>
              </dl>
            </Panel>
            <Panel title="Ownership (cap table)">
              <Table compact head={<tr><th>Holder</th><th>Type</th><th className="r">Shares</th><th className="r">%</th></tr>}>
                {c.shareholders.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.kind}</td><td className="r">{num(s.shares)}</td><td className="r">{pct(s.shares / total)}</td></tr>)}
              </Table>
              <Link to={`${base}/investments`} className="small">Funding & valuation →</Link>
            </Panel>
          </div>
          <div className="grid g2 mt">
            <Panel title="Facilities & locations" actions={<Link className="btn sm" to={`${base}/transactions?new=facility_build`}>Build / lease facility</Link>}>
              <Table compact head={<tr><th>Facility</th><th>City</th><th>Level</th><th>Status</th><th className="r">Monthly cost</th><th></th></tr>}>
                {c.facilities.map((f) => (
                  <tr key={f.id}>
                    <td>{f.name}<div className="small faint">{f.owned ? 'Owned' : 'Leased'}</div></td>
                    <td>{f.city}</td>
                    <td>{f.level}</td>
                    <td><Badge tone={f.status === 'operational' ? 'ok' : 'info'}>{f.status.replace('_', ' ')}</Badge>{f.status !== 'operational' && <div className="small faint">ready M{f.readyTick + 1}</div>}</td>
                    <td className="r">{inr(f.monthlyFixedCost, { compact: true })}</td>
                    <td>{f.type !== 'hq' && f.status === 'operational' && f.level < 4 && <Link className="btn sm ghost" to={`${base}/transactions?new=facility_upgrade&facility=${f.id}`}>Upgrade</Link>}</td>
                  </tr>
                ))}
              </Table>
            </Panel>
            <Panel title="Organizational structure" actions={<Link to={`${base}/workforce`}>Workforce →</Link>}>
              <div className="stack">
                <div className="row"><Badge tone="info">Board & founders</Badge><span className="small muted">→ CEO → department heads</span></div>
                {depts.map((d) => {
                  const teams = c.teams.filter((t) => t.department === d);
                  return (
                    <div key={d} className="row between small" style={{ borderBottom: '1px solid var(--line-soft)', paddingBottom: 6 }}>
                      <b>{titleCase(d)}</b>
                      <span>{teams.map((t) => `${t.role} (${t.headcount})`).join(', ')}</span>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>
          <div className="grid g2 mt">
            <Panel title="Products">
              <Table compact head={<tr><th>Product</th><th>Segment</th><th className="r">Price</th><th className="r">Quality</th><th>Status</th><th></th></tr>}>
                {c.products.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="small">{catalog.segments[p.segmentId].name}</td>
                    <td className="r">{inr(p.price)}</td>
                    <td className="r">{p.quality}</td>
                    <td><Badge tone={p.status === 'active' ? 'ok' : 'neutral'}>{p.status}</Badge></td>
                    <td><Button size="sm" variant="ghost" disabled={!canAct} onClick={() => act('set_product_status', { productId: p.id, status: p.status === 'active' ? 'discontinued' : 'active' })}>{p.status === 'active' ? 'Discontinue' : 'Reactivate'}</Button></td>
                  </tr>
                ))}
              </Table>
            </Panel>
            <Panel title="Company history">
              <ol className="chain" style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 320, overflowY: 'auto' }}>
                {[...c.milestones].reverse().map((m, i) => (
                  <li key={i} className="chain-step"><span className="chain-dot" aria-hidden>M{m.tick + 1}</span><span className="small">{m.text}</span></li>
                ))}
              </ol>
            </Panel>
          </div>
        </>
      )}
      <Modal open={edit} onClose={() => setEdit(false)} title="Edit company profile" footer={<><Button onClick={() => setEdit(false)}>Cancel</Button><Button variant="primary" onClick={async () => { if (await act('update_company', form)) setEdit(false); }}>Save</Button></>}>
        <div className="stack">
          <Field label="Company name" htmlFor="ename"><input id="ename" className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Brand" htmlFor="ebrand" hint="Existing product names keep their current brand prefix."><input id="ebrand" className="input" value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} /></Field>
          <Field label="Strategy" htmlFor="estrat" hint="Strategy is a label for analysis; prices and quality change through Marketing and R&D.">
            <select id="estrat" className="input" value={form.strategy} onChange={(e) => setForm((f) => ({ ...f, strategy: e.target.value as typeof f.strategy }))}>
              <option value="cost_leadership">Cost leadership</option><option value="differentiation">Differentiation</option><option value="focus">Focus</option>
            </select>
          </Field>
          <Field label="Business model" htmlFor="emodel"><textarea id="emodel" className="input" rows={2} value={form.businessModel} onChange={(e) => setForm((f) => ({ ...f, businessModel: e.target.value }))} /></Field>
        </div>
      </Modal>
      {c && (
        <Confirm open={close} onClose={() => setClose(false)} title={`Close ${c.name}?`} danger confirmLabel="Close company permanently" requireText={c.name} onConfirm={async () => { if (await act('close_company', { confirmName: c.name })) setClose(false); }}>
          <p>The company stops operating: no production, sales, payroll or decisions. All records remain available read-only. This cannot be undone.</p>
        </Confirm>
      )}
    </>
  );
}
