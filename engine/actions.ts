/**
 * Command dispatcher — the only way state changes.
 *
 * The UI submits proposed actions; each handler validates preconditions
 * against the authoritative state and either applies the change or throws a
 * DomainError (in which case the caller discards the working copy).
 */
import type { ActionResult, Company, CountryCode, IndustryId, RndProject, Strategy, TransactionKind, WorldState } from './types';
import { DomainError } from './types';
import { createCompany, estimateSetup, updateCompany } from './company';
import type { CreateCompanyInput } from './company';
import { cancelPurchaseOrder, expeditePurchaseOrder, placePurchaseOrder, qualifySupplier } from './procurement';
import { validatePlan } from './production';
import { cancelRequisition, layoff, openRequisition, setSalary, startTraining } from './workforce';
import type { TRAININGS } from './workforce';
import { createProject, decideGate, setProjectBudget } from './rnd';
import { cancelCampaign, createCampaign } from './marketing';
import type { CHANNELS } from './marketing';
import { executeTransaction, formatRs, previewTransaction } from './finance';
import { ACCOUNTS, cashBalance, nextId, postEntry, reverseEntry } from './ledger';
import { advanceMonth } from './simulation';
import { getCompany, tickLabel } from './world';
import { COUNTRIES, MATERIALS, SEGMENTS, SUPPLIERS } from './catalog';
import { mul } from './money';

export interface Action {
  type: string;
  companyId?: string;
  payload: Record<string, any>;
}

export const READ_ONLY_LIFECYCLES = ['insolvent', 'closed'];

function activeCompany(world: WorldState, companyId?: string): Company {
  if (!companyId) throw new DomainError('companyId is required for this action', 'VALIDATION');
  const c = getCompany(world, companyId);
  if (READ_ONLY_LIFECYCLES.includes(c.lifecycle)) throw new DomainError(`${c.name} is ${c.lifecycle}; no further operating decisions can be made`, 'COMPANY_INACTIVE');
  return c;
}

function int(v: unknown, label: string): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) throw new DomainError(`${label} must be a whole number`, 'VALIDATION');
  return n;
}

export const ACTION_TYPES = [
  'create_company',
  'update_company',
  'close_company',
  'set_price',
  'set_export_markets',
  'set_product_status',
  'set_production_plan',
  'set_overtime',
  'schedule_maintenance',
  'place_po',
  'cancel_po',
  'expedite_po',
  'qualify_supplier',
  'set_reorder_point',
  'hire',
  'cancel_requisition',
  'layoff',
  'set_salary',
  'start_training',
  'create_rnd_project',
  'decide_gate',
  'set_rnd_budget',
  'create_campaign',
  'cancel_campaign',
  'set_budget',
  'propose_transaction',
  'decide_transaction',
  'apply_mitigation',
  'comply_policy',
  'dismiss_alert',
  'restore_alert',
  'post_adjustment',
  'reverse_entry',
  'advance_month',
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

/** actions that only read or preview and never change state are not in this list */
export function applyAction(world: WorldState, action: Action, ctx: { actionId: string }): ActionResult {
  const p = action.payload ?? {};
  const effects: string[] = [];
  let data: unknown;
  switch (action.type as ActionType) {
    case 'create_company': {
      const input: CreateCompanyInput = {
        name: String(p.name ?? ''),
        brand: String(p.brand ?? ''),
        industry: p.industry as IndustryId,
        city: String(p.city ?? ''),
        legalForm: String(p.legalForm ?? 'Private Limited'),
        strategy: p.strategy as Strategy,
        businessModel: String(p.businessModel ?? ''),
        founderName: String(p.founderName ?? ''),
        founderCapital: int(p.founderCapital, 'Founder capital'),
        openingLoan: int(p.openingLoan ?? 0, 'Opening loan'),
        factoryMode: p.factoryMode === 'lease' ? 'lease' : 'build',
        warehouseMode: p.warehouseMode === 'build' ? 'build' : 'lease',
        rndLab: !!p.rndLab,
        products: Array.isArray(p.products) ? p.products.map(String) : [],
        isDemo: !!p.isDemo,
      };
      const est = estimateSetup(world, input);
      const c = createCompany(world, input, ctx.actionId);
      data = { companyId: c.id };
      effects.push(`${c.name} registered with ${formatRs(cashBalance(c))} cash after setup (capex ${formatRs(est.capex)}, fees ${formatRs(est.fees)})`);
      break;
    }
    case 'update_company': {
      const c = activeCompany(world, action.companyId);
      updateCompany(c, p);
      effects.push('Company profile updated');
      break;
    }
    case 'close_company': {
      const c = activeCompany(world, action.companyId);
      if (p.confirmName !== c.name) throw new DomainError('Type the company name exactly to confirm closure', 'CONFIRMATION_REQUIRED');
      c.lifecycle = 'closed';
      for (const l of c.lines) l.plannedUnits = 0;
      c.milestones.push({ tick: world.tick, text: 'Company voluntarily closed by the owner' });
      effects.push(`${c.name} closed. Records are preserved read-only.`);
      break;
    }
    case 'set_price': {
      const c = activeCompany(world, action.companyId);
      const prod = c.products.find((x) => x.id === p.productId);
      if (!prod) throw new DomainError('Product not found', 'NOT_FOUND');
      const price = int(p.price, 'Price');
      const ref = SEGMENTS[prod.segmentId].referencePrice;
      if (price < mul(ref, 0.3) || price > mul(ref, 3)) throw new DomainError(`Price must be between ${formatRs(mul(ref, 0.3))} and ${formatRs(mul(ref, 3))} (30–300% of the segment reference price)`, 'VALIDATION');
      const old = prod.price;
      prod.price = price;
      effects.push(`${prod.name} price ${formatRs(old)} → ${formatRs(price)} from next month`);
      break;
    }
    case 'set_export_markets': {
      const c = activeCompany(world, action.companyId);
      const prod = c.products.find((x) => x.id === p.productId);
      if (!prod) throw new DomainError('Product not found', 'NOT_FOUND');
      const markets = (Array.isArray(p.markets) ? p.markets : []) as CountryCode[];
      const allowed = Object.keys(SEGMENTS[prod.segmentId].exportDemand);
      for (const m of markets) if (!allowed.includes(m)) throw new DomainError(`${COUNTRIES[m]?.name ?? m} is not an export market for this segment`, 'VALIDATION');
      prod.exportMarkets = [...new Set(markets)];
      effects.push(`${prod.name} export markets: ${prod.exportMarkets.length ? prod.exportMarkets.map((m) => COUNTRIES[m].name).join(', ') : 'none'}`);
      break;
    }
    case 'set_product_status': {
      const c = activeCompany(world, action.companyId);
      const prod = c.products.find((x) => x.id === p.productId);
      if (!prod) throw new DomainError('Product not found', 'NOT_FOUND');
      if (p.status !== 'active' && p.status !== 'discontinued') throw new DomainError('Invalid status', 'VALIDATION');
      prod.status = p.status;
      if (p.status === 'discontinued') for (const l of c.lines) if (l.productId === prod.id) l.plannedUnits = 0;
      effects.push(`${prod.name} ${p.status}`);
      break;
    }
    case 'set_production_plan': {
      const c = activeCompany(world, action.companyId);
      const units = int(p.plannedUnits, 'Planned units');
      const line = c.lines.find((l) => l.id === p.lineId);
      if (!line) throw new DomainError('Production line not found', 'NOT_FOUND');
      const productId = p.productId === undefined ? line.productId : p.productId;
      const f = validatePlan(world, c, line.id, units, productId);
      line.productId = productId;
      line.plannedUnits = units;
      line.status = line.status === 'maintenance' ? 'maintenance' : productId ? 'running' : 'idle';
      data = f;
      effects.push(`${line.name}: plan ${units.toLocaleString('en-IN')} units/month (max feasible ${f.maxFeasible.toLocaleString('en-IN')})`);
      break;
    }
    case 'set_overtime': {
      const c = activeCompany(world, action.companyId);
      c.overtime = !!p.enabled;
      effects.push(c.overtime ? 'Extra shift on: +25% production labor hours at 1.5× pay; morale pressure' : 'Extra shift off');
      break;
    }
    case 'schedule_maintenance': {
      const c = activeCompany(world, action.companyId);
      const line = c.lines.find((l) => l.id === p.lineId);
      if (!line) throw new DomainError('Production line not found', 'NOT_FOUND');
      if (line.status === 'maintenance') throw new DomainError('Maintenance already scheduled', 'INVALID_STATE');
      const fac = c.facilities.find((f) => f.id === line.facilityId);
      const cost = 25000000 * (fac?.level ?? 1); // ₹2.5 L per level
      if (cost > cashBalance(c)) throw new DomainError(`Maintenance costs ${formatRs(cost)}, more than available cash`, 'INSUFFICIENT_CASH');
      postEntry(c, world.counters, { tick: world.tick, memo: `Planned maintenance: ${line.name}`, source: { type: 'maintenance', id: line.id }, cashFlow: 'operating', cashFlowLine: 'Facility costs paid', lines: [{ account: '6300', debit: cost, credit: 0 }, { account: '1000', debit: 0, credit: cost }], idempotencyKey: `maintenance:${line.id}:${world.tick}`, actionId: ctx.actionId });
      line.status = 'maintenance';
      line.maintenanceUntil = world.tick;
      effects.push(`${line.name} offline for maintenance in ${tickLabel(world, world.tick)}; condition restored to 100% afterwards`);
      break;
    }
    case 'place_po': {
      const c = activeCompany(world, action.companyId);
      const po = placePurchaseOrder(world, c, String(p.supplierId), String(p.materialId), int(p.qty, 'Quantity'), !!p.expedited);
      data = po;
      effects.push(`${po.id}: ${po.qty.toLocaleString('en-IN')} ${MATERIALS[po.materialId].unit} ${MATERIALS[po.materialId].name} from ${SUPPLIERS[po.supplierId].name}, ${formatRs(po.totalCost)} landed, due ${tickLabel(world, po.expectedTick)}`);
      break;
    }
    case 'cancel_po': {
      const c = activeCompany(world, action.companyId);
      const r = cancelPurchaseOrder(world, c, String(p.poId));
      effects.push(`${p.poId} cancelled${r.fee ? ` (fee ${formatRs(r.fee)})` : ''}`);
      break;
    }
    case 'expedite_po': {
      const c = activeCompany(world, action.companyId);
      const r = expeditePurchaseOrder(world, c, String(p.poId));
      effects.push(`${p.poId} switched to air freight (${formatRs(r.fee)}); arrives in ${tickLabel(world, world.tick)}`);
      break;
    }
    case 'qualify_supplier': {
      const c = activeCompany(world, action.companyId);
      qualifySupplier(world, c, String(p.supplierId));
      effects.push(`${SUPPLIERS[String(p.supplierId)].name} qualification started (₹1.5 L); orders possible from ${tickLabel(world, world.tick + 1)}`);
      break;
    }
    case 'set_reorder_point': {
      const c = activeCompany(world, action.companyId);
      if (!MATERIALS[String(p.materialId)]) throw new DomainError('Unknown material', 'NOT_FOUND');
      const qty = int(p.qty, 'Reorder point');
      if (qty < 0) throw new DomainError('Reorder point cannot be negative', 'VALIDATION');
      c.reorderPoints[String(p.materialId)] = qty;
      effects.push(`Reorder point for ${MATERIALS[String(p.materialId)].name} set to ${qty.toLocaleString('en-IN')}`);
      break;
    }
    case 'hire': {
      const c = activeCompany(world, action.companyId);
      const r = openRequisition(world, c, String(p.teamId), int(p.count, 'Count'));
      effects.push(`Requisition ${r.id} opened for ${r.count}; expected to fill ${tickLabel(world, r.fillTick)} (fees ${formatRs(r.costPerHire * r.count)} on joining)`);
      break;
    }
    case 'cancel_requisition': {
      const c = activeCompany(world, action.companyId);
      cancelRequisition(c, String(p.requisitionId));
      effects.push('Requisition cancelled');
      break;
    }
    case 'layoff': {
      const c = activeCompany(world, action.companyId);
      const r = layoff(world, c, String(p.teamId), int(p.count, 'Count'));
      effects.push(`${p.count} staff released; severance ${formatRs(r.severance)}; morale fell`);
      break;
    }
    case 'set_salary': {
      const c = activeCompany(world, action.companyId);
      setSalary(world, c, String(p.teamId), int(p.salary, 'Salary'));
      effects.push(`Salary updated to ${formatRs(int(p.salary, 'Salary'))}/month from next payroll`);
      break;
    }
    case 'start_training': {
      const c = activeCompany(world, action.companyId);
      const tr = startTraining(world, c, String(p.teamId), p.kind as keyof typeof TRAININGS);
      effects.push(`${tr.name} started (${formatRs(tr.cost)}); +${tr.skillGain} skill on completion ${tickLabel(world, tr.endTick)}`);
      break;
    }
    case 'create_rnd_project': {
      const c = activeCompany(world, action.companyId);
      const proj = createProject(world, c, { name: String(p.name ?? ''), kind: p.kind as RndProject['kind'], targetTemplateId: p.targetTemplateId, targetProductId: p.targetProductId, targetLineId: p.targetLineId, monthlyBudget: int(p.monthlyBudget, 'Monthly budget') });
      const committed = c.rndProjects.filter((x) => x.status === 'active').reduce((a, x) => a + x.monthlyBudget, 0);
      if (c.budget.rnd > 0 && committed > c.budget.rnd) effects.push(`Warning: active R&D spend ${formatRs(committed)}/month exceeds the R&D budget of ${formatRs(c.budget.rnd)}`);
      data = { projectId: proj.id };
      effects.push(`${proj.name} started in discovery at ${formatRs(proj.monthlyBudget)}/month`);
      break;
    }
    case 'decide_gate': {
      const c = activeCompany(world, action.companyId);
      effects.push(decideGate(world, c, String(p.projectId), p.decision === 'kill' ? 'kill' : 'go'));
      break;
    }
    case 'set_rnd_budget': {
      const c = activeCompany(world, action.companyId);
      setProjectBudget(c, String(p.projectId), int(p.monthlyBudget, 'Monthly budget'), p.resume === undefined ? undefined : !!p.resume);
      effects.push('R&D project updated');
      break;
    }
    case 'create_campaign': {
      const c = activeCompany(world, action.companyId);
      const r = createCampaign(world, c, { name: String(p.name ?? ''), channel: p.channel as keyof typeof CHANNELS, productId: p.productId ?? null, monthlyBudget: int(p.monthlyBudget, 'Monthly budget'), months: int(p.months, 'Months') });
      effects.push(`${r.campaign.name} scheduled ${tickLabel(world, r.campaign.startTick)}–${tickLabel(world, r.campaign.endTick)} at ${formatRs(r.campaign.monthlyBudget)}/month`);
      effects.push(...r.warnings.map((w) => `Warning: ${w}`));
      data = { campaignId: r.campaign.id };
      break;
    }
    case 'cancel_campaign': {
      const c = activeCompany(world, action.companyId);
      cancelCampaign(c, String(p.campaignId));
      effects.push('Campaign cancelled; no further spend');
      break;
    }
    case 'set_budget': {
      const c = activeCompany(world, action.companyId);
      for (const k of ['marketing', 'rnd', 'hiring', 'capex'] as const) {
        if (p[k] === undefined) continue;
        const v = int(p[k], `${k} budget`);
        if (v < 0) throw new DomainError('Budgets cannot be negative', 'VALIDATION');
        c.budget[k] = v;
      }
      effects.push('Monthly budgets updated');
      break;
    }
    case 'propose_transaction': {
      const c = activeCompany(world, action.companyId);
      const kind = p.kind as TransactionKind;
      const terms = (p.terms ?? {}) as Record<string, string | number>;
      const prev = previewTransaction(world, c, kind, terms);
      const tx = { id: nextId(world.counters, 'TX'), kind, status: 'pending_review' as const, createdTick: world.tick, counterparty: prev.counterparty, terms: prev.terms, preview: prev.preview, warnings: prev.warnings, journalIds: [] as string[] };
      c.transactions.push(tx);
      data = tx;
      effects.push(`${tx.id} submitted for review: ${kind.replace('_', ' ')} with ${tx.counterparty}`);
      break;
    }
    case 'decide_transaction': {
      const c = activeCompany(world, action.companyId);
      const tx = c.transactions.find((t) => t.id === p.transactionId);
      if (!tx) throw new DomainError('Transaction not found', 'NOT_FOUND');
      if (tx.status !== 'pending_review') throw new DomainError(`Transaction is already ${tx.status}`, 'INVALID_STATE');
      if (p.decision === 'reject') {
        tx.status = 'rejected';
        tx.decidedTick = world.tick;
        effects.push(`${tx.id} rejected`);
      } else {
        try {
          effects.push(...executeTransaction(world, c, tx, ctx.actionId));
        } catch (e) {
          if (e instanceof DomainError) {
            // keep an auditable record of the failed approval
            tx.status = 'failed';
            tx.failureReason = e.message;
            tx.decidedTick = world.tick;
            effects.push(`${tx.id} failed validation at approval: ${e.message}`);
          } else throw e;
        }
      }
      data = tx;
      break;
    }
    case 'apply_mitigation': {
      const c = activeCompany(world, action.companyId);
      const ev = world.events.find((e) => e.id === p.eventId && e.status === 'active');
      if (!ev) throw new DomainError('Event is not active', 'NOT_FOUND');
      if (p.kind !== 'rent_generator') throw new DomainError('Unsupported mitigation', 'VALIDATION');
      if (!ev.effects.energyCapacityMult?.[c.jurisdiction]) throw new DomainError('This event does not affect your power supply', 'VALIDATION');
      if (c.mitigations.some((m) => m.eventId === ev.id && m.kind === 'rent_generator')) throw new DomainError('Generators are already rented for this event', 'INVALID_STATE');
      const months = Math.max(1, ev.endTick - world.tick + 1);
      const cost = 60000000 * months;
      if (cost > cashBalance(c)) throw new DomainError(`Generator rental costs ${formatRs(cost)}, more than available cash`, 'INSUFFICIENT_CASH');
      postEntry(c, world.counters, { tick: world.tick, memo: `Diesel generator rental for ${months} month(s) — ${ev.title}`, source: { type: 'mitigation', id: ev.id }, cashFlow: 'operating', cashFlowLine: 'Mitigation costs paid', lines: [{ account: '6800', debit: cost, credit: 0 }, { account: '1000', debit: 0, credit: cost }], idempotencyKey: `mitigation:${c.id}:${ev.id}:generator`, actionId: ctx.actionId });
      c.mitigations.push({ id: nextId(world.counters, 'MT'), eventId: ev.id, kind: 'rent_generator', label: 'Diesel generators', appliedTick: world.tick, untilTick: ev.endTick, cost });
      effects.push(`Generators rented until ${tickLabel(world, ev.endTick)}; full power restored (${formatRs(cost)})`);
      break;
    }
    case 'comply_policy': {
      const c = activeCompany(world, action.companyId);
      const pol = world.policies.find((x) => x.id === p.policyId);
      if (!pol) throw new DomainError('Policy not found', 'NOT_FOUND');
      const comp = c.compliance.find((x) => x.policyId === pol.id) ?? (pol.industries === 'all' || pol.industries.includes(c.industry) ? (c.compliance.push({ policyId: pol.id, status: 'pending', penaltiesPaid: 0 }), c.compliance[c.compliance.length - 1]) : undefined);
      if (!comp) throw new DomainError('This policy does not apply to your industry', 'VALIDATION');
      if (comp.status === 'compliant') throw new DomainError('Already compliant', 'INVALID_STATE');
      if (pol.complianceCost > cashBalance(c)) throw new DomainError(`Compliance costs ${formatRs(pol.complianceCost)}, more than available cash`, 'INSUFFICIENT_CASH');
      if (pol.complianceCost > 0) postEntry(c, world.counters, { tick: world.tick, memo: `Compliance: ${pol.title}`, source: { type: 'policy', id: pol.id }, cashFlow: 'operating', cashFlowLine: 'Levies & penalties paid', lines: [{ account: '6900', debit: pol.complianceCost, credit: 0 }, { account: '1000', debit: 0, credit: pol.complianceCost }], idempotencyKey: `comply:${c.id}:${pol.id}`, actionId: ctx.actionId });
      comp.status = 'compliant';
      comp.compliedTick = world.tick;
      effects.push(`Compliant with ${pol.title} (${formatRs(pol.complianceCost)})`);
      break;
    }
    case 'dismiss_alert':
    case 'restore_alert': {
      const c = getCompany(world, action.companyId ?? '');
      const id = String(p.alertId ?? '');
      if (!id) throw new DomainError('alertId required', 'VALIDATION');
      c.dismissedAlerts = c.dismissedAlerts.filter((x) => x !== id);
      if (action.type === 'dismiss_alert') c.dismissedAlerts.push(id);
      effects.push(action.type === 'dismiss_alert' ? 'Alert dismissed (the underlying risk is still tracked in its module)' : 'Alert restored');
      break;
    }
    case 'post_adjustment': {
      const c = activeCompany(world, action.companyId);
      const lines = (Array.isArray(p.lines) ? p.lines : []).map((l: any) => ({ account: String(l.account), debit: int(l.debit ?? 0, 'Debit'), credit: int(l.credit ?? 0, 'Credit') }));
      for (const l of lines) {
        const t = ACCOUNTS[l.account]?.type;
        if (t !== 'expense' && t !== 'revenue') throw new DomainError(`Adjustments may only reclassify between revenue and expense accounts (${l.account} is not allowed). Cash, inventory, receivables and payables are controlled by their sub-ledgers.`, 'FORBIDDEN_ACCOUNT');
      }
      const memo = String(p.memo ?? '').trim();
      if (memo.length < 5) throw new DomainError('Explain the adjustment (at least 5 characters)', 'VALIDATION');
      const e = postEntry(c, world.counters, { tick: world.tick, memo: `Adjustment: ${memo}`, source: { type: 'adjustment', id: ctx.actionId }, cashFlow: 'none', lines, idempotencyKey: `adjustment:${ctx.actionId}`, actionId: ctx.actionId });
      data = { entryId: e.id };
      effects.push(`${e.id} posted`);
      break;
    }
    case 'reverse_entry': {
      const c = activeCompany(world, action.companyId);
      const entry = c.journal.find((e) => e.id === p.entryId);
      if (!entry) throw new DomainError('Journal entry not found', 'NOT_FOUND');
      if (entry.source.type !== 'adjustment') throw new DomainError('Only manual adjustments can be reversed. Operational entries are corrected through their originating module.', 'FORBIDDEN');
      const reason = String(p.reason ?? '').trim();
      if (reason.length < 5) throw new DomainError('Give a reason for the reversal', 'VALIDATION');
      const rev = reverseEntry(c, world.counters, entry.id, world.tick, reason);
      rev.actionId = ctx.actionId;
      effects.push(`${entry.id} reversed by ${rev.id}; original preserved`);
      break;
    }
    case 'advance_month': {
      const expected = int(p.expectedTick, 'expectedTick');
      if (expected !== world.tick) throw new DomainError(`The world is at ${tickLabel(world, world.tick)}, not ${tickLabel(world, expected)}. This advance was already processed or is stale.`, 'STALE_TICK');
      if (!world.companies.some((c) => c.lifecycle === 'operating' || c.lifecycle === 'distressed')) throw new DomainError('Create a company before advancing time', 'NO_COMPANY');
      const report = advanceMonth(world);
      data = report;
      effects.push(`Advanced from ${report.label} to ${tickLabel(world, world.tick)}`);
      break;
    }
    default:
      throw new DomainError(`Unknown action type: ${action.type}`, 'UNKNOWN_ACTION');
  }
  return { ok: true, data, effects };
}
