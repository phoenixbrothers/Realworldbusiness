import { describe, expect, it } from 'vitest';
import {
  DomainError,
  addStock,
  advanceMonth,
  allocate,
  balanceSheet,
  buildEvent,
  cashBalance,
  cashFlowStatement,
  companyInvariants,
  computeExposure,
  createEvent,
  createWorld,
  incomeStatement,
  kpis,
  planFeasibility,
  postEntry,
  project,
  rawBalance,
  reconcileInventory,
  removeStock,
  reverseEntry,
  runway,
  validatePlan,
  varianceBridge,
  worldInvariants,
  applyAction,
} from '../engine/index';
import { act, newCompanyWorld, operate } from './helpers';

const expectAllInvariants = (world: Parameters<typeof worldInvariants>[0]) => {
  const r = worldInvariants(world);
  expect(r.failures.map((f) => `${f.check.label} expected=${f.check.expected} actual=${f.check.actual}`)).toEqual([]);
};

describe('money', () => {
  it('allocates without losing paise', () => {
    const parts = allocate(100001, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100001);
  });
});

describe('ledger (SIM-01 accounting integrity)', () => {
  it('rejects unbalanced, fractional, negative-cash and duplicate postings', () => {
    const { world, company } = newCompanyWorld();
    const c = company();
    const base = { tick: 0, memo: 'x', source: { type: 't', id: '1' }, cashFlow: 'none' as const };
    expect(() => postEntry(c, world.counters, { ...base, idempotencyKey: 'a', lines: [{ account: '6000', debit: 100, credit: 0 }, { account: '1000', debit: 0, credit: 99 }] })).toThrow(/Unbalanced/);
    expect(() => postEntry(c, world.counters, { ...base, idempotencyKey: 'b', lines: [{ account: '6000', debit: 1.5, credit: 0 }, { account: '1000', debit: 0, credit: 1.5 }] })).toThrow(/integer/);
    const cash = cashBalance(c);
    expect(() => postEntry(c, world.counters, { ...base, idempotencyKey: 'c', lines: [{ account: '6000', debit: cash + 1, credit: 0 }, { account: '1000', debit: 0, credit: cash + 1 }] })).toThrow(/negative/);
    postEntry(c, world.counters, { ...base, idempotencyKey: 'd', lines: [{ account: '6000', debit: 100, credit: 0 }, { account: '1000', debit: 0, credit: 100 }] });
    expect(() => postEntry(c, world.counters, { ...base, idempotencyKey: 'd', lines: [{ account: '6000', debit: 100, credit: 0 }, { account: '1000', debit: 0, credit: 100 }] })).toThrow(/Duplicate/);
  });

  it('founder capital, setup capex and fees reconcile into a balanced opening balance sheet', () => {
    const { world, company } = newCompanyWorld();
    const c = company();
    const bs = balanceSheet(c, world.tick);
    expect(bs.balanced).toBe(true);
    expect(rawBalance(c, '3000')).toBe(-30_00_00_000 * 100);
    expect(bs.totalAssets).toBe(bs.totalLiabilities + bs.totalEquity);
    expectAllInvariants(world);
  });

  it('reversals keep the original and net to zero', () => {
    const { world, companyId, company } = newCompanyWorld();
    const r = act(world, 'post_adjustment', { memo: 'Reclassify training cost', lines: [{ account: '6700', debit: 5000 }, { account: '6000', credit: 5000 }] }, companyId);
    const id = (r.data as { entryId: string }).entryId;
    act(world, 'reverse_entry', { entryId: id, reason: 'Posted in error' }, companyId);
    const c = company();
    expect(c.journal.find((e) => e.id === id)!.status).toBe('reversed');
    expect(rawBalance(c, '6700')).toBe(0);
    expect(() => act(world, 'reverse_entry', { entryId: id, reason: 'again please' }, companyId)).toThrow(/already been reversed/);
    // reversing the founder contribution after cash was spent would make cash negative: refused
    expect(() => reverseEntry(c, world.counters, c.journal[0].id, 0, 'x')).toThrow(/Insufficient cash/);
  });

  it('adjustments cannot touch cash or sub-ledger accounts', () => {
    const { world, companyId } = newCompanyWorld();
    expect(() => act(world, 'post_adjustment', { memo: 'Sneaky cash edit', lines: [{ account: '1000', debit: 5000 }, { account: '4000', credit: 5000 }] }, companyId)).toThrow(/reclassify/);
  });

  it('equity raise, loan drawdown and purchases reconcile across 12 months in every industry', () => {
    for (const industry of ['electronics', 'ev', 'food'] as const) {
      const { world, companyId, company } = newCompanyWorld(industry, 11);
      act(world, 'propose_transaction', { kind: 'term_loan', terms: { amount: 1_50_00_000 * 100, termMonths: 36 } }, companyId);
      act(world, 'decide_transaction', { transactionId: company().transactions[0].id, decision: 'approve' }, companyId);
      act(world, 'propose_transaction', { kind: 'equity_round', terms: { amount: 3_00_00_000 * 100, counterparty: 'Konkan Ventures' } }, companyId);
      act(world, 'decide_transaction', { transactionId: company().transactions[1].id, decision: 'approve' }, companyId);
      expect(company().shareholders.some((s) => s.name === 'Konkan Ventures')).toBe(true);
      for (let m = 0; m < 12; m++) {
        operate(world, company());
        act(world, 'advance_month', { expectedTick: world.tick });
        expectAllInvariants(world);
      }
      const c = company();
      const cf = cashFlowStatement(c, 0, world.tick);
      expect(cf.reconciles).toBe(true);
      expect(cf.closing).toBe(cashBalance(c));
      const is = incomeStatement(c, 0, world.tick);
      expect(balanceSheet(c, world.tick).retainedEarnings).toBe(is.netIncome);
      expect(c.history.length).toBe(12);
    }
  });
});

describe('inventory (SIM-02 reconciliation)', () => {
  it('moving-average values reconcile exactly and stock cannot go negative', () => {
    const { world, company } = newCompanyWorld();
    const c = company();
    addStock(c, world.counters, 0, 'raw', 'polymer', 3, 1000, 'purchase_receipt', 'x');
    postEntry(c, world.counters, { tick: 0, memo: 'r', source: { type: 't', id: 'x' }, cashFlow: 'none', idempotencyKey: 'inv1', lines: [{ account: '1200', debit: 1000, credit: 0 }, { account: '2000', debit: 0, credit: 1000 }] });
    const v1 = removeStock(c, world.counters, 0, 'raw', 'polymer', 1, 'production_consume', 'y');
    const v2 = removeStock(c, world.counters, 0, 'raw', 'polymer', 2, 'production_consume', 'y');
    expect(v1 + v2).toBe(1000);
    expect(() => removeStock(c, world.counters, 0, 'raw', 'polymer', 1, 'production_consume', 'z')).toThrow(/Insufficient stock/);
    expect(reconcileInventory(c).checks.filter((x) => x.label.includes('polymer')).every((x) => x.ok)).toBe(true);
  });
});

describe('production constraints (SIM-02)', () => {
  it('cannot plan above material, labor or machine limits', () => {
    const { world, companyId, company } = newCompanyWorld();
    const line = company().lines[0];
    // no materials on hand or inbound
    expect(() => act(world, 'set_production_plan', { lineId: line.id, plannedUnits: 100 }, companyId)).toThrow(/feasible maximum of 0/);
    operate(world, company(), 0.4);
    const f = planFeasibility(world, company()).find((x) => x.lineId === line.id)!;
    expect(() => validatePlan(world, company(), line.id, f.maxFeasible + 1)).toThrow(DomainError);
    expect(() => validatePlan(world, company(), line.id, f.maxFeasible)).not.toThrow();
  });

  it('raising one line never silently makes another line infeasible', () => {
    const { world, companyId, company } = newCompanyWorld();
    operate(world, company(), 0.6);
    const [l1, l2] = company().lines;
    const before = planFeasibility(world, company()).find((f) => f.lineId === l2.id)!;
    expect(before.feasible).toBe(l2.plannedUnits);
    const max1 = validatePlan(world, company(), l1.id, 0).maxFeasible;
    act(world, 'set_production_plan', { lineId: l1.id, plannedUnits: max1 }, companyId);
    for (const f of planFeasibility(world, company())) expect(f.feasible).toBe(f.planned);
  });

  it('consumes exactly the bill of materials and never produces twice in one tick', () => {
    const { world, company } = newCompanyWorld();
    operate(world, company(), 0.3, 1);
    advanceMonth(world);
    const c = company();
    for (const rec of c.production.filter((p) => p.tick === 0)) {
      const product = c.products.find((p) => p.id === rec.productId)!;
      for (const b of product.bom) {
        const consumed = -c.movements.filter((m) => m.refId === rec.id && m.itemId === b.materialId).reduce((a, m) => a + m.qty, 0);
        expect(consumed).toBe(Math.ceil((rec.produced + rec.scrap) * b.qty - 1e-9));
      }
      expect(c.journal.filter((e) => e.idempotencyKey === `production:${rec.lineId}:0`).length).toBe(1);
    }
    expectAllInvariants(world);
  });

  it('an energy shortage binds output unless generators are rented', () => {
    const run = (mitigate: boolean) => {
      const { world, companyId, company } = newCompanyWorld('food', 3);
      operate(world, company(), 0.9, 1);
      const ev = createEvent(world, buildEvent(world, 'energy_shortage', 1)!);
      if (mitigate) act(world, 'apply_mitigation', { eventId: ev.id, kind: 'rent_generator' }, companyId);
      const f = planFeasibility(world, company(), {}, false);
      return f.map((x) => x.constraints.find((k) => k.key === 'energy')!.limit);
    };
    const without = run(false);
    const withGen = run(true);
    expect(withGen[0]).toBeGreaterThan(without[0]);
  });
});

describe('events (SIM-03 exposure-specific propagation)', () => {
  it('an export restriction blocks exposed orders but leaves an unexposed company untouched', () => {
    const world = createWorld({ name: 'Two firms', seed: 5, scriptedEvents: false });
    const mk = (name: string, industry: 'electronics' | 'food') => (act(world, 'create_company', { name, brand: name.slice(0, 5), industry, city: 'Pune', strategy: 'focus', founderName: 'F', founderCapital: 30_00_00_000 * 100, openingLoan: 0, factoryMode: 'build', warehouseMode: 'lease', rndLab: false, products: industry === 'electronics' ? ['phone_a1'] : ['koozh_classic'] }).data as { companyId: string }).companyId;
    const eId = mk('Chip Co', 'electronics');
    const fId = mk('Food Co', 'food');
    const e = world.companies.find((c) => c.id === eId)!;
    // force chipset sourcing from China
    act(world, 'place_po', { supplierId: 's_shenzhen', materialId: 'chipset', qty: 1000 }, eId);
    const draft = buildEvent(world, 'export_restriction', 'CN')!;
    draft.effects = { exportBan: [{ country: 'CN', materialIds: ['chipset'] }] };
    const ev = createEvent(world, draft);
    const food = world.companies.find((c) => c.id === fId)!;
    expect(computeExposure(world, food, ev).level).toBe('none');
    const exE = computeExposure(world, e, ev);
    expect(exE.items.some((i) => i.type === 'purchase_order')).toBe(true);
    expect(exE.mitigations.some((m) => m.kind === 'qualify_supplier' || m.kind === 'order_alternate')).toBe(true);
    expect(() => act(world, 'place_po', { supplierId: 's_shenzhen', materialId: 'chipset', qty: 10 }, eId)).toThrow(/Export restriction/);
    advanceMonth(world);
    expect(e.purchaseOrders[0].status).toBe('in_transit'); // not yet due (1-month lead time)
    advanceMonth(world);
    expect(e.purchaseOrders[0].status).toBe('blocked');
    expect(e.rawInventory.chipset?.qty ?? 0).toBe(0);
    expectAllInvariants(world);
  });

  it('a port strike delays in-transit orders on that route only; expediting bypasses it', () => {
    const { world, companyId, company } = newCompanyWorld('electronics', 9);
    act(world, 'place_po', { supplierId: 's_shenzhen', materialId: 'display', qty: 500 }, companyId);
    act(world, 'place_po', { supplierId: 's_bengaluru', materialId: 'chipset', qty: 500 }, companyId);
    advanceMonth(world); // tick 1: shenzhen order due now
    createEvent(world, buildEvent(world, 'port_strike', 'CN-CHE')!);
    const [cn, inr] = company().purchaseOrders;
    expect(inr.status).toBe('received');
    const before = structuredClone(world);
    advanceMonth(world);
    expect(company().purchaseOrders[0].status).toBe('delayed');
    // same situation, expedited
    const c2 = before.companies[0];
    applyAction(before, { type: 'expedite_po', companyId: c2.id, payload: { poId: cn.id } }, { actionId: 'x1' });
    advanceMonth(before);
    expect(before.companies[0].purchaseOrders[0].status).toBe('received');
  });
});

describe('simulation advance (UX-08 / SIM-04)', () => {
  it('rejects stale or duplicate advances', () => {
    const { world } = newCompanyWorld();
    act(world, 'advance_month', { expectedTick: 0 });
    expect(() => act(world, 'advance_month', { expectedTick: 0 })).toThrow(/already processed or is stale/);
  });

  it('replaying the same seed and ordered actions reproduces the same world', () => {
    const run = () => {
      const { world, company } = newCompanyWorld('ev', 1234, { scriptedEvents: true });
      for (let i = 0; i < 6; i++) {
        operate(world, company());
        act(world, 'advance_month', { expectedTick: world.tick });
      }
      return JSON.stringify({ ...world, counters: world.counters });
    };
    expect(run()).toBe(run());
  });

  it('R&D needs time and an explicit gate decision before benefits apply', () => {
    const { world, companyId, company } = newCompanyWorld('electronics', 21);
    const p = company().products[0];
    const q0 = p.quality;
    act(world, 'create_rnd_project', { name: 'Better phone', kind: 'quality_upgrade', targetProductId: p.id, monthlyBudget: 6_00_000 * 100 }, companyId);
    const proj = company().rndProjects[0];
    expect(() => act(world, 'decide_gate', { projectId: proj.id, decision: 'go' }, companyId)).toThrow(/No gate decision/);
    let launched = false;
    for (let i = 0; i < 40 && !launched; i++) {
      advanceMonth(world);
      if (proj.awaitingGate) act(world, 'decide_gate', { projectId: proj.id, decision: 'go' }, companyId);
      launched = proj.status === 'launched';
      if (!launched) expect(company().products[0].quality).toBe(q0);
    }
    expect(launched).toBe(true);
    expect(company().products[0].quality).toBe(q0 + 10);
    expect(proj.gates.filter((g) => g.result === 'passed').length).toBe(5);
  });
});

describe('read models', () => {
  it('KPIs carry definitions, sources and types; runway is not meaningful when cash-generative', () => {
    const { world, company } = newCompanyWorld();
    operate(world, company());
    advanceMonth(world);
    const k = kpis(world, company());
    for (const x of k) {
      expect(x.definition.length).toBeGreaterThan(10);
      expect(['actual', 'forecast', 'estimate', 'scenario']).toContain(x.dataType);
    }
    expect(k.find((x) => x.key === 'runway')!.dataType).toBe('estimate');
    const rw = runway(company(), world);
    expect(rw.meaningful ? rw.months! > 0 : rw.months === null).toBe(true);
  });

  it('variance bridge reconciles to the net income change', () => {
    const { world, company } = newCompanyWorld();
    for (let i = 0; i < 3; i++) {
      operate(world, company());
      advanceMonth(world);
    }
    const b = varianceBridge(world, company())!;
    expect(b.reconciles).toBe(true);
  });

  it('forecasts do not mutate the world and are labelled', () => {
    const { world, company } = newCompanyWorld();
    operate(world, company());
    const before = JSON.stringify(world);
    const f = project(world, company().id, 3);
    expect(JSON.stringify(world)).toBe(before);
    expect(f.dataType).toBe('forecast');
    expect(f.points.length).toBe(3);
    const s = project(world, company().id, 3, { priceChangePct: 10 });
    expect(s.dataType).toBe('scenario');
    expect(companyInvariants(company()).every((c) => c.ok)).toBe(true);
  });
});
