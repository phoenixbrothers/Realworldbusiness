/**
 * Demo world seeding. Everything is created through the normal action
 * pipeline (so it is validated, logged and replayable). The demo company is
 * flagged isDemo and the world is flagged is_demo so the UI labels it.
 */
import type { WorldService } from './worlds';
import { SUPPLIERS, landedQuote, monthlyMaterialNeeds, planFeasibility, routeDelay } from '../engine/index';
import type { Company, WorldState } from '../engine/index';

function procureFor(service: WorldService, worldId: string, userId: string, company: () => Company, world: () => WorldState, months: number) {
  const c = company();
  const w = world();
  const needs = monthlyMaterialNeeds(c);
  for (const [mat, need] of Object.entries(needs)) {
    const pipeline = (c.rawInventory[mat]?.qty ?? 0) + c.purchaseOrders.filter((p) => p.materialId === mat && (p.status === 'in_transit' || p.status === 'delayed')).reduce((a, p) => a + p.qty, 0);
    const qty = need * months - pipeline;
    if (qty <= 0) continue;
    const options = c.qualifiedSuppliers
      .map((q) => q.supplierId)
      .filter((s) => SUPPLIERS[s].materials.includes(mat))
      .sort((a, b) => SUPPLIERS[a].leadTime - SUPPLIERS[b].leadTime || landedQuote(w, c, a, mat, 1000).total - landedQuote(w, c, b, mat, 1000).total);
    for (const s of options) {
      try {
        service.execute(worldId, userId, { type: 'place_po', companyId: c.id, payload: { supplierId: s, materialId: mat, qty: Math.min(qty, SUPPLIERS[s].capacityPerMonth) } });
        break;
      } catch {
        /* try next supplier */
      }
    }
  }
}

/** set each line to 55% of capacity, or the feasible maximum, one line at a time */
function setPlans(service: WorldService, wid: string, userId: string, C: () => Company, W: () => WorldState) {
  const cid = C().id;
  for (const line of C().lines) if (line.plannedUnits) service.execute(wid, userId, { type: 'set_production_plan', companyId: cid, payload: { lineId: line.id, plannedUnits: 0 } });
  for (const { id } of C().lines) {
    const line = C().lines.find((l) => l.id === id)!;
    const f = planFeasibility(W(), C()).find((x) => x.lineId === id)!;
    const units = Math.min(Math.round(line.capacity * 0.55), f.maxFeasible);
    if (units > 0) service.execute(wid, userId, { type: 'set_production_plan', companyId: cid, payload: { lineId: id, plannedUnits: units } });
  }
}

export function createDemoWorld(service: WorldService, userId: string, industry: 'electronics' | 'ev' | 'food' = 'electronics') {
  const world = service.create(userId, { name: 'Demo world — Chennai electronics', seed: 20270101, scriptedEvents: true, eventFrequency: 'normal' }, true);
  const wid = world.id;
  const products = { electronics: ['phone_a1', 'earbuds'], ev: ['scooter_s1', 'ebike_city'], food: ['koozh_classic', 'meal_bowl'] }[industry];
  const r = service.execute(wid, userId, {
    type: 'create_company',
    payload: { name: 'Aster Devices (Demo)', brand: 'Aster', industry, city: 'Chennai', strategy: 'differentiation', businessModel: 'Design and assemble mid-range devices; sell online and through distributors', founderName: 'Demo Founder', founderCapital: 40_00_00_000 * 100, openingLoan: 10_00_00_000 * 100, factoryMode: 'build', warehouseMode: 'lease', rndLab: true, products, isDemo: true },
  });
  const cid = (r.data as { companyId: string }).companyId;
  const W = () => service.load(wid);
  const C = () => W().companies.find((c) => c.id === cid)!;
  // size the first purchase against a 55%-of-capacity plan, then set the feasible plan
  const sizeWorld = structuredClone(W());
  const sc = sizeWorld.companies.find((c) => c.id === cid)!;
  for (const l of sc.lines) l.plannedUnits = Math.round(l.capacity * 0.55);
  procureFor(service, wid, userId, () => sc, () => W(), 2);
  setPlans(service, wid, userId, C, W);
  service.execute(wid, userId, { type: 'create_campaign', companyId: cid, payload: { name: 'Launch — digital & social', channel: 'digital', productId: null, monthlyBudget: 15_00_000 * 100, months: 6 } });
  const firstProduct = C().products[0];
  service.execute(wid, userId, { type: 'create_rnd_project', companyId: cid, payload: { name: `${firstProduct.name} quality upgrade`, kind: 'quality_upgrade', targetProductId: firstProduct.id, monthlyBudget: 6_00_000 * 100 } });
  // run two months so the dashboard has history
  for (let i = 0; i < 2; i++) {
    service.execute(wid, userId, { type: 'advance_month', payload: { expectedTick: W().tick } });
    // respond to disruptions the way a player would: air-freight orders held up by a disrupted route
    for (const po of C().purchaseOrders.filter((p) => (p.status === 'in_transit' || p.status === 'delayed') && p.mode !== 'expedited' && routeDelay(W(), SUPPLIERS[p.supplierId].routeId) > 0)) {
      try {
        service.execute(wid, userId, { type: 'expedite_po', companyId: cid, payload: { poId: po.id } });
      } catch {
        /* not expeditable (e.g. export ban) */
      }
    }
    procureFor(service, wid, userId, C, W, 2);
    setPlans(service, wid, userId, C, W);
  }
  return { worldId: wid, companyId: cid };
}
