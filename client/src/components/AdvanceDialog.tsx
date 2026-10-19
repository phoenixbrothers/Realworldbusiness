/**
 * Advance simulation (plan §10, UX-08): review pending decisions and risks →
 * see expected effects → confirm → show changes and exceptions.
 * The request carries the expected tick so a duplicate or stale advance is rejected server-side.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useWorld } from '../store';
import { inr, num } from '../format';
import { Badge, Button, Callout, DataTypeBadge, Loading, Modal, Table, ErrorState } from './ui';
import type { Projection } from '../types';

interface Preview {
  month: string;
  tick: number;
  production: { lineId: string; line?: string; product: string; planned: number; feasible: number; bottleneck: string | null }[];
  arriving: { id: string; label: string; supplier: string }[];
  cash: number;
  obligations: { payroll: number; payablesDue: number; receivablesDue: number };
  pendingDecisions: { label: string; module: string }[];
  risks: { id: string; title: string; reason: string; severity: string; module: string }[];
}
interface Report {
  label: string;
  companies: { companyId: string; name: string; lines: string[]; exceptions: string[] }[];
  newEvents: { id: string; title: string; severity: string }[];
}

export function AdvanceDialog({ onClose }: { onClose: () => void }) {
  const { worldId, companyId, view, act, base } = useWorld();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [forecast, setForecast] = useState<Projection | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  useEffect(() => {
    if (!companyId) return;
    Promise.all([api.get<Preview>(`/api/worlds/${worldId}/companies/${companyId}/advance-preview`), api.get<Projection>(`/api/worlds/${worldId}/companies/${companyId}/forecast?months=1`)])
      .then(([p, f]) => {
        setPreview(p);
        setForecast(f);
      })
      .catch(setError);
  }, [worldId, companyId]);
  const confirm = async () => {
    if (!view) return;
    setBusy(true);
    const r = await act('advance_month', { expectedTick: view.world.tick }, { quiet: true, companyId: null });
    setBusy(false);
    if (r) setReport(r.data as Report);
  };
  const f = forecast?.points[0];
  if (report) {
    return (
      <Modal open onClose={onClose} title={`${report.label} closed`} wide footer={<Button variant="primary" onClick={onClose} data-autofocus>Continue</Button>} labelExtra={<DataTypeBadge type="actual" label="Results posted" />}>
        <div className="stack">
          {report.companies.map((c) => (
            <div key={c.companyId} className="panel" style={{ background: 'var(--panel-2)' }}>
              <h3>{c.name}</h3>
              <ul className="small" style={{ margin: '6px 0', paddingLeft: 18 }}>
                {c.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
              {c.exceptions.length > 0 ? (
                <Callout tone="warn" title={`${c.exceptions.length} exception(s)`}>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {c.exceptions.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </Callout>
              ) : (
                <Callout tone="ok">No operational exceptions this month.</Callout>
              )}
            </div>
          ))}
          {report.newEvents.length > 0 && (
            <div>
              <h3 className="mb">New world events (simulated)</h3>
              <div className="list">
                {report.newEvents.map((e) => (
                  <Link key={e.id} to={`${base}/events?focus=${e.id}`} className="list-item" onClick={onClose} style={{ textDecoration: 'none' }}>
                    <Badge tone={e.severity === 'high' || e.severity === 'critical' ? 'bad' : e.severity === 'medium' ? 'warn' : 'info'}>{e.severity}</Badge>
                    <span>{e.title}</span>
                    <span className="small faint" style={{ marginLeft: 'auto' }}>Inspect causal impact →</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          <p className="small muted">Every figure above is posted to the ledger. Open Finance or Reports to trace any number to its journal entries.</p>
        </div>
      </Modal>
    );
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`Advance to the end of ${preview?.month ?? view?.world.label ?? ''}`}
      wide
      footer={
        <>
          <Button onClick={onClose}>Not yet</Button>
          <Button variant="primary" onClick={confirm} loading={busy} disabled={!preview}>
            Confirm & run month
          </Button>
        </>
      }
    >
      {error ? (
        <ErrorState error={error} />
      ) : !preview ? (
        <Loading label="Preparing preflight summary…" />
      ) : (
        <div className="stack">
          <p className="small muted">Running a month processes payroll, purchases, production, sales, R&D, finance and world events for every company in this world. This cannot be undone; the simulation will pause again at the start of next month.</p>
          {preview.pendingDecisions.length > 0 && (
            <Callout tone="warn" title="Pending decisions">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {preview.pendingDecisions.map((d, i) => (
                  <li key={i}>
                    <Link to={`${base}/${d.module}`} onClick={onClose}>{d.label}</Link>
                  </li>
                ))}
              </ul>
            </Callout>
          )}
          {preview.risks.length > 0 && (
            <Callout tone="bad" title="Unresolved high-priority risks">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {preview.risks.map((r) => (
                  <li key={r.id}>
                    <Link to={`${base}/${r.module}`} onClick={onClose}>{r.title}</Link> — {r.reason}
                  </li>
                ))}
              </ul>
            </Callout>
          )}
          <div className="grid g2">
            <div className="panel" style={{ background: 'var(--panel-2)' }}>
              <h3 className="mb">Cash obligations this month</h3>
              <dl className="kv">
                <dt>Cash now</dt>
                <dd>{inr(preview.cash)}</dd>
                <dt>Payroll (incl. employer contributions)</dt>
                <dd>{inr(-preview.obligations.payroll)}</dd>
                <dt>Payables falling due</dt>
                <dd>{inr(-preview.obligations.payablesDue)}</dd>
                <dt>Receivables falling due</dt>
                <dd>{inr(preview.obligations.receivablesDue)}</dd>
              </dl>
            </div>
            <div className="panel" style={{ background: 'var(--panel-2)' }}>
              <div className="row between mb">
                <h3>Expected result</h3>
                <DataTypeBadge type="forecast" />
              </div>
              {f ? (
                <dl className="kv">
                  <dt>Revenue</dt>
                  <dd>{inr(f.revenue)}</dd>
                  <dt>Net income</dt>
                  <dd>{inr(f.netIncome)}</dd>
                  <dt>Cash at month end</dt>
                  <dd>{inr(f.cash)}</dd>
                  <dt>Units sold</dt>
                  <dd>{num(f.unitsSold)}</dd>
                </dl>
              ) : (
                <p className="small muted">No forecast available.</p>
              )}
              <p className="small faint mt">Assumes no new events and on-time deliveries. Actual results will differ.</p>
            </div>
          </div>
          <div>
            <h3 className="mb">Production plan</h3>
            <Table head={<tr><th>Line</th><th>Product</th><th className="r">Planned</th><th className="r">Feasible now</th><th>Limiting factor</th></tr>}>
              {preview.production.map((p) => (
                <tr key={p.lineId}>
                  <td>{p.line}</td>
                  <td>{p.product}</td>
                  <td className="r">{num(p.planned)}</td>
                  <td className="r">{num(p.feasible)}</td>
                  <td>{p.bottleneck ? <Badge tone="warn">{p.bottleneck}</Badge> : <span className="faint">—</span>}</td>
                </tr>
              ))}
            </Table>
          </div>
          <div>
            <h3 className="mb">Deliveries scheduled</h3>
            {preview.arriving.length ? (
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {preview.arriving.map((a) => (
                  <li key={a.id}>
                    {a.id}: {a.label} from {a.supplier}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">No deliveries due this month.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
