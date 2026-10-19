/**
 * Domain model for the REALWORLD simulation engine.
 *
 * Conventions
 * - All money is an integer number of minor units (paise for INR). Never a float.
 * - Simulation time is a monthly tick. Tick 0 is the month the world starts.
 * - IDs are deterministic (counter based) so a world can be replayed exactly.
 */

export type Money = number; // integer minor units (paise)
export type Tick = number;
export type CountryCode = 'IN' | 'CN' | 'US' | 'DE' | 'AE' | 'VN';
export type CurrencyCode = 'INR' | 'CNY' | 'USD' | 'EUR' | 'AED' | 'VND';
export type IndustryId = 'electronics' | 'ev' | 'food';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type DataType = 'actual' | 'forecast' | 'estimate' | 'scenario';

export const RULESET_VERSION = '1.0.0';

// ---------------------------------------------------------------- catalog

export interface Country {
  code: CountryCode;
  name: string;
  currency: CurrencyCode;
  region: string;
  /** map position in a 1000x500 equirectangular-ish viewport */
  map: { x: number; y: number };
  ports: string[];
}

export interface MaterialDef {
  id: string;
  name: string;
  unit: string;
  category: 'electronics' | 'metals' | 'chemicals' | 'agri' | 'packaging' | 'energy_storage';
  /** base price in INR paise per unit at tick 0 */
  basePrice: Money;
  /** commodity index this material tracks */
  commodity: CommodityId;
  /** storage units consumed per unit held */
  volume: number;
}

export type CommodityId = 'semiconductors' | 'lithium' | 'copper' | 'steel' | 'polymers' | 'grains' | 'dairy' | 'packaging';

export interface SupplierDef {
  id: string;
  name: string;
  country: CountryCode;
  materials: string[];
  /** price multiplier against the material base price (in INR terms before FX drift) */
  priceFactor: number;
  /** probability (0..1) a shipment arrives on time in normal conditions */
  reliability: number;
  quality: number; // 0..100
  leadTime: number; // months by sea/road
  capacityPerMonth: number; // units per material per month
  paymentTermsMonths: number; // 0 = pay on receipt, 1 = net 30
  routeId: string;
}

export interface RouteDef {
  id: string;
  name: string;
  from: CountryCode;
  to: CountryCode;
  fromPort: string;
  toPort: string;
  mode: 'sea' | 'road' | 'air';
  /** freight cost as fraction of goods value */
  freightRate: number;
  /** waypoints for the world map */
  path: { x: number; y: number }[];
}

export interface ProductTemplate {
  id: string;
  industry: IndustryId;
  name: string;
  segmentId: string;
  bom: { materialId: string; qty: number }[];
  laborHours: number;
  machineHours: number;
  energyKwh: number;
  baseQuality: number;
  referencePrice: Money;
  /** units a fully staffed level-1 line can make per month */
  lineCapacity: number;
  unlockedByDefault: boolean;
  volume: number;
  description: string;
}

export interface SegmentDef {
  id: string;
  industry: IndustryId;
  name: string;
  /** monthly units demanded in India at tick 0 */
  baseDemand: number;
  referencePrice: Money;
  priceElasticity: number;
  qualityWeight: number;
  brandWeight: number;
  seasonality: number[]; // 12 multipliers
  exportDemand: Partial<Record<CountryCode, number>>;
}

export interface IndustryDef {
  id: IndustryId;
  name: string;
  description: string;
  segments: string[];
  startingProducts: string[];
  /** policy ids that apply to this industry */
  regulated: string[];
}

// ---------------------------------------------------------------- economy

export interface CountryEconomy {
  code: CountryCode;
  gdpGrowth: number; // annual %, e.g. 6.5
  inflation: number; // annual %
  policyRate: number; // annual %
  fxPerINR: number; // units of local currency per 1 INR (INR = 1)
  stability: number; // 0..100
  consumerConfidence: number; // index, 100 = neutral
  relationsWithIndia: number; // -100..100
}

export interface EconomySnapshot {
  tick: Tick;
  countries: Record<CountryCode, CountryEconomy>;
  commodities: Record<CommodityId, number>; // index, 100 = tick-0 price
  energyPriceINRPerKwh: Money; // paise per kWh
  freightIndex: number; // 100 = base
  wageIndex: number; // 100 = base, India manufacturing wage
}

// ---------------------------------------------------------------- ledger

export type AccountType = 'asset' | 'contra_asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface AccountDef {
  code: string;
  name: string;
  type: AccountType;
  group: string;
  description: string;
}

export type CashFlowCategory = 'operating' | 'investing' | 'financing' | 'none';

export interface JournalLine {
  account: string;
  debit: Money;
  credit: Money;
  memo?: string;
}

export interface JournalEntry {
  id: string;
  companyId: string;
  tick: Tick;
  seq: number;
  memo: string;
  source: { type: string; id: string };
  cashFlow: CashFlowCategory;
  /** finer grained label for the direct-method cash flow statement */
  cashFlowLine?: string;
  lines: JournalLine[];
  status: 'posted' | 'reversed';
  idempotencyKey: string;
  reversalOf?: string;
  reversedBy?: string;
  actionId?: string;
}

// ---------------------------------------------------------------- company

export type LifecycleState = 'operating' | 'distressed' | 'insolvent' | 'closed';
export type Strategy = 'cost_leadership' | 'differentiation' | 'focus';

export interface Shareholder {
  id: string;
  name: string;
  kind: 'founder' | 'investor' | 'esop';
  shares: number;
  invested: Money;
  acquiredTick: Tick;
}

export type FacilityType = 'hq' | 'factory' | 'warehouse' | 'rnd_lab' | 'logistics_hub';

export interface Facility {
  id: string;
  type: FacilityType;
  name: string;
  city: string;
  level: number;
  status: 'operational' | 'under_construction' | 'upgrading';
  readyTick: Tick;
  owned: boolean;
  /** capital spent (construction in progress) not yet placed in service */
  pendingCapex: Money;
  cost: Money; // gross book cost capitalized
  usefulLifeMonths: number;
  monthlyFixedCost: Money; // rent, utilities base, security
  /** factory: energy capacity kWh per month; warehouse: storage units */
  capacity: number;
}

export interface ProductionLine {
  id: string;
  facilityId: string;
  name: string;
  productId: string | null;
  plannedUnits: number;
  /** machine capacity units / month at full condition */
  capacity: number;
  condition: number; // 0..1, degrades with use, restored by maintenance
  automation: number; // 0..1, reduces labor hours
  status: 'running' | 'idle' | 'maintenance';
  maintenanceUntil: Tick;
}

export interface Product {
  id: string;
  templateId: string;
  name: string;
  segmentId: string;
  price: Money;
  quality: number;
  bom: { materialId: string; qty: number }[];
  laborHours: number;
  machineHours: number;
  energyKwh: number;
  status: 'active' | 'discontinued';
  launchedTick: Tick;
  exportMarkets: CountryCode[];
  /** desired finished-goods cover in months, used for alerts */
  targetCoverMonths: number;
  /** share of last month's demand that was served (1 = no stockout) */
  lastFillRate: number;
}

export interface InventoryItem {
  qty: number;
  value: Money; // total carrying value; unit cost = value / qty
}

export interface InventoryMovement {
  id: string;
  tick: Tick;
  kind: 'raw' | 'finished';
  itemId: string;
  qty: number; // signed
  value: Money; // signed
  reason: 'purchase_receipt' | 'production_consume' | 'production_output' | 'sale' | 'scrap' | 'export_sale';
  refId: string;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  materialId: string;
  qty: number;
  unitPriceINR: Money; // pre-tariff, converted at order fx
  tariffRate: number; // fraction
  freightCost: Money;
  totalCost: Money; // landed cost (goods + tariff + freight)
  orderedTick: Tick;
  expectedTick: Tick;
  status: 'in_transit' | 'delayed' | 'received' | 'cancelled' | 'blocked';
  mode: 'standard' | 'expedited';
  receivedTick?: Tick;
  delayReason?: string;
  payableId?: string;
}

export interface Payable {
  id: string;
  counterparty: string;
  amount: Money;
  dueTick: Tick;
  status: 'open' | 'paid' | 'overdue';
  sourceId: string;
  kind: 'supplier' | 'tax' | 'salary' | 'levy' | 'other';
  /** liability account carrying the payable (default 2000) */
  account: string;
  paidTick?: Tick;
}

export interface Receivable {
  id: string;
  counterparty: string;
  amount: Money;
  dueTick: Tick;
  status: 'open' | 'collected';
  sourceId: string;
}

export interface Team {
  id: string;
  department: 'production' | 'rnd' | 'sales_marketing' | 'operations' | 'admin';
  role: string;
  headcount: number;
  salary: Money; // monthly gross per head
  skill: number; // 0..100
  morale: number; // 0..100
  /** hires still ramping: list of {count, monthsRemaining} */
  ramping: { count: number; monthsRemaining: number }[];
  lastLeavers: number;
}

export interface Requisition {
  id: string;
  teamId: string;
  count: number;
  openedTick: Tick;
  fillTick: Tick;
  costPerHire: Money;
  status: 'open' | 'filled' | 'cancelled';
}

export interface Training {
  id: string;
  teamId: string;
  name: string;
  cost: Money;
  startTick: Tick;
  endTick: Tick;
  skillGain: number;
  status: 'active' | 'completed';
}

export type RndStage = 'discovery' | 'feasibility' | 'prototype' | 'testing' | 'production_validation' | 'launched' | 'cancelled';
export const RND_STAGES: RndStage[] = ['discovery', 'feasibility', 'prototype', 'testing', 'production_validation', 'launched'];

export interface RndProject {
  id: string;
  name: string;
  kind: 'new_product' | 'quality_upgrade' | 'process_automation' | 'cost_reduction';
  targetTemplateId?: string; // new_product
  targetProductId?: string; // quality_upgrade / cost_reduction
  targetLineId?: string; // process_automation
  stage: RndStage;
  progress: number; // 0..100 within the stage
  awaitingGate: boolean;
  monthlyBudget: Money;
  spent: Money;
  plannedBudget: Money;
  technicalRisk: number; // 0..1 chance a gate review fails
  startedTick: Tick;
  gates: { stage: RndStage; tick: Tick; result: 'passed' | 'failed'; evidence: string }[];
  status: 'active' | 'paused' | 'launched' | 'cancelled';
}

export interface Patent {
  id: string;
  title: string;
  grantedTick: Tick;
  projectId: string;
  expiresTick: Tick;
}

export interface Campaign {
  id: string;
  name: string;
  channel: 'digital' | 'tv' | 'retail_promo' | 'trade_show';
  productId: string | null;
  monthlyBudget: Money;
  startTick: Tick;
  endTick: Tick;
  spent: Money;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  reach: number; // cumulative awareness points contributed
}

export interface Loan {
  id: string;
  lender: string;
  kind: 'term_loan' | 'overdraft';
  principal: Money;
  outstanding: Money;
  spreadBps: number; // over policy rate
  floating: boolean;
  fixedRateBps: number; // used when not floating
  termMonths: number;
  startTick: Tick;
  maturityTick: Tick;
  status: 'active' | 'repaid' | 'defaulted';
  covenantMinCash: Money;
}

export interface Deposit {
  id: string;
  bank: string;
  principal: Money;
  rateBps: number;
  startTick: Tick;
  maturityTick: Tick;
  accrued: Money;
  status: 'active' | 'matured' | 'withdrawn';
}

export interface Budget {
  marketing: Money;
  rnd: Money;
  hiring: Money;
  capex: Money;
}

export interface SalesRecord {
  tick: Tick;
  productId: string;
  market: CountryCode;
  demand: number;
  sold: number;
  lostSales: number;
  price: Money;
  revenue: Money;
  cogs: Money;
  share: number;
}

export interface ProductionRecord {
  id: string;
  tick: Tick;
  lineId: string;
  productId: string;
  planned: number;
  feasible: number;
  produced: number;
  scrap: number;
  bottleneck: string;
  materialCost: Money;
  conversionCost: Money;
  unitCost: Money;
  status: 'completed' | 'partial' | 'blocked';
}

export interface PeriodSummary {
  tick: Tick;
  revenue: Money;
  cogs: Money;
  grossProfit: Money;
  opex: Money;
  operatingProfit: Money;
  netIncome: Money;
  cash: Money;
  debt: Money;
  netCashFlow: Money;
  unitsSold: number;
  unitsProduced: number;
  headcount: number;
  awareness: number;
  satisfaction: number;
  marketShare: number;
  inventoryValue: Money;
}

export interface Mitigation {
  id: string;
  eventId: string;
  kind: string;
  label: string;
  appliedTick: Tick;
  untilTick: Tick;
  cost: Money;
  targetId?: string;
}

export interface Compliance {
  policyId: string;
  status: 'compliant' | 'pending' | 'non_compliant';
  compliedTick?: Tick;
  penaltiesPaid: Money;
}

export interface Company {
  id: string;
  name: string;
  brand: string;
  industry: IndustryId;
  jurisdiction: CountryCode;
  city: string;
  legalForm: string;
  strategy: Strategy;
  businessModel: string;
  foundedTick: Tick;
  lifecycle: LifecycleState;
  currency: CurrencyCode;
  isDemo: boolean;
  shareholders: Shareholder[];
  facilities: Facility[];
  lines: ProductionLine[];
  products: Product[];
  rawInventory: Record<string, InventoryItem>;
  finishedInventory: Record<string, InventoryItem>;
  movements: InventoryMovement[];
  purchaseOrders: PurchaseOrder[];
  payables: Payable[];
  receivables: Receivable[];
  teams: Team[];
  requisitions: Requisition[];
  trainings: Training[];
  rndProjects: RndProject[];
  patents: Patent[];
  campaigns: Campaign[];
  loans: Loan[];
  deposits: Deposit[];
  budget: Budget;
  brandAwareness: number; // 0..100
  satisfaction: number; // 0..100
  journal: JournalEntry[];
  sales: SalesRecord[];
  production: ProductionRecord[];
  history: PeriodSummary[];
  mitigations: Mitigation[];
  compliance: Compliance[];
  reorderPoints: Record<string, number>; // materialId -> units
  milestones: { tick: Tick; text: string }[];
  dismissedAlerts: string[];
  /** cumulative tax losses available to offset future profits */
  taxLossCarryforward: Money;
  transactions: TransactionRecord[];
  /** extra production shift: +25% labor hours at 1.5x pay */
  overtime: boolean;
  qualifiedSuppliers: { supplierId: string; readyTick: Tick; cost: Money }[];
  overdueMonths: number;
}

export type TransactionKind =
  | 'equity_round'
  | 'term_loan'
  | 'loan_prepayment'
  | 'facility_build'
  | 'facility_upgrade'
  | 'deposit_open'
  | 'deposit_withdraw';

export interface TransactionRecord {
  id: string;
  kind: TransactionKind;
  status: 'pending_review' | 'executed' | 'rejected' | 'failed';
  createdTick: Tick;
  decidedTick?: Tick;
  counterparty: string;
  terms: Record<string, string | number>;
  preview: {
    cashDelta: Money;
    debtDelta: Money;
    equityDelta: Money;
    assetDelta: Money;
    dilutionPct: number;
    ownershipAfter: { name: string; pct: number }[];
    notes: string[];
  };
  warnings: string[];
  journalIds: string[];
  failureReason?: string;
}

// ---------------------------------------------------------------- competitors

export interface CompetitorOffer {
  segmentId: string;
  name: string;
  price: Money;
  quality: number;
  capacity: number;
  lastSold: number;
}

export interface Competitor {
  id: string;
  name: string;
  country: CountryCode;
  industry: IndustryId;
  awareness: number;
  offers: CompetitorOffer[];
  posture: 'aggressive' | 'balanced' | 'premium';
  recentMoves: { tick: Tick; text: string }[];
}

// ---------------------------------------------------------------- events & policy

export type EventKind =
  | 'port_strike'
  | 'tariff_increase'
  | 'trade_agreement'
  | 'export_restriction'
  | 'energy_shortage'
  | 'commodity_spike'
  | 'currency_shock'
  | 'rate_change'
  | 'wage_increase'
  | 'demand_shock'
  | 'political_instability'
  | 'supplier_failure'
  | 'competitor_launch'
  | 'regulation';

export interface EventEffects {
  routeDelay?: Record<string, number>; // routeId -> extra months
  routeFreightMult?: Record<string, number>;
  tariffAdd?: { from: CountryCode; category: string; add: number }[];
  exportBan?: { country: CountryCode; materialIds: string[] }[];
  energyCapacityMult?: Partial<Record<CountryCode, number>>;
  energyPriceMult?: number;
  commodityShock?: Partial<Record<CommodityId, number>>; // multiplier applied once
  fxShock?: Partial<Record<CountryCode, number>>; // multiplier on fxPerINR applied once
  rateDelta?: Partial<Record<CountryCode, number>>; // applied once
  wageMult?: number; // applied once to wage index
  demandMult?: Record<string, number>; // segmentId -> multiplier while active
  stabilityDelta?: Partial<Record<CountryCode, number>>;
  supplierReliability?: Record<string, number>; // supplierId -> absolute reliability while active
  supplierOffline?: string[];
  policyId?: string;
}

export interface WorldEvent {
  id: string;
  kind: EventKind;
  title: string;
  summary: string;
  trigger: string;
  tick: Tick;
  endTick: Tick;
  severity: Severity;
  confidence: number; // 0..1 how certain the projected effects are
  countries: CountryCode[];
  routes: string[];
  effects: EventEffects;
  simulated: true;
  status: 'active' | 'expired';
  sentiment: 'risk' | 'opportunity' | 'neutral';
  scope: 'world' | 'company';
  companyId?: string;
  sourceRef?: { type: string; id: string };
}

export interface Policy {
  id: string;
  title: string;
  jurisdiction: CountryCode;
  industries: IndustryId[] | 'all';
  kind: 'certification' | 'per_unit_levy' | 'minimum_wage' | 'tax' | 'reporting';
  description: string;
  announcedTick: Tick;
  effectiveTick: Tick;
  complianceCost: Money; // one-off
  perUnitLevy: Money;
  monthlyPenalty: Money; // if non-compliant after effective date
  approximation: string;
  status: 'announced' | 'in_force';
}

// ---------------------------------------------------------------- world

export interface Notification {
  id: string;
  tick: Tick;
  companyId?: string;
  severity: Severity;
  title: string;
  body: string;
  link?: { module: string; id?: string };
  kind: 'operations' | 'finance' | 'market' | 'world' | 'rnd' | 'workforce' | 'compliance';
}

export interface WorldState {
  id: string;
  name: string;
  seed: number;
  rngState: number;
  ruleset: string;
  tick: Tick;
  startYear: number;
  startMonth: number; // 0-11
  status: 'paused';
  counters: Record<string, number>;
  economy: EconomySnapshot;
  economyHistory: EconomySnapshot[];
  companies: Company[];
  competitors: Competitor[];
  events: WorldEvent[];
  policies: Policy[];
  notifications: Notification[];
  /** tariff schedule into India by origin and material category (fraction) */
  tariffs: Record<CountryCode, Record<string, number>>;
  /** tariff applied by destination on Indian exports (fraction) */
  exportTariffs: Partial<Record<CountryCode, number>>;
  supplierStatus: Record<string, { reliability: number; online: boolean; qualityIssues: number }>;
  options: { scriptedEvents: boolean; eventFrequency: 'low' | 'normal' | 'high' };
  lastAdvance?: { tick: Tick; summary: string[] };
}

export interface ActionResult<T = unknown> {
  ok: boolean;
  error?: string;
  code?: string;
  data?: T;
  /** human readable list of what changed */
  effects: string[];
}

export class DomainError extends Error {
  code: string;
  constructor(message: string, code = 'VALIDATION') {
    super(message);
    this.code = code;
  }
}
