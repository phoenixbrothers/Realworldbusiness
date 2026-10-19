/**
 * Perpetual inventory with moving-average cost tracked as total value.
 * Removing q of Q units removes round(V*q/Q) value (all value when q === Q),
 * so item values always sum exactly to the GL inventory accounts.
 */
import type { Company, InventoryItem, InventoryMovement, Money, Tick } from './types';
import { DomainError } from './types';
import { prorate } from './money';
import { nextId, rawBalance } from './ledger';
import { MATERIALS, PRODUCT_TEMPLATES } from './catalog';

function bucket(company: Company, kind: 'raw' | 'finished'): Record<string, InventoryItem> {
  return kind === 'raw' ? company.rawInventory : company.finishedInventory;
}

export function onHand(company: Company, kind: 'raw' | 'finished', itemId: string): number {
  return bucket(company, kind)[itemId]?.qty ?? 0;
}

export function addStock(
  company: Company,
  counters: Record<string, number>,
  tick: Tick,
  kind: 'raw' | 'finished',
  itemId: string,
  qty: number,
  value: Money,
  reason: InventoryMovement['reason'],
  refId: string,
): InventoryMovement {
  if (!Number.isInteger(qty) || qty <= 0) throw new DomainError('Stock receipts must be a positive whole quantity', 'BAD_QTY');
  if (!Number.isSafeInteger(value) || value < 0) throw new DomainError('Stock value must be non-negative integer paise', 'BAD_VALUE');
  const b = bucket(company, kind);
  const item = b[itemId] ?? { qty: 0, value: 0 };
  item.qty += qty;
  item.value += value;
  b[itemId] = item;
  const mv: InventoryMovement = { id: nextId(counters, 'MV'), tick, kind, itemId, qty, value, reason, refId };
  company.movements.push(mv);
  return mv;
}

/** remove stock; returns the carrying value removed */
export function removeStock(
  company: Company,
  counters: Record<string, number>,
  tick: Tick,
  kind: 'raw' | 'finished',
  itemId: string,
  qty: number,
  reason: InventoryMovement['reason'],
  refId: string,
): Money {
  if (!Number.isInteger(qty) || qty <= 0) throw new DomainError('Stock issues must be a positive whole quantity', 'BAD_QTY');
  const b = bucket(company, kind);
  const item = b[itemId];
  if (!item || item.qty < qty) throw new DomainError(`Insufficient stock of ${itemId}: have ${item?.qty ?? 0}, need ${qty}`, 'INSUFFICIENT_STOCK');
  const value = prorate(item.value, qty, item.qty);
  item.qty -= qty;
  item.value -= value;
  if (item.qty === 0) item.value = 0;
  company.movements.push({ id: nextId(counters, 'MV'), tick, kind, itemId, qty: -qty, value: -value, reason, refId });
  return value;
}

export function inventoryValue(company: Company, kind: 'raw' | 'finished'): Money {
  return Object.values(bucket(company, kind)).reduce((a, i) => a + i.value, 0);
}

export function storageUsed(company: Company): number {
  let v = 0;
  for (const [id, it] of Object.entries(company.rawInventory)) v += it.qty * (MATERIALS[id]?.volume ?? 0);
  for (const [pid, it] of Object.entries(company.finishedInventory)) {
    const p = company.products.find((x) => x.id === pid);
    v += it.qty * (p ? PRODUCT_TEMPLATES[p.templateId]?.volume ?? 0.05 : 0.05);
  }
  return Math.round(v);
}

export function storageCapacity(company: Company): number {
  return company.facilities.filter((f) => f.type === 'warehouse' && f.status !== 'under_construction').reduce((a, f) => a + f.capacity, 0);
}

export interface ReconciliationResult {
  ok: boolean;
  checks: { label: string; expected: number; actual: number; ok: boolean }[];
}

/** Stock balances must equal the sum of movements, and values must equal the GL. */
export function reconcileInventory(company: Company): ReconciliationResult {
  const checks: ReconciliationResult['checks'] = [];
  for (const kind of ['raw', 'finished'] as const) {
    const b = bucket(company, kind);
    const mvQty: Record<string, number> = {};
    const mvVal: Record<string, number> = {};
    for (const m of company.movements) {
      if (m.kind !== kind) continue;
      mvQty[m.itemId] = (mvQty[m.itemId] ?? 0) + m.qty;
      mvVal[m.itemId] = (mvVal[m.itemId] ?? 0) + m.value;
    }
    const ids = new Set([...Object.keys(b), ...Object.keys(mvQty)]);
    for (const id of ids) {
      const q = b[id]?.qty ?? 0;
      const v = b[id]?.value ?? 0;
      checks.push({ label: `${kind} ${id} quantity = Σ movements`, expected: mvQty[id] ?? 0, actual: q, ok: (mvQty[id] ?? 0) === q });
      checks.push({ label: `${kind} ${id} value = Σ movement values`, expected: mvVal[id] ?? 0, actual: v, ok: (mvVal[id] ?? 0) === v });
      if (q < 0) checks.push({ label: `${kind} ${id} non-negative`, expected: 0, actual: q, ok: false });
    }
    const gl = rawBalance(company, kind === 'raw' ? '1200' : '1210');
    const sub = inventoryValue(company, kind);
    checks.push({ label: `${kind === 'raw' ? 'Raw materials' : 'Finished goods'} subledger = GL ${kind === 'raw' ? '1200' : '1210'}`, expected: gl, actual: sub, ok: gl === sub });
  }
  return { ok: checks.every((c) => c.ok), checks };
}
