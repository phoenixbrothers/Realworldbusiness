/** R&D stage-gate roadmap (plan §8). Gate evidence is separate from targets; technical success is distinct from commercial success. */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWorld } from '../store';
import { inr, num } from '../format';
import { PageHeader } from '../components/Shell';
import { Badge, Button, Callout, Confirm, DataTypeBadge, Empty, Field, Modal, MoneyInput, Panel, Table } from '../components/ui';

const STAGES = ['discovery', 'feasibility', 'prototype', 'testing', 'production_validation', 'launched'] as const;
const STAGE_LABEL: Record<string, string> = { discovery: 'Discovery', feasibility: 'Feasibility', prototype: 'Prototype', testing: 'Testing', production_validation: 'Production validation', launched: 'Launch', cancelled: 'Cancelled' };

export default function Rnd() {
  const { view, catalog, act, canAct } = useWorld();
  const c = view!.company!;
  const [params] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [kill, setKill] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', kind: 'quality_upgrade' as 'new_product' | 'quality_upgrade' | 'process_automation' | 'cost_reduction', targetTemplateId: '', targetProductId: c.products[0]?.id ?? '', targetLineId: c.lines[0]?.id ?? '', monthlyBudget: 6_00_000 * 100 });
  const [budgetEdit, setBudgetEdit] = useState<{ id: string; v: number } | null>(null);
  if (!catalog) return null;
  const concepts = Object.values(catalog.templates).filter((t) => t.industry === c.industry && !t.unlockedByDefault && !c.products.some((p) => p.templateId === t.id));
  const active = c.rndProjects.filter((p) => p.status === 'active' || p.status === 'paused');
  const closed = c.rndProjects.filter((p) => p.status === 'launched' || p.status === 'cancelled');
  const focus = params.get('focus');
  const kindSpec = catalog.rndKinds[form.kind];
  const create = async () => {
    const r = await act('create_rnd_project', { ...form, targetTemplateId: form.kind === 'new_product' ? form.targetTemplateId : undefined, targetProductId: form.kind === 'quality_upgrade' || form.kind === 'cost_reduction' ? form.targetProductId : undefined, targetLineId: form.kind === 'process_automation' ? form.targetLineId : undefined });
    if (r) setOpen(false);
  };
  return (
    <>
      <PageHeader title="R&D roadmap" module="rnd" actions={<Button variant="primary" onClick={() => setOpen(true)} disabled={!canAct}>New project</Button>} />
      <div className="grid g4 mb">
        <Panel><div className="stat"><span className="l">R&D capacity</span><span className="v num">{c.computed.rndCapacity.toFixed(1)} pts/mo</span><span className="small faint">Engineers × skill × morale × lab level</span></div></Panel>
        <Panel><div className="stat"><span className="l">Active projects</span><span className="v num">{active.length}</span><span className="small faint">Capacity is shared equally</span></div></Panel>
        <Panel><div className="stat"><span className="l">Monthly R&D spend</span><span className="v num">{inr(active.filter((p) => p.status === 'active').reduce((a, p) => a + p.monthlyBudget, 0), { compact: true })}</span><span className="small faint">Budget {inr(c.budget.rnd, { compact: true })}</span></div></Panel>
        <Panel><div className="stat"><span className="l">Patents held</span><span className="v num">{c.patents.length}</span><span className="small faint">20-year term</span></div></Panel>
      </div>
      {active.length === 0 ? (
        <Panel><Empty title="No active R&D projects" action={<Button variant="primary" onClick={() => setOpen(true)} disabled={!canAct}>Start a project</Button>}>Projects move through five gated stages. Benefits apply only after launch.</Empty></Panel>
      ) : (
        <div className="stack">
          {active.map((p) => {
            const idx = STAGES.indexOf(p.stage as (typeof STAGES)[number]);
            const target = p.kind === 'new_product' ? catalog.templates[p.targetTemplateId!]?.name : p.kind === 'process_automation' ? c.lines.find((l) => l.id === p.targetLineId)?.name : c.products.find((x) => x.id === p.targetProductId)?.name;
            const variance = p.plannedBudget ? (p.spent - p.plannedBudget * ((idx + p.progress / 100) / 5)) / p.plannedBudget : 0;
            return (
              <Panel key={p.id} title={<>{p.name} <Badge tone="info">{catalog.rndKinds[p.kind].label}</Badge>{p.status === 'paused' && <Badge tone="warn">Paused</Badge>}</>} sub={`Target: ${target ?? '—'} · started M${p.startedTick + 1} · technical risk ${(p.technicalRisk * 100).toFixed(0)}% per gate`} className={focus === p.id ? 'focus' : undefined}>
                <div className="stages" role="list" aria-label="Stage gates">
                  {STAGES.map((s, i) => (
                    <div key={s} role="listitem" className={`stage ${i === idx ? 'current' : ''}`} aria-current={i === idx ? 'step' : undefined}>
                      <div className="pip"><i style={{ width: `${i < idx ? 100 : i === idx ? p.progress : 0}%` }} /></div>
                      {STAGE_LABEL[s]}
                      <div className="faint">{i < idx ? 'Passed' : i === idx ? `${p.progress.toFixed(0)}%` : ''}</div>
                    </div>
                  ))}
                </div>
                <div className="row between mt">
                  <span className="small">
                    Spent {inr(p.spent, { compact: true })} of ~{inr(p.plannedBudget, { compact: true })} planned <DataTypeBadge type="estimate" /> · budget variance {variance >= 0 ? '+' : ''}{(variance * 100).toFixed(1)}% · {inr(p.monthlyBudget, { compact: true })}/month
                  </span>
                  <div className="row">
                    {p.awaitingGate && (
                      <Button variant="primary" size="sm" disabled={!canAct} onClick={() => act('decide_gate', { projectId: p.id, decision: 'go' })}>
                        Approve gate → {STAGE_LABEL[STAGES[idx + 1]]}
                      </Button>
                    )}
                    <Button size="sm" disabled={!canAct} onClick={() => setBudgetEdit({ id: p.id, v: p.monthlyBudget })}>Budget</Button>
                    {p.status === 'paused' && <Button size="sm" disabled={!canAct} onClick={() => act('set_rnd_budget', { projectId: p.id, monthlyBudget: p.monthlyBudget, resume: true })}>Resume</Button>}
                    <Button size="sm" variant="danger" disabled={!canAct} onClick={() => setKill(p.id)}>Stop</Button>
                  </div>
                </div>
                {p.awaitingGate && <Callout tone="warn" title="Gate decision pending">Review evidence: “{p.gates.at(-1)?.evidence}”. Progress is halted until you decide.</Callout>}
                {p.gates.length > 0 && (
                  <details className="mt">
                    <summary className="small">Gate evidence ({p.gates.length})</summary>
                    <Table compact head={<tr><th>Month</th><th>Stage</th><th>Result</th><th>Evidence</th></tr>}>
                      {p.gates.map((g, i) => (
                        <tr key={i}><td>M{g.tick + 1}</td><td>{STAGE_LABEL[g.stage]}</td><td><Badge tone={g.result === 'passed' ? 'ok' : 'bad'}>{g.result}</Badge></td><td className="small">{g.evidence}</td></tr>
                      ))}
                    </Table>
                  </details>
                )}
              </Panel>
            );
          })}
        </div>
      )}
      <div className="grid g2 mt">
        <Panel title="Completed & stopped projects">
          {closed.length === 0 ? <p className="small muted">None yet.</p> : (
            <Table compact head={<tr><th>Project</th><th>Outcome</th><th className="r">Spent</th><th>Commercial result</th></tr>}>
              {closed.map((p) => {
                const prod = p.kind === 'new_product' ? c.products.find((x) => x.templateId === p.targetTemplateId) : c.products.find((x) => x.id === p.targetProductId);
                const sold = prod ? c.sales.filter((s) => s.productId === prod.id).reduce((a, s) => a + s.sold, 0) : 0;
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td><Badge tone={p.status === 'launched' ? 'ok' : 'neutral'}>{p.status === 'launched' ? 'Technical success' : 'Stopped'}</Badge></td>
                    <td className="r">{inr(p.spent, { compact: true })}</td>
                    <td className="small">{p.status === 'launched' && prod ? `${num(sold)} units sold since` : '—'}</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Panel>
        <Panel title="Patents">
          {c.patents.length === 0 ? <p className="small muted">Patents are granted when new-product, quality or automation projects launch.</p> : (
            <Table compact head={<tr><th>ID</th><th>Title</th><th>Granted</th><th>Expires</th></tr>}>
              {c.patents.map((p) => <tr key={p.id}><td className="mono">{p.id}</td><td>{p.title}</td><td>M{p.grantedTick + 1}</td><td>M{p.expiresTick + 1}</td></tr>)}
            </Table>
          )}
        </Panel>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="New R&D project" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={create}>Start in discovery</Button></>}>
        <div className="stack">
          <Field label="Project type" htmlFor="rkind">
            <select id="rkind" className="input" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as typeof f.kind }))}>
              <option value="quality_upgrade">Quality upgrade (+10 quality on launch)</option>
              <option value="new_product">New product (unlock a concept)</option>
              <option value="process_automation">Process automation (−labor hours, +15% line capacity)</option>
              <option value="cost_reduction">Cost reduction (−10% top input, −10% machine time)</option>
            </select>
          </Field>
          {form.kind === 'new_product' && (
            <Field label="Product concept" htmlFor="rtpl">
              <select id="rtpl" className="input" value={form.targetTemplateId} onChange={(e) => setForm((f) => ({ ...f, targetTemplateId: e.target.value, name: f.name || `${catalog.templates[e.target.value]?.name} development` }))}>
                <option value="">Choose…</option>
                {concepts.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.description}</option>)}
              </select>
            </Field>
          )}
          {(form.kind === 'quality_upgrade' || form.kind === 'cost_reduction') && (
            <Field label="Product" htmlFor="rprod">
              <select id="rprod" className="input" value={form.targetProductId} onChange={(e) => setForm((f) => ({ ...f, targetProductId: e.target.value }))}>
                {c.products.map((p) => <option key={p.id} value={p.id}>{p.name} (quality {p.quality})</option>)}
              </select>
            </Field>
          )}
          {form.kind === 'process_automation' && (
            <Field label="Production line" htmlFor="rline">
              <select id="rline" className="input" value={form.targetLineId} onChange={(e) => setForm((f) => ({ ...f, targetLineId: e.target.value }))}>
                {c.lines.map((l) => <option key={l.id} value={l.id}>{l.name} (automation {(l.automation * 100).toFixed(0)}%)</option>)}
              </select>
            </Field>
          )}
          <Field label="Project name" htmlFor="rname">
            <input id="rname" className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={60} />
          </Field>
          <Field label="Monthly budget" htmlFor="rbud" hint={`Minimum ${inr(kindSpec.minBudget)}; up to 1.25× the minimum speeds progress (diminishing returns). Expensed monthly.`}>
            <MoneyInput id="rbud" value={form.monthlyBudget} onChange={(v) => setForm((f) => ({ ...f, monthlyBudget: v }))} step={50000} />
          </Field>
          <Callout tone="info">Each of five stages needs ~{kindSpec.pointsPerStage} capacity points. With your current capacity ({c.computed.rndCapacity.toFixed(1)} pts/mo{active.length ? `, shared with ${active.length} other project(s)` : ''}) expect roughly {Math.ceil((kindSpec.pointsPerStage * 5 * (active.length + 1)) / Math.max(0.1, c.computed.rndCapacity))} months if every gate passes. Gate reviews fail {(kindSpec.risk * 100).toFixed(0)}% of the time.</Callout>
        </div>
      </Modal>
      <Modal open={!!budgetEdit} onClose={() => setBudgetEdit(null)} title="Change monthly budget" footer={<><Button onClick={() => setBudgetEdit(null)}>Cancel</Button><Button variant="primary" onClick={async () => { if (budgetEdit && (await act('set_rnd_budget', { projectId: budgetEdit.id, monthlyBudget: budgetEdit.v }))) setBudgetEdit(null); }}>Save</Button></>}>
        {budgetEdit && <Field label="Monthly budget" htmlFor="rb2"><MoneyInput id="rb2" value={budgetEdit.v} onChange={(v) => setBudgetEdit({ ...budgetEdit, v })} step={50000} /></Field>}
      </Modal>
      <Confirm open={!!kill} onClose={() => setKill(null)} title="Stop this project?" danger confirmLabel="Stop project" onConfirm={async () => { await act('decide_gate', { projectId: kill, decision: 'kill' }); setKill(null); }}>
        <p>Spending stops immediately. Money already spent is not recovered and no benefit is delivered. This cannot be undone.</p>
      </Confirm>
    </>
  );
}
