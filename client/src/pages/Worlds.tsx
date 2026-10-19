import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe2, Plus, Sparkles } from 'lucide-react';
import { api, ApiError } from '../api';
import { useSession, useToast } from '../store';
import { Badge, Button, Callout, Empty, ErrorState, Field, Loading, Modal, Seg } from '../components/ui';

interface WorldRow {
  id: string;
  name: string;
  tick: number;
  isDemo: boolean;
  role: string;
  updatedAt: string;
  startYear: number;
  startMonth: number;
  companies: { id: string; name: string; industry: string; lifecycle: string }[];
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function WorldsPage() {
  const { user, logout } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [worlds, setWorlds] = useState<WorldRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('My economy');
  const [seed, setSeed] = useState('');
  const [freq, setFreq] = useState<'low' | 'normal' | 'high'>('normal');
  const [scripted, setScripted] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const load = () => api.get<{ worlds: WorldRow[] }>('/api/worlds').then((r) => setWorlds(r.worlds)).catch(setError);
  useEffect(() => {
    document.title = 'Worlds · REALWORLD';
    load();
  }, []);
  const open_ = (w: WorldRow) => {
    const c = w.companies.find((x) => x.lifecycle === 'operating') ?? w.companies[0];
    nav(c ? `/w/${w.id}/c/${c.id}/overview` : `/w/${w.id}/new-company`);
  };
  const create = async () => {
    setBusy('create');
    setFormError(null);
    try {
      const r = await api.post<{ worldId: string }>('/api/worlds', { name, seed: seed ? Number(seed) : undefined, eventFrequency: freq, scriptedEvents: scripted });
      nav(`/w/${r.worldId}/new-company`);
    } catch (e) {
      setFormError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };
  const demo = async (industry: string) => {
    setBusy(industry);
    try {
      const r = await api.post<{ worldId: string; companyId: string }>('/api/worlds', { name: 'Demo', demo: true, industry });
      nav(`/w/${r.worldId}/c/${r.companyId}/overview`);
    } catch (e) {
      toast.push({ tone: 'error', title: 'Could not create demo', lines: [(e as Error).message] });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="content" style={{ maxWidth: 1100 }}>
      <div className="page-head">
        <div>
          <div className="brand" style={{ padding: 0, marginBottom: 12 }}>
            <span className="brand-mark" aria-hidden />
            <span>
              <b>REAL-WORLD</b>
              <span>Business simulation</span>
            </span>
          </div>
          <h1>Your worlds</h1>
          <p className="muted">Signed in as {user?.name}. Each world is an independent simulated economy with its own seed and history.</p>
        </div>
        <div className="row">
          <Button onClick={() => logout().then(() => nav('/login'))}>Sign out</Button>
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Plus aria-hidden /> New world
          </Button>
        </div>
      </div>
      {error ? (
        <ErrorState error={error} retry={load} />
      ) : !worlds ? (
        <Loading />
      ) : worlds.length === 0 ? (
        <div className="panel">
          <Empty title="No worlds yet" icon={<Globe2 aria-hidden />} action={<Button variant="primary" onClick={() => setOpen(true)}>Create a world</Button>}>
            Start a fresh economy and register your first company, or explore a pre-played demo below.
          </Empty>
        </div>
      ) : (
        <div className="cards">
          {worlds.map((w) => (
            <button key={w.id} className="card-sel" onClick={() => open_(w)}>
              <div className="row between">
                <b>{w.name}</b>
                <Badge>{w.role}</Badge>
              </div>
              <p className="small muted" style={{ marginTop: 4 }}>
                {MONTHS[(w.startMonth + w.tick) % 12]} {w.startYear + Math.floor((w.startMonth + w.tick) / 12)} · month {w.tick + 1}
              </p>
              <div className="row" style={{ marginTop: 8 }}>
                {w.isDemo && <Badge tone="purple">Demo</Badge>}
                {w.companies.length === 0 && <Badge tone="warn">No company yet</Badge>}
                {w.companies.map((c) => (
                  <Badge key={c.id} tone={c.lifecycle === 'operating' ? 'ok' : 'bad'}>{c.name}</Badge>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}
      <div className="panel mt">
        <div className="panel-head">
          <h2>
            <Sparkles aria-hidden style={{ width: 18 }} /> Explore a demo
          </h2>
          <Badge tone="purple">Seeded demo data</Badge>
        </div>
        <p className="small muted mb">Creates a world with a demo company that has already run two months through the real engine. Demo records are labelled and can be deleted.</p>
        <div className="row">
          <Button loading={busy === 'electronics'} onClick={() => demo('electronics')}>Consumer electronics</Button>
          <Button loading={busy === 'ev'} onClick={() => demo('ev')}>Electric mobility</Button>
          <Button loading={busy === 'food'} onClick={() => demo('food')}>Food & beverage</Button>
        </div>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Create a world" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={create} loading={busy === 'create'}>Create world</Button></>}>
        <div className="stack">
          <Field label="World name" htmlFor="wname">
            <input id="wname" className="input" value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
          </Field>
          <Field label="Seed (optional)" htmlFor="wseed" hint="Same seed + same decisions = same outcomes. Leave blank for a random seed.">
            <input id="wseed" className="input" type="number" min={1} value={seed} onChange={(e) => setSeed(e.target.value)} />
          </Field>
          <div className="field">
            <span className="label">Event frequency</span>
            <Seg label="Event frequency" value={freq} onChange={setFreq} options={[{ id: 'low', label: 'Calm' }, { id: 'normal', label: 'Normal' }, { id: 'high', label: 'Turbulent' }]} />
          </div>
          <label className="check">
            <input type="checkbox" checked={scripted} onChange={(e) => setScripted(e.target.checked)} />
            Include onboarding events (a port strike in month 2 and a power shortage in month 4)
          </label>
          {formError && <Callout tone="bad">{formError}</Callout>}
        </div>
      </Modal>
    </div>
  );
}
