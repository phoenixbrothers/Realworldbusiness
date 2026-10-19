/**
 * Purchasing and inbound logistics.
 *  - Orders can only be placed with qualified suppliers that are online and
 *    not subject to an export ban, and the landed cost must be covered by
 *    cash net of committed orders (no over-commitment).
 *  - Goods are paid on receipt: supplier value to AP per payment terms,
 *    customs duty and freight due immediately.
 *  - Arrivals honour route delays, supplier reliability and export bans.
 */
import type { Company, PurchaseOrder, WorldState } from './types';
import { DomainError } from './types';
import { MATERIALS, SUPPLIERS } from './catalog';
import { addStock } from './inventory';
import { cashBalance, nextId, postEntry } from './ledger';
import { mul } from './money';
import type { Rng } from './rng';
import { addPayable, formatRs } from './finance';
import { isExportBanned, landedQuote, notify, routeDelay, tickLabel } from './world';

export function committedPurchases(company: Company): number {
  return company.purchaseOrders.filter((p) => p.status === 'in_transit' || p.status === 'delayed').reduce((a, p) => a + p.totalCost, 0);
}

export function isQualified(world: WorldState, company: Company, supplierId: string): boolean {
  return company.qualifiedSuppliers.some((q) => q.supplierId === supplierId && q.readyTick <= world.tick);
}

export function placePurchaseOrder(world: WorldState, company: Company, supplierId: string, materialId: string, qty: number, expedited = false): PurchaseOrder {
  const s = SUPPLIERS[supplierId];
  if (!s) throw new DomainError('Unknown supplier', 'NOT_FOUND');
  if (!MATERIALS[materialId]) throw new DomainError('Unknown material', 'NOT_FOUND');
  if (!s.materials.includes(materialId)) throw new DomainError(`${s.name} does not supply ${MATERIALS[materialId].name}`, 'VALIDATION');
  if (!Number.isInteger(qty) || qty <= 0) throw new DomainError('Quantity must be a positive whole number', 'BAD_QTY');
  if (!isQualified(world, company, supplierId)) {
    const pending = company.qualifiedSuppliers.find((q) => q.supplierId === supplierId);
    throw new DomainError(pending ? `${s.name} is still being qualified (ready ${tickLabel(world, pending.readyTick)})` : `${s.name} is not a qualified supplier. Qualify it first (1 month, ₹1.5 L).`, 'NOT_QUALIFIED');
  }
  const q = landedQuote(world, company, supplierId, materialId, qty, expedited);
  if (!q.supplierOnline) throw new DomainError(`${s.name} is not accepting orders (operations halted)`, 'SUPPLIER_OFFLINE');
  if (q.banned) throw new DomainError(`Export restriction: ${MATERIALS[materialId].name} cannot currently be shipped from ${s.country}`, 'EXPORT_BANNED');
  const thisMonth = company.purchaseOrders.filter((p) => p.supplierId === supplierId && p.materialId === materialId && p.orderedTick === world.tick && p.status !== 'cancelled').reduce((a, p) => a + p.qty, 0);
  if (thisMonth + qty > s.capacityPerMonth) throw new DomainError(`${s.name} can supply at most ${s.capacityPerMonth.toLocaleString('en-IN')} ${MATERIALS[materialId].unit} per month (${thisMonth.toLocaleString('en-IN')} already ordered)`, 'SUPPLIER_CAPACITY');
  const available = cashBalance(company) - committedPurchases(company);
  if (q.total > available) {
    throw new DomainError(`Insufficient uncommitted cash: order costs ${formatRs(q.total)}, available ${formatRs(Math.max(0, available))} after open orders`, 'INSUFFICIENT_CASH');
  }
  const po: PurchaseOrder = {
    id: nextId(world.counters, 'PO'),
    supplierId,
    materialId,
    qty,
    unitPriceINR: q.unitPrice,
    tariffRate: q.tariffRate,
    freightCost: q.freight + q.expediteFee,
    totalCost: q.total,
    orderedTick: world.tick,
    expectedTick: world.tick + q.leadTime + q.routeDelay,
    status: 'in_transit',
    mode: expedited ? 'expedited' : 'standard',
  };
  if (q.routeDelay > 0) po.delayReason = 'Route disruption at order time';
  company.purchaseOrders.push(po);
  return po;
}

export function cancelPurchaseOrder(world: WorldState, company: Company, poId: string): { fee: number } {
  const po = company.purchaseOrders.find((p) => p.id === poId);
  if (!po) throw new DomainError('Purchase order not found', 'NOT_FOUND');
  if (po.status !== 'in_transit' && po.status !== 'delayed') throw new DomainError(`Cannot cancel an order that is ${po.status}`, 'INVALID_STATE');
  // orders already shipped (placed in an earlier month) carry a 10% cancellation fee
  const fee = po.orderedTick < world.tick ? mul(po.unitPriceINR * po.qty, 0.1) : 0;
  if (fee > 0) {
    postEntry(company, world.counters, {
      tick: world.tick,
      memo: `Cancellation fee for ${po.id}`,
      source: { type: 'purchase_order', id: po.id },
      cashFlow: 'none',
      lines: [
        { account: '6800', debit: fee, credit: 0 },
        { account: '2000', debit: 0, credit: fee },
      ],
      idempotencyKey: `po-cancel:${po.id}`,
    });
    addPayable(world, company, { counterparty: SUPPLIERS[po.supplierId].name, amount: fee, dueTick: world.tick, sourceId: po.id, kind: 'supplier', account: '2000' });
  }
  po.status = 'cancelled';
  return { fee };
}

export function expeditePurchaseOrder(world: WorldState, company: Company, poId: string): { fee: number } {
  const po = company.purchaseOrders.find((p) => p.id === poId);
  if (!po) throw new DomainError('Purchase order not found', 'NOT_FOUND');
  if (po.status !== 'in_transit' && po.status !== 'delayed') throw new DomainError(`Cannot expedite an order that is ${po.status}`, 'INVALID_STATE');
  if (po.mode === 'expedited') throw new DomainError('Order is already expedited', 'INVALID_STATE');
  const s = SUPPLIERS[po.supplierId];
  if (isExportBanned(world, s.country, po.materialId)) throw new DomainError('Export restriction blocks this shipment regardless of transport mode', 'EXPORT_BANNED');
  const fee = mul(po.unitPriceINR * po.qty, 0.06) + 5000000;
  if (fee > cashBalance(company)) throw new DomainError(`Air-freight premium ${formatRs(fee)} exceeds available cash`, 'INSUFFICIENT_CASH');
  postEntry(company, world.counters, {
    tick: world.tick,
    memo: `Air-freight upgrade for ${po.id}`,
    source: { type: 'purchase_order', id: po.id },
    cashFlow: 'operating',
    cashFlowLine: 'Payments to suppliers',
    lines: [
      { account: '6800', debit: fee, credit: 0 },
      { account: '1000', debit: 0, credit: fee },
    ],
    idempotencyKey: `po-expedite:${po.id}`,
  });
  po.mode = 'expedited';
  po.expectedTick = world.tick;
  po.status = 'in_transit';
  po.delayReason = undefined;
  return { fee };
}

export function qualifySupplier(world: WorldState, company: Company, supplierId: string): void {
  const s = SUPPLIERS[supplierId];
  if (!s) throw new DomainError('Unknown supplier', 'NOT_FOUND');
  if (company.qualifiedSuppliers.some((q) => q.supplierId === supplierId)) throw new DomainError(`${s.name} is already qualified or in qualification`, 'INVALID_STATE');
  const cost = 15000000; // ₹1.5 L audit and sample approval
  if (cost > cashBalance(company)) throw new DomainError('Not enough cash for the supplier audit (₹1.5 L)', 'INSUFFICIENT_CASH');
  postEntry(company, world.counters, {
    tick: world.tick,
    memo: `Supplier qualification audit: ${s.name}`,
    source: { type: 'supplier', id: supplierId },
    cashFlow: 'operating',
    cashFlowLine: 'Payments to suppliers',
    lines: [
      { account: '6800', debit: cost, credit: 0 },
      { account: '1000', debit: 0, credit: cost },
    ],
    idempotencyKey: `qualify:${company.id}:${supplierId}`,
  });
  company.qualifiedSuppliers.push({ supplierId, readyTick: world.tick + 1, cost });
}

/** process orders due this month: delay, block or receive */
export function processArrivals(world: WorldState, company: Company, rng: Rng): { received: PurchaseOrder[]; delayed: PurchaseOrder[]; blocked: PurchaseOrder[] } {
  const received: PurchaseOrder[] = [];
  const delayed: PurchaseOrder[] = [];
  const blocked: PurchaseOrder[] = [];
  for (const po of company.purchaseOrders) {
    if ((po.status !== 'in_transit' && po.status !== 'delayed') || po.expectedTick > world.tick) continue;
    const s = SUPPLIERS[po.supplierId];
    const status = world.supplierStatus[s.id];
    if (isExportBanned(world, s.country, po.materialId)) {
      po.status = 'blocked';
      po.delayReason = 'Export restriction — shipment not released';
      blocked.push(po);
      notify(world, { companyId: company.id, severity: 'critical', title: `${po.id} blocked by export restriction`, body: `${po.qty.toLocaleString('en-IN')} ${MATERIALS[po.materialId].unit} of ${MATERIALS[po.materialId].name} from ${s.name} will not ship. No payment is due. Qualify an alternative supplier.`, kind: 'operations', link: { module: 'supply-chain', id: po.id } });
      continue;
    }
    if (!status.online) {
      po.status = 'blocked';
      po.delayReason = 'Supplier halted operations';
      blocked.push(po);
      notify(world, { companyId: company.id, severity: 'high', title: `${po.id} cancelled: ${s.name} halted`, body: 'The supplier cannot fulfil this order. No payment is due.', kind: 'operations', link: { module: 'supply-chain', id: po.id } });
      continue;
    }
    if (po.mode !== 'expedited') {
      const extra = routeDelay(world, s.routeId);
      const late = rng.chance(1 - status.reliability);
      if (extra > 0 || late) {
        const by = Math.max(extra, 1);
        po.expectedTick = world.tick + by;
        po.status = 'delayed';
        po.delayReason = extra > 0 ? 'Route disruption' : 'Supplier missed ship date';
        delayed.push(po);
        notify(world, { companyId: company.id, severity: 'medium', title: `${po.id} delayed to ${tickLabel(world, po.expectedTick)}`, body: `${po.delayReason}: ${MATERIALS[po.materialId].name} from ${s.name}.`, kind: 'operations', link: { module: 'supply-chain', id: po.id } });
        continue;
      }
    }
    // receive
    const goods = po.unitPriceINR * po.qty;
    const duties = po.totalCost - goods;
    addStock(company, world.counters, world.tick, 'raw', po.materialId, po.qty, po.totalCost, 'purchase_receipt', po.id);
    postEntry(company, world.counters, {
      tick: world.tick,
      memo: `Goods received ${po.id}: ${po.qty.toLocaleString('en-IN')} ${MATERIALS[po.materialId].unit} ${MATERIALS[po.materialId].name} from ${s.name}`,
      source: { type: 'purchase_order', id: po.id },
      cashFlow: 'none',
      lines: [
        { account: '1200', debit: po.totalCost, credit: 0, memo: 'Landed cost' },
        { account: '2000', debit: 0, credit: po.totalCost, memo: 'Supplier, customs & freight payable' },
      ],
      idempotencyKey: `receipt:${po.id}`,
    });
    const supplierPayable = addPayable(world, company, { counterparty: s.name, amount: goods, dueTick: world.tick + s.paymentTermsMonths, sourceId: po.id, kind: 'supplier', account: '2000' });
    if (duties > 0) addPayable(world, company, { counterparty: 'Customs & freight forwarder', amount: duties, dueTick: world.tick, sourceId: po.id, kind: 'supplier', account: '2000' });
    po.payableId = supplierPayable.id;
    po.status = 'received';
    po.receivedTick = world.tick;
    received.push(po);
  }
  return { received, delayed, blocked };
}

/** materials whose stock plus inbound will not cover next month's plan */
export function shortageForecast(world: WorldState, company: Company, needs: Record<string, number>): { materialId: string; need: number; onHand: number; inbound: number; gap: number }[] {
  const out: { materialId: string; need: number; onHand: number; inbound: number; gap: number }[] = [];
  for (const [m, need] of Object.entries(needs)) {
    const onHand = company.rawInventory[m]?.qty ?? 0;
    const inbound = company.purchaseOrders.filter((p) => p.materialId === m && (p.status === 'in_transit' || p.status === 'delayed') && p.expectedTick <= world.tick).reduce((a, p) => a + p.qty, 0);
    if (onHand + inbound < need) out.push({ materialId: m, need, onHand, inbound, gap: need - onHand - inbound });
  }
  return out;
}
