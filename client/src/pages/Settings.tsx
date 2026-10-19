/** Settings & account: profile, preferences, password, world members & roles, replay verification, deletion. */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useSession, useToast, useWorld } from '../store';
import { PageHeader } from '../components/Shell';
import { hasWebGL } from '../components/Campus';
import { Badge, Button, Callout, Confirm, Field, Panel, Table } from '../components/ui';

interface Member { id: string; name: string; email: string; role: string; added_at: string }

export default function Settings() {
  const { user, setUser, updatePrefs } = useSession();
  const { view, worldId } = useWorld();
  const toast = useToast();
  const nav = useNavigate();
  const [name, setName] = useState(user?.name ?? '');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [members, setMembers] = useState<Member[]>([]);
  const [invite, setInvite] = useState({ email: '', role: 'analyst' });
  const [replay, setReplay] = useState<{ actions: number; match: boolean; replayHash: string; storedHash: string; ms: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const owner = view?.role === 'owner';
  const loadMembers = () => api.get<{ members: Member[] }>(`/api/worlds/${worldId}/members`).then((r) => setMembers(r.members)).catch(() => undefined);
  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId]);
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.push({ tone: 'ok', title: ok });
    } catch (e) {
      toast.push({ tone: 'error', title: 'Not saved', lines: [(e as ApiError).message] });
    } finally {
      setBusy(null);
    }
  };
  const p = user?.preferences ?? {};
  return (
    <>
      <PageHeader title="Settings & account" module="settings" />
      <div className="grid g2">
        <Panel title="Profile">
          <div className="stack">
            <Field label="Email" htmlFor="sem"><input id="sem" className="input" value={user?.email ?? ''} disabled /></Field>
            <Field label="Display name" htmlFor="snm"><input id="snm" className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Button variant="primary" loading={busy === 'name'} onClick={() => run('name', async () => setUser((await api.patch<{ user: any }>('/api/me', { name })).user), 'Profile saved')}>Save profile</Button>
          </div>
        </Panel>
        <Panel title="Preferences" sub="Saved to your account on the server.">
          <div className="stack">
            <label className="check"><input type="checkbox" checked={p.theme === 'light'} onChange={(e) => run('pref', () => updatePrefs({ theme: e.target.checked ? 'light' : 'dark' }), 'Theme updated')} /> Light theme for long reading sessions</label>
            <label className="check"><input type="checkbox" checked={!!p.reducedMotion} onChange={(e) => run('pref', () => updatePrefs({ reducedMotion: e.target.checked }), 'Motion preference saved')} /> Reduce motion</label>
            <label className="check"><input type="checkbox" checked={p.enable3d !== false} onChange={(e) => run('pref', () => updatePrefs({ enable3d: e.target.checked }), '3D preference saved')} /> Show the interactive 3D campus</label>
            {!hasWebGL() && <Callout tone="warn">WebGL is not available on this device; the 2D isometric campus is used instead.</Callout>}
          </div>
        </Panel>
        <Panel title="Change password">
          <div className="stack">
            <Field label="Current password" htmlFor="spc"><input id="spc" className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="New password" htmlFor="spn" hint="At least 8 characters. Other sessions are signed out."><input id="spn" className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Button loading={busy === 'pw'} disabled={pw.next.length < 8 || !pw.current} onClick={() => run('pw', async () => { await api.post('/api/me/password', pw); setPw({ current: '', next: '' }); }, 'Password changed')}>Change password</Button>
          </div>
        </Panel>
        <Panel title="World members & roles" sub="Owner: everything · Manager: operate companies · Analyst: read-only. Enforced by the server.">
          <Table compact head={<tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr>}>
            {members.map((m) => (
              <tr key={m.id}><td>{m.name}</td><td className="small">{m.email}</td><td><Badge tone={m.role === 'owner' ? 'purple' : m.role === 'manager' ? 'info' : 'neutral'}>{m.role}</Badge></td>
                <td>{owner && m.role !== 'owner' && <Button size="sm" variant="ghost" onClick={() => run('rm', async () => setMembers((await api.del<{ members: Member[] }>(`/api/worlds/${worldId}/members/${m.id}`)).members), 'Member removed')}>Remove</Button>}</td></tr>
            ))}
          </Table>
          {owner ? (
            <div className="row mt">
              <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="registered user's email" aria-label="Member email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
              <select className="input" style={{ width: 'auto' }} aria-label="Role" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}><option value="analyst">Analyst</option><option value="manager">Manager</option></select>
              <Button loading={busy === 'inv'} onClick={() => run('inv', async () => { setMembers((await api.post<{ members: Member[] }>(`/api/worlds/${worldId}/members`, invite)).members); setInvite({ email: '', role: 'analyst' }); }, 'Member added')}>Add</Button>
            </div>
          ) : <p className="small faint mt">Only the owner can manage members.</p>}
        </Panel>
        <Panel title="World integrity">
          <dl className="kv small">
            <dt>World</dt><dd>{view?.world.name}</dd>
            <dt>Seed</dt><dd className="mono">{view?.world.seed}</dd>
            <dt>Ruleset</dt><dd>v{view?.world.ruleset}</dd>
            <dt>Event frequency</dt><dd>{view?.world.options.eventFrequency}</dd>
            <dt>State version</dt><dd>{view?.version}</dd>
          </dl>
          <p className="small muted mt">Replay rebuilds the world from its seed and the ordered log of accepted actions, then compares a hash with the stored state.</p>
          <Button className="mt" loading={busy === 'replay'} onClick={() => run('replay', async () => setReplay(await api.post(`/api/worlds/${worldId}/verify-replay`)), 'Replay finished')}>Verify deterministic replay</Button>
          {replay && <Callout tone={replay.match ? 'ok' : 'bad'} title={replay.match ? 'Replay matches stored state' : 'Replay mismatch'}>{replay.actions} actions replayed in {replay.ms} ms · hash {replay.replayHash} {replay.match ? '=' : '≠'} {replay.storedHash}</Callout>}
        </Panel>
        <Panel title="Danger zone">
          <p className="small muted">Deleting a world permanently removes its companies, ledger and audit log for every member.</p>
          <Button className="mt" variant="danger" disabled={!owner} onClick={() => setDel(true)}>Delete this world</Button>
          {!owner && <p className="small faint mt">Only the owner can delete the world.</p>}
        </Panel>
      </div>
      {view && (
        <Confirm open={del} onClose={() => setDel(false)} title="Delete world permanently?" danger confirmLabel="Delete world" requireText={view.world.name} busy={busy === 'del'} onConfirm={() => run('del', async () => { await api.del(`/api/worlds/${worldId}`, { confirmName: view.world.name }); nav('/worlds'); }, 'World deleted')}>
          <p>This cannot be undone.</p>
        </Confirm>
      )}
    </>
  );
}
