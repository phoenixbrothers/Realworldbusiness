import type { Company, CountryCode, Notification, Severity, Tick, WorldState } from './types';
import { DomainError } from './types';
import { BASE_TARIFFS, COMMODITIES, MATERIALS, ROUTES, SUPPLIERS } from './catalog';
import { mul, prorate } from './money';
import { nextId } from './ledger';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function tickLabel(world: Pick<WorldState, 'startYear' | 'startMonth'>, tick: Tick): string {
  const m = world.startMonth + tick;
  return `${MONTHS[((m % 12) + 12) % 12]} ${world.startYear + Math.floor(m / 12)}`;
}

export function tickParts(world: Pick<WorldState, 'startMonth'>, tick: Tick): { month: number; year: number; monthOfYear: number } {
  return { month: (tick % 12) + 1, year: Math.floor(tick / 12) + 1, monthOfYear: (world.startMonth + tick) % 12 };
}

export function getCompany(world: WorldState, companyId: string): Company {
  const c = world.companies.find((x) => x.id === companyId);
  if (!c) throw new DomainError('Company not found', 'NOT_FOUND');
  return c;
}

export function notify(world: WorldState, n: Omit<Notification, 'id' | 'tick'> & { tick?: Tick }): Notification {
  const note: Notification = { ...n, id: nextId(world.counters, 'NT'), tick: n.tick ?? world.tick };
  world.notifications.push(note);
  if (world.notifications.length > 600) world.notifications.splice(0, world.notifications.length - 600);
  return note;
}

export function severityRank(s: Severity): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[s];
}

/** is a material export-banned from a country by an active event */
export function isExportBanned(world: WorldState, country: CountryCode, materialId: string): boolean {
  return world.events.some((e) => e.status === 'active' && e.effects.exportBan?.some((b) => b.country === country && b.materialIds.includes(materialId)));
}

export function routeDelay(world: WorldState, routeId: string): number {
  let d = 0;
  for (const e of world.events) if (e.status === 'active' && e.effects.routeDelay?.[routeId]) d = Math.max(d, e.effects.routeDelay[routeId]);
  return d;
}

export function routeFreightMult(world: WorldState, routeId: string): number {
  let m = 1;
  for (const e of world.events) if (e.status === 'active' && e.effects.routeFreightMult?.[routeId]) m = Math.max(m, e.effects.routeFreightMult[routeId]);
  return m;
}

export function tariffRate(world: WorldState, from: CountryCode, materialId: string): number {
  const cat = MATERIALS[materialId].category;
  return world.tariffs[from]?.[cat] ?? BASE_TARIFFS[from]?.[cat] ?? 0;
}

/** INR unit price (paise) a supplier currently quotes for a material, before tariff and freight */
export function supplierUnitPrice(world: WorldState, supplierId: string, materialId: string): number {
  const s = SUPPLIERS[supplierId];
  const m = MATERIALS[materialId];
  const commodity = world.economy.commodities[m.commodity] / 100;
  const fxNow = world.economy.countries[s.country].fxPerINR;
  const fx0 = world.economyHistory[0]?.countries[s.country].fxPerINR ?? fxNow;
  // foreign suppliers price in local currency: a weaker rupee (lower fxPerINR) raises INR cost
  const fxEffect = s.country === 'IN' ? 1 : fx0 / fxNow;
  // domestic suppliers pass through Indian inflation drift
  const inflationDrift = s.country === 'IN' ? world.economy.wageIndex / 100 : 1;
  return Math.max(1, mul(m.basePrice, s.priceFactor * commodity * fxEffect * (s.country === 'IN' ? Math.sqrt(inflationDrift) : 1)));
}

export interface LandedQuote {
  supplierId: string;
  materialId: string;
  qty: number;
  unitPrice: number;
  goods: number;
  tariffRate: number;
  tariff: number;
  freight: number;
  expediteFee: number;
  total: number;
  landedUnitCost: number;
  leadTime: number;
  routeId: string;
  routeDelay: number;
  banned: boolean;
  supplierOnline: boolean;
  reliability: number;
}

export function landedQuote(world: WorldState, company: Company, supplierId: string, materialId: string, qty: number, expedited = false): LandedQuote {
  const s = SUPPLIERS[supplierId];
  const unitPrice = supplierUnitPrice(world, supplierId, materialId);
  const goods = unitPrice * qty;
  const tr = tariffRate(world, s.country, materialId);
  const tariff = mul(goods, tr);
  const route = ROUTES[s.routeId];
  const hub = company.facilities.some((f) => f.type === 'logistics_hub' && f.status === 'operational');
  const freightBase = mul(goods, route.freightRate * routeFreightMult(world, route.id) * (world.economy.freightIndex / 100) * (hub ? 0.85 : 1));
  const expediteFee = expedited ? mul(goods, 0.06) + 5000000 : 0; // air freight premium + handling
  const total = goods + tariff + freightBase + expediteFee;
  const status = world.supplierStatus[supplierId] ?? { reliability: s.reliability, online: true, qualityIssues: 0 };
  return {
    supplierId,
    materialId,
    qty,
    unitPrice,
    goods,
    tariffRate: tr,
    tariff,
    freight: freightBase,
    expediteFee,
    total,
    landedUnitCost: qty > 0 ? Math.round(total / qty) : 0,
    leadTime: expedited ? 0 : s.leadTime,
    routeId: route.id,
    routeDelay: expedited ? 0 : routeDelay(world, route.id),
    banned: isExportBanned(world, s.country, materialId),
    supplierOnline: status.online,
    reliability: status.reliability,
  };
}

export function commodityName(id: keyof typeof COMMODITIES): string {
  return COMMODITIES[id].name;
}

export { prorate };
