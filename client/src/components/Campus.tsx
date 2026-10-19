/**
 * Company campus: the emotional entry point into operations (plan §4 zone C).
 * 3D is optional — it is lazy-loaded, skipped when WebGL is unavailable or
 * disabled in settings, and every hotspot has a keyboard-accessible button
 * plus a context panel with real data and a link to its module.
 */
import { Component, lazy, Suspense, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Box, Minus, Plus, RotateCcw } from 'lucide-react';
import { useSession, useWorld } from '../store';
import { inr, num, pct } from '../format';
import type { CompanyView } from '../types';

const Campus3D = lazy(() => import('./Campus3D'));

export interface CampusSite {
  id: string;
  type: 'hq' | 'factory' | 'warehouse' | 'rnd_lab' | 'logistics_hub';
  label: string;
  level: number;
  status: string;
  pos: [number, number];
  tone: '' | 'warn' | 'bad' | 'off';
  facilityId: string;
}

const SLOT: Record<CampusSite['type'], [number, number][]> = {
  hq: [[0, -4]],
  factory: [[6, -2.5], [10.5, -4.5]],
  warehouse: [[-6, 2.8], [-10, -1]],
  rnd_lab: [[-6, -4.5]],
  logistics_hub: [[7.5, 3.4]],
};
const MODULE_FOR: Record<CampusSite['type'], string> = { hq: 'company', factory: 'manufacturing', warehouse: 'inventory', rnd_lab: 'rnd', logistics_hub: 'supply-chain' };
const LABEL: Record<CampusSite['type'], string> = { hq: 'Headquarters', factory: 'Factory', warehouse: 'Warehouse', rnd_lab: 'R&D Lab', logistics_hub: 'Logistics Hub' };

export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

class CanvasBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function buildSites(c: CompanyView): CampusSite[] {
  const used: Record<string, number> = {};
  const alerts = c.computed.alerts.filter((a) => !a.dismissed);
  return c.facilities.map((f) => {
    const i = (used[f.type] = (used[f.type] ?? -1) + 1);
    const pos = SLOT[f.type][Math.min(i, SLOT[f.type].length - 1)];
    const offset: [number, number] = i >= SLOT[f.type].length ? [pos[0] + i, pos[1] + i] : pos;
    let tone: CampusSite['tone'] = '';
    if (f.status === 'under_construction') tone = 'off';
    else if (f.type === 'factory' && alerts.some((a) => a.module === 'manufacturing' || a.id.startsWith('stockout'))) tone = 'warn';
    else if (f.type === 'warehouse' && alerts.some((a) => a.id === 'warehouse')) tone = 'warn';
    else if (f.type === 'rnd_lab' && alerts.some((a) => a.module === 'rnd')) tone = 'warn';
    if (f.type === 'hq' && alerts.some((a) => a.severity === 'critical')) tone = 'bad';
    return { id: f.id, facilityId: f.id, type: f.type, label: f.type === 'hq' ? 'Headquarters' : `${LABEL[f.type]}${i ? ` ${i + 1}` : ''}`, level: f.level, status: f.status, pos: offset, tone };
  });
}

function SiteDetail({ site, c, base }: { site: CampusSite; c: CompanyView; base: string }) {
  const f = c.facilities.find((x) => x.id === site.facilityId)!;
  const lines = c.lines.filter((l) => l.facilityId === f.id);
  const rows: [string, string][] = [
    ['Location', f.city],
    ['Status', f.status.replace('_', ' ')],
    ['Ownership', f.owned ? `Owned (book cost ${inr(f.cost, { compact: true })})` : 'Leased'],
    ['Running cost', `${inr(f.monthlyFixedCost, { compact: true })}/month`],
  ];
  if (f.type === 'factory') {
    rows.push(['Lines', `${lines.length} · planned ${num(lines.reduce((a, l) => a + l.plannedUnits, 0))} units`]);
    rows.push(['Energy available', `${num(c.computed.energy[f.id] ?? 0)} kWh/month`]);
    rows.push(['Labor available', `${num(c.computed.laborHours)} h/month`]);
  }
  if (f.type === 'warehouse') rows.push(['Storage used', `${num(c.computed.storageUsed)} / ${num(c.computed.storageCapacity)} units (${pct(c.computed.storageCapacity ? c.computed.storageUsed / c.computed.storageCapacity : 0, 0)})`]);
  if (f.type === 'rnd_lab') rows.push(['Active projects', String(c.rndProjects.filter((p) => p.status === 'active').length)]);
  if (f.type === 'hq') rows.push(['Headcount', num(c.teams.reduce((a, t) => a + t.headcount, 0))]);
  return (
    <div className="campus-panel" role="region" aria-label={`${site.label} details`}>
      <div className="row between">
        <b>{f.name}</b>
        <span className="small" style={{ color: '#9fb7cf' }}>Level {f.level}</span>
      </div>
      <dl className="kv small" style={{ marginTop: 8 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt style={{ color: '#9fb7cf' }}>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <Link to={`${base}/${MODULE_FOR[site.type]}`} className="btn sm primary" style={{ marginTop: 10, width: '100%' }}>
        Open {LABEL[site.type] === 'Headquarters' ? 'company profile' : MODULE_FOR[site.type].replace('-', ' ')} →
      </Link>
    </div>
  );
}

/** pre-rendered isometric fallback (SVG) with the same hotspots */
function IsoFallback({ sites, selected, onSelect }: { sites: CampusSite[]; selected: string | null; onSelect: (id: string) => void }) {
  const iso = (x: number, z: number) => [500 + (x - z) * 26, 210 + (x + z) * 13] as const;
  const color: Record<CampusSite['type'], string> = { hq: '#7fb6e6', factory: '#c9ced6', warehouse: '#d9d2c4', rnd_lab: '#b7a6f0', logistics_hub: '#e2734e' };
  return (
    <svg viewBox="0 0 1000 420" style={{ width: '100%', height: 420, display: 'block' }} role="img" aria-label="Isometric campus map">
      <polygon points={[iso(-16, -10), iso(16, -10), iso(16, 6), iso(-16, 6)].map((p) => p.join(',')).join(' ')} fill="#3f7d4f" />
      <polygon points={[iso(-16, 6), iso(16, 6), iso(16, 14), iso(-16, 14)].map((p) => p.join(',')).join(' ')} fill="#2a6fa5" />
      <polygon points={[iso(-15, 0), iso(15, 0), iso(15, 1.2), iso(-15, 1.2)].map((p) => p.join(',')).join(' ')} fill="#5b6573" />
      {sites.map((s) => {
        const [x, y] = iso(s.pos[0], s.pos[1]);
        const h = s.type === 'hq' ? 70 + s.level * 14 : s.type === 'logistics_hub' ? 46 : 40;
        const w = s.type === 'warehouse' ? 70 : 52;
        const sel = selected === s.id;
        return (
          <g key={s.id} onClick={() => onSelect(s.id)} style={{ cursor: 'pointer' }} opacity={s.status === 'under_construction' ? 0.5 : 1}>
            <polygon points={`${x},${y - h} ${x + w / 2},${y - h + w / 4} ${x + w / 2},${y + w / 4} ${x},${y + w / 2} ${x - w / 2},${y + w / 4} ${x - w / 2},${y - h + w / 4}`} fill={color[s.type]} stroke={sel ? '#22d6b0' : '#0b2238'} strokeWidth={sel ? 3 : 1} />
            <polygon points={`${x},${y - h} ${x + w / 2},${y - h + w / 4} ${x},${y - h + w / 2} ${x - w / 2},${y - h + w / 4}`} fill="#566270" />
            <line x1={x} y1={y - h + w / 2} x2={x} y2={y + w / 2} stroke="#0b2238" strokeOpacity={0.4} />
          </g>
        );
      })}
    </svg>
  );
}

export function Campus() {
  const { view, base } = useWorld();
  const { user } = useSession();
  const c = view?.company;
  const sites = useMemo(() => (c ? buildSites(c) : []), [c]);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [reset, setReset] = useState(0);
  const pref3d = user?.preferences.enable3d !== false;
  const [force2d, setForce2d] = useState(false);
  const can3d = useMemo(() => hasWebGL(), []);
  const use3d = pref3d && can3d && !force2d;
  if (!c) return null;
  const sel = sites.find((s) => s.id === selected);
  const fallback = <IsoFallback sites={sites} selected={selected} onSelect={setSelected} />;
  return (
    <div className="campus" aria-label={`${c.name} campus`}>
      {use3d ? (
        <CanvasBoundary fallback={fallback}>
          <Suspense fallback={<div style={{ height: 420, display: 'grid', placeItems: 'center', color: '#9fb7cf' }}><div className="spinner" aria-hidden /> <span className="sr-only">Loading 3D campus</span></div>}>
            <Campus3D sites={sites} selected={selected} onSelect={setSelected} zoom={zoom} resetKey={reset} />
          </Suspense>
        </CanvasBoundary>
      ) : (
        fallback
      )}
      <div className="campus-controls">
        {use3d && (
          <>
            <button className="btn icon sm" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))} aria-label="Zoom in">
              <Plus aria-hidden />
            </button>
            <button className="btn icon sm" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.15).toFixed(2)))} aria-label="Zoom out">
              <Minus aria-hidden />
            </button>
            <button className="btn icon sm" onClick={() => { setZoom(1); setReset((r) => r + 1); }} aria-label="Reset camera">
              <RotateCcw aria-hidden />
            </button>
          </>
        )}
        <button className="btn sm" onClick={() => setForce2d((f) => !f)} disabled={!can3d || !pref3d} title={!can3d ? 'WebGL is not available; showing the 2D campus' : !pref3d ? '3D disabled in settings' : undefined}>
          <Box aria-hidden /> {use3d ? '2D view' : '3D view'}
        </button>
      </div>
      {sel && <SiteDetail site={sel} c={c} base={base} />}
      <div className="campus-hud" role="toolbar" aria-label="Campus facilities">
        {sites.map((s) => (
          <button key={s.id} className="hotspot" aria-pressed={selected === s.id} onClick={() => setSelected(selected === s.id ? null : s.id)}>
            <span className={`dot ${s.tone}`} aria-hidden />
            <b>{s.label}</b>
            <small>{s.status === 'under_construction' ? 'Under construction' : `Level ${s.level}`}{s.tone === 'warn' ? ' · needs attention' : s.tone === 'bad' ? ' · critical' : ''}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
