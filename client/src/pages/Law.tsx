/** Law & regulation (plan §9): policy timeline and compliance checklist attached to the company, with scope, effective date and modeled obligation. */
import { useState } from 'react';
import { useWorld } from '../store';
import { inr } from '../format';
import { PageHeader } from '../components/Shell';
import { Badge, Button, Callout, Confirm, DataTypeBadge, Loading, Panel, Table } from '../components/ui';

export default function Law() {
  const { view, catalog, act, canAct } = useWorld();
  const [confirm, setConfirm] = useState<string | null>(null);
  if (!view || !catalog) return <Loading />;
  const w = view.world;
  const c = view.company;
  const policies = [...w.policies].sort((a, b) => a.effectiveTick - b.effectiveTick);
  const pol = policies.find((p) => p.id === confirm);
  return (
    <>
      <PageHeader title="Law & regulation" module="law" />
      <Callout tone="info">Rules are simplified models of Indian regulation, each with a stated approximation. They are not legal advice.</Callout>
      {c && (
        <Panel className="mt" title={`Compliance checklist · ${c.name}`}>
          <Table head={<tr><th>Rule</th><th>Effective</th><th>Obligation</th><th>Status</th><th className="r">Penalties paid</th><th></th></tr>}>
            {c.compliance.map((cp) => {
              const p = w.policies.find((x) => x.id === cp.policyId)!;
              return (
                <tr key={cp.policyId}>
                  <td>{p.title}<div className="small faint">{p.description}</div></td>
                  <td>{p.effectiveLabel}{p.status === 'in_force' && <div><Badge tone="info">In force</Badge></div>}</td>
                  <td className="small">{p.kind === 'tax' ? '25% of taxable profit' : `${p.complianceCost ? `${inr(p.complianceCost)} one-off` : ''}${p.perUnitLevy ? ` · ${inr(p.perUnitLevy)}/unit sold` : ''}${p.monthlyPenalty ? ` · ${inr(p.monthlyPenalty)}/mo penalty if non-compliant` : ''}`}</td>
                  <td><Badge tone={cp.status === 'compliant' ? 'ok' : cp.status === 'non_compliant' ? 'bad' : 'warn'}>{cp.status.replace('_', ' ')}</Badge></td>
                  <td className="r">{inr(cp.penaltiesPaid)}</td>
                  <td>{cp.status !== 'compliant' && <Button size="sm" variant="primary" disabled={!canAct} onClick={() => setConfirm(p.id)}>Comply</Button>}</td>
                </tr>
              );
            })}
          </Table>
        </Panel>
      )}
      <Panel className="mt" title="Policy timeline" actions={<DataTypeBadge type="simulated" />}>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0 }} className="chain">
          {policies.map((p, i) => {
            const applies = c ? p.industries === 'all' || p.industries.includes(c.industry) : true;
            return (
              <li key={p.id} className="chain-step">
                <span className="chain-dot" aria-hidden>{i + 1}</span>
                <div>
                  <div className="row">
                    <b>{p.title}</b>
                    <Badge tone={p.status === 'in_force' ? 'info' : 'warn'}>{p.status === 'in_force' ? 'In force' : 'Announced'}</Badge>
                    {!applies && <Badge>Not your industry</Badge>}
                  </div>
                  <p className="small muted">Jurisdiction: {catalog.countries[p.jurisdiction].name} · scope: {p.industries === 'all' ? 'all industries' : p.industries.map((x) => catalog.industries[x].name).join(', ')} · announced {p.announcedLabel} · effective {p.effectiveLabel}</p>
                  <p className="small">{p.description}</p>
                  <p className="small faint">Approximation: {p.approximation}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </Panel>
      <Confirm open={!!pol} onClose={() => setConfirm(null)} title={`Comply with ${pol?.title}`} confirmLabel={`Pay ${inr(pol?.complianceCost ?? 0)}`} onConfirm={async () => { await act('comply_policy', { policyId: confirm }); setConfirm(null); }}>
        <p>The one-off compliance cost is paid from cash now and expensed to Compliance & regulatory (GL 6900). Penalties already incurred are not refunded.</p>
      </Confirm>
    </>
  );
}
