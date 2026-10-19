/** KPI tiles with drill-down: definition, period, trend, variance and source journal lines (plan §4 zone D, UX-04). */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, BarChart3, Hourglass, PieChart, TrendingUp, Landmark, Package, Target } from 'lucide-react';
import type { Kpi } from '../types';
import { useWorld, useWorldQuery } from '../store';
import { deltaClass, inr, pct } from '../format';
import { DataTypeBadge, Drawer, ErrorState, Loading, Table } from './ui';
import { LinesChart, Sparkline, Waterfall } from './Charts';

const ICONS: Record<string, [React.ComponentType<{ 'aria-hidden'?: boolean }>, string]> = {
  cash: [Banknote, '#22d6b0'],
  revenue: [BarChart3, '#4e91ff'],
  gross_margin: [PieChart, '#f5b94c'],
  runway: [Hourglass, '#9b7bff'],
  operating_profit: [TrendingUp, '#22d6b0'],
  debt: [Landmark, '#e85c67'],
  inventory: [Package, '#4e91ff'],
  share: [Target, '#9b7bff'],
};

function deltaText(k: Kpi) {
  const d = k.comparison?.delta;
  if (d === null || d === undefined) return k.comparison ? `${k.comparison.label}: ${k.comparison.display}` : '';
  if (k.unit === '%') return `${d >= 0 ? '▲' : '▼'} ${Math.abs(d * 100).toFixed(1)} pts ${k.comparison!.label}`;
  return `${d >= 0 ? '▲' : '▼'} ${Math.abs(d * 100).toFixed(1)}% ${k.comparison!.label}`;
}

export function KpiStrip({ keys }: { keys: string[] }) {
  const { view } = useWorld();
  const [open, setOpen] = useState<string | null>(null);
  const list = view?.company?.computed.kpis ?? [];
  return (
    <>
      <div className="kpis">
        {keys.map((key) => {
          const k = list.find((x) => x.key === key);
          if (!k) return null;
          const [Icon, color] = ICONS[key] ?? [BarChart3, '#4e91ff'];
          const inverse = key === 'debt';
          return (
            <button key={key} className="kpi" onClick={() => setOpen(key)} aria-label={`${k.label}: ${k.display}. ${deltaText(k)}. Open details`}>
              <span className="kpi-icon" style={{ background: `${color}22`, color }}>
                <Icon aria-hidden />
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="kpi-label">
                  {k.label}
                  {k.dataType !== 'actual' && <DataTypeBadge type={k.dataType} />}
                </span>
                <span className="kpi-value num" style={{ display: 'block' }}>{k.display}</span>
                <span className={`kpi-delta ${deltaClass(k.comparison?.delta, inverse)}`}>{deltaText(k)}</span>
              </span>
              <Sparkline values={k.trend.map((t) => t.value)} color={color} label={k.label} />
            </button>
          );
        })}
      </div>
      {open && <KpiDrawer kpiKey={open} onClose={() => setOpen(null)} />}
    </>
  );
}

interface Detail {
  kpi: Kpi;
  records: { entryId: string; month: string; memo: string; account: string; accountName: string; debit: number; credit: number; source: { type: string; id: string } }[];
  bridge: { from: string; to: string; start: number; end: number; steps: { label: string; amount: number; source: string }[]; reconciles: boolean } | null;
}

export function KpiDrawer({ kpiKey, onClose }: { kpiKey: string; onClose: () => void }) {
  const { worldId, companyId, base } = useWorld();
  const { data, error, loading } = useWorldQuery<Detail>(companyId ? `/api/worlds/${worldId}/companies/${companyId}/kpi/${kpiKey}` : null);
  const k = data?.kpi;
  const fmt = (v: number) => (k?.unit === 'INR' ? inr(v, { compact: true }) : k?.unit === '%' ? pct(v) : v.toFixed(1));
  return (
    <Drawer open onClose={onClose} title={k?.label ?? 'KPI detail'} labelExtra={k && <DataTypeBadge type={k.dataType} />}>
      {error ? (
        <ErrorState error={error} />
      ) : loading || !k ? (
        <Loading />
      ) : (
        <div className="stack">
          <div>
            <div className="kpi-value num" style={{ fontSize: 28, fontWeight: 700 }}>{k.display}</div>
            <div className="small muted">{k.period}</div>
          </div>
          <div className="panel" style={{ background: 'var(--panel-2)' }}>
            <h3>Definition</h3>
            <p className="small mt">{k.definition}</p>
            {k.note && <p className="small warn mt">{k.note}</p>}
            {k.accounts.length > 0 && (
              <p className="small faint mt">
                Source accounts:{' '}
                {k.accounts.map((a) => (
                  <Link key={a} to={`${base}/finance?account=${a}`} onClick={onClose} style={{ marginRight: 6 }}>
                    {a}
                  </Link>
                ))}
              </p>
            )}
          </div>
          {k.comparison && (
            <dl className="kv">
              <dt>{k.comparison.label}</dt>
              <dd>{k.comparison.display}</dd>
            </dl>
          )}
          {k.trend.length > 1 && (
            <div>
              <h3 className="mb">Trend (actual)</h3>
              <LinesChart data={k.trend.map((t) => ({ label: t.label, v: t.value }))} series={[{ key: 'v', name: k.label }]} height={180} format={fmt} yWidth={70} />
            </div>
          )}
          {data.bridge && (
            <div>
              <h3>Why net income changed: {data.bridge.from} → {data.bridge.to}</h3>
              <p className="small muted mb">Each bar is the change in one ledger driver. {data.bridge.reconciles ? 'Bridge reconciles to the reported figures.' : 'Bridge does not fully reconcile.'}</p>
              <Waterfall start={data.bridge.start} end={data.bridge.end} startLabel={data.bridge.from} endLabel={data.bridge.to} steps={data.bridge.steps} />
            </div>
          )}
          <div>
            <h3 className="mb">Underlying journal lines (last 3 months)</h3>
            {data.records.length === 0 ? (
              <p className="small muted">No postings in this period.</p>
            ) : (
              <Table compact head={<tr><th>Entry</th><th>Month</th><th>Memo</th><th>Acct</th><th className="r">Debit</th><th className="r">Credit</th></tr>}>
                {data.records.slice(0, 60).map((r, i) => (
                  <tr key={`${r.entryId}-${r.account}-${i}`}>
                    <td className="mono">
                      <Link to={`${base}/transactions?entry=${r.entryId}`} onClick={onClose}>{r.entryId}</Link>
                    </td>
                    <td className="small">{r.month}</td>
                    <td className="small">{r.memo}</td>
                    <td className="mono">{r.account}</td>
                    <td className="r">{r.debit ? inr(r.debit) : ''}</td>
                    <td className="r">{r.credit ? inr(r.credit) : ''}</td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
