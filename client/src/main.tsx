import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import './styles.css';
import { SessionProvider, ToastProvider, WorldProvider, useSession, useWorld } from './store';
import { Shell } from './components/Shell';
import { Loading, ErrorState, Empty } from './components/ui';
import { AuthPage } from './pages/Auth';
import { WorldsPage } from './pages/Worlds';

const pages = {
  overview: lazy(() => import('./pages/Overview')),
  company: lazy(() => import('./pages/Companies')),
  finance: lazy(() => import('./pages/Finance')),
  manufacturing: lazy(() => import('./pages/Manufacturing')),
  inventory: lazy(() => import('./pages/Inventory')),
  'supply-chain': lazy(() => import('./pages/SupplyChain')),
  rnd: lazy(() => import('./pages/Rnd')),
  marketing: lazy(() => import('./pages/Marketing')),
  sales: lazy(() => import('./pages/Sales')),
  workforce: lazy(() => import('./pages/Workforce')),
  markets: lazy(() => import('./pages/Markets')),
  countries: lazy(() => import('./pages/Countries')),
  investments: lazy(() => import('./pages/Investments')),
  trade: lazy(() => import('./pages/Trade')),
  economics: lazy(() => import('./pages/Economics')),
  law: lazy(() => import('./pages/Law')),
  transactions: lazy(() => import('./pages/Transactions')),
  events: lazy(() => import('./pages/Events')),
  reports: lazy(() => import('./pages/Reports')),
  settings: lazy(() => import('./pages/Settings')),
} as const;
const NewCompany = lazy(() => import('./pages/NewCompany'));

/** pages that work without a company selected */
const WORLD_LEVEL = new Set(['events', 'countries', 'trade', 'economics', 'law', 'settings', 'company']);

function Module() {
  const { module = 'overview' } = useParams();
  const { view, error, loading, refresh, base } = useWorld();
  if (loading && !view) return <Loading label="Loading world…" />;
  if (error && !view) return <ErrorState error={error} retry={refresh} />;
  const Page = pages[module as keyof typeof pages];
  if (!Page) return <Empty title="Page not found" action={<a className="btn" href={`${base}/overview`}>Go to overview</a>} />;
  if (!view?.company && !WORLD_LEVEL.has(module)) return <Navigate to={`/w/${view?.world.id}/new-company`} replace />;
  return (
    <Suspense fallback={<Loading />}>
      <Page />
    </Suspense>
  );
}

function WorldRoute({ newCompany }: { newCompany?: boolean }) {
  const { worldId = '', companyId } = useParams();
  return (
    <WorldProvider worldId={worldId} companyId={companyId && companyId !== '_' ? companyId : null}>
      <Shell>
        {newCompany ? (
          <Suspense fallback={<Loading />}>
            <NewCompany />
          </Suspense>
        ) : (
          <Module />
        )}
      </Shell>
    </WorldProvider>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  if (loading) return <Loading label="Checking session…" />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/worlds" element={<Protected><WorldsPage /></Protected>} />
      <Route path="/w/:worldId/new-company" element={<Protected><WorldRoute newCompany /></Protected>} />
      <Route path="/w/:worldId/c/:companyId/:module" element={<Protected><WorldRoute /></Protected>} />
      <Route path="/w/:worldId" element={<Protected><WorldRoute /></Protected>} />
      <Route path="*" element={<Navigate to="/worlds" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
