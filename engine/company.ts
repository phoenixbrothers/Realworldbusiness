/**
 * Company lifecycle: registration (guided setup) and profile changes.
 * Setup posts the founder contribution, optional opening loan, facility
 * capex and incorporation fees through the ledger, so the opening balance
 * sheet is traceable from day one.
 */
import type { Company, IndustryId, Strategy, WorldState } from './types';
import { DomainError } from './types';
import { CITIES, FACILITY_SPECS, INDUSTRIES, INDUSTRY_FACILITY_FACTOR, MATERIALS, PRODUCT_TEMPLATES, STARTING_TEAMS, SUPPLIERS } from './catalog';
import { nextId, postEntry } from './ledger';
import { mul, rupees } from './money';
import { formatRs, loanRateBps } from './finance';
import { landedQuote, notify } from './world';

export interface CreateCompanyInput {
  name: string;
  brand: string;
  industry: IndustryId;
  city: string;
  legalForm: string;
  strategy: Strategy;
  businessModel: string;
  founderName: string;
  founderCapital: number; // paise
  openingLoan: number; // paise, 0 for none
  factoryMode: 'build' | 'lease';
  warehouseMode: 'build' | 'lease';
  rndLab: boolean;
  products: string[]; // template ids
  isDemo?: boolean;
}

export const SETUP_FEES = rupees(500000);

export interface SetupEstimate {
  capex: number;
  fees: number;
  monthlyFixed: number;
  monthlyPayroll: number;
  cashAfterSetup: number;
  monthsOfRunwayBeforeRevenue: number;
  warnings: string[];
}

function emptyCompany(id: string): Omit<Company, 'name' | 'brand' | 'industry' | 'city' | 'legalForm' | 'strategy' | 'businessModel' | 'foundedTick'> {
  return {
    id,
    jurisdiction: 'IN',
    lifecycle: 'operating',
    currency: 'INR',
    isDemo: false,
    shareholders: [],
    facilities: [],
    lines: [],
    products: [],
    rawInventory: {},
    finishedInventory: {},
    movements: [],
    purchaseOrders: [],
    payables: [],
    receivables: [],
    teams: [],
    requisitions: [],
    trainings: [],
    rndProjects: [],
    patents: [],
    campaigns: [],
    loans: [],
    deposits: [],
    budget: { marketing: rupees(1500000), rnd: rupees(1200000), hiring: rupees(300000), capex: 0 },
    brandAwareness: 20,
    satisfaction: 70,
    journal: [],
    sales: [],
    production: [],
    history: [],
    mitigations: [],
    compliance: [],
    reorderPoints: {},
    milestones: [],
    dismissedAlerts: [],
    taxLossCarryforward: 0,
    transactions: [],
    overtime: false,
    qualifiedSuppliers: [],
    overdueMonths: 0,
  };
}

export function validateCompanyInput(world: WorldState, input: CreateCompanyInput): void {
  const name = input.name?.trim() ?? '';
  if (name.length < 2 || name.length > 60) throw new DomainError('Company name must be 2–60 characters', 'VALIDATION');
  if (world.companies.some((c) => c.name.toLowerCase() === name.toLowerCase() && c.lifecycle !== 'closed')) throw new DomainError('A company with this name already exists in this world', 'DUPLICATE');
  if (!input.brand?.trim() || input.brand.trim().length > 30) throw new DomainError('Brand name is required (max 30 characters)', 'VALIDATION');
  if (!INDUSTRIES[input.industry]) throw new DomainError('Choose an industry', 'VALIDATION');
  if (!CITIES.some((c) => c.name === input.city)) throw new DomainError('Choose a city in India', 'VALIDATION');
  if (!['cost_leadership', 'differentiation', 'focus'].includes(input.strategy)) throw new DomainError('Choose a strategy', 'VALIDATION');
  if (!input.founderName?.trim()) throw new DomainError('Founder name is required', 'VALIDATION');
  if (!Number.isSafeInteger(input.founderCapital) || input.founderCapital < rupees(2_00_00_000) || input.founderCapital > rupees(200_00_00_000)) throw new DomainError('Founder capital must be between ₹2 Cr and ₹200 Cr', 'VALIDATION');
  if (!Number.isSafeInteger(input.openingLoan) || input.openingLoan < 0 || input.openingLoan > mul(input.founderCapital, 1.5)) throw new DomainError('Opening loan must be between 0 and 1.5× founder capital', 'VALIDATION');
  const allowed = INDUSTRIES[input.industry].startingProducts;
  if (!input.products?.length || input.products.some((p) => !allowed.includes(p))) throw new DomainError('Choose at least one starting product from your industry', 'VALIDATION');
}

/** production staff to run every starting line at ~75% of capacity */
export function startingProductionHeadcount(templateIds: string[]): number {
  const hours = templateIds.reduce((a, id) => a + (PRODUCT_TEMPLATES[id]?.lineCapacity ?? 0) * (PRODUCT_TEMPLATES[id]?.laborHours ?? 0), 0);
  return Math.max(10, Math.round((hours / (168 * 0.77)) * 0.75));
}

export function estimateSetup(world: WorldState, input: CreateCompanyInput): SetupEstimate {
  const city = CITIES.find((c) => c.name === input.city) ?? CITIES[0];
  const ind = INDUSTRY_FACILITY_FACTOR[input.industry] ?? 1;
  const warnings: string[] = [];
  let capex = 0;
  let monthlyFixed = mul(FACILITY_SPECS.hq.leaseMonthly, city.costFactor);
  const fac = (type: 'factory' | 'warehouse' | 'rnd_lab', mode: 'build' | 'lease') => {
    const spec = FACILITY_SPECS[type];
    const f = type === 'rnd_lab' ? 1 : ind;
    if (mode === 'build') {
      capex += mul(spec.buildCost, city.costFactor * f);
      monthlyFixed += mul(spec.leaseMonthly, 0.35 * city.costFactor * f);
    } else monthlyFixed += mul(spec.leaseMonthly, city.costFactor * f);
  };
  fac('factory', input.factoryMode);
  fac('warehouse', input.warehouseMode);
  if (input.rndLab) fac('rnd_lab', 'lease');
  const teams = STARTING_TEAMS[input.industry];
  const prodHeads = startingProductionHeadcount(input.products);
  const monthlyPayroll = teams.reduce((a, t) => a + rupees(t.salary) * (t.department === 'production' ? prodHeads : t.headcount), 0) * 1.13;
  const cashAfterSetup = input.founderCapital + input.openingLoan - capex - SETUP_FEES;
  const burn = monthlyPayroll + monthlyFixed;
  const months = burn > 0 ? cashAfterSetup / burn : 99;
  if (cashAfterSetup <= 0) warnings.push('Setup costs exceed the capital raised.');
  else if (months < 4) warnings.push(`Only ~${months.toFixed(1)} months of fixed costs covered before revenue — materials purchases will need cash too.`);
  void world;
  return { capex, fees: SETUP_FEES, monthlyFixed, monthlyPayroll: Math.round(monthlyPayroll), cashAfterSetup, monthsOfRunwayBeforeRevenue: +months.toFixed(1), warnings };
}

export function createCompany(world: WorldState, input: CreateCompanyInput, actionId?: string): Company {
  validateCompanyInput(world, input);
  const est = estimateSetup(world, input);
  if (est.cashAfterSetup <= 0) throw new DomainError(`Capital does not cover setup: capex ${formatRs(est.capex)} + fees ${formatRs(est.fees)}`, 'INSUFFICIENT_CASH');
  const city = CITIES.find((c) => c.name === input.city)!;
  const id = nextId(world.counters, 'CO');
  const c: Company = {
    ...emptyCompany(id),
    name: input.name.trim(),
    brand: input.brand.trim(),
    industry: input.industry,
    city: city.name,
    legalForm: input.legalForm || 'Private Limited',
    strategy: input.strategy,
    businessModel: input.businessModel?.trim() || 'Manufacture and sell through online and distributor channels',
    foundedTick: world.tick,
    isDemo: !!input.isDemo,
  };
  const key = (k: string) => `setup:${id}:${k}`;
  // founder equity
  postEntry(c, world.counters, { tick: world.tick, memo: `Founder capital from ${input.founderName}`, source: { type: 'setup', id }, cashFlow: 'financing', cashFlowLine: 'Equity raised', lines: [{ account: '1000', debit: input.founderCapital, credit: 0 }, { account: '3000', debit: 0, credit: input.founderCapital }], idempotencyKey: key('equity'), actionId });
  c.shareholders.push({ id: nextId(world.counters, 'SH'), name: input.founderName.trim(), kind: 'founder', shares: 1_000_000, invested: input.founderCapital, acquiredTick: world.tick });
  c.shareholders.push({ id: nextId(world.counters, 'SH'), name: 'ESOP pool (unallocated)', kind: 'esop', shares: 100_000, invested: 0, acquiredTick: world.tick });
  // overdraft facility
  c.loans.push({ id: nextId(world.counters, 'LN'), lender: 'Coastal Commercial Bank', kind: 'overdraft', principal: input.industry === 'food' ? rupees(50_00_000) : rupees(1_50_00_000), outstanding: 0, spreadBps: 400, floating: true, fixedRateBps: 0, termMonths: 0, startTick: world.tick, maturityTick: world.tick + 1200, status: 'active', covenantMinCash: 0 });
  if (input.openingLoan > 0) {
    const loan = { id: nextId(world.counters, 'LN'), lender: 'State Bank (simulated)', kind: 'term_loan' as const, principal: input.openingLoan, outstanding: input.openingLoan, spreadBps: 300, floating: true, fixedRateBps: 0, termMonths: 60, startTick: world.tick, maturityTick: world.tick + 60, status: 'active' as const, covenantMinCash: mul(input.openingLoan, 0.1) };
    c.loans.push(loan);
    postEntry(c, world.counters, { tick: world.tick, memo: `Opening term loan from ${loan.lender} (${(loanRateBps(world, loan) / 100).toFixed(2)}% floating)`, source: { type: 'setup', id }, cashFlow: 'financing', cashFlowLine: 'Loans drawn', lines: [{ account: '1000', debit: input.openingLoan, credit: 0 }, { account: '2500', debit: 0, credit: input.openingLoan }], idempotencyKey: key('loan'), actionId });
  }
  // facilities
  const indFactor = INDUSTRY_FACILITY_FACTOR[input.industry] ?? 1;
  const addFacility = (type: keyof typeof FACILITY_SPECS, mode: 'build' | 'lease', capacity: number) => {
    const spec = FACILITY_SPECS[type];
    const k = city.costFactor * (type === 'factory' || type === 'warehouse' ? indFactor : 1);
    const cost = mode === 'build' ? mul(spec.buildCost, k) : 0;
    const f = { id: nextId(world.counters, 'FC'), type, name: `${city.name} ${spec.label}`, city: city.name, level: 1, status: 'operational' as const, readyTick: world.tick, owned: mode === 'build' && cost > 0, pendingCapex: 0, cost, usefulLifeMonths: mode === 'build' ? spec.life : 0, monthlyFixedCost: mode === 'build' ? mul(spec.leaseMonthly, 0.35 * k) : mul(spec.leaseMonthly, k), capacity };
    c.facilities.push(f);
    if (cost > 0) postEntry(c, world.counters, { tick: world.tick, memo: `Acquired ${f.name} (ready facility)`, source: { type: 'setup', id: f.id }, cashFlow: 'investing', cashFlowLine: 'Capital expenditure', lines: [{ account: '1500', debit: cost, credit: 0 }, { account: '1000', debit: 0, credit: cost }], idempotencyKey: key(`facility:${type}`), actionId });
    return f;
  };
  addFacility('hq', 'lease', 0);
  const templates = input.products.map((t) => PRODUCT_TEMPLATES[t]);
  const energyNeed = templates.reduce((a, t) => a + t.lineCapacity * t.energyKwh, 0);
  const factory = addFacility('factory', input.factoryMode, Math.round(energyNeed * 1.25));
  addFacility('warehouse', input.warehouseMode, FACILITY_SPECS.warehouse.capacity * (input.industry === 'ev' ? 2 : 1));
  if (input.rndLab) addFacility('rnd_lab', 'lease', 0);
  postEntry(c, world.counters, { tick: world.tick, memo: 'Incorporation, licences and professional fees', source: { type: 'setup', id }, cashFlow: 'operating', cashFlowLine: 'Setup & licences', lines: [{ account: '6900', debit: SETUP_FEES, credit: 0 }, { account: '1000', debit: 0, credit: SETUP_FEES }], idempotencyKey: key('fees'), actionId });
  // products and lines
  const priceFactor = { cost_leadership: 0.94, differentiation: 1.06, focus: 1.0 }[input.strategy];
  const qualityBonus = { cost_leadership: -2, differentiation: 4, focus: 2 }[input.strategy];
  templates.forEach((t, i) => {
    const pid = nextId(world.counters, 'PD');
    c.products.push({ id: pid, templateId: t.id, name: `${c.brand} ${t.name}`, segmentId: t.segmentId, price: Math.round(mul(t.referencePrice, priceFactor) / 100) * 100, quality: t.baseQuality + qualityBonus, bom: t.bom.map((b) => ({ ...b })), laborHours: t.laborHours, machineHours: t.machineHours, energyKwh: t.energyKwh, status: 'active', launchedTick: world.tick, exportMarkets: [], targetCoverMonths: 1, lastFillRate: 1 });
    c.lines.push({ id: nextId(world.counters, 'LINE'), facilityId: factory.id, name: `${city.name} Line ${i + 1}`, productId: pid, plannedUnits: 0, capacity: t.lineCapacity, condition: 1, automation: 0, status: 'running', maintenanceUntil: -1 });
  });
  // teams
  const prodHeads = startingProductionHeadcount(input.products);
  for (const t of STARTING_TEAMS[input.industry]) {
    c.teams.push({ id: nextId(world.counters, 'TM'), department: t.department, role: t.role, headcount: t.department === 'production' ? prodHeads : t.headcount, salary: rupees(t.salary), skill: t.skill, morale: 68, ramping: [], lastLeavers: 0 });
  }
  // pre-qualified suppliers: the two cheapest landed options per material plus all domestic ones
  const materials = new Set(templates.flatMap((t) => t.bom.map((b) => b.materialId)));
  for (const m of materials) {
    const options = Object.values(SUPPLIERS).filter((s) => s.materials.includes(m));
    const ranked = options.map((s) => ({ s, cost: landedQuote(world, c, s.id, m, 1000).total })).sort((a, b) => a.cost - b.cost);
    for (const { s } of ranked.slice(0, 2)) if (!c.qualifiedSuppliers.some((q) => q.supplierId === s.id)) c.qualifiedSuppliers.push({ supplierId: s.id, readyTick: world.tick, cost: 0 });
    for (const s of options.filter((x) => x.country === 'IN')) if (!c.qualifiedSuppliers.some((q) => q.supplierId === s.id)) c.qualifiedSuppliers.push({ supplierId: s.id, readyTick: world.tick, cost: 0 });
    c.reorderPoints[m] = 0;
  }
  // compliance register
  for (const p of world.policies) {
    if (p.industries !== 'all' && !p.industries.includes(c.industry)) continue;
    c.compliance.push({ policyId: p.id, status: p.kind === 'tax' ? 'compliant' : 'pending', penaltiesPaid: 0 });
  }
  c.milestones.push({ tick: world.tick, text: `${c.name} incorporated in ${city.name} as a ${c.legalForm}` });
  world.companies.push(c);
  notify(world, { companyId: c.id, severity: 'low', title: `${c.name} is registered`, body: 'Next: order materials and set a production plan. Lines need materials before they can run.', kind: 'operations', link: { module: 'manufacturing' } });
  void MATERIALS;
  return c;
}

export function updateCompany(company: Company, patch: { name?: string; brand?: string; strategy?: Strategy; businessModel?: string }): void {
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (n.length < 2 || n.length > 60) throw new DomainError('Company name must be 2–60 characters', 'VALIDATION');
    company.name = n;
  }
  if (patch.brand !== undefined) {
    const b = patch.brand.trim();
    if (!b || b.length > 30) throw new DomainError('Brand name is required (max 30 characters)', 'VALIDATION');
    company.brand = b;
  }
  if (patch.strategy !== undefined) {
    if (!['cost_leadership', 'differentiation', 'focus'].includes(patch.strategy)) throw new DomainError('Invalid strategy', 'VALIDATION');
    company.strategy = patch.strategy;
  }
  if (patch.businessModel !== undefined) company.businessModel = patch.businessModel.trim().slice(0, 200);
}
