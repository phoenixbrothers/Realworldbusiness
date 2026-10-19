/** Causal chain view: trigger → exposure → operational impact → financial consequence → mitigation (UX-06). */
import { Link } from 'react-router-dom';
import type { Exposure, WorldEvent } from '../types';
import { useWorld } from '../store';
import { inr, pct } from '../format';
import { Badge, Button, Callout, DataTypeBadge, Drawer, SeverityBadge } from './ui';

export function exposureTone(l: Exposure['level']) {
  return l === 'high' ? 'bad' : l === 'medium' ? 'warn' : l === 'low' ? 'info' : 'neutral';
}

export function EventDetail({ event, exposure, onClose }: { event: WorldEvent & { tickLabel?: string; endLabel?: string }; exposure?: Exposure; onClose: () => void }) {
  const { act, base, canAct, view } = useWorld();
  const active = event.status === 'active';
  return (
    <Drawer open onClose={onClose} title={event.title} labelExtra={<DataTypeBadge type="simulated" label="Simulated event" />}>
      <div className="stack">
        <div className="row">
          <SeverityBadge severity={event.severity} />
          <Badge tone={event.sentiment === 'opportunity' ? 'purple' : event.sentiment === 'risk' ? 'warn' : 'neutral'}>{event.sentiment}</Badge>
          <Badge tone={active ? 'ok' : 'neutral'}>{active ? 'Active' : 'Expired'}</Badge>
          <span className="small faint">
            {event.tickLabel} → {event.endLabel} · confidence {pct(event.confidence, 0)}
          </span>
        </div>
        <p>{event.summary}</p>
        {exposure ? (
          <>
            <div className="row">
              <span className="label">Your exposure:</span>
              <Badge tone={exposureTone(exposure.level)}>{exposure.level}</Badge>
              {exposure.monthlyImpact !== 0 && (
                <span className="small">
                  {inr(Math.abs(exposure.monthlyImpact))}/month {exposure.monthlyImpact > 0 ? 'at risk' : 'benefit'} <DataTypeBadge type="estimate" />
                </span>
              )}
            </div>
            <ol className="chain" aria-label="Causal chain" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {exposure.chain.map((s, i) => (
                <li className="chain-step" key={s.stage}>
                  <span className="chain-dot" aria-hidden>{i + 1}</span>
                  <div>
                    <b className="small" style={{ display: 'block' }}>{s.title}</b>
                    <span className="small muted">{s.text}</span>
                  </div>
                </li>
              ))}
            </ol>
            {exposure.items.length > 0 && (
              <div>
                <h3 className="mb">Exposed records</h3>
                <div className="list">
                  {exposure.items.map((it) => (
                    <Link key={`${it.type}-${it.id}`} className="list-item" to={`${base}/${it.module}?focus=${it.id}`} onClick={onClose} style={{ textDecoration: 'none' }}>
                      <Badge>{it.type.replace('_', ' ')}</Badge>
                      <span>
                        <span style={{ display: 'block' }}>{it.label}</span>
                        <span className="small faint">{it.detail}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            <Callout tone="info" title="Uncertainty">
              {exposure.uncertainty}
            </Callout>
            {exposure.mitigations.length > 0 && active && (
              <div>
                <h3 className="mb">Response options</h3>
                <p className="small muted mb">Options are not free or instant; costs are estimates and the engine validates every action.</p>
                <div className="stack">
                  {exposure.mitigations.map((m) => (
                    <div key={m.id} className="panel" style={{ background: 'var(--panel-2)' }}>
                      <div className="row between">
                        <b>{m.label}</b>
                        {m.estCost > 0 && (
                          <span className="small">
                            {inr(m.estCost)} <DataTypeBadge type="estimate" />
                          </span>
                        )}
                      </div>
                      <p className="small muted">{m.description}</p>
                      <div className="row between mt">
                        <span className="small faint">
                          Timing: {m.timing} · {m.resilience}
                        </span>
                        {m.action ? (
                          <Button size="sm" variant="primary" disabled={!canAct} onClick={() => act(m.action!.type, m.action!.payload)}>
                            Apply
                          </Button>
                        ) : m.link ? (
                          <Link className="btn sm" to={`${base}/${m.link}`} onClick={onClose}>
                            Open {m.link.replace('-', ' ')}
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="small muted">{view?.company ? 'No exposure computed for this event (expired events are kept for history).' : 'Create a company to see your exposure.'}</p>
        )}
        <div className="panel" style={{ background: 'var(--panel-2)' }}>
          <h3 className="mb">Declared effects (simulation rules)</h3>
          <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(event.effects, null, 2)}</pre>
        </div>
      </div>
    </Drawer>
  );
}
