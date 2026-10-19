/**
 * Research & development with stage gates:
 *   discovery -> feasibility -> prototype -> testing -> production_validation -> launched
 * Progress needs researcher capacity and budget over time. When a stage
 * reaches 100% a technical gate review runs (seeded) during the month; a
 * failed review sends the project back to 60%. A passed review waits for the
 * user's go/kill decision. Benefits apply only at launch.
 */
import type { Company, RndProject, WorldState } from './types';
import { DomainError, RND_STAGES } from './types';
import { PRODUCT_TEMPLATES } from './catalog';
import { cashBalance, nextId, postEntry } from './ledger';
import { mul, rupees } from './money';
import type { Rng } from './rng';
import { formatRs } from './finance';
import { notify } from './world';

export const RND_KINDS = {
  new_product: { label: 'New product', pointsPerStage: 16, risk: 0.25, minBudget: rupees(800000) },
  quality_upgrade: { label: 'Quality upgrade', pointsPerStage: 10, risk: 0.2, minBudget: rupees(500000) },
  process_automation: { label: 'Process automation', pointsPerStage: 10, risk: 0.2, minBudget: rupees(600000) },
  cost_reduction: { label: 'Cost reduction', pointsPerStage: 8, risk: 0.15, minBudget: rupees(400000) },
} as const;

const GATE_EVIDENCE: Record<string, [string, string]> = {
  discovery: ['Customer interviews confirm the need', 'Market sizing did not support the concept'],
  feasibility: ['Design review passed; BOM within target', 'Design could not meet cost target'],
  prototype: ['Working prototypes built and bench-tested', 'Prototype failed thermal / durability tests'],
  testing: ['Certification and field tests passed', 'Field tests found reliability defects'],
  production_validation: ['Pilot run met yield and takt-time targets', 'Pilot yield below target'],
};

export function rndCapacityPoints(company: Company): number {
  const team = company.teams.filter((t) => t.department === 'rnd');
  const lab = company.facilities.filter((f) => f.type === 'rnd_lab' && f.status !== 'under_construction');
  const labFactor = lab.length ? Math.max(...lab.map((l) => 1 + 0.25 * (l.level - 1))) : 0.6;
  const people = team.reduce((a, t) => a + (t.headcount - t.ramping.reduce((x, r) => x + r.count, 0) * 0.5) * (0.6 + t.skill / 250) * (0.75 + t.morale / 400), 0);
  return Math.max(0, people * labFactor);
}

export function createProject(world: WorldState, company: Company, input: { name: string; kind: RndProject['kind']; targetTemplateId?: string; targetProductId?: string; targetLineId?: string; monthlyBudget: number }): RndProject {
  const spec = RND_KINDS[input.kind];
  if (!spec) throw new DomainError('Unknown project type', 'VALIDATION');
  const name = input.name.trim();
  if (name.length < 3 || name.length > 60) throw new DomainError('Project name must be 3–60 characters', 'VALIDATION');
  if (!Number.isSafeInteger(input.monthlyBudget) || input.monthlyBudget < spec.minBudget) throw new DomainError(`Monthly budget must be at least ${formatRs(spec.minBudget)} for this project type`, 'VALIDATION');
  if (input.kind === 'new_product') {
    const t = input.targetTemplateId ? PRODUCT_TEMPLATES[input.targetTemplateId] : undefined;
    if (!t || t.industry !== company.industry || t.unlockedByDefault) throw new DomainError('Choose a product concept from your industry that is not yet available', 'VALIDATION');
    if (company.products.some((p) => p.templateId === t.id)) throw new DomainError('That product has already been launched', 'VALIDATION');
    if (company.rndProjects.some((p) => p.targetTemplateId === t.id && p.status !== 'cancelled' && p.status !== 'launched')) throw new DomainError('A project for this concept is already running', 'VALIDATION');
  }
  if (input.kind === 'quality_upgrade' || input.kind === 'cost_reduction') {
    if (!company.products.some((p) => p.id === input.targetProductId)) throw new DomainError('Choose a product to improve', 'VALIDATION');
  }
  if (input.kind === 'process_automation') {
    const line = company.lines.find((l) => l.id === input.targetLineId);
    if (!line) throw new DomainError('Choose a production line to automate', 'VALIDATION');
    if (line.automation >= 0.75) throw new DomainError('Line is already at maximum automation', 'VALIDATION');
  }
  const project: RndProject = {
    id: nextId(world.counters, 'RD'),
    name,
    kind: input.kind,
    targetTemplateId: input.targetTemplateId,
    targetProductId: input.targetProductId,
    targetLineId: input.targetLineId,
    stage: 'discovery',
    progress: 0,
    awaitingGate: false,
    monthlyBudget: input.monthlyBudget,
    spent: 0,
    plannedBudget: input.monthlyBudget * Math.ceil((spec.pointsPerStage * 5) / Math.max(1, rndCapacityPoints(company)) + 1),
    technicalRisk: spec.risk,
    startedTick: world.tick,
    gates: [],
    status: 'active',
  };
  company.rndProjects.push(project);
  return project;
}

export function decideGate(world: WorldState, company: Company, projectId: string, decision: 'go' | 'kill'): string {
  const p = company.rndProjects.find((x) => x.id === projectId);
  if (!p) throw new DomainError('Project not found', 'NOT_FOUND');
  if (p.status === 'cancelled' || p.status === 'launched') throw new DomainError('Project is closed', 'INVALID_STATE');
  if (decision === 'kill') {
    p.status = 'cancelled';
    p.stage = 'cancelled';
    p.awaitingGate = false;
    return `${p.name} cancelled after ${formatRs(p.spent)} spent`;
  }
  if (!p.awaitingGate) throw new DomainError('No gate decision is pending: the stage has not passed its review yet', 'INVALID_STATE');
  const idx = RND_STAGES.indexOf(p.stage);
  const next = RND_STAGES[idx + 1];
  p.awaitingGate = false;
  p.progress = 0;
  if (next === 'launched') {
    launch(world, company, p);
    return `${p.name} launched`;
  }
  p.stage = next;
  return `${p.name} advanced to ${next.replace('_', ' ')}`;
}

function launch(world: WorldState, company: Company, p: RndProject): void {
  p.stage = 'launched';
  p.status = 'launched';
  let text = '';
  if (p.kind === 'new_product' && p.targetTemplateId) {
    const t = PRODUCT_TEMPLATES[p.targetTemplateId];
    company.products.push({ id: nextId(world.counters, 'PD'), templateId: t.id, name: `${company.brand} ${t.name}`, segmentId: t.segmentId, price: t.referencePrice, quality: t.baseQuality, bom: t.bom.map((b) => ({ ...b })), laborHours: t.laborHours, machineHours: t.machineHours, energyKwh: t.energyKwh, status: 'active', launchedTick: world.tick, exportMarkets: [], targetCoverMonths: 1, lastFillRate: 1 });
    text = `${t.name} is available to assign to a production line`;
  } else if (p.kind === 'quality_upgrade') {
    const prod = company.products.find((x) => x.id === p.targetProductId);
    if (prod) {
      prod.quality = Math.min(95, prod.quality + 10);
      text = `${prod.name} quality raised to ${prod.quality}`;
    }
  } else if (p.kind === 'process_automation') {
    const line = company.lines.find((l) => l.id === p.targetLineId);
    if (line) {
      line.automation = Math.min(0.75, +(line.automation + 0.25).toFixed(2));
      line.capacity = Math.round(line.capacity * 1.15);
      text = `${line.name} automation ${Math.round(line.automation * 100)}%, capacity +15%`;
    }
  } else if (p.kind === 'cost_reduction') {
    const prod = company.products.find((x) => x.id === p.targetProductId);
    if (prod) {
      // reduce the most expensive input by 10%
      const top = [...prod.bom].sort((a, b) => b.qty * (company.rawInventory[b.materialId]?.value ?? 1) - a.qty * (company.rawInventory[a.materialId]?.value ?? 1))[0];
      if (top) top.qty = +(top.qty * 0.9).toFixed(4);
      prod.machineHours = +(prod.machineHours * 0.9).toFixed(4);
      text = `${prod.name}: ${top?.materialId ?? 'input'} usage −10%, machine time −10%`;
    }
  }
  if (p.kind !== 'cost_reduction') {
    company.patents.push({ id: nextId(world.counters, 'PAT'), title: p.name, grantedTick: world.tick, projectId: p.id, expiresTick: world.tick + 240 });
  }
  company.milestones.push({ tick: world.tick, text: `R&D launch: ${p.name} — ${text}` });
  notify(world, { companyId: company.id, severity: 'low', title: `${p.name} launched`, body: `${text}. Technical success does not guarantee commercial success — watch sales.`, kind: 'rnd', link: { module: 'rnd', id: p.id } });
}

export function stepRnd(world: WorldState, company: Company, rng: Rng): void {
  const active = company.rndProjects.filter((p) => p.status === 'active');
  if (!active.length) return;
  const capacity = rndCapacityPoints(company);
  const working = active.filter((p) => !p.awaitingGate);
  const share = working.length ? capacity / working.length : 0;
  for (const p of active) {
    if (p.awaitingGate) continue;
    // spend: discretionary, never uses the overdraft
    if (p.monthlyBudget > cashBalance(company)) {
      p.status = 'paused';
      notify(world, { companyId: company.id, severity: 'medium', title: `${p.name} paused`, body: 'Insufficient cash for this month’s R&D budget. Resume when funds allow.', kind: 'rnd', link: { module: 'rnd', id: p.id } });
      continue;
    }
    postEntry(company, world.counters, {
      tick: world.tick,
      memo: `R&D spend: ${p.name} (${p.stage.replace('_', ' ')})`,
      source: { type: 'rnd', id: p.id },
      cashFlow: 'operating',
      cashFlowLine: 'R&D paid',
      lines: [
        { account: '6200', debit: p.monthlyBudget, credit: 0 },
        { account: '1000', debit: 0, credit: p.monthlyBudget },
      ],
      idempotencyKey: `rnd:${p.id}:${world.tick}`,
    });
    p.spent += p.monthlyBudget;
    const spec = RND_KINDS[p.kind];
    const budgetFactor = Math.min(1.25, p.monthlyBudget / spec.minBudget) ** 0.5;
    const gain = (share * budgetFactor * 100) / spec.pointsPerStage;
    p.progress = Math.min(100, +(p.progress + gain).toFixed(1));
    if (p.progress >= 100) {
      const failed = rng.chance(p.technicalRisk * (p.stage === 'testing' ? 1.4 : 1));
      const [ok, bad] = GATE_EVIDENCE[p.stage] ?? ['Stage review passed', 'Stage review failed'];
      p.gates.push({ stage: p.stage, tick: world.tick, result: failed ? 'failed' : 'passed', evidence: failed ? bad : ok });
      if (failed) {
        p.progress = 60;
        notify(world, { companyId: company.id, severity: 'medium', title: `${p.name}: ${p.stage.replace('_', ' ')} review failed`, body: `${bad}. Rework needed (progress reset to 60%).`, kind: 'rnd', link: { module: 'rnd', id: p.id } });
      } else {
        p.awaitingGate = true;
        notify(world, { companyId: company.id, severity: 'medium', title: `${p.name}: gate decision needed`, body: `${ok}. Approve to move past ${p.stage.replace('_', ' ')}, or stop the project.`, kind: 'rnd', link: { module: 'rnd', id: p.id } });
      }
    }
  }
}

export function setProjectBudget(company: Company, projectId: string, monthlyBudget: number, resume?: boolean): void {
  const p = company.rndProjects.find((x) => x.id === projectId);
  if (!p) throw new DomainError('Project not found', 'NOT_FOUND');
  if (p.status === 'cancelled' || p.status === 'launched') throw new DomainError('Project is closed', 'INVALID_STATE');
  const min = RND_KINDS[p.kind].minBudget;
  if (!Number.isSafeInteger(monthlyBudget) || monthlyBudget < min) throw new DomainError(`Budget must be at least ${formatRs(min)}`, 'VALIDATION');
  p.monthlyBudget = monthlyBudget;
  if (resume !== undefined) p.status = resume ? 'active' : 'paused';
  void mul;
}
