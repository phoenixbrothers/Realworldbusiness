/** Stylized world map: countries, trade routes and active-event overlays (plan §9). The map is a decision tool. */
import type { Catalog, WorldMeta } from '../types';

const LAND = [
  'M60,60 L300,40 L332,92 L300,140 L268,170 L238,200 L205,214 L180,190 L140,160 L100,120 L60,100 Z',
  'M250,228 L300,218 L332,262 L320,322 L290,400 L270,422 L258,350 L244,280 Z',
  'M466,70 L560,58 L585,100 L560,132 L520,142 L480,132 L462,100 Z',
  'M468,152 L560,150 L612,200 L602,262 L570,332 L530,352 L508,300 L488,240 L464,192 Z',
  'M560,58 L850,46 L905,100 L865,150 L822,190 L800,232 L762,222 L725,236 L700,204 L660,192 L622,162 L585,132 Z',
  'M770,242 L832,250 L852,266 L792,268 Z',
  'M820,300 L902,290 L922,342 L862,362 L820,342 Z',
];

export function WorldMap({ world, catalog, selected, onSelect, highlightRoutes = [], height = 360 }: { world: WorldMeta; catalog: Catalog; selected?: string | null; onSelect?: (code: string) => void; highlightRoutes?: string[]; height?: number }) {
  const routeRisk = Object.fromEntries(world.routeStatus.map((r) => [r.routeId, r]));
  const activeByCountry: Record<string, number> = {};
  for (const e of world.events) if (e.status === 'active') for (const c of e.countries) activeByCountry[c] = (activeByCountry[c] ?? 0) + 1;
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox="40 20 920 420" style={{ width: '100%', height, display: 'block', background: 'color-mix(in srgb, var(--blue) 8%, var(--panel))', borderRadius: 12 }} role="img" aria-label="World map with simulated trade routes and country risk">
        {LAND.map((d, i) => (
          <path key={i} d={d} fill="var(--panel-3)" stroke="var(--line)" strokeWidth={1} />
        ))}
        {Object.values(catalog.routes).filter((r) => r.mode !== 'road').map((r) => {
          const st = routeRisk[r.id];
          const color = st?.risk === 'high' ? '#e85c67' : st?.risk === 'medium' ? '#f5b94c' : '#22d6b0';
          const hl = highlightRoutes.includes(r.id);
          return (
            <g key={r.id}>
              <polyline points={r.path.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth={hl ? 4 : 2} strokeDasharray={st?.risk === 'high' ? '6 4' : undefined} strokeLinejoin="round" opacity={0.9}>
                <title>{`${r.name}: ${st?.risk === 'high' ? `disrupted (+${st.delay} month delay)` : st?.risk === 'medium' ? 'elevated risk' : 'normal'}`}</title>
              </polyline>
            </g>
          );
        })}
        {Object.values(catalog.countries).map((c) => {
          const ec = world.economy.countries[c.code];
          const stab = ec.stability;
          const fill = c.code === 'IN' ? '#4e91ff' : stab < 60 ? '#e85c67' : stab < 72 ? '#f5b94c' : '#22d6b0';
          const sel = selected === c.code;
          const events = activeByCountry[c.code] ?? 0;
          return (
            <g key={c.code} transform={`translate(${c.map.x},${c.map.y})`} style={{ cursor: onSelect ? 'pointer' : 'default' }} onClick={() => onSelect?.(c.code)} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={onSelect ? `${c.name}: stability ${stab.toFixed(0)}${events ? `, ${events} active events` : ''}` : undefined} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect?.(c.code)}>
              <circle r={sel ? 13 : 10} fill={fill} stroke={sel ? '#fff' : '#07182b'} strokeWidth={sel ? 3 : 2} />
              {events > 0 && <circle r={17} fill="none" stroke="#f5b94c" strokeWidth={2} strokeDasharray="3 3" />}
              <text y={-16} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--text)" style={{ paintOrder: 'stroke', stroke: 'var(--panel)', strokeWidth: 3 }}>
                {c.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="legend mt">
        <span><i style={{ background: '#4e91ff' }} />Home market</span>
        <span><i style={{ background: '#22d6b0' }} />Stable / normal route</span>
        <span><i style={{ background: '#f5b94c' }} />Elevated risk</span>
        <span><i style={{ background: '#e85c67' }} />Unstable / disrupted (dashed)</span>
        <span><i style={{ background: 'none', border: '1px dashed #f5b94c', height: 8, width: 8, borderRadius: 8 }} />Active event</span>
      </div>
    </div>
  );
}
