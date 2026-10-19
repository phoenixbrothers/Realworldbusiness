/**
 * Chart primitives. Visual grammar (plan §11):
 *   actual   → solid bars / solid lines
 *   forecast → dashed blue line, lighter tint
 *   scenario → purple line with its own label
 * Every chart has a visible legend and an accessible summary.
 */
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine, BarChart, LineChart, Legend } from 'recharts';
import { inr } from '../format';

const C = { teal: '#22d6b0', blue: '#4e91ff', purple: '#9b7bff', amber: '#f5b94c', red: '#e85c67', grid: 'rgba(127,151,176,0.18)', axis: '#7f97b0' };

const axisProps = { stroke: C.axis, fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = { background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 12 };

export function Sparkline({ values, color = C.teal, label }: { values: number[]; color?: string; label: string }) {
  if (values.length < 2) return <svg className="spark" role="img" aria-label={`${label}: not enough history`} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 84},${32 - ((v - min) / (max - min || 1)) * 28}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 84 34" role="img" aria-label={`${label} trend over ${values.length} months`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export interface PerfPoint {
  label: string;
  revenue?: number | null;
  profit?: number | null;
  forecastRevenue?: number | null;
  forecastProfit?: number | null;
  scenarioRevenue?: number | null;
}

/** Revenue bars (actual) + profit bars + forecast dashed line */
export function PerformanceChart({ data, height = 240, show = { revenue: true, profit: true, forecast: true } }: { data: PerfPoint[]; height?: number; show?: { revenue: boolean; profit: boolean; forecast: boolean } }) {
  return (
    <div>
      <div style={{ width: '100%', height }} role="img" aria-label={`Financial performance chart, ${data.length} months, revenue and profit with forecast where available`}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} width={64} tickFormatter={(v) => inr(v, { compact: true })} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [inr(Number(v)), n]} />
            <ReferenceLine y={0} stroke={C.axis} />
            {show.revenue && <Bar dataKey="revenue" name="Revenue (actual)" fill={C.blue} radius={[4, 4, 0, 0]} maxBarSize={22} />}
            {show.profit && <Bar dataKey="profit" name="Net income (actual)" fill={C.teal} radius={[4, 4, 0, 0]} maxBarSize={22} />}
            {show.forecast && <Line dataKey="forecastRevenue" name="Revenue (forecast)" stroke={C.blue} strokeDasharray="5 4" strokeWidth={2} dot={{ r: 2 }} connectNulls />}
            {show.forecast && <Line dataKey="forecastProfit" name="Net income (forecast)" stroke={C.teal} strokeDasharray="5 4" strokeWidth={2} dot={{ r: 2 }} connectNulls />}
            {data.some((d) => d.scenarioRevenue != null) && <Line dataKey="scenarioRevenue" name="Revenue (scenario)" stroke={C.purple} strokeWidth={2} dot={{ r: 2 }} connectNulls />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="legend mt" aria-hidden>
        {show.revenue && <span><i style={{ background: C.blue }} />Revenue — actual</span>}
        {show.profit && <span><i style={{ background: C.teal }} />Net income — actual</span>}
        {show.forecast && <span><i style={{ background: 'none', borderTop: `2px dashed ${C.blue}` }} />Forecast (dashed)</span>}
        {data.some((d) => d.scenarioRevenue != null) && <span><i style={{ background: C.purple }} />Scenario</span>}
      </div>
    </div>
  );
}

export function LinesChart({ data, series, height = 220, format = (v: number) => String(v), yWidth = 56 }: { data: Record<string, any>[]; series: { key: string; name: string; color?: string; dashed?: boolean }[]; height?: number; format?: (v: number) => string; yWidth?: number }) {
  const palette = [C.blue, C.teal, C.purple, C.amber, C.red, '#7fd1ff'];
  return (
    <div style={{ width: '100%', height }} role="img" aria-label={`Line chart of ${series.map((s) => s.name).join(', ')}`}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} width={yWidth} tickFormatter={format} domain={['auto', 'auto']} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [format(Number(v)), n]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s, i) => (
            <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.color ?? palette[i % palette.length]} strokeWidth={2} dot={false} strokeDasharray={s.dashed ? '5 4' : undefined} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarsChart({ data, bars, height = 220, format = (v: number) => String(v), stacked, layout = 'horizontal' }: { data: Record<string, any>[]; bars: { key: string; name: string; color?: string }[]; height?: number; format?: (v: number) => string; stacked?: boolean; layout?: 'horizontal' | 'vertical' }) {
  const palette = [C.blue, C.teal, C.purple, C.amber, C.red];
  return (
    <div style={{ width: '100%', height }} role="img" aria-label={`Bar chart of ${bars.map((b) => b.name).join(', ')}`}>
      <ResponsiveContainer>
        <BarChart data={data} layout={layout} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={C.grid} vertical={layout === 'vertical'} horizontal={layout === 'horizontal'} />
          {layout === 'horizontal' ? (
            <>
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} width={60} tickFormatter={format} />
            </>
          ) : (
            <>
              <XAxis type="number" {...axisProps} tickFormatter={format} />
              <YAxis type="category" dataKey="label" {...axisProps} width={140} />
            </>
          )}
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [format(Number(v)), n]} />
          {bars.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {bars.map((b, i) => (
            <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color ?? palette[i % palette.length]} stackId={stacked ? 's' : undefined} radius={stacked ? 0 : [4, 4, 4, 4]} maxBarSize={26}>
              {data.map((d, j) => (d.__color ? <Cell key={j} fill={d.__color} /> : null))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Waterfall from a start value through signed steps to an end value */
export function Waterfall({ start, steps, end, startLabel, endLabel, height = 260 }: { start: number; steps: { label: string; amount: number }[]; end: number; startLabel: string; endLabel: string; height?: number }) {
  let run = start;
  const rows: { label: string; base: number; value: number; amount: number; __color: string }[] = [{ label: startLabel, base: Math.min(0, start), value: Math.abs(start), amount: start, __color: C.blue }];
  for (const s of steps) {
    if (s.amount === 0) continue;
    const next = run + s.amount;
    rows.push({ label: s.label, base: Math.min(run, next), value: Math.abs(s.amount), amount: s.amount, __color: s.amount >= 0 ? C.teal : C.red });
    run = next;
  }
  rows.push({ label: endLabel, base: Math.min(0, end), value: Math.abs(end), amount: end, __color: C.blue });
  return (
    <div>
      <div style={{ width: '100%', height }} role="img" aria-label={`Waterfall from ${startLabel} ${inr(start)} to ${endLabel} ${inr(end)}`}>
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" {...axisProps} interval={0} angle={-25} textAnchor="end" height={64} />
            <YAxis {...axisProps} width={64} tickFormatter={(v) => inr(v, { compact: true })} />
            <Tooltip contentStyle={tooltipStyle} formatter={(_v: any, _n: any, p: any) => [inr(p.payload.amount, { sign: true }), p.payload.label]} />
            <ReferenceLine y={0} stroke={C.axis} />
            <Bar dataKey="base" stackId="w" fill="transparent" />
            <Bar dataKey="value" stackId="w" radius={[3, 3, 0, 0]}>
              {rows.map((r, i) => (
                <Cell key={i} fill={r.__color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="legend" aria-hidden>
        <span><i style={{ background: C.blue }} />Period total</span>
        <span><i style={{ background: C.teal }} />Increase</span>
        <span><i style={{ background: C.red }} />Decrease</span>
      </div>
    </div>
  );
}

export const CHART_COLORS = C;
