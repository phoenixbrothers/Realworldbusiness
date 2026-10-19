/**
 * Guided product tour (plan UX-04). A lightweight spotlight that highlights
 * one real interface element at a time and explains what it does and what
 * to do next. Steps describe implemented functionality only — nothing here
 * references a feature that does not exist.
 *
 * Persistence: localStorage, scoped to the signed-in user, so the tour does
 * not reappear on every visit once finished or skipped. It can always be
 * restarted from Settings or the Help & guide page.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Compass, X } from 'lucide-react';
import { useSession } from '../store';
import { Button } from './ui';

export interface TourStep {
  /** value of a data-tour="..." attribute on the element to highlight; omit to center the card on screen */
  target?: string;
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    title: 'Welcome to REALWORLD',
    body: 'You run a company inside a simulated economy. Every decision you make — pricing, hiring, production, financing — is posted to a real accounting ledger, and the simulation only moves forward when you tell it to. This short tour points out the main pieces of the screen.',
  },
  {
    target: 'sidebar',
    title: 'Navigation',
    body: 'Every part of the business lives here, grouped by topic: your company and workforce, day-to-day operations, commercial activity, finance, and the wider world (countries, trade, events). Click any item to open it — your company stays selected as you move around.',
  },
  {
    target: 'search',
    title: 'Search',
    body: 'Type a product, supplier, journal entry, country or event name here to jump straight to it, instead of hunting through menus.',
  },
  {
    target: 'time-control',
    title: 'Simulation time',
    body: 'The simulation is paused until you click "Run next month". Nothing happens automatically — review your plan, then advance one month at a time. You will see a summary before confirming and the results right after.',
  },
  {
    target: 'kpi-strip',
    title: 'Key numbers',
    body: 'Cash, revenue, gross margin and cash runway — the four numbers that matter most. Click any tile to see exactly where it comes from, down to the underlying transactions.',
  },
  {
    target: 'campus',
    title: 'Your business campus',
    body: 'A visual view of your facilities. Click a building — or use the labelled buttons below it — to jump to that part of the business (factory → Manufacturing, warehouse → Inventory, and so on).',
  },
  {
    target: 'actions-panel',
    title: 'What should I do next?',
    body: 'This list is built from your company’s actual state — low stock, a pending decision, an overdue payment, a risky event. Each item explains why it matters and has a button that takes you straight to it.',
  },
  {
    target: 'next-action',
    title: 'You are ready',
    body: 'This button always points at the single most important thing to do next. When you are not sure where to start, click it. You can replay this tour any time from Settings.',
  },
];

interface TourState {
  active: boolean;
  step: number;
  start: () => void;
  stop: (reason: 'finished' | 'skipped' | 'exited') => void;
  seenByUser: () => boolean;
}
const TourCtx = createContext<TourState | null>(null);

function storageKey(userId: string | undefined) {
  return `rw.tour.done.${userId ?? 'anon'}`;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);

  const start = useCallback(() => {
    setStep(0);
    setActive(true);
  }, []);
  const stop = useCallback(
    (reason: 'finished' | 'skipped' | 'exited') => {
      setActive(false);
      try {
        localStorage.setItem(storageKey(user?.id), reason);
      } catch {
        /* private browsing / storage blocked: tour just won't persist completion, which is safe */
      }
    },
    [user?.id],
  );

  const seenByUser = useCallback(() => {
    if (!user) return true;
    try {
      return !!localStorage.getItem(storageKey(user.id));
    } catch {
      return true; // if storage is unavailable, don't force the tour on every load
    }
  }, [user]);

  const value = useMemo(() => ({ active, step, start, stop, seenByUser }), [active, step, start, stop, seenByUser]);
  return (
    <TourCtx.Provider value={value}>
      {children}
      {active && <TourOverlay step={step} onStep={setStep} onStop={stop} />}
    </TourCtx.Provider>
  );
}

export function useTour() {
  const ctx = useContext(TourCtx);
  if (!ctx) throw new Error('useTour must be used within TourProvider');
  return ctx;
}

/**
 * Drop this on the one page that has the tour's target elements mounted
 * (World Overview). It auto-starts the tour once, the first time this
 * specific page is reached by a user who has not seen or skipped it —
 * never on pages (Worlds, New company, Settings) that lack the elements
 * the tour points at.
 */
export function OnboardingTour() {
  const { start, seenByUser } = useTour();
  useEffect(() => {
    if (seenByUser()) return;
    const t = setTimeout(start, 600); // let the dashboard render first
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function useRect(selector: string | undefined) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }
    const update = () => {
      const el = document.querySelector(`[data-tour="${selector}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    update();
    const id = setInterval(update, 250); // DOM settles asynchronously (data loads, 3D canvas, etc.)
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [selector]);
  return rect;
}

function TourOverlay({ step, onStep, onStop }: { step: number; onStep: (n: number) => void; onStop: (reason: 'finished' | 'skipped' | 'exited') => void }) {
  const current = STEPS[step];
  const rect = useRect(current.target);
  useEffect(() => {
    if (current.target && rect) {
      const el = document.querySelector(`[data-tour="${current.target}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [current.target, rect]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onStop('exited');
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onStop]);

  const pad = 8;
  const hasTarget = !!current.target && !!rect;
  const cardTop = hasTarget ? Math.min(window.innerHeight - 220, Math.max(16, rect!.bottom + 16)) : undefined;
  const cardLeft = hasTarget ? Math.min(window.innerWidth - 380, Math.max(16, rect!.left)) : undefined;

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-labelledby="tour-title" style={{ position: 'fixed', inset: 0, zIndex: 300 }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {hasTarget && <rect x={rect!.left - pad} y={rect!.top - pad} width={rect!.width + pad * 2} height={rect!.height + pad * 2} rx={10} fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(2,10,20,0.72)" mask="url(#tour-mask)" />
        {hasTarget && <rect x={rect!.left - pad} y={rect!.top - pad} width={rect!.width + pad * 2} height={rect!.height + pad * 2} rx={10} fill="none" stroke="#22d6b0" strokeWidth={2} />}
      </svg>
      <div
        className="panel tour-card"
        style={{
          position: 'absolute',
          width: 360,
          maxWidth: 'calc(100vw - 32px)',
          top: hasTarget ? cardTop : '50%',
          left: hasTarget ? cardLeft : '50%',
          transform: hasTarget ? undefined : 'translate(-50%, -50%)',
          boxShadow: '0 12px 40px rgba(0,0,0,.5)',
        }}
      >
        <div className="row between">
          <span className="row small" style={{ gap: 6 }}>
            <Compass aria-hidden style={{ width: 16, color: 'var(--teal)' }} />
            <span className="faint">
              Step {step + 1} of {STEPS.length}
            </span>
          </span>
          <button className="btn ghost icon sm" aria-label="Exit tutorial" onClick={() => onStop('exited')}>
            <X aria-hidden />
          </button>
        </div>
        <h3 id="tour-title" className="mt" style={{ marginTop: 10 }}>
          {current.title}
        </h3>
        <p className="small mt" style={{ marginTop: 6 }}>
          {current.body}
        </p>
        <div className="row between mt" style={{ marginTop: 14 }}>
          <Button size="sm" onClick={() => onStop('skipped')}>
            Skip
          </Button>
          <div className="row">
            {step > 0 && (
              <Button size="sm" onClick={() => onStep(step - 1)}>
                <ArrowLeft aria-hidden /> Back
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={() => (step === STEPS.length - 1 ? onStop('finished') : onStep(step + 1))}>
              {step === STEPS.length - 1 ? 'Finish' : 'Next'} <ArrowRight aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
