/**
 * Builds the client view model: world meta + the selected company with
 * computed KPIs, alerts, feasibility and exposure. Large append-only
 * collections (journal, movements) are served by paginated endpoints instead.
 */
import type { Company, WorldState } from '../engine/index';
import {
  ACCOUNTS,
  CITIES,
  COMMODITIES,
  COUNTRIES,
  DATA_PROVENANCE,
  EXPORT_ROUTE,
  FACILITY_SPECS,
  INDUSTRIES,
  INDUSTRY_FACILITY_FACTOR,
  MATERIALS,
  PRODUCT_TEMPLATES,
  ROUTES,
  RULESET_VERSION,
  SEGMENTS,
  SUPPLIERS,
  balanceSheet,
  cashBalance,
  companyCard,
  computeExposure,
  computeUtility,
  energyAvailable,
  incomeStatement,
  inventoryValue,
  kpis,
  alerts,
  laborHoursAvailable,
  landedQuote,
  loanRateBps,
  marketSalary,
  minimumWage,
  monthlyMaterialNeeds,
  planFeasibility,
  reconcileInventory,
  routeStatus,
  rndCapacityPoints,
  runway,
  storageCapacity,
  storageUsed,
  tickLabel,
  valuationEstimate,
  committedPurchases,
  creditLimit,
  INVESTORS,
  LENDERS,
  CHANNELS,
  RND_KINDS,
  TRAININGS,
  awarenessGain,
  overdraft,
  isQualified,
} from '../engine/index';

export function catalog() {
  return {
    ruleset: RULESET_VERSION,
    provenance: DATA_PROVENANCE,
    countries: COUNTRIES,
    materials: MATERIALS,
    suppliers: SUPPLIERS,
    routes: ROUTES,
    exportRoutes: EXPORT_ROUTE,
    segments: SEGMENTS,
    templates: PRODUCT_TEMPLATES,
    industries: INDUSTRIES,
    industryFacilityFactor: INDUSTRY_FACILITY_FACTOR,
    accounts: ACCOUNTS,
    commodities: COMMODITIES,
    facilitySpecs: FACILITY_SPECS,
    cities: CITIES,
    channels: CHANNELS,
    rndKinds: RND_KINDS,
    trainings: TRAININGS,
    investors: INVESTORS,
    lenders: LENDERS,
  };
}

function companyView(world: WorldState, c: Company) {
  const { journal: _j, movements: _m, ...rest } = c;
  void _j;
  void _m;
  const exposures = world.events.filter((e) => e.status === 'active').map((e) => computeExposure(world, c, e));
  const quotes: Record<string, Record<string, { unit: number; landedUnit: number; tariffRate: number; leadTime: number; routeDelay: number; banned: boolean; online: boolean; qualified: boolean; reliability: number }>> = {};
  for (const s of Object.values(SUPPLIERS)) {
    quotes[s.id] = {};
    for (const m of s.materials) {
      const q = landedQuote(world, c, s.id, m, 1000);
      quotes[s.id][m] = { unit: q.unitPrice, landedUnit: q.landedUnitCost, tariffRate: q.tariffRate, leadTime: q.leadTime, routeDelay: q.routeDelay, banned: q.banned, online: q.supplierOnline, qualified: isQualified(world, c, s.id), reliability: q.reliability };
    }
  }
  const last = world.tick - 1;
  const segmentsView = [...new Set(c.products.map((p) => p.segmentId))].map((segId) => {
    const seg = SEGMENTS[segId];
    const latest = (pid: string) => c.sales.filter((s) => s.productId === pid && s.market === 'IN').slice(-1)[0];
    const offers = [
      ...c.products.filter((p) => p.segmentId === segId && p.status === 'active').map((p) => ({ owner: c.name, name: p.name, price: p.price, quality: p.quality, awareness: c.brandAwareness, utility: computeUtility(seg, p.quality, c.brandAwareness, p.price), mine: true, sold: latest(p.id)?.sold ?? 0, share: latest(p.id)?.share ?? 0 })),
      ...world.competitors.flatMap((comp) => comp.offers.filter((o) => o.segmentId === segId).map((o) => ({ owner: comp.name, name: o.name, price: o.price, quality: o.quality, awareness: comp.awareness, utility: computeUtility(seg, o.quality, comp.awareness, o.price), mine: false, sold: o.lastSold, share: 0 }))),
    ];
    const total = offers.reduce((a, o) => a + o.sold, 0);
    for (const o of offers) o.share = total ? o.sold / total : 0;
    return { segmentId: segId, name: seg.name, referencePrice: seg.referencePrice, offers };
  });
  return {
    ...rest,
    journalCount: c.journal.length,
    sales: c.sales.slice(-240),
    production: c.production.slice(-120),
    computed: {
      cash: cashBalance(c),
      kpis: kpis(world, c),
      alerts: alerts(world, c),
      runway: runway(c, world),
      feasibility: planFeasibility(world, c),
      laborHours: laborHoursAvailable(c),
      energy: Object.fromEntries(c.facilities.filter((f) => f.type === 'factory').map((f) => [f.id, energyAvailable(world, c, f.id)])),
      storageUsed: storageUsed(c),
      storageCapacity: storageCapacity(c),
      rawValue: inventoryValue(c, 'raw'),
      finishedValue: inventoryValue(c, 'finished'),
      materialNeeds: monthlyMaterialNeeds(c),
      reconciliation: reconcileInventory(c),
      rndCapacity: rndCapacityPoints(c),
      valuation: valuationEstimate(world, c),
      committedPurchases: committedPurchases(c),
      creditLimit: creditLimit(c),
      overdraft: overdraft(c) ?? null,
      loanRates: Object.fromEntries(c.loans.map((l) => [l.id, loanRateBps(world, l)])),
      marketSalary: Object.fromEntries(c.teams.map((t) => [t.id, marketSalary(world, t)])),
      minimumWage: minimumWage(world),
      exposures,
      quotes,
      segments: segmentsView,
      awarenessResponse: Object.fromEntries(Object.keys(CHANNELS).map((ch) => [ch, [5, 10, 20, 40, 80].map((l) => ({ spend: l * 100000 * 100, gain: +awarenessGain(c, ch as keyof typeof CHANNELS, l * 100000 * 100).toFixed(2) }))])),
      lastMonth: last >= c.foundedTick ? incomeStatement(c, last, last) : null,
      balanceSheet: balanceSheet(c, world.tick),
    },
  };
}

export function worldView(world: WorldState, companyId: string | undefined, role: string, version: number) {
  const company = world.companies.find((c) => c.id === companyId) ?? world.companies.find((c) => c.lifecycle === 'operating') ?? world.companies[0];
  return {
    version,
    role,
    world: {
      id: world.id,
      name: world.name,
      tick: world.tick,
      label: tickLabel(world, world.tick),
      month: (world.tick % 12) + 1,
      year: Math.floor(world.tick / 12) + 1,
      startYear: world.startYear,
      startMonth: world.startMonth,
      status: world.status,
      ruleset: world.ruleset,
      seed: world.seed,
      options: world.options,
      economy: world.economy,
      economyHistory: world.economyHistory.slice(-36),
      events: world.events.slice(-120).map((e) => ({ ...e, tickLabel: tickLabel(world, e.tick), endLabel: tickLabel(world, e.endTick) })),
      policies: world.policies.map((p) => ({ ...p, effectiveLabel: tickLabel(world, p.effectiveTick), announcedLabel: tickLabel(world, p.announcedTick) })),
      competitors: world.competitors,
      tariffs: world.tariffs,
      exportTariffs: world.exportTariffs,
      supplierStatus: world.supplierStatus,
      routeStatus: routeStatus(world),
      notifications: world.notifications.filter((n) => !n.companyId || n.companyId === company?.id).slice(-60).reverse().map((n) => ({ ...n, tickLabel: tickLabel(world, n.tick) })),
      lastAdvance: world.lastAdvance ?? null,
      companies: world.companies.map((c) => companyCard(world, c)),
    },
    company: company ? companyView(world, company) : null,
  };
}
