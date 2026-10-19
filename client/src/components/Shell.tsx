import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, BookOpen, Boxes, Building2, ChartLine, Factory, FileText, FlaskConical, Gavel, Globe2, Handshake, LayoutDashboard, LineChart, LogOut, Megaphone, Menu, Newspaper, Play, Search, Settings, ShoppingCart, Ship, Swords, Truck, Users, Wallet,
} from 'lucide-react';
import { api } from '../api';
import { useSession, useWorld } from '../store';
import { Badge, Button, DataTypeBadge, severityTone } from './ui';
import { AdvanceDialog } from './AdvanceDialog';

export const MODULES: { group: string; items: { id: string; label: string; icon: React.ComponentType<{ 'aria-hidden'?: boolean }> }[] }[] = [
  { group: 'Overview', items: [{ id: 'overview', label: 'World Overview', icon: LayoutDashboard }, { id: 'events', label: 'News & Events', icon: Newspaper }] },
  { group: 'Company', items: [{ id: 'company', label: 'My Companies', icon: Building2 }, { id: 'workforce', label: 'Workforce & HR', icon: Users }] },
  { group: 'Operations', items: [{ id: 'manufacturing', label: 'Manufacturing', icon: Factory }, { id: 'inventory', label: 'Inventory & Warehousing', icon: Boxes }, { id: 'supply-chain', label: 'Supply Chain & Logistics', icon: Truck }, { id: 'rnd', label: 'Research & Development', icon: FlaskConical }] },
  { group: 'Commercial', items: [{ id: 'marketing', label: 'Marketing & Branding', icon: Megaphone }, { id: 'sales', label: 'Sales & Customers', icon: ShoppingCart }, { id: 'markets', label: 'Markets & Competitors', icon: Swords }] },
  { group: 'Finance', items: [{ id: 'finance', label: 'Finance & Accounting', icon: Wallet }, { id: 'investments', label: 'Investments', icon: LineChart }, { id: 'transactions', label: 'Transactions', icon: Handshake }] },
  { group: 'World', items: [{ id: 'countries', label: 'Countries & Geopolitics', icon: Globe2 }, { id: 'trade', label: 'Global Trade', icon: Ship }, { id: 'economics', label: 'Economics', icon: ChartLine }, { id: 'law', label: 'Law & Regulation', icon: Gavel }] },
  { group: 'Insights', items: [{ id: 'reports', label: 'Reports & Analytics', icon: FileText }] },
];
export const moduleLabel = (id: string) => MODULES.flatMap((g) => g.items).find((i) => i.id === id)?.label ?? (id === 'settings' ? 'Settings' : id);

export function Shell({ children }: { children: ReactNode }) {
  const { view, base, companyId } = useWorld();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const alertCount = view?.company?.computed.alerts.filter((a) => !a.dismissed && (a.severity === 'critical' || a.severity === 'high')).length ?? 0;
  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <nav className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <Link to="/worlds" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="brand-mark" aria-hidden />
          <span>
            <b>REAL-WORLD</b>
            <span>Business simulation</span>
          </span>
        </Link>
        {MODULES.map((g) => (
          <div className="nav-group" key={g.group}>
            <h4>{g.group}</h4>
            {g.items.map((it) => (
              <NavLink key={it.id} to={`${base}/${it.id}`} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <it.icon aria-hidden />
                {it.label}
                {it.id === 'overview' && alertCount > 0 && <span className="nav-badge" aria-label={`${alertCount} high-priority alerts`}>{alertCount}</span>}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="nav-group">
          <NavLink to={`${base}/settings`} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Settings aria-hidden />
            Settings & Account
          </NavLink>
        </div>
        <div className="sidebar-foot">
          <Link to={`${base}/reports?tab=guide`} className="nav-link" style={{ border: '1px solid var(--line-soft)' }}>
            <BookOpen aria-hidden />
            <span>
              Help & guide
              <span className="small faint" style={{ display: 'block' }}>How the simulation works</span>
            </span>
          </Link>
        </div>
      </nav>
      {open && <div className="overlay" style={{ zIndex: 80, background: 'rgba(0,0,0,.4)' }} onClick={() => setOpen(false)} aria-hidden />}
      <div className="main">
        <TopBar onMenu={() => setOpen((o) => !o)} companyId={companyId} />
        <main id="main" className="content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

function TopBar({ onMenu, companyId }: { onMenu: () => void; companyId: string | null }) {
  const { view, worldId, base, canAct } = useWorld();
  const { user, logout } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [advOpen, setAdvOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!bell) return;
    const h = (e: MouseEvent) => !bellRef.current?.contains(e.target as Node) && setBell(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setBell(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [bell]);
  const w = view?.world;
  const notes = w?.notifications ?? [];
  const module = loc.pathname.split('/')[5] ?? 'overview';
  return (
    <header className="topbar">
      <button className="btn icon ghost menu-btn" onClick={onMenu} aria-label="Open navigation">
        <Menu aria-hidden />
      </button>
      <GlobalSearch worldId={worldId} companyId={companyId} onPick={(module, id) => nav(`${base}/${module}${id ? `?focus=${encodeURIComponent(id)}` : ''}`)} />
      {w && w.companies.length > 1 && (
        <label className="row small">
          <span className="sr-only">Selected company</span>
          <select className="input" style={{ width: 'auto', padding: '6px 8px' }} value={companyId ?? ''} onChange={(e) => nav(`/w/${worldId}/c/${e.target.value}/${module}`)}>
            {w.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.lifecycle !== 'operating' ? `(${c.lifecycle})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <div style={{ flex: 1 }} />
      {w && (
        <div className="timebox" aria-label="Simulation time">
          <div className="tb-text">
            <b>{w.label}</b>
            <span>
              Month {w.month}, Year {w.year} · <span title="The simulation only advances when you confirm">Paused</span>
            </span>
          </div>
          <Button variant="primary" onClick={() => setAdvOpen(true)} disabled={!canAct || !view?.company} title={!canAct ? 'Your role is read-only' : !view?.company ? 'Create a company first' : 'Review and advance one month'}>
            <Play aria-hidden /> Run next month
          </Button>
        </div>
      )}
      <div style={{ position: 'relative' }} ref={bellRef}>
        <button className="btn icon ghost" aria-label={`Notifications (${notes.length})`} aria-expanded={bell} onClick={() => setBell((b) => !b)}>
          <Bell aria-hidden />
          {notes.some((n) => n.tick >= (w?.tick ?? 0) - 1) && <span className="nav-badge" style={{ position: 'absolute', top: 0, right: 0 }}>{notes.filter((n) => n.tick >= (w?.tick ?? 0) - 1).length}</span>}
        </button>
        {bell && (
          <div className="popover" role="dialog" aria-label="Notifications">
            <div className="panel-head" style={{ padding: '12px 14px 0' }}>
              <h3>Notifications</h3>
              <DataTypeBadge type="simulated" />
            </div>
            <div className="list" style={{ padding: '0 14px 10px' }}>
              {notes.length === 0 && <p className="small muted">Nothing yet.</p>}
              {notes.slice(0, 30).map((n) => (
                <button
                  key={n.id}
                  className="list-item"
                  onClick={() => {
                    setBell(false);
                    if (n.link) nav(`${base}/${n.link.module}${n.link.id ? `?focus=${n.link.id}` : ''}`);
                  }}
                >
                  <Badge tone={severityTone(n.severity)}>{n.severity}</Badge>
                  <span style={{ flex: 1 }}>
                    <b className="small" style={{ display: 'block' }}>{n.title}</b>
                    <span className="small muted">{n.body}</span>
                  </span>
                  <span className="small faint">{n.tickLabel}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <Link to={`${base}/settings`} className="btn ghost" title="Account settings" aria-label={`Account: ${user?.name}`}>
        <span aria-hidden style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--panel-3)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12 }}>
          {user?.name?.[0]?.toUpperCase()}
        </span>
      </Link>
      <button className="btn icon ghost" aria-label="Sign out" onClick={() => logout().then(() => nav('/login'))}>
        <LogOut aria-hidden />
      </button>
      {advOpen && view?.company && <AdvanceDialog onClose={() => setAdvOpen(false)} />}
    </header>
  );
}

function GlobalSearch({ worldId, companyId, onPick }: { worldId: string; companyId: string | null; onPick: (module: string, id?: string) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ type: string; id: string; label: string; detail: string; module: string }[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .get<{ results: typeof results }>(`/api/worlds/${worldId}/search?q=${encodeURIComponent(q)}${companyId ? `&companyId=${companyId}` : ''}`)
        .then((r) => {
          setResults(r.results);
          setActive(0);
          setOpen(true);
        })
        .catch(() => setResults([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q, worldId, companyId]);
  const pick = (r: (typeof results)[number]) => {
    setOpen(false);
    setQ('');
    onPick(r.module, r.type === 'page' ? undefined : r.id);
  };
  return (
    <div className="search" role="combobox" aria-expanded={open && results.length > 0} aria-haspopup="listbox" aria-owns="search-results">
      <Search aria-hidden />
      <input
        aria-label="Search products, suppliers, events, journal entries and pages"
        placeholder="Search anything…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-activedescendant={open && results[active] ? `sr-${active}` : undefined}
        aria-controls="search-results"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(results.length - 1, a + 1));
          if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
          if (e.key === 'Enter' && results[active]) pick(results[active]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && q.length >= 2 && (
        <div className="search-results" role="listbox" id="search-results">
          {results.length === 0 && <div className="small muted" style={{ padding: 12 }}>No matches for “{q}”.</div>}
          {results.map((r, i) => (
            <button key={`${r.type}-${r.id}-${i}`} id={`sr-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
              <Badge>{r.type.replace('_', ' ')}</Badge>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                <span className="small faint">{r.detail}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PageHeader({ title, module, actions, children }: { title: string; module: string; actions?: ReactNode; children?: ReactNode }) {
  const { view, base } = useWorld();
  const w = view?.world;
  const c = view?.company;
  useEffect(() => {
    document.title = `${title} · REALWORLD`;
  }, [title]);
  return (
    <div className="page-head">
      <div>
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to="/worlds">Worlds</Link>
          <span aria-hidden>/</span>
          <Link to={`${base}/overview`}>{w?.name ?? '…'}</Link>
          {c && (
            <>
              <span aria-hidden>/</span>
              <Link to={`${base}/company`}>{c.name}</Link>
            </>
          )}
          <span aria-hidden>/</span>
          <span aria-current="page">{moduleLabel(module)}</span>
        </nav>
        <h1>{title}</h1>
        <div className="page-meta">
          <DataTypeBadge type="simulated" label="Simulated data" />
          {w && <span className="small faint">Month {String(w.month).padStart(2, '0')} / Year {w.year} · {w.label} · ruleset v{w.ruleset}</span>}
          {c?.isDemo && <Badge tone="purple">Demo company</Badge>}
          {view?.role === 'analyst' && <Badge tone="warn">Read-only (analyst)</Badge>}
          {c && c.lifecycle !== 'operating' && <Badge tone="bad">{c.lifecycle}</Badge>}
          {children}
        </div>
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
