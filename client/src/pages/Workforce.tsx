/** Workforce (plan §8): team/role map, hiring pipeline, training, payroll vs capacity impact. */
import { useState } from 'react';
import { useWorld } from '../store';
import { inr, num, pct } from '../format';
import { PageHeader } from '../components/Shell';
import { LinesChart } from '../components/Charts';
import { Badge, Button, Callout, Confirm, DataTypeBadge, Field, Meter, Modal, MoneyInput, Panel, Table } from '../components/ui';

const DEPT: Record<string, string> = { production: 'Production', rnd: 'R&D', sales_marketing: 'Sales & marketing', operations: 'Operations & logistics', admin: 'Finance & admin' };

export default function Workforce() {
  const { view, catalog, act, canAct } = useWorld();
  const c = view!.company!;
  const [hire, setHire] = useState<{ teamId: string; count: number } | null>(null);
  const [fire, setFire] = useState<{ teamId: string; count: number } | null>(null);
  const [pay, setPay] = useState<{ teamId: string; salary: number } | null>(null);
  const [train, setTrain] = useState<string | null>(null);
  const headcount = c.teams.reduce((a, t) => a + t.headcount, 0);
  const payroll = c.teams.reduce((a, t) => a + t.salary * t.headcount, 0);
  const team = (id?: string) => c.teams.find((t) => t.id === id);
  const prodHeadcount = c.teams.filter((t) => t.department === 'production').reduce((a, t) => a + t.headcount, 0);
  const hoursPerHead = prodHeadcount ? c.computed.laborHours / prodHeadcount : 0;
  return (
    <>
      <PageHeader title="Workforce & HR" module="workforce" />
      <div className="grid g4 mb">
        <Panel><div className="stat"><span className="l">Headcount</span><span className="v num">{num(headcount)}</span><span className="small faint">{c.requisitions.filter((r) => r.status === 'open').reduce((a, r) => a + r.count, 0)} open roles</span></div></Panel>
        <Panel><div className="stat"><span className="l">Gross payroll / month</span><span className="v num">{inr(payroll, { compact: true })}</span><span className="small faint">+13% employer contributions{c.overtime ? ' + overtime' : ''}</span></div></Panel>
        <Panel><div className="stat"><span className="l">Production labor capacity</span><span className="v num">{num(c.computed.laborHours)} h</span><span className="small faint">{hoursPerHead.toFixed(0)} effective h/head</span></div></Panel>
        <Panel><div className="stat"><span className="l">Statutory minimum wage</span><span className="v num">{inr(c.computed.minimumWage)}</span><span className="small faint">per month <DataTypeBadge type="simulated" /></span></div></Panel>
      </div>
      <Panel title="Teams" sub="Productivity = (0.6 + skill/250) × (0.75 + morale/400). New hires work at half productivity for two months.">
        <Table head={<tr><th>Team</th><th className="r">Headcount</th><th className="r">Salary</th><th className="r">Market</th><th style={{ width: 120 }}>Skill</th><th style={{ width: 120 }}>Morale</th><th className="r">Left last month</th><th></th></tr>}>
          {c.teams.map((t) => {
            const market = c.computed.marketSalary[t.id];
            const ramp = t.ramping.reduce((a, r) => a + r.count, 0);
            const training = c.trainings.find((x) => x.teamId === t.id && x.status === 'active');
            return (
              <tr key={t.id}>
                <td>{t.role}<div className="small faint">{DEPT[t.department]}{ramp ? ` · ${ramp} ramping` : ''}{training ? ` · ${training.name}` : ''}</div></td>
                <td className="r">{num(t.headcount)}</td>
                <td className={`r ${t.salary < market ? 'warn' : ''}`}>{inr(t.salary)}</td>
                <td className="r">{inr(market)}<div className="small faint">{pct(t.salary / market - 1, 0)}</div></td>
                <td><div className="small">{t.skill.toFixed(0)}</div><Meter value={t.skill / 100} tone="blue" label={`${t.role} skill`} /></td>
                <td><div className="small">{t.morale.toFixed(0)}</div><Meter value={t.morale / 100} tone={t.morale < 45 ? 'red' : t.morale < 60 ? 'amber' : undefined} label={`${t.role} morale`} /></td>
                <td className="r">{num(t.lastLeavers)}</td>
                <td>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <Button size="sm" disabled={!canAct} onClick={() => setHire({ teamId: t.id, count: 10 })}>Hire</Button>
                    <Button size="sm" disabled={!canAct || !!training} onClick={() => setTrain(t.id)}>Train</Button>
                    <Button size="sm" disabled={!canAct} onClick={() => setPay({ teamId: t.id, salary: t.salary })}>Pay</Button>
                    <Button size="sm" variant="ghost" disabled={!canAct || t.headcount === 0} onClick={() => setFire({ teamId: t.id, count: 1 })}>Reduce</Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      </Panel>
      <div className="grid g2 mt">
        <Panel title="Hiring pipeline">
          {c.requisitions.length === 0 ? <p className="small muted">No requisitions yet. Production and operations roles fill in about 1 month; others in about 2 (+1 when labour markets are tight).</p> : (
            <Table compact head={<tr><th>Req</th><th>Team</th><th className="r">Count</th><th>Opened</th><th>Fill</th><th>Status</th><th></th></tr>}>
              {[...c.requisitions].reverse().map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td className="small">{team(r.teamId)?.role}</td>
                  <td className="r">{r.count}</td>
                  <td>M{r.openedTick + 1}</td>
                  <td>M{r.fillTick + 1}</td>
                  <td><Badge tone={r.status === 'filled' ? 'ok' : r.status === 'open' ? 'info' : 'neutral'}>{r.status}</Badge></td>
                  <td>{r.status === 'open' && <Button size="sm" variant="ghost" disabled={!canAct} onClick={() => act('cancel_requisition', { requisitionId: r.id })}>Cancel</Button>}</td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
        <Panel title="Headcount trend" actions={<DataTypeBadge type="actual" />}>
          {c.history.length > 1 ? <LinesChart data={c.history.map((h) => ({ label: `M${h.tick + 1}`, hc: h.headcount }))} series={[{ key: 'hc', name: 'Headcount' }]} height={200} /> : <p className="small muted">Trend appears after two months.</p>}
        </Panel>
      </div>
      <Modal open={!!hire} onClose={() => setHire(null)} title={`Hire: ${team(hire?.teamId)?.role ?? ''}`} footer={<><Button onClick={() => setHire(null)}>Cancel</Button><Button variant="primary" onClick={async () => { if (hire && (await act('hire', hire))) setHire(null); }}>Open requisition</Button></>}>
        {hire && (() => {
          const t = team(hire.teamId)!;
          const monthly = t.salary * hire.count * 1.13;
          return (
            <div className="stack">
              <Field label="Number of people" htmlFor="hc"><input id="hc" className="input" type="number" min={1} max={500} value={hire.count} onChange={(e) => setHire({ ...hire, count: Math.floor(Number(e.target.value)) })} data-autofocus /></Field>
              <dl className="kv">
                <dt>Recruitment fees (on joining)</dt><dd>{inr(t.salary * 0.5 * hire.count)}</dd>
                <dt>Added payroll / month</dt><dd>{inr(monthly)}</dd>
                {t.department === 'production' && (<><dt>Added labor hours (after ramp)</dt><dd>~{num(hire.count * hoursPerHead)}</dd></>)}
              </dl>
              <Callout tone="info">Hires join after the time-to-fill and work at half productivity for their first two months.</Callout>
            </div>
          );
        })()}
      </Modal>
      <Modal open={!!pay} onClose={() => setPay(null)} title={`Salary: ${team(pay?.teamId)?.role ?? ''}`} footer={<><Button onClick={() => setPay(null)}>Cancel</Button><Button variant="primary" onClick={async () => { if (pay && (await act('set_salary', pay))) setPay(null); }}>Apply from next payroll</Button></>}>
        {pay && (
          <div className="stack">
            <Field label="Monthly gross salary per head" htmlFor="sal" hint={`Market: ${inr(c.computed.marketSalary[pay.teamId])} · minimum wage: ${inr(c.computed.minimumWage)}`}><MoneyInput id="sal" value={pay.salary} onChange={(v) => setPay({ ...pay, salary: v })} step={500} /></Field>
            <p className="small muted">Paying below market lowers morale and raises attrition. Cuts reduce morale immediately.</p>
          </div>
        )}
      </Modal>
      <Modal open={!!train} onClose={() => setTrain(null)} title={`Training: ${team(train ?? '')?.role ?? ''}`}>
        {train && catalog && (
          <div className="stack">
            {Object.entries(catalog.trainings).map(([k, v]) => {
              const t = team(train)!;
              return (
                <div key={k} className="panel" style={{ background: 'var(--panel-2)' }}>
                  <div className="row between"><b>{v.name}</b><span>{inr(v.costPerHead * t.headcount)}</span></div>
                  <p className="small muted">+{v.gain} skill after {v.months} month(s) (half above skill 80) · {inr(v.costPerHead)} per head · paid now</p>
                  <Button size="sm" variant="primary" className="mt" onClick={async () => { if (await act('start_training', { teamId: train, kind: k })) setTrain(null); }}>Start</Button>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
      <Confirm open={!!fire} onClose={() => setFire(null)} title={`Reduce ${team(fire?.teamId)?.role ?? ''}`} danger confirmLabel="Confirm reduction" onConfirm={async () => { if (fire && (await act('layoff', fire))) setFire(null); }}>
        {fire && (
          <div className="stack">
            <Field label="Number of people" htmlFor="lc"><input id="lc" className="input" type="number" min={1} max={team(fire.teamId)?.headcount} value={fire.count} onChange={(e) => setFire({ ...fire, count: Math.floor(Number(e.target.value)) })} /></Field>
            <p className="small">Severance: one month's salary per person ({inr((team(fire.teamId)?.salary ?? 0) * fire.count)}). Morale falls for this team and slightly across the company.</p>
          </div>
        )}
      </Confirm>
    </>
  );
}
