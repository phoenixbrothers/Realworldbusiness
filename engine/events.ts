/**
 * Simulated world events and causal propagation.
 *
 * Every event declares explicit, structured effects (EventEffects). Engine
 * modules read those effects; nothing applies "to everyone". Company
 * exposure is computed from that company's actual suppliers, purchase
 * orders, routes, products, factories, loans and markets, so the same event
 * hits exposed firms and leaves unexposed firms untouched.
 *
 *   EVENT -> EXPOSURE -> OPERATIONAL IMPACT -> FINANCIAL CONSEQUENCE -> MITIGATION
 */
import type { Company, CommodityId, CountryCode, EventKind, Money, Policy, Severity, WorldEvent, WorldState } from './types';
import { BASE_TARIFFS, COMMODITIES, COUNTRIES, MATERIALS, PRODUCT_TEMPLATES, ROUTES, SEGMENTS, SUPPLIERS } from './catalog';
import type { Rng } from './rng';
import { nextId } from './ledger';
import { mul } from './money';
import { notify, routeDelay, supplierUnitPrice, tickLabel } from './world';

type Draft = Omit<WorldEvent, 'id' | 'tick' | 'status' | 'simulated' | 'scope'>;

const SEA_ROUTES = ['CN-CHE', 'VN-CHE', 'DE-MUM', 'US-MUM', 'AE-MUM'];
const CATEGORY_LABEL: Record<string, string> = { electronics: 'electronic components', energy_storage: 'battery cells', metals: 'metals', chemicals: 'polymers & chemicals', packaging: 'packaging', agri: 'agricultural inputs' };

interface Template {
  kind: EventKind;
  p: number; // monthly probability
  build(world: WorldState, rng: Rng): Draft | null;
}

const TEMPLATES: Template[] = [
  {
    kind: 'port_strike',
    p: 0.07,
    build: (w, rng) => {
      const routeId = rng.pick(SEA_ROUTES);
      const r = ROUTES[routeId];
      const months = rng.int(1, 2);
      return {
        kind: 'port_strike',
        title: `Port strike at ${r.fromPort}`,
        summary: `Dock workers at ${r.fromPort} walk out. Sailings on ${r.name} are expected to slip by about a month and spot freight rates rise ~40%.`,
        trigger: `Labor dispute at ${r.fromPort} (${COUNTRIES[r.from].name})`,
        endTick: w.tick + months - 1,
        severity: 'high',
        confidence: 0.7,
        countries: [r.from],
        routes: [routeId],
        effects: { routeDelay: { [routeId]: 1 }, routeFreightMult: { [routeId]: 1.4 } },
        sentiment: 'risk',
      };
    },
  },
  {
    kind: 'tariff_increase',
    p: 0.04,
    build: (w, rng) => {
      const from = rng.pick<CountryCode>(['CN', 'CN', 'VN', 'US']);
      const category = rng.pick(['electronics', 'energy_storage', 'metals']);
      const add = rng.pick([0.05, 0.1]);
      return {
        kind: 'tariff_increase',
        title: `India raises duty on ${CATEGORY_LABEL[category]} from ${COUNTRIES[from].name}`,
        summary: `Basic customs duty on ${CATEGORY_LABEL[category]} imported from ${COUNTRIES[from].name} rises by ${(add * 100).toFixed(0)} percentage points for at least a year.`,
        trigger: 'Trade-defence measure announced by the Ministry of Finance (simulated)',
        endTick: w.tick + 11,
        severity: 'medium',
        confidence: 0.85,
        countries: [from],
        routes: [],
        effects: { tariffAdd: [{ from, category, add }] },
        sentiment: 'risk',
      };
    },
  },
  {
    kind: 'trade_agreement',
    p: 0.025,
    build: (w, rng) => {
      const partner = rng.pick<CountryCode>(['AE', 'VN', 'DE']);
      return {
        kind: 'trade_agreement',
        title: `India–${COUNTRIES[partner].name} trade agreement cuts duties`,
        summary: `A new agreement lowers duties on electronics, battery cells and metals from ${COUNTRIES[partner].name} by 5 points and eases Indian exports there.`,
        trigger: 'Bilateral trade agreement signed (simulated)',
        endTick: w.tick + 23,
        severity: 'low',
        confidence: 0.9,
        countries: [partner],
        routes: [],
        effects: { tariffAdd: ['electronics', 'energy_storage', 'metals'].map((category) => ({ from: partner, category, add: -0.05 })) },
        sentiment: 'opportunity',
      };
    },
  },
  {
    kind: 'export_restriction',
    p: 0.025,
    build: (w, rng) => {
      const country = rng.pick<CountryCode>(['CN', 'CN', 'US']);
      const materialIds = country === 'CN' ? [rng.pick(['li_cell', 'chipset'])] : ['chipset'];
      const months = rng.int(2, 4);
      return {
        kind: 'export_restriction',
        title: `${COUNTRIES[country].name} restricts exports of ${materialIds.map((m) => MATERIALS[m].name.toLowerCase()).join(', ')}`,
        summary: `New export licensing halts shipments of ${materialIds.map((m) => MATERIALS[m].name.toLowerCase()).join(', ')} from ${COUNTRIES[country].name} for ${months} months. Orders not yet received are blocked.`,
        trigger: 'Strategic export-control measure (simulated)',
        endTick: w.tick + months - 1,
        severity: 'critical',
        confidence: 0.6,
        countries: [country],
        routes: [],
        effects: { exportBan: [{ country, materialIds }], stabilityDelta: { [country]: -3 } },
        sentiment: 'risk',
      };
    },
  },
  {
    kind: 'energy_shortage',
    p: 0.04,
    build: (w, rng) => {
      const months = rng.int(1, 2);
      return {
        kind: 'energy_shortage',
        title: 'Grid power shortage across Indian industrial states',
        summary: 'Coal supply shortfalls force rolling industrial power cuts: factories receive ~60% of contracted supply and tariffs rise 50%.',
        trigger: 'Coal stock shortfall at thermal plants during peak demand (simulated)',
        endTick: w.tick + months - 1,
        severity: 'high',
        confidence: 0.75,
        countries: ['IN'],
        routes: [],
        effects: { energyCapacityMult: { IN: 0.6 }, energyPriceMult: 1.5 },
        sentiment: 'risk',
      };
    },
  },
  {
    kind: 'commodity_spike',
    p: 0.05,
    build: (w, rng) => {
      const c = rng.pick<CommodityId>(['lithium', 'semiconductors', 'copper', 'steel', 'grains', 'polymers']);
      const mult = +rng.range(1.2, 1.4).toFixed(2);
      return {
        kind: 'commodity_spike',
        title: `${COMMODITIES[c].name} prices jump ${Math.round((mult - 1) * 100)}%`,
        summary: `Supply tightness pushes the ${COMMODITIES[c].name.toLowerCase()} index up ${Math.round((mult - 1) * 100)}%. Prices are expected to ease gradually over several months.`,
        trigger: `Global supply tightness in ${COMMODITIES[c].name.toLowerCase()} (simulated)`,
        endTick: w.tick + 2,
        severity: 'medium',
        confidence: 0.65,
        countries: [],
        routes: [],
        effects: { commodityShock: { [c]: mult } },
        sentiment: 'risk',
      };
    },
  },
  {
    kind: 'currency_shock',
    p: 0.03,
    build: (w) => ({
      kind: 'currency_shock',
      title: 'Rupee slides 6% against major currencies',
      summary: 'Capital outflows weaken the rupee. Imported inputs become more expensive in INR; Indian exports become more price-competitive abroad.',
      trigger: 'Portfolio outflows and a stronger dollar (simulated)',
      endTick: w.tick + 2,
      severity: 'medium',
      confidence: 0.7,
      countries: ['IN'],
      routes: [],
      effects: { fxShock: { CN: 0.94, US: 0.94, DE: 0.94, AE: 0.94, VN: 0.94 } },
      sentiment: 'risk',
    }),
  },
  {
    kind: 'rate_change',
    p: 0.04,
    build: (w, rng) => {
      const up = rng.chance(0.5);
      const delta = up ? 0.5 : -0.25;
      return {
        kind: 'rate_change',
        title: `RBI ${up ? 'raises' : 'cuts'} the repo rate by ${Math.abs(delta * 100)} bps`,
        summary: `Floating-rate borrowing costs ${up ? 'rise' : 'fall'} from next month. Deposit yields move the same way.`,
        trigger: 'Monetary policy committee decision (simulated)',
        endTick: w.tick,
        severity: up ? 'medium' : 'low',
        confidence: 0.95,
        countries: ['IN'],
        routes: [],
        effects: { rateDelta: { IN: delta } },
        sentiment: up ? 'risk' : 'opportunity',
      };
    },
  },
  {
    kind: 'wage_increase',
    p: 0.03,
    build: (w) => ({
      kind: 'wage_increase',
      title: 'State governments revise minimum wages',
      summary: 'Minimum wages for manufacturing rise ~6%. Market salaries follow; teams paid below market will see higher attrition.',
      trigger: 'Periodic minimum-wage revision (simulated)',
      endTick: w.tick,
      severity: 'medium',
      confidence: 0.9,
      countries: ['IN'],
      routes: [],
      effects: { wageMult: 1.06 },
      sentiment: 'risk',
    }),
  },
  {
    kind: 'demand_shock',
    p: 0.05,
    build: (w, rng) => {
      const seg = rng.pick(Object.keys(SEGMENTS));
      const up = rng.chance(0.5);
      const mult = up ? 1.2 : 0.82;
      return {
        kind: 'demand_shock',
        title: `Demand ${up ? 'surges' : 'softens'} for ${SEGMENTS[seg].name.toLowerCase()}`,
        summary: up
          ? `A viral trend and festival promotions lift category demand ~20% for the next quarter.`
          : `Weaker discretionary spending trims category demand ~18% for the next quarter.`,
        trigger: up ? 'Consumer trend shift (simulated)' : 'Tighter household budgets (simulated)',
        endTick: w.tick + 2,
        severity: up ? 'low' : 'medium',
        confidence: 0.55,
        countries: ['IN'],
        routes: [],
        effects: { demandMult: { [seg]: mult } },
        sentiment: up ? 'opportunity' : 'risk',
      };
    },
  },
  {
    kind: 'political_instability',
    p: 0.025,
    build: (w, rng) => {
      const country = rng.pick<CountryCode>(['VN', 'CN', 'AE']);
      const suppliers = Object.values(SUPPLIERS).filter((s) => s.country === country).map((s) => s.id);
      const route = Object.values(ROUTES).find((r) => r.from === country);
      return {
        kind: 'political_instability',
        title: `Political unrest in ${COUNTRIES[country].name}`,
        summary: `Protests and curfews disrupt factories and customs in ${COUNTRIES[country].name}. Supplier on-time reliability falls sharply for ~3 months.`,
        trigger: 'Contested political transition (simulated)',
        endTick: w.tick + 2,
        severity: 'high',
        confidence: 0.5,
        countries: [country],
        routes: route ? [route.id] : [],
        effects: { stabilityDelta: { [country]: -15 }, supplierReliability: Object.fromEntries(suppliers.map((s) => [s, 0.55])) },
        sentiment: 'risk',
      };
    },
  },
  {
    kind: 'supplier_failure',
    p: 0.03,
    build: (w, rng) => {
      const s = rng.pick(Object.values(SUPPLIERS));
      const bankrupt = rng.chance(0.35);
      return {
        kind: 'supplier_failure',
        title: bankrupt ? `${s.name} halts operations` : `Quality recall at ${s.name}`,
        summary: bankrupt
          ? `${s.name} has stopped shipping after a liquidity crisis. Open orders will not be fulfilled for ~3 months.`
          : `${s.name} recalls a batch for out-of-spec ${MATERIALS[s.materials[0]].name.toLowerCase()}. Expect higher scrap and late shipments for ~2 months.`,
        trigger: bankrupt ? 'Supplier insolvency (simulated)' : 'Supplier quality failure (simulated)',
        endTick: w.tick + (bankrupt ? 2 : 1),
        severity: bankrupt ? 'high' : 'medium',
        confidence: 0.7,
        countries: [s.country],
        routes: [],
        effects: bankrupt ? { supplierOffline: [s.id] } : { supplierReliability: { [s.id]: 0.6 } },
        sentiment: 'risk',
      };
    },
  },
];

type RegulationDef = Omit<Policy, 'announcedTick' | 'effectiveTick' | 'status'>;
const REGULATIONS: RegulationDef[] = ([
  { id: 'reg_traceability', title: 'Mandatory QR traceability for packaged foods', jurisdiction: 'IN', industries: ['food'], kind: 'certification', description: 'Every pack must carry a batch-level QR code linked to a traceability registry.', complianceCost: 300000, perUnitLevy: 0, monthlyPenalty: 100000, approximation: 'One-off systems and labelling cost; simulated estimate.' },
  { id: 'reg_cell_import', title: 'Import registration for lithium-ion cells', jurisdiction: 'IN', industries: ['ev', 'electronics'], kind: 'certification', description: 'Importers of Li-ion cells must register cell models and test reports.', complianceCost: 600000, perUnitLevy: 0, monthlyPenalty: 200000, approximation: 'Registration and testing cost; simulated estimate.' },
  { id: 'reg_esg', title: 'Business responsibility & sustainability reporting', jurisdiction: 'IN', industries: 'all', kind: 'reporting', description: 'Mid-size manufacturers must file annual sustainability disclosures.', complianceCost: 250000, perUnitLevy: 0, monthlyPenalty: 50000, approximation: 'Advisory and audit fee; simulated estimate.' },
] as RegulationDef[]).map((r) => ({ ...r, complianceCost: r.complianceCost * 100, monthlyPenalty: r.monthlyPenalty * 100 }));

export function applyEventStart(world: WorldState, ev: WorldEvent): void {
  const fx = ev.effects;
  for (const t of fx.tariffAdd ?? []) {
    world.tariffs[t.from][t.category] = Math.max(0, +(world.tariffs[t.from][t.category] + t.add).toFixed(4));
  }
  for (const [c, m] of Object.entries(fx.commodityShock ?? {})) world.economy.commodities[c as CommodityId] = +(world.economy.commodities[c as CommodityId] * (m as number)).toFixed(2);
  for (const [c, m] of Object.entries(fx.fxShock ?? {})) {
    const ce = world.economy.countries[c as CountryCode];
    ce.fxPerINR = +(ce.fxPerINR * (m as number)).toPrecision(6);
  }
  for (const [c, d] of Object.entries(fx.rateDelta ?? {})) world.economy.countries[c as CountryCode].policyRate = +(world.economy.countries[c as CountryCode].policyRate + (d as number)).toFixed(2);
  for (const [c, d] of Object.entries(fx.stabilityDelta ?? {})) {
    const ce = world.economy.countries[c as CountryCode];
    ce.stability = Math.max(0, ce.stability + (d as number));
    if ((d as number) < 0 && c !== 'IN') ce.relationsWithIndia = Math.max(-100, ce.relationsWithIndia + (d as number) / 2);
  }
  if (fx.energyPriceMult) world.economy.energyPriceINRPerKwh = Math.round(world.economy.energyPriceINRPerKwh * fx.energyPriceMult);
  if (fx.wageMult) world.economy.wageIndex = +(world.economy.wageIndex * fx.wageMult).toFixed(2);
  if (ev.kind === 'trade_agreement') {
    for (const c of ev.countries) world.exportTariffs[c] = Math.max(0, (world.exportTariffs[c] ?? 0) - 0.05);
  }
}

function applyEventEnd(world: WorldState, ev: WorldEvent): void {
  for (const t of ev.effects.tariffAdd ?? []) {
    const base = BASE_TARIFFS[t.from][t.category];
    world.tariffs[t.from][t.category] = Math.max(0, +(world.tariffs[t.from][t.category] - t.add).toFixed(4));
    if (t.add < 0 && world.tariffs[t.from][t.category] > base) world.tariffs[t.from][t.category] = base;
  }
  if (ev.kind === 'trade_agreement') for (const c of ev.countries) world.exportTariffs[c] = (world.exportTariffs[c] ?? 0) + 0.05;
}

export function refreshSupplierStatus(world: WorldState): void {
  for (const s of Object.values(SUPPLIERS)) world.supplierStatus[s.id] = { reliability: s.reliability, online: true, qualityIssues: 0 };
  for (const ev of world.events) {
    if (ev.status !== 'active') continue;
    for (const [id, r] of Object.entries(ev.effects.supplierReliability ?? {})) {
      world.supplierStatus[id].reliability = Math.min(world.supplierStatus[id].reliability, r);
      if (ev.kind === 'supplier_failure') world.supplierStatus[id].qualityIssues = 3;
    }
    for (const id of ev.effects.supplierOffline ?? []) world.supplierStatus[id].online = false;
  }
}

export function createEvent(world: WorldState, draft: Draft, scope: 'world' | 'company' = 'world', companyId?: string): WorldEvent {
  const ev: WorldEvent = { ...draft, id: nextId(world.counters, 'EV'), tick: world.tick, status: 'active', simulated: true, scope, companyId };
  world.events.push(ev);
  applyEventStart(world, ev);
  refreshSupplierStatus(world);
  return ev;
}

/** expire finished events, then roll for new ones (live mode only) */
export function stepEvents(world: WorldState, rng: Rng): WorldEvent[] {
  for (const ev of world.events) {
    if (ev.status === 'active' && ev.endTick < world.tick) {
      ev.status = 'expired';
      applyEventEnd(world, ev);
    }
  }
  const created: WorldEvent[] = [];
  if (rng.stochastic && world.options.scriptedEvents && world.tick === 1) {
    created.push(createEvent(world, TEMPLATES[0].build(world, scriptedRng('CN-CHE'))!));
  }
  if (rng.stochastic && world.options.scriptedEvents && world.tick === 3) {
    created.push(createEvent(world, TEMPLATES.find((t) => t.kind === 'energy_shortage')!.build(world, scriptedRng(1))!));
  }
  if (rng.stochastic) {
    const freq = { low: 0.5, normal: 1, high: 1.8 }[world.options.eventFrequency];
    for (const t of TEMPLATES) {
      if (created.length >= 2) break;
      if (!rng.chance(t.p * freq)) continue;
      const draft = t.build(world, rng);
      if (!draft) continue;
      // avoid stacking an identical active event
      if (world.events.some((e) => e.status === 'active' && e.title === draft.title)) continue;
      created.push(createEvent(world, draft));
    }
    if (rng.chance(0.03 * freq)) {
      const pending = REGULATIONS.filter((r) => !world.policies.some((p) => p.id === r.id));
      if (pending.length) {
        const r = rng.pick(pending);
        const policy: Policy = { ...r, announcedTick: world.tick, effectiveTick: world.tick + 3, status: 'announced' };
        world.policies.push(policy);
        created.push(
          createEvent(world, {
            kind: 'regulation',
            title: `New rule announced: ${policy.title}`,
            summary: `${policy.description} Takes effect ${tickLabel(world, policy.effectiveTick)}; non-compliance costs ${formatPaise(policy.monthlyPenalty)} per month.`,
            trigger: 'Regulatory notification (simulated)',
            endTick: policy.effectiveTick,
            severity: 'medium',
            confidence: 0.95,
            countries: ['IN'],
            routes: [],
            effects: { policyId: policy.id },
            sentiment: 'neutral',
          }),
        );
      }
    }
  }
  refreshSupplierStatus(world);
  for (const ev of created) {
    notify(world, { severity: ev.severity, title: `${ev.title}`, body: ev.summary, kind: 'world', link: { module: 'events', id: ev.id } });
  }
  return created;
}

/** deterministic picker used by scripted onboarding events */
function scriptedRng(value: unknown): Rng {
  return {
    stochastic: true,
    next: () => 0,
    range: (min) => min,
    int: (min) => min,
    chance: () => false,
    normal: (m = 0) => m,
    pick: <T>(items: readonly T[]) => (items.includes(value as T) ? (value as T) : items[0]),
    state: () => 0,
  };
}

function formatPaise(p: Money): string {
  return `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/** inject a specific event (used by tests and the scenario lab) */
export function buildEvent(world: WorldState, kind: EventKind, pick?: unknown): Draft | null {
  const t = TEMPLATES.find((x) => x.kind === kind);
  if (!t) return null;
  return t.build(world, scriptedRng(pick));
}

export const EVENT_KINDS = TEMPLATES.map((t) => t.kind);

// ------------------------------------------------------------------ exposure

export interface ExposureItem {
  type: 'purchase_order' | 'supplier' | 'material' | 'product' | 'factory' | 'loan' | 'market' | 'payroll' | 'policy';
  id: string;
  label: string;
  detail: string;
  module: string;
}

export interface MitigationOption {
  id: string;
  kind: string;
  label: string;
  description: string;
  estCost: Money;
  timing: string;
  resilience: string;
  action?: { type: string; payload: Record<string, unknown> };
  link?: string;
}

export interface CausalStep {
  stage: 'trigger' | 'exposure' | 'operational' | 'financial' | 'mitigation';
  title: string;
  text: string;
  amount?: Money;
  dataType?: 'actual' | 'estimate';
}

export interface Exposure {
  eventId: string;
  companyId: string;
  level: 'none' | 'low' | 'medium' | 'high';
  items: ExposureItem[];
  operational: string[];
  monthlyImpact: Money; // estimate, positive = cost / lost profit
  impactBasis: string;
  uncertainty: string;
  mitigations: MitigationOption[];
  chain: CausalStep[];
}

/** monthly material requirement from the current production plan */
export function monthlyMaterialNeeds(company: Company): Record<string, number> {
  const need: Record<string, number> = {};
  for (const line of company.lines) {
    const p = company.products.find((x) => x.id === line.productId);
    if (!p || line.plannedUnits <= 0) continue;
    for (const b of p.bom) need[b.materialId] = (need[b.materialId] ?? 0) + Math.ceil(line.plannedUnits * b.qty);
  }
  return need;
}

function usedSuppliers(world: WorldState, company: Company): Set<string> {
  const s = new Set<string>();
  for (const q of company.qualifiedSuppliers) if (q.readyTick <= world.tick) s.add(q.supplierId);
  for (const po of company.purchaseOrders) if (po.orderedTick >= world.tick - 6) s.add(po.supplierId);
  return s;
}

function monthlyRevenueRunRate(company: Company): Money {
  const recent = company.history.slice(-3);
  if (recent.length) return Math.round(recent.reduce((a, h) => a + h.revenue, 0) / recent.length);
  return company.products.reduce((a, p) => {
    const line = company.lines.find((l) => l.productId === p.id);
    return a + (line ? line.plannedUnits * p.price : 0);
  }, 0);
}

export function computeExposure(world: WorldState, company: Company, ev: WorldEvent): Exposure {
  const items: ExposureItem[] = [];
  const operational: string[] = [];
  const mitigations: MitigationOption[] = [];
  let impact = 0;
  let basis = '';
  const needs = monthlyMaterialNeeds(company);
  const suppliersUsed = usedSuppliers(world, company);
  const fx = ev.effects;
  const openPOs = company.purchaseOrders.filter((p) => p.status === 'in_transit' || p.status === 'delayed');

  const altSupplierMitigations = (materialIds: string[], exclude: (sid: string) => boolean) => {
    for (const mid of materialIds) {
      const alts = Object.values(SUPPLIERS).filter((s) => s.materials.includes(mid) && !exclude(s.id));
      for (const s of alts.slice(0, 2)) {
        const qualified = company.qualifiedSuppliers.find((q) => q.supplierId === s.id);
        const price = supplierUnitPrice(world, s.id, mid);
        mitigations.push({
          id: `alt-${s.id}-${mid}`,
          kind: qualified ? 'order_alternate' : 'qualify_supplier',
          label: qualified ? `Order ${MATERIALS[mid].name.toLowerCase()} from ${s.name}` : `Qualify ${s.name} for ${MATERIALS[mid].name.toLowerCase()}`,
          description: qualified
            ? `Already qualified. Quoted ${formatPaise(price)}/${MATERIALS[mid].unit} before duty, lead time ${s.leadTime} month(s), reliability ${(s.reliability * 100).toFixed(0)}%.`
            : `Audit and sample approval take 1 month and cost ₹1,50,000 before the first order can be placed. Quoted ${formatPaise(price)}/${MATERIALS[mid].unit}, lead time ${s.leadTime} month(s).`,
          estCost: qualified ? 0 : 15000000,
          timing: qualified ? `${s.leadTime === 0 ? 'This month' : `${s.leadTime} month(s)`}` : `1 month qualification + ${s.leadTime} month(s) lead time`,
          resilience: `${COUNTRIES[s.country].name}, route ${ROUTES[s.routeId].name}`,
          action: qualified ? undefined : { type: 'qualify_supplier', payload: { supplierId: s.id } },
          link: qualified ? 'supply-chain' : undefined,
        });
      }
    }
  };

  switch (ev.kind) {
    case 'port_strike':
    case 'political_instability': {
      const routes = ev.routes;
      const affectedPOs = openPOs.filter((p) => routes.includes(SUPPLIERS[p.supplierId].routeId) || (fx.supplierReliability && fx.supplierReliability[p.supplierId] !== undefined));
      for (const po of affectedPOs) {
        items.push({ type: 'purchase_order', id: po.id, label: `${po.id} · ${po.qty.toLocaleString('en-IN')} ${MATERIALS[po.materialId].unit} ${MATERIALS[po.materialId].name}`, detail: `From ${SUPPLIERS[po.supplierId].name}, due ${tickLabel(world, po.expectedTick)}`, module: 'supply-chain' });
        mitigations.push({ id: `exp-${po.id}`, kind: 'expedite_po', label: `Air-freight ${po.id}`, description: 'Switch to air freight. Arrives during the coming month regardless of port delays.', estCost: mul(po.unitPriceINR * po.qty, 0.06) + 5000000, timing: 'Arrives next month', resilience: 'Bypasses the affected port', action: { type: 'expedite_po', payload: { poId: po.id } } });
      }
      const sup = [...suppliersUsed].filter((sid) => routes.includes(SUPPLIERS[sid].routeId) || (fx.supplierReliability?.[sid] !== undefined));
      for (const sid of sup) items.push({ type: 'supplier', id: sid, label: SUPPLIERS[sid].name, detail: `Ships via ${ROUTES[SUPPLIERS[sid].routeId].name}`, module: 'supply-chain' });
      const mats = [...new Set(sup.flatMap((sid) => SUPPLIERS[sid].materials).filter((m) => needs[m]))];
      for (const m of mats) {
        const cover = (company.rawInventory[m]?.qty ?? 0) / Math.max(1, needs[m]);
        operational.push(`${MATERIALS[m].name}: ${cover.toFixed(1)} months of cover on hand vs ~${routes.length ? '1 month' : 'unpredictable'} extra delay.`);
        if (cover < 1.5) {
          const affectedProducts = company.products.filter((p) => p.bom.some((b) => b.materialId === m));
          for (const p of affectedProducts) {
            const line = company.lines.find((l) => l.productId === p.id);
            impact += Math.round((line?.plannedUnits ?? 0) * p.price * 0.35 * Math.max(0, 1 - cover));
          }
        }
      }
      basis = 'Lost gross profit if production stops for the uncovered share of next month (35% margin assumption).';
      for (const r of routes) {
        for (const p of company.products) for (const c of p.exportMarkets) if (ROUTES[r]?.from === c) items.push({ type: 'market', id: c, label: `Exports to ${COUNTRIES[c].name}`, detail: `${p.name} shipments use ${ROUTES[r].name}`, module: 'trade' });
      }
      altSupplierMitigations(mats, (sid) => routes.includes(SUPPLIERS[sid].routeId) || ev.countries.includes(SUPPLIERS[sid].country));
      mitigations.push({ id: 'safety', kind: 'safety_stock', label: 'Raise reorder points (safety stock)', description: 'Increase buffer stock for exposed materials. Ties up working capital and warehouse space.', estCost: 0, timing: 'Next order cycle', resilience: 'Absorbs future delays', link: 'inventory' });
      break;
    }
    case 'tariff_increase':
    case 'trade_agreement': {
      for (const t of fx.tariffAdd ?? []) {
        for (const sid of suppliersUsed) {
          const s = SUPPLIERS[sid];
          if (s.country !== t.from) continue;
          for (const m of s.materials) {
            if (MATERIALS[m].category !== t.category || !needs[m]) continue;
            const monthly = supplierUnitPrice(world, sid, m) * needs[m];
            impact += mul(monthly, t.add);
            items.push({ type: 'material', id: m, label: MATERIALS[m].name, detail: `Sourced from ${s.name}; duty ${t.add > 0 ? '+' : ''}${(t.add * 100).toFixed(0)} pts`, module: 'trade' });
          }
        }
      }
      basis = 'Monthly material need at current plan × current supplier price × duty change.';
      if (impact > 0) {
        operational.push('Landed cost of affected inputs rises from the next purchase order; existing stock keeps its original cost.');
        altSupplierMitigations([...new Set(items.map((i) => i.id))], (sid) => (fx.tariffAdd ?? []).some((t) => t.from === SUPPLIERS[sid].country));
        mitigations.push({ id: 'pricing', kind: 'price_increase', label: 'Pass part of the cost through to price', description: 'Raise prices on affected products. Expect lower market share at higher price (elasticity applies).', estCost: 0, timing: 'Next month', resilience: 'Protects margin, risks volume', link: 'marketing' });
      } else if (impact < 0) operational.push('Landed cost of affected inputs falls from the next purchase order.');
      break;
    }
    case 'export_restriction': {
      for (const ban of fx.exportBan ?? []) {
        for (const po of openPOs) {
          const s = SUPPLIERS[po.supplierId];
          if (s.country === ban.country && ban.materialIds.includes(po.materialId)) {
            items.push({ type: 'purchase_order', id: po.id, label: `${po.id} · ${MATERIALS[po.materialId].name}`, detail: `Blocked: ${s.name} cannot ship`, module: 'supply-chain' });
          }
        }
        for (const m of ban.materialIds) {
          if (!needs[m]) continue;
          const dependent = [...suppliersUsed].some((sid) => SUPPLIERS[sid].country === ban.country && SUPPLIERS[sid].materials.includes(m));
          if (!dependent) continue;
          items.push({ type: 'material', id: m, label: MATERIALS[m].name, detail: `Supplied from ${COUNTRIES[ban.country].name}`, module: 'supply-chain' });
          const cover = (company.rawInventory[m]?.qty ?? 0) / Math.max(1, needs[m]);
          operational.push(`${MATERIALS[m].name}: ${cover.toFixed(1)} months of cover. Production of dependent products stops when stock runs out.`);
          for (const p of company.products.filter((x) => x.bom.some((b) => b.materialId === m))) {
            const line = company.lines.find((l) => l.productId === p.id);
            impact += Math.round((line?.plannedUnits ?? 0) * p.price * 0.35 * Math.max(0, 1 - cover / 2));
            items.push({ type: 'product', id: p.id, label: p.name, detail: 'Depends on the restricted input', module: 'manufacturing' });
          }
        }
        const blockedMats = openPOs.filter((po) => SUPPLIERS[po.supplierId].country === ban.country && ban.materialIds.includes(po.materialId)).map((po) => po.materialId);
        altSupplierMitigations([...new Set([...ban.materialIds.filter((m) => needs[m]), ...blockedMats])], (sid) => SUPPLIERS[sid].country === ban.country);
      }
      basis = 'Gross profit at risk once on-hand cover is exhausted (35% margin assumption).';
      break;
    }
    case 'energy_shortage': {
      const factories = company.facilities.filter((f) => f.type === 'factory');
      if (company.jurisdiction === 'IN' && factories.length) {
        for (const f of factories) items.push({ type: 'factory', id: f.id, label: f.name, detail: `${f.city}: power supply cut to 60%`, module: 'manufacturing' });
        let energyNeed = 0;
        let revenueAtRisk = 0;
        for (const line of company.lines) {
          const p = company.products.find((x) => x.id === line.productId);
          if (!p) continue;
          energyNeed += line.plannedUnits * p.energyKwh;
          revenueAtRisk += line.plannedUnits * p.price;
        }
        const capacity = factories.reduce((a, f) => a + f.capacity, 0) * 0.6;
        const shortfall = energyNeed > 0 ? Math.max(0, 1 - capacity / energyNeed) : 0;
        operational.push(shortfall > 0 ? `Planned output needs ${Math.round(energyNeed).toLocaleString('en-IN')} kWh; only ~${Math.round(capacity).toLocaleString('en-IN')} kWh available → ~${Math.round(shortfall * 100)}% of output at risk.` : 'Planned output still fits within reduced power supply; energy cost per unit rises 50%.');
        impact = Math.round(revenueAtRisk * shortfall * 0.35) + mul(world.economy.energyPriceINRPerKwh * Math.min(energyNeed, capacity), 0.5);
        basis = 'Lost gross profit on curtailed output plus higher energy tariff on remaining output.';
        const months = Math.max(1, ev.endTick - world.tick + 1);
        mitigations.push({ id: 'gen', kind: 'rent_generator', label: 'Rent diesel generators', description: 'Restores full power for the duration of the shortage. Diesel power is expensive and is charged monthly.', estCost: 60000000 * months, timing: 'Immediate', resilience: 'Removes the energy bottleneck while the event lasts', action: { type: 'apply_mitigation', payload: { eventId: ev.id, kind: 'rent_generator' } } });
      }
      break;
    }
    case 'commodity_spike': {
      for (const [c, mult] of Object.entries(fx.commodityShock ?? {})) {
        for (const [m, qty] of Object.entries(needs)) {
          if (MATERIALS[m].commodity !== c) continue;
          const base = MATERIALS[m].basePrice;
          impact += Math.round(base * qty * ((mult as number) - 1));
          items.push({ type: 'material', id: m, label: MATERIALS[m].name, detail: `Tracks the ${COMMODITIES[c as CommodityId].name.toLowerCase()} index`, module: 'economics' });
        }
      }
      basis = 'Monthly need × base price × price increase; mean reversion makes this an upper estimate.';
      if (impact > 0) {
        operational.push('New purchase orders cost more; inventory bought earlier keeps its lower cost until consumed.');
        mitigations.push({ id: 'rnd', kind: 'cost_reduction', label: 'Start a cost-reduction R&D project', description: 'Redesign to use less of the affected material (≈10% saving after 5 stage gates).', estCost: 0, timing: 'Several months', resilience: 'Permanent cost reduction', link: 'rnd' });
        mitigations.push({ id: 'defer', kind: 'defer_purchases', label: 'Defer non-urgent purchases', description: 'Prices are expected to mean-revert. Running down stock reduces exposure but raises stockout risk.', estCost: 0, timing: 'Immediate', resilience: 'Trades cost for stockout risk', link: 'supply-chain' });
      }
      break;
    }
    case 'currency_shock': {
      for (const sid of suppliersUsed) {
        const s = SUPPLIERS[sid];
        if (s.country === 'IN') continue;
        for (const m of s.materials) {
          if (!needs[m]) continue;
          impact += mul(supplierUnitPrice(world, sid, m) * needs[m], 0.06);
          items.push({ type: 'supplier', id: sid, label: s.name, detail: `Invoices in ${COUNTRIES[s.country].currency}`, module: 'trade' });
        }
      }
      for (const p of company.products) if (p.exportMarkets.length) items.push({ type: 'market', id: p.id, label: `${p.name} exports`, detail: 'More price-competitive abroad', module: 'trade' });
      basis = 'Imported input spend × 6% depreciation (partly offset by export competitiveness, not netted).';
      if (impact > 0) {
        operational.push('Imported inputs cost more in rupees from the next order.');
        mitigations.push({ id: 'dom', kind: 'domestic_sourcing', label: 'Shift volume to domestic suppliers', description: 'Domestic suppliers price in INR. They may cost more at baseline and have limited capacity.', estCost: 0, timing: 'Next order cycle', resilience: 'Removes FX exposure', link: 'supply-chain' });
      }
      break;
    }
    case 'rate_change': {
      const delta = fx.rateDelta?.IN ?? 0;
      for (const l of company.loans.filter((x) => x.status === 'active' && x.floating && x.outstanding > 0)) {
        items.push({ type: 'loan', id: l.id, label: `${l.lender} ${l.kind === 'overdraft' ? 'overdraft' : 'term loan'}`, detail: `${formatPaise(l.outstanding)} floating`, module: 'finance' });
        impact += mul(l.outstanding, delta / 100 / 12);
      }
      basis = 'Floating outstanding debt × rate change ÷ 12.';
      if (impact > 0) mitigations.push({ id: 'prepay', kind: 'prepay', label: 'Prepay floating debt', description: 'Use surplus cash to reduce floating-rate borrowings. Reduces liquidity.', estCost: 0, timing: 'Immediate', resilience: 'Lower interest cost', link: 'transactions' });
      break;
    }
    case 'wage_increase': {
      for (const t of company.teams) {
        const market = t.salary;
        if (t.headcount > 0) items.push({ type: 'payroll', id: t.id, label: t.role, detail: `${t.headcount} staff at ${formatPaise(market)}/month`, module: 'workforce' });
      }
      const payroll = company.teams.reduce((a, t) => a + t.salary * t.headcount, 0);
      impact = mul(payroll, 0.06);
      basis = 'Matching the 6% market move across current payroll (otherwise attrition rises instead).';
      operational.push('Teams paid below the new market rate will see morale fall and attrition rise.');
      mitigations.push({ id: 'sal', kind: 'adjust_salary', label: 'Review salaries by team', description: 'Match market to protect retention, or accept attrition risk.', estCost: impact, timing: 'Next payroll', resilience: 'Protects productivity', link: 'workforce' });
      mitigations.push({ id: 'auto', kind: 'automation', label: 'Invest in line automation (R&D)', description: 'Process automation cuts labor hours per unit by up to 50% at full automation.', estCost: 0, timing: 'Several months', resilience: 'Structural labor saving', link: 'rnd' });
      break;
    }
    case 'demand_shock': {
      for (const [seg, mult] of Object.entries(fx.demandMult ?? {})) {
        for (const p of company.products.filter((x) => x.segmentId === seg && x.status === 'active')) {
          const recent = company.sales.filter((s) => s.productId === p.id && s.market === 'IN').slice(-1)[0];
          const rev = recent ? recent.revenue : 0;
          impact += -Math.round(rev * ((mult as number) - 1) * 0.35);
          items.push({ type: 'product', id: p.id, label: p.name, detail: `Category demand ×${mult}`, module: 'sales' });
        }
      }
      basis = 'Last month revenue × demand change × 35% contribution margin (negative = gain).';
      if (items.length) {
        operational.push((Object.values(fx.demandMult ?? {})[0] ?? 1) > 1 ? 'More units can be sold if finished-goods stock and capacity allow; check the production plan.' : 'Expect slower sell-through; finished goods may accumulate unless production is trimmed.');
        mitigations.push({ id: 'plan', kind: 'adjust_production', label: 'Adjust production plan', description: 'Align output with the new demand level.', estCost: 0, timing: 'Next month', resilience: 'Avoids stockouts or excess stock', link: 'manufacturing' });
        mitigations.push({ id: 'mkt', kind: 'marketing', label: 'Adjust marketing spend', description: 'Campaigns raise awareness with diminishing returns.', estCost: 0, timing: 'Next month', resilience: 'Supports share', link: 'marketing' });
      }
      break;
    }
    case 'supplier_failure': {
      const sids = [...(fx.supplierOffline ?? []), ...Object.keys(fx.supplierReliability ?? {})];
      for (const sid of sids) {
        if (!suppliersUsed.has(sid)) continue;
        items.push({ type: 'supplier', id: sid, label: SUPPLIERS[sid].name, detail: fx.supplierOffline?.includes(sid) ? 'Not shipping' : 'Quality issues and delays', module: 'supply-chain' });
        for (const po of openPOs.filter((p) => p.supplierId === sid)) items.push({ type: 'purchase_order', id: po.id, label: `${po.id} · ${MATERIALS[po.materialId].name}`, detail: `Due ${tickLabel(world, po.expectedTick)}`, module: 'supply-chain' });
        const mats = SUPPLIERS[sid].materials.filter((m) => needs[m]);
        for (const m of mats) {
          const cover = (company.rawInventory[m]?.qty ?? 0) / Math.max(1, needs[m]);
          operational.push(`${MATERIALS[m].name}: ${cover.toFixed(1)} months of cover.`);
        }
        altSupplierMitigations(mats, (x) => x === sid);
        if (fx.supplierReliability?.[sid]) operational.push('Higher scrap is expected on lines using this supplier’s material.');
      }
      basis = 'Exposure listed; financial effect depends on stock cover and alternatives (not estimated).';
      break;
    }
    case 'regulation': {
      const pol = world.policies.find((p) => p.id === fx.policyId);
      if (pol && (pol.industries === 'all' || pol.industries.includes(company.industry))) {
        const comp = company.compliance.find((c) => c.policyId === pol.id);
        items.push({ type: 'policy', id: pol.id, label: pol.title, detail: `Effective ${tickLabel(world, pol.effectiveTick)} · ${comp?.status === 'compliant' ? 'compliant' : 'action required'}`, module: 'law' });
        if (comp?.status !== 'compliant') {
          impact = pol.monthlyPenalty;
          basis = 'Monthly penalty if not compliant by the effective date.';
          operational.push(`Compliance must be completed before ${tickLabel(world, pol.effectiveTick)}.`);
          mitigations.push({ id: `comply-${pol.id}`, kind: 'comply', label: `Comply now (${formatPaise(pol.complianceCost)})`, description: pol.approximation, estCost: pol.complianceCost, timing: 'Immediate', resilience: 'Avoids monthly penalties', action: { type: 'comply_policy', payload: { policyId: pol.id } } });
        }
      }
      break;
    }
    case 'competitor_launch': {
      const seg = Object.keys(fx.demandMult ?? {})[0] ?? (ev.sourceRef?.id ?? '');
      for (const p of company.products.filter((x) => x.segmentId === seg && x.status === 'active')) {
        items.push({ type: 'product', id: p.id, label: p.name, detail: 'Competes in the same segment', module: 'markets' });
      }
      if (items.length) {
        basis = 'Share loss depends on relative price, quality and awareness (see Markets).';
        operational.push('Expect market share pressure in the affected segment next month.');
        mitigations.push({ id: 'qual', kind: 'quality_rnd', label: 'Start a quality-upgrade project', description: '+10 quality on launch after 5 stage gates.', estCost: 0, timing: 'Several months', resilience: 'Durable differentiation', link: 'rnd' });
        mitigations.push({ id: 'price', kind: 'price_adjust', label: 'Review pricing', description: 'Match or hold price; see the market share model.', estCost: 0, timing: 'Next month', resilience: 'Short-term defence', link: 'marketing' });
      }
      break;
    }
  }

  // de-duplicate exposure items
  const seen = new Set<string>();
  const uniq = items.filter((i) => {
    const k = `${i.type}:${i.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const revenue = Math.max(1, monthlyRevenueRunRate(company));
  const ratio = Math.abs(impact) / revenue;
  const level: Exposure['level'] = uniq.length === 0 ? 'none' : ratio > 0.15 ? 'high' : ratio > 0.04 ? 'medium' : 'low';
  const uncertainty = `Confidence ${(ev.confidence * 100).toFixed(0)}%. ${ev.confidence < 0.6 ? 'Duration and severity are highly uncertain.' : 'Timing is reasonably well understood; magnitude may vary.'}`;
  const chain: CausalStep[] = [
    { stage: 'trigger', title: 'Trigger', text: `${ev.trigger}. ${ev.summary}` },
    { stage: 'exposure', title: 'Your exposure', text: uniq.length ? `${uniq.length} exposed item(s): ${uniq.slice(0, 4).map((i) => i.label).join('; ')}${uniq.length > 4 ? '…' : ''}` : `${company.name} has no supplier, route, product, factory or loan linked to this event.` },
    { stage: 'operational', title: 'Operational impact', text: operational.length ? operational.join(' ') : 'No operational change expected.' },
    { stage: 'financial', title: 'Financial consequence', text: uniq.length ? `${impact >= 0 ? 'Estimated cost / profit at risk' : 'Estimated benefit'}: ${formatPaise(Math.abs(impact))} per month. ${basis}` : 'None expected.', amount: impact, dataType: 'estimate' },
    { stage: 'mitigation', title: 'Response options', text: mitigations.length ? mitigations.map((m) => m.label).join(' · ') : 'No action required.' },
  ];
  return { eventId: ev.id, companyId: company.id, level, items: uniq, operational, monthlyImpact: impact, impactBasis: basis, uncertainty, mitigations, chain };
}

export function routeStatus(world: WorldState): { routeId: string; delay: number; risk: Severity | 'normal' }[] {
  return Object.keys(ROUTES).map((id) => {
    const d = routeDelay(world, id);
    const unrest = world.events.some((e) => e.status === 'active' && e.routes.includes(id));
    return { routeId: id, delay: d, risk: d > 0 ? 'high' : unrest ? 'medium' : 'normal' };
  });
}

export const PRODUCT_TEMPLATE_NAMES = Object.fromEntries(Object.values(PRODUCT_TEMPLATES).map((t) => [t.id, t.name]));
