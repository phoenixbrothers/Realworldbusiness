import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useWorld } from '../store';
import { inr } from '../format';
import { PageHeader } from '../components/Shell';
import { Button, Callout, DataTypeBadge, Field, Loading, MoneyInput, Panel } from '../components/ui';

const STEPS = ['Industry', 'Identity', 'Products', 'Capital', 'Footprint', 'Strategy', 'Review'] as const;
const STRATEGIES = [
  { id: 'cost_leadership', label: 'Cost leadership', text: 'Price ~6% below reference with slightly lower quality. Wins on value; thin margins.' },
  { id: 'differentiation', label: 'Differentiation', text: 'Price ~6% above reference with higher quality. Needs brand investment.' },
  { id: 'focus', label: 'Focus', text: 'Reference price and modestly higher quality for a defined niche.' },
] as const;

interface Estimate {
  capex: number;
  fees: number;
  monthlyFixed: number;
  monthlyPayroll: number;
  cashAfterSetup: number;
  monthsOfRunwayBeforeRevenue: number;
  warnings: string[];
}

export default function NewCompany() {
  const { catalog, worldId, act, view, canAct } = useWorld();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    industry: 'electronics' as 'electronics' | 'ev' | 'food',
    name: '',
    brand: '',
    businessModel: '',
    legalForm: 'Private Limited',
    products: [] as string[],
    founderName: '',
    founderCapital: 30_00_00_000 * 100,
    openingLoan: 0,
    city: 'Chennai',
    factoryMode: 'build' as 'build' | 'lease',
    warehouseMode: 'lease' as 'build' | 'lease',
    rndLab: true,
    strategy: 'focus' as 'cost_leadership' | 'differentiation' | 'focus',
  });
  const [est, setEst] = useState<Estimate | null>(null);
  const [estErr, setEstErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (catalog && f.products.length === 0) set('products', catalog.industries[f.industry].startingProducts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .post<{ ok: boolean; estimate?: Estimate; error?: string }>(`/api/worlds/${worldId}/setup-estimate`, f)
        .then((r) => {
          setEst(r.estimate ?? null);
          setEstErr(r.ok ? null : r.error ?? null);
        })
        .catch(() => setEst(null));
    }, 200);
    return () => clearTimeout(t);
  }, [f, worldId]);
  const errors = useMemo(() => {
    const e: Record<number, string | null> = {};
    e[1] = f.name.trim().length < 2 ? 'Company name must be at least 2 characters' : !f.brand.trim() ? 'Brand name is required' : null;
    e[2] = f.products.length === 0 ? 'Choose at least one starting product' : null;
    e[3] = !f.founderName.trim() ? 'Founder name is required' : f.founderCapital < 2_00_00_000 * 100 ? 'Founder capital must be at least ₹2 Cr' : f.founderCapital > 200_00_00_000 * 100 ? 'Founder capital cannot exceed ₹200 Cr' : f.openingLoan > f.founderCapital * 1.5 ? 'Opening loan cannot exceed 1.5× founder capital' : null;
    e[6] = est && est.cashAfterSetup <= 0 ? 'Capital does not cover setup costs' : null;
    return e;
  }, [f, est]);
  if (!catalog || !view) return <Loading />;
  const ind = catalog.industries[f.industry];
  const canNext = !errors[step];
  const submit = async () => {
    setBusy(true);
    const r = await act('create_company', f, { companyId: null, successTitle: 'Company registered' });
    setBusy(false);
    if (r) nav(`/w/${worldId}/c/${r.data.companyId}/manufacturing`);
  };
  return (
    <>
      <PageHeader title="Start a company" module="company" />
      {!canAct && <Callout tone="warn">Your role in this world is read-only.</Callout>}
      <div className="grid g-main">
        <Panel>
          <nav className="stepper" aria-label="Setup steps">
            {STEPS.map((s, i) => (
              <button key={s} aria-current={i === step ? 'step' : undefined} className={i < step ? 'done' : ''} onClick={() => i <= step && setStep(i)} disabled={i > step}>
                {i + 1}. {s}
              </button>
            ))}
          </nav>
          {step === 0 && (
            <div className="stack">
              <h2>Jurisdiction & industry</h2>
              <Callout tone="info">Jurisdiction: <b>India</b> (initial reference market). Trade partners: China, Vietnam, UAE, Germany, United States.</Callout>
              <div className="cards">
                {Object.values(catalog.industries).map((i) => (
                  <button key={i.id} className="card-sel" aria-pressed={f.industry === i.id} onClick={() => setF((x) => ({ ...x, industry: i.id, products: i.startingProducts }))}>
                    <b>{i.name}</b>
                    <p className="small muted" style={{ marginTop: 4 }}>{i.description}</p>
                    <p className="small faint" style={{ marginTop: 6 }}>Segments: {i.segments.map((s) => catalog.segments[s].name).join(', ')}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="stack">
              <h2>Name, brand & business model</h2>
              <Field label="Registered company name" htmlFor="cname" error={f.name && errors[1]?.startsWith('Company') ? errors[1] : null}>
                <input id="cname" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={60} data-autofocus />
              </Field>
              <Field label="Consumer brand" htmlFor="cbrand" hint="Used in product names, e.g. “{brand} A1 Smartphone”.">
                <input id="cbrand" className="input" value={f.brand} onChange={(e) => set('brand', e.target.value)} maxLength={30} />
              </Field>
              <Field label="Legal form" htmlFor="clegal">
                <select id="clegal" className="input" value={f.legalForm} onChange={(e) => set('legalForm', e.target.value)}>
                  <option>Private Limited</option>
                  <option>Limited Liability Partnership</option>
                  <option>Public Limited (unlisted)</option>
                </select>
              </Field>
              <Field label="Business model (optional)" htmlFor="cmodel">
                <textarea id="cmodel" className="input" rows={2} value={f.businessModel} onChange={(e) => set('businessModel', e.target.value)} maxLength={200} placeholder="e.g. Manufacture mid-range devices and sell online and through distributors" />
              </Field>
            </div>
          )}
          {step === 2 && (
            <div className="stack">
              <h2>Starting products & segments</h2>
              <p className="small muted">Each product gets its own production line. More products can be unlocked through R&D.</p>
              <div className="cards">
                {ind.startingProducts.map((pid) => {
                  const t = catalog.templates[pid];
                  const on = f.products.includes(pid);
                  return (
                    <button key={pid} className="card-sel" aria-pressed={on} onClick={() => set('products', on ? f.products.filter((x) => x !== pid) : [...f.products, pid])}>
                      <b>{t.name}</b>
                      <p className="small muted">{catalog.segments[t.segmentId].name} · reference {inr(t.referencePrice)}</p>
                      <p className="small faint" style={{ marginTop: 4 }}>{t.description}</p>
                      <p className="small faint">Line capacity {t.lineCapacity.toLocaleString('en-IN')}/month · {t.laborHours} labor h/unit</p>
                    </button>
                  );
                })}
              </div>
              {errors[2] && <Callout tone="warn">{errors[2]}</Callout>}
            </div>
          )}
          {step === 3 && (
            <div className="stack">
              <h2>Capital & ownership</h2>
              <Field label="Founder name" htmlFor="fname">
                <input id="fname" className="input" value={f.founderName} onChange={(e) => set('founderName', e.target.value)} />
              </Field>
              <Field label="Founder equity contribution" htmlFor="fcap" hint="₹2 Cr – ₹200 Cr. Recorded as share capital; founder receives 1,000,000 shares plus a 100,000-share ESOP pool.">
                <MoneyInput id="fcap" value={f.founderCapital} onChange={(v) => set('founderCapital', v)} step={1000000} />
              </Field>
              <Field label="Opening term loan (optional)" htmlFor="floan" hint="60-month floating loan at repo + 3%. Covenant: keep 10% of principal in cash.">
                <MoneyInput id="floan" value={f.openingLoan} onChange={(v) => set('openingLoan', v)} step={1000000} />
              </Field>
              {errors[3] && <Callout tone="warn">{errors[3]}</Callout>}
            </div>
          )}
          {step === 4 && (
            <div className="stack">
              <h2>Location & footprint</h2>
              <Field label="City" htmlFor="city">
                <select id="city" className="input" value={f.city} onChange={(e) => set('city', e.target.value)}>
                  {catalog.cities.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}, {c.state} — cost factor {c.costFactor}× · port {c.port}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid g2">
                <Field label="Factory" htmlFor="fmode" hint="Buying a ready plant needs capex but lowers monthly cost; leasing preserves cash.">
                  <select id="fmode" className="input" value={f.factoryMode} onChange={(e) => set('factoryMode', e.target.value as 'build')}>
                    <option value="build">Buy ready plant (capex)</option>
                    <option value="lease">Lease</option>
                  </select>
                </Field>
                <Field label="Warehouse" htmlFor="wmode">
                  <select id="wmode" className="input" value={f.warehouseMode} onChange={(e) => set('warehouseMode', e.target.value as 'build')}>
                    <option value="lease">Lease</option>
                    <option value="build">Buy (capex)</option>
                  </select>
                </Field>
              </div>
              <label className="check">
                <input type="checkbox" checked={f.rndLab} onChange={(e) => set('rndLab', e.target.checked)} />
                Lease an R&D lab (without a lab, R&D runs at 60% throughput)
              </label>
            </div>
          )}
          {step === 5 && (
            <div className="stack">
              <h2>Strategy</h2>
              <div className="cards">
                {STRATEGIES.map((s) => (
                  <button key={s.id} className="card-sel" aria-pressed={f.strategy === s.id} onClick={() => set('strategy', s.id)}>
                    <b>{s.label}</b>
                    <p className="small muted">{s.text}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
          {step === 6 && (
            <div className="stack">
              <h2>Review & register</h2>
              <dl className="kv">
                <dt>Company</dt><dd>{f.name} ({f.legalForm})</dd>
                <dt>Brand</dt><dd>{f.brand}</dd>
                <dt>Industry</dt><dd>{ind.name}</dd>
                <dt>Products</dt><dd>{f.products.map((p) => catalog.templates[p].name).join(', ')}</dd>
                <dt>Location</dt><dd>{f.city}, India</dd>
                <dt>Strategy</dt><dd>{STRATEGIES.find((s) => s.id === f.strategy)!.label}</dd>
                <dt>Founder equity</dt><dd>{inr(f.founderCapital)}</dd>
                <dt>Opening loan</dt><dd>{inr(f.openingLoan)}</dd>
              </dl>
              <Callout tone="info" title="What happens when you register">
                Founder capital is posted to share capital, facilities are capitalized or leased, ₹5 L of incorporation fees are expensed, starting teams are hired and the cheapest suppliers for your materials are pre-qualified. You will then need to order materials and set a production plan.
              </Callout>
              {errors[6] && <Callout tone="bad">{errors[6]}</Callout>}
            </div>
          )}
          <div className="row between mt">
            <Button onClick={() => setStep((s) => s - 1)} disabled={step === 0}>Back</Button>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>Continue</Button>
            ) : (
              <Button variant="primary" onClick={submit} loading={busy} disabled={!canAct || !!errors[6] || !!errors[1] || !!errors[3]}>Register company</Button>
            )}
          </div>
        </Panel>
        <Panel title="Setup economics" actions={<DataTypeBadge type="estimate" />}>
          {estErr && <Callout tone="warn">{estErr}</Callout>}
          {est ? (
            <div className="stack">
              <dl className="kv">
                <dt>Capital raised</dt><dd>{inr(f.founderCapital + f.openingLoan)}</dd>
                <dt>Facility capex</dt><dd>{inr(-est.capex)}</dd>
                <dt>Incorporation fees</dt><dd>{inr(-est.fees)}</dd>
                <dt><b>Cash after setup</b></dt><dd><b>{inr(est.cashAfterSetup)}</b></dd>
              </dl>
              <div className="divider" />
              <dl className="kv">
                <dt>Monthly payroll</dt><dd>{inr(est.monthlyPayroll)}</dd>
                <dt>Monthly facility costs</dt><dd>{inr(est.monthlyFixed)}</dd>
                <dt>Months of fixed costs covered</dt><dd>{est.monthsOfRunwayBeforeRevenue}</dd>
              </dl>
              {est.warnings.map((w) => (
                <Callout key={w} tone="warn">{w}</Callout>
              ))}
              <p className="small faint">Excludes materials, marketing and R&D, which you control after registration. Equity impact: founder owns ~90.9% (ESOP pool 9.1%).</p>
            </div>
          ) : (
            <Loading label="Calculating…" />
          )}
        </Panel>
      </div>
    </>
  );
}
