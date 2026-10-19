import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useSession } from '../store';
import type { User } from '../store';
import { Button, Callout, Field, Seg } from '../components/ui';

export function AuthPage() {
  const { user, setUser } = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.title = 'Sign in · REALWORLD';
  }, []);
  if (user) return <Navigate to="/worlds" replace />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = mode === 'login' ? await api.post<{ user: User }>('/api/auth/login', { email, password }) : await api.post<{ user: User }>('/api/auth/register', { email, name, password });
      setUser(r.user);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-wrap">
      <div className="auth-art">
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark" aria-hidden />
          <span>
            <b>REAL-WORLD</b>
            <span>Business simulation</span>
          </span>
        </div>
        <div>
          <h1 style={{ fontSize: 38, maxWidth: 520 }}>See the world. Understand the impact. Choose a response. Inspect the result.</h1>
          <p style={{ marginTop: 16, color: '#a9bdd2', maxWidth: 520 }}>
            Build a company in a simulated Indian economy connected to China, Vietnam, the UAE, Germany and the United States. Every number is posted to a double-entry ledger and every event is traceable to its cause.
          </p>
        </div>
        <p className="small" style={{ color: '#7f97b0' }}>All world data, events and companies are simulated. Nothing here is real-world news or a prediction.</p>
      </div>
      <div className="auth-form">
        <form onSubmit={submit} className="panel stack" style={{ width: 'min(420px, 100%)' }} aria-labelledby="auth-title">
          <h2 id="auth-title">{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
          <Seg label="Choose sign in or register" value={mode} onChange={(m) => { setMode(m); setError(null); }} options={[{ id: 'login', label: 'Sign in' }, { id: 'register', label: 'Register' }]} />
          {mode === 'register' && (
            <Field label="Your name" htmlFor="name">
              <input id="name" className="input" autoComplete="name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          <Field label="Email" htmlFor="email">
            <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor="password" hint={mode === 'register' ? 'At least 8 characters.' : undefined}>
            <input id="password" className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <Callout tone="bad">{error}</Callout>}
          <Button variant="primary" type="submit" loading={busy}>
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
      </div>
    </div>
  );
}
