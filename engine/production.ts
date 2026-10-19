/**
 * Manufacturing. Output is bounded by machine capacity (line condition and
 * maintenance), production labor hours, factory energy supply and materials
 * on hand. Planned output can never be submitted above the feasible maximum,
 * and the tick recomputes feasibility before consuming anything.
 */
import type { Company, Money, ProductionLine, ProductionRecord, Tick, WorldState } from './types';
import { DomainError } from './types';
import { HOURS_PER_HEAD } from './catalog';
import { addStock, onHand, removeStock } from './inventory';
import { nextId, postEntry } from './ledger';
import { mul, prorate } from './money';

export interface Constraint {
  key: 'plan' | 'machine' | 'labor' | 'energy' | 'material' | 'maintenance' | 'facility' | 'product';
  label: string;
  limit: number;
}

export interface Feasibility {
  lineId: string;
  productId: string | null;
  planned: number;
  maxFeasible: number;
  feasible: number;
  bottleneck: Constraint | null;
  constraints: Constraint[];
  materialNeeds: { materialId: string; perUnit: number; required: number; available: number }[];
  laborHoursPerUnit: number;
  estUnitCost: Money;
}

export function laborHoursAvailable(company: Company): number {
  let hours = 0;
  for (const t of company.teams) {
    if (t.department !== 'production') continue;
    const ramping = t.ramping.reduce((a, r) => a + r.count, 0);
    const productivity = (0.6 + t.skill / 250) * (0.75 + t.morale / 400);
    hours += (t.headcount - ramping * 0.5) * HOURS_PER_HEAD * productivity;
  }
  return Math.max(0, Math.floor(hours * (company.overtime ? 1.25 : 1)));
}

export function energyMultiplier(world: WorldState, company: Company): number {
  const generator = company.mitigations.some((m) => m.kind === 'rent_generator' && m.untilTick >= world.tick);
  if (generator) return 1;
  let mult = 1;
  for (const e of world.events) {
    if (e.status !== 'active') continue;
    const m = e.effects.energyCapacityMult?.[company.jurisdiction];
    if (m !== undefined) mult = Math.min(mult, m);
  }
  return mult;
}

export function energyAvailable(world: WorldState, company: Company, facilityId: string): number {
  const f = company.facilities.find((x) => x.id === facilityId);
  if (!f || f.status === 'under_construction') return 0;
  return Math.floor(f.capacity * energyMultiplier(world, company));
}

export function lineLaborHours(company: Company, line: ProductionLine): number {
  const p = company.products.find((x) => x.id === line.productId);
  if (!p) return 0;
  return p.laborHours * (1 - 0.5 * line.automation);
}

export function machineLimit(line: ProductionLine, tick: Tick): number {
  if (line.status === 'maintenance' && line.maintenanceUntil >= tick) return 0;
  return Math.floor(line.capacity * Math.min(1, line.condition / 0.7));
}

function materialLimit(available: number, perUnit: number): number {
  if (perUnit <= 0) return Number.MAX_SAFE_INTEGER;
  let u = Math.floor(available / perUnit + 1e-9);
  while (u > 0 && Math.ceil(u * perUnit - 1e-9) > available) u -= 1;
  return u;
}

/**
 * Feasibility for every line given shared labor/energy/material pools.
 * Lines are allocated in order, mirroring how the tick consumes resources.
 */
export function planFeasibility(
  world: WorldState,
  company: Company,
  overrides: Record<string, { plannedUnits?: number; productId?: string | null }> = {},
  includeInbound = true,
  /** evaluate this line after all others, so its maximum respects other lines' standing plans */
  lastLineId?: string,
): Feasibility[] {
  let labor = laborHoursAvailable(company);
  const energy: Record<string, number> = {};
  const materials: Record<string, number> = {};
  for (const [id, it] of Object.entries(company.rawInventory)) materials[id] = it.qty;
  if (includeInbound) {
    // purchase orders scheduled to arrive during the coming month count as available (they are received before production runs)
    for (const po of company.purchaseOrders) {
      if ((po.status === 'in_transit' || po.status === 'delayed') && po.expectedTick <= world.tick) materials[po.materialId] = (materials[po.materialId] ?? 0) + po.qty;
    }
  }
  const out: Feasibility[] = [];
  const ordered = lastLineId ? [...company.lines.filter((l) => l.id !== lastLineId), ...company.lines.filter((l) => l.id === lastLineId)] : company.lines;
  for (const line of ordered) {
    const ov = overrides[line.id] ?? {};
    const productId = ov.productId !== undefined ? ov.productId : line.productId;
    const planned = ov.plannedUnits ?? line.plannedUnits;
    const product = company.products.find((p) => p.id === productId && p.status === 'active');
    const facility = company.facilities.find((f) => f.id === line.facilityId);
    const constraints: Constraint[] = [{ key: 'plan', label: 'Planned output', limit: planned }];
    if (!facility || facility.status === 'under_construction') constraints.push({ key: 'facility', label: 'Factory not operational', limit: 0 });
    if (!product) constraints.push({ key: 'product', label: 'No active product assigned', limit: 0 });
    if (energy[line.facilityId] === undefined) energy[line.facilityId] = energyAvailable(world, company, line.facilityId);
    const lhpu = product ? product.laborHours * (1 - 0.5 * line.automation) : 0;
    const machine = machineLimit(line, world.tick);
    if (line.status === 'maintenance' && line.maintenanceUntil >= world.tick) constraints.push({ key: 'maintenance', label: 'Line under maintenance this month', limit: 0 });
    else constraints.push({ key: 'machine', label: `Machine capacity (condition ${(line.condition * 100).toFixed(0)}%)`, limit: machine });
    const materialNeeds: Feasibility['materialNeeds'] = [];
    if (product) {
      constraints.push({ key: 'labor', label: 'Production labor hours', limit: lhpu > 0 ? Math.floor(labor / lhpu) : Number.MAX_SAFE_INTEGER });
      constraints.push({ key: 'energy', label: 'Factory energy supply', limit: product.energyKwh > 0 ? Math.floor(energy[line.facilityId] / product.energyKwh) : Number.MAX_SAFE_INTEGER });
      for (const b of product.bom) {
        const avail = materials[b.materialId] ?? 0;
        constraints.push({ key: 'material', label: `Material: ${b.materialId}`, limit: materialLimit(avail, b.qty) });
        materialNeeds.push({ materialId: b.materialId, perUnit: b.qty, required: Math.ceil(planned * b.qty - 1e-9), available: Math.max(0, avail) });
      }
    }
    const capacityOnly = constraints.filter((c) => c.key !== 'plan');
    const maxFeasible = Math.max(0, Math.min(...capacityOnly.map((c) => c.limit)));
    const feasible = Math.max(0, Math.min(planned, maxFeasible));
    const binding = [...constraints].sort((a, b) => a.limit - b.limit)[0] ?? null;
    const bottleneck = feasible < planned ? binding : capacityOnly.sort((a, b) => a.limit - b.limit)[0] ?? null;
    // consume shared pools
    if (product && feasible > 0) {
      labor -= feasible * lhpu;
      energy[line.facilityId] -= feasible * product.energyKwh;
      for (const b of product.bom) materials[b.materialId] = (materials[b.materialId] ?? 0) - Math.ceil(feasible * b.qty - 1e-9);
    }
    let estUnitCost = 0;
    if (product) {
      for (const b of product.bom) {
        const it = company.rawInventory[b.materialId];
        if (it && it.qty > 0) estUnitCost += Math.round((it.value / it.qty) * b.qty);
      }
      estUnitCost += mul(world.economy.energyPriceINRPerKwh, product.energyKwh);
    }
    out.push({ lineId: line.id, productId: productId ?? null, planned, maxFeasible, feasible, bottleneck, constraints, materialNeeds, laborHoursPerUnit: lhpu, estUnitCost });
  }
  return out;
}

export interface TickProductionContext {
  laborPool: Money;
  laborHoursAvailable: number;
  overheadPool: Record<string, Money>;
}

/** run production for every line; called once per tick */
export function runProduction(world: WorldState, company: Company, ctx: TickProductionContext): ProductionRecord[] {
  const tick = world.tick;
  const records: ProductionRecord[] = [];
  const plans = planFeasibility(world, company, {}, false);
  for (const plan of plans) {
    const line = company.lines.find((l) => l.id === plan.lineId)!;
    const product = company.products.find((p) => p.id === plan.productId);
    const recId = nextId(world.counters, 'PR');
    if (!product || plan.planned <= 0) {
      if (line.status === 'maintenance' && line.maintenanceUntil <= tick) {
        line.condition = 1;
        line.status = line.productId ? 'running' : 'idle';
      }
      continue;
    }
    const started = plan.feasible;
    const teamSkill = avgProductionSkill(company);
    const scrapRate = Math.min(0.25, 0.02 + 0.06 * (1 - line.condition) + 0.03 * Math.max(0, (60 - teamSkill) / 60) + supplierQualityPenalty(world, product.bom.map((b) => b.materialId)));
    const scrap = Math.round(started * scrapRate);
    const good = started - scrap;
    let materialCost = 0;
    if (started > 0) {
      for (const b of product.bom) {
        const need = Math.ceil(started * b.qty - 1e-9);
        if (need > 0) materialCost += removeStock(company, world.counters, tick, 'raw', b.materialId, need, 'production_consume', recId);
      }
    }
    const hoursUsed = started * plan.laborHoursPerUnit;
    const laborAbsorbed = ctx.laborHoursAvailable > 0 ? prorate(ctx.laborPool, Math.min(hoursUsed, ctx.laborHoursAvailable), ctx.laborHoursAvailable) : 0;
    const factoryLines = company.lines.filter((l) => l.facilityId === line.facilityId).length || 1;
    const overheadShare = Math.floor((ctx.overheadPool[line.facilityId] ?? 0) / factoryLines);
    const overheadAbsorbed = line.capacity > 0 ? prorate(overheadShare, Math.min(started, line.capacity), line.capacity) : 0;
    const energyCost = mul(world.economy.energyPriceINRPerKwh, started * product.energyKwh);
    const conversion = laborAbsorbed + overheadAbsorbed + energyCost;
    const total = materialCost + conversion;
    const goodValue = started > 0 ? prorate(total, good, started) : 0;
    const scrapValue = total - goodValue;
    if (good > 0) addStock(company, world.counters, tick, 'finished', product.id, good, goodValue, 'production_output', recId);
    if (total > 0) {
      postEntry(company, world.counters, {
        tick,
        memo: `Production ${recId}: ${good} × ${product.name} on ${line.name}${scrap ? `, ${scrap} scrapped` : ''}`,
        source: { type: 'production', id: recId },
        cashFlow: 'none',
        lines: [
          { account: '1210', debit: goodValue, credit: 0, memo: 'Finished goods at absorbed cost' },
          { account: '5050', debit: scrapValue, credit: 0, memo: 'Scrap' },
          { account: '1200', debit: 0, credit: materialCost, memo: 'Materials consumed' },
          { account: '1295', debit: 0, credit: laborAbsorbed + overheadAbsorbed, memo: 'Labor and overhead absorbed' },
          { account: '2000', debit: 0, credit: energyCost, memo: 'Energy bill payable' },
        ],
        idempotencyKey: `production:${line.id}:${tick}`,
      });
    }
    if (energyCost > 0) {
      company.payables.push({ id: nextId(world.counters, 'AP'), counterparty: 'State electricity board', amount: energyCost, dueTick: tick + 1, status: 'open', sourceId: recId, kind: 'other', account: '2000' });
    }
    // wear and tear
    const utilization = line.capacity > 0 ? started / line.capacity : 0;
    line.condition = Math.max(0.2, +(line.condition - (0.005 + 0.025 * utilization)).toFixed(4));
    if (line.status === 'maintenance' && line.maintenanceUntil <= tick) {
      line.condition = 1;
      line.status = 'running';
    }
    const status: ProductionRecord['status'] = started === 0 ? 'blocked' : started < plan.planned ? 'partial' : 'completed';
    const rec: ProductionRecord = {
      id: recId,
      tick,
      lineId: line.id,
      productId: product.id,
      planned: plan.planned,
      feasible: plan.feasible,
      produced: good,
      scrap,
      bottleneck: plan.feasible < plan.planned && plan.bottleneck ? plan.bottleneck.label : '—',
      materialCost,
      conversionCost: conversion,
      unitCost: good > 0 ? Math.round(goodValue / good) : 0,
      status,
    };
    company.production.push(rec);
    records.push(rec);
  }
  return records;
}

function avgProductionSkill(company: Company): number {
  const teams = company.teams.filter((t) => t.department === 'production' && t.headcount > 0);
  const hc = teams.reduce((a, t) => a + t.headcount, 0);
  return hc ? teams.reduce((a, t) => a + t.skill * t.headcount, 0) / hc : 50;
}

function supplierQualityPenalty(world: WorldState, materialIds: string[]): number {
  void materialIds;
  let p = 0;
  for (const s of Object.values(world.supplierStatus)) if (s.qualityIssues > 0) p = Math.max(p, 0.01 * s.qualityIssues);
  return Math.min(0.05, p);
}

export function validatePlan(world: WorldState, company: Company, lineId: string, plannedUnits: number, productId?: string | null): Feasibility {
  if (!Number.isInteger(plannedUnits) || plannedUnits < 0) throw new DomainError('Planned units must be a non-negative whole number', 'BAD_QTY');
  const line = company.lines.find((l) => l.id === lineId);
  if (!line) throw new DomainError('Production line not found', 'NOT_FOUND');
  if (productId) {
    const p = company.products.find((x) => x.id === productId && x.status === 'active');
    if (!p) throw new DomainError('Product is not active', 'INVALID');
  }
  const f = planFeasibility(world, company, { [lineId]: { plannedUnits, productId } }, true, lineId).find((x) => x.lineId === lineId)!;
  if (plannedUnits > f.maxFeasible) {
    throw new DomainError(
      `Planned output ${plannedUnits} exceeds the feasible maximum of ${f.maxFeasible} (limited by ${f.bottleneck?.label ?? 'capacity'}).`,
      'INFEASIBLE_PLAN',
    );
  }
  return f;
}

export function lineOnHandCover(company: Company, productId: string): number {
  return onHand(company, 'finished', productId);
}
