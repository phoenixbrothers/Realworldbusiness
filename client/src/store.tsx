/**
 * Client state. The server is the single source of truth: every mutation is
 * an action POST; on success the view model is re-fetched. Nothing about the
 * simulation is computed or persisted locally.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError, newIdempotencyKey } from './api';
import type { Catalog, View } from './types';

export interface User {
  id: string;
  email: string;
  name: string;
  preferences: { theme?: 'dark' | 'light'; reducedMotion?: boolean; enable3d?: boolean; compactTables?: boolean };
}

// ------------------------------------------------------------------ toasts
export interface Toast {
  id: number;
  tone: 'ok' | 'error' | 'warn';
  title: string;
  lines?: string[];
}
const ToastCtx = createContext<{ push: (t: Omit<Toast, 'id'>) => void }>({ push: () => {} });
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), t.tone === 'error' ? 9000 : 5500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'error' ? 'error' : t.tone === 'warn' ? 'warn' : ''}`}>
            <div style={{ flex: 1 }}>
              <b>{t.title}</b>
              {t.lines?.map((l, i) => (
                <div key={i} className="small muted">
                  {l}
                </div>
              ))}
            </div>
            <button className="btn ghost sm" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="Dismiss notification">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ------------------------------------------------------------------ session
interface SessionState {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  updatePrefs: (p: Partial<User['preferences']>) => Promise<void>;
  logout: () => Promise<void>;
}
const SessionCtx = createContext<SessionState>(null as unknown as SessionState);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api
      .get<{ user: User }>('/api/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const p = user?.preferences;
    document.documentElement.dataset.theme = p?.theme ?? 'dark';
    document.documentElement.dataset.reducedMotion = String(!!p?.reducedMotion);
  }, [user]);
  const updatePrefs = useCallback(async (p: Partial<User['preferences']>) => {
    const r = await api.patch<{ user: User }>('/api/me', { preferences: p });
    setUser(r.user);
  }, []);
  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    setUser(null);
  }, []);
  return <SessionCtx.Provider value={{ user, loading, setUser, updatePrefs, logout }}>{children}</SessionCtx.Provider>;
}
export const useSession = () => useContext(SessionCtx);

// ------------------------------------------------------------------ catalog
let catalogPromise: Promise<Catalog> | null = null;
export function useCatalog(): Catalog | null {
  const [c, setC] = useState<Catalog | null>(null);
  useEffect(() => {
    catalogPromise ??= api.get<Catalog>('/api/catalog');
    catalogPromise.then(setC).catch(() => (catalogPromise = null));
  }, []);
  return c;
}

// ------------------------------------------------------------------ world
export interface ActResult {
  status: 'accepted' | 'rejected';
  effects: string[];
  data?: any;
  version: number;
}
interface WorldState {
  worldId: string;
  companyId: string | null;
  view: View | null;
  catalog: Catalog | null;
  error: unknown;
  loading: boolean;
  canAct: boolean;
  refresh: () => Promise<void>;
  /** submit an action; returns the result or null on validation failure (toast shown) */
  act: (type: string, payload?: Record<string, unknown>, opts?: { quiet?: boolean; companyId?: string | null; successTitle?: string }) => Promise<ActResult | null>;
  base: string;
}
const WorldCtx = createContext<WorldState>(null as unknown as WorldState);

export function WorldProvider({ worldId, companyId, children }: { worldId: string; companyId: string | null; children: ReactNode }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const catalog = useCatalog();
  const toast = useToast();
  const reqRef = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++reqRef.current;
    try {
      const v = await api.get<View>(`/api/worlds/${worldId}/view${companyId ? `?companyId=${companyId}` : ''}`);
      if (id === reqRef.current) {
        setView(v);
        setError(null);
      }
    } catch (e) {
      if (id === reqRef.current) setError(e);
    } finally {
      if (id === reqRef.current) setLoading(false);
    }
  }, [worldId, companyId]);
  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);
  const act = useCallback<WorldState['act']>(
    async (type, payload = {}, opts = {}) => {
      try {
        const r = await api.post<ActResult>(`/api/worlds/${worldId}/actions`, {
          type,
          companyId: opts.companyId === null ? undefined : opts.companyId ?? companyId ?? undefined,
          payload,
          idempotencyKey: newIdempotencyKey(),
          expectedVersion: view?.version,
        });
        await refresh();
        if (!opts.quiet) {
          const warnings = r.effects.filter((e) => e.startsWith('Warning'));
          toast.push({ tone: warnings.length ? 'warn' : 'ok', title: opts.successTitle ?? 'Done', lines: r.effects.slice(0, 4) });
        }
        return r;
      } catch (e) {
        const err = e as ApiError;
        if (err.code === 'VERSION_CONFLICT') await refresh();
        toast.push({ tone: 'error', title: err.code === 'VERSION_CONFLICT' ? 'The world changed — reloaded' : 'Not applied', lines: [err.message] });
        return null;
      }
    },
    [worldId, companyId, view?.version, refresh, toast],
  );
  const value = useMemo<WorldState>(
    () => ({ worldId, companyId: view?.company?.id ?? companyId, view, catalog, error, loading, canAct: view?.role === 'owner' || view?.role === 'manager', refresh, act, base: `/w/${worldId}/c/${view?.company?.id ?? companyId ?? '_'}` }),
    [worldId, companyId, view, catalog, error, loading, refresh, act],
  );
  return <WorldCtx.Provider value={value}>{children}</WorldCtx.Provider>;
}
export const useWorld = () => useContext(WorldCtx);

/** fetch helper that refetches whenever the world version changes */
export function useWorldQuery<T>(path: string | null, deps: unknown[] = []) {
  const { view } = useWorld();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const version = view?.version;
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    api
      .get<T>(path)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version, ...deps]);
  return { data, error, loading };
}
