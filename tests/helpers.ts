import { SUPPLIERS, applyAction, createWorld, landedQuote, monthlyMaterialNeeds, planFeasibility } from '../engine/index';
import type { Action, Company, IndustryId, WorldState } from '../engine/index';

let n = 0;
export function act(world: WorldState, type: Action['type'], payload: Record<string, unknown>, companyId?: string) {
  return applyAction(world, { type, payload, companyId }, { actionId: `T${++n}` });
}

export const PRODUCTS: Record<IndustryId, string[]> = { electronics: ['phone_a1', 'earbuds'], ev: ['scooter_s1', 'ebike_city'], food: ['koozh_classic', 'meal_bowl'] };

export function newCompanyWorld(industry: IndustryId = 'electronics', seed = 7, opts: { scriptedEvents?: boolean } = {}) {
  n = 0;
  const world = createWorld({ name: 'Test', seed, scriptedEvents: opts.scriptedEvents ?? false });
  const r = act(world, 'create_company', { name: 'Test Co', brand: 'Testo', industry, city: 'Chennai', strategy: 'focus', founderName: 'Founder', founderCapital: 30_00_00_000 * 100, openingLoan: 0, factoryMode: 'build', warehouseMode: 'lease', rndLab: true, products: PRODUCTS[industry] });
  const companyId = (r.data as { companyId: string }).companyId;
  const company = () => world.companies.find((c) => c.id === companyId)!;
  return { world, companyId, company };
}

/** buy materials for `months` of a plan at `share` of line capacity, then set feasible plans */
export function operate(world: WorldState, company: Company, share = 0.5, months = 2) {
  const sized = structuredClone(company);
  for (const l of sized.lines) l.plannedUnits = Math.round(l.capacity * share);
  const needs = monthlyMaterialNeeds(sized);
  for (const [mat, need] of Object.entries(needs)) {
    const pipeline = (company.rawInventory[mat]?.qty ?? 0) + company.purchaseOrders.filter((p) => p.materialId === mat && (p.status === 'in_transit' || p.status === 'delayed')).reduce((a, p) => a + p.qty, 0);
    const qty = need * months - pipeline;
    if (qty <= 0) continue;
    const options = company.qualifiedSuppliers.map((q) => q.supplierId).filter((s) => SUPPLIERS[s].materials.includes(mat)).sort((a, b) => SUPPLIERS[a].leadTime - SUPPLIERS[b].leadTime || landedQuote(world, company, a, mat, 1000).total - landedQuote(world, company, b, mat, 1000).total);
    for (const s of options) {
      try {
        act(world, 'place_po', { supplierId: s, materialId: mat, qty: Math.min(qty, SUPPLIERS[s].capacityPerMonth) }, company.id);
        break;
      } catch {
        /* next */
      }
    }
  }
  // set lines one at a time: each line's plan consumes shared labor/energy/material for later lines
  for (const line of company.lines) act(world, 'set_production_plan', { lineId: line.id, plannedUnits: 0 }, company.id);
  for (const line of company.lines) {
    const f = planFeasibility(world, company).find((x) => x.lineId === line.id)!;
    act(world, 'set_production_plan', { lineId: line.id, plannedUnits: Math.min(Math.round(line.capacity * share), f.maxFeasible) }, company.id);
  }
}
