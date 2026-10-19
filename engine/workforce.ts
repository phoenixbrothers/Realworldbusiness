/**
 * Workforce: teams (role cohorts) with headcount, salary, skill and morale.
 * Hiring takes time (requisition -> fill), new hires ramp at half
 * productivity for two months, attrition responds to pay vs market and
 * morale, and training raises skill. Payroll is posted by finance.ts.
 */
import type { Company, Team, WorldState } from './types';
import { DomainError } from './types';
import { BASE_SALARY_BY_DEPT } from './catalog';
import { cashBalance, nextId, postEntry } from './ledger';
import { mul, rupees } from './money';
import type { Rng } from './rng';
import { formatRs } from './finance';
import { notify, tickLabel } from './world';

export function marketSalary(world: WorldState, team: Team): number {
  return Math.round(rupees(BASE_SALARY_BY_DEPT[team.department] ?? 30000) * (world.economy.wageIndex / 100) * (team.department === 'rnd' ? 1.05 : 1));
}

export function minimumWage(world: WorldState): number {
  return Math.round(rupees(14000) * (world.economy.wageIndex / 100));
}

export function openRequisition(world: WorldState, company: Company, teamId: string, count: number) {
  const team = company.teams.find((t) => t.id === teamId);
  if (!team) throw new DomainError('Team not found', 'NOT_FOUND');
  if (!Number.isInteger(count) || count <= 0 || count > 500) throw new DomainError('Hire between 1 and 500 people at a time', 'BAD_QTY');
  const tight = world.economy.wageIndex > 110 ? 1 : 0;
  const months = (team.department === 'production' || team.department === 'operations' ? 1 : 2) + tight;
  const costPerHire = mul(team.salary, 0.5);
  const req = { id: nextId(world.counters, 'REQ'), teamId, count, openedTick: world.tick, fillTick: world.tick + months, costPerHire, status: 'open' as const };
  company.requisitions.push(req);
  return req;
}

export function cancelRequisition(company: Company, reqId: string) {
  const r = company.requisitions.find((x) => x.id === reqId);
  if (!r || r.status !== 'open') throw new DomainError('Open requisition not found', 'NOT_FOUND');
  r.status = 'cancelled';
}

export function layoff(world: WorldState, company: Company, teamId: string, count: number) {
  const team = company.teams.find((t) => t.id === teamId);
  if (!team) throw new DomainError('Team not found', 'NOT_FOUND');
  if (!Number.isInteger(count) || count <= 0) throw new DomainError('Count must be a positive whole number', 'BAD_QTY');
  if (count > team.headcount) throw new DomainError(`Team only has ${team.headcount} people`, 'BAD_QTY');
  const severance = team.salary * count; // one month per head
  if (severance > cashBalance(company)) throw new DomainError(`Severance of ${formatRs(severance)} exceeds available cash`, 'INSUFFICIENT_CASH');
  postEntry(company, world.counters, {
    tick: world.tick,
    memo: `Severance: ${count} × ${team.role}`,
    source: { type: 'workforce', id: team.id },
    cashFlow: 'operating',
    cashFlowLine: 'Salaries paid',
    lines: [
      { account: '6700', debit: severance, credit: 0 },
      { account: '1000', debit: 0, credit: severance },
    ],
    idempotencyKey: `layoff:${team.id}:${world.tick}:${world.counters.JE ?? 0}`,
  });
  team.headcount -= count;
  let toRemove = count;
  for (const r of team.ramping) {
    const k = Math.min(r.count, toRemove);
    r.count -= k;
    toRemove -= k;
  }
  team.ramping = team.ramping.filter((r) => r.count > 0);
  for (const t of company.teams) t.morale = Math.max(0, t.morale - (t.id === team.id ? 12 : 4));
  return { severance };
}

export function setSalary(world: WorldState, company: Company, teamId: string, salary: number) {
  const team = company.teams.find((t) => t.id === teamId);
  if (!team) throw new DomainError('Team not found', 'NOT_FOUND');
  if (!Number.isSafeInteger(salary) || salary <= 0) throw new DomainError('Salary must be a positive amount', 'VALIDATION');
  const min = minimumWage(world);
  if (salary < min) throw new DomainError(`Salary is below the statutory minimum wage of ${formatRs(min)} per month`, 'MIN_WAGE');
  const old = team.salary;
  team.salary = salary;
  if (salary < old) team.morale = Math.max(0, team.morale - 8);
}

export const TRAININGS = {
  basic: { name: 'Skills refresher', costPerHead: rupees(6000), gain: 4, months: 1 },
  advanced: { name: 'Advanced certification', costPerHead: rupees(18000), gain: 9, months: 2 },
} as const;

export function startTraining(world: WorldState, company: Company, teamId: string, kind: keyof typeof TRAININGS) {
  const team = company.teams.find((t) => t.id === teamId);
  if (!team) throw new DomainError('Team not found', 'NOT_FOUND');
  const spec = TRAININGS[kind];
  if (!spec) throw new DomainError('Unknown training program', 'VALIDATION');
  if (company.trainings.some((t) => t.teamId === teamId && t.status === 'active')) throw new DomainError('This team already has a training program running', 'INVALID_STATE');
  const cost = spec.costPerHead * team.headcount;
  if (cost <= 0) throw new DomainError('Team has no staff to train', 'VALIDATION');
  if (cost > cashBalance(company)) throw new DomainError(`Training costs ${formatRs(cost)}, more than available cash`, 'INSUFFICIENT_CASH');
  const tr = { id: nextId(world.counters, 'TR'), teamId, name: spec.name, cost, startTick: world.tick, endTick: world.tick + spec.months - 1, skillGain: spec.gain, status: 'active' as const };
  postEntry(company, world.counters, {
    tick: world.tick,
    memo: `${spec.name} for ${team.role} (${team.headcount} staff)`,
    source: { type: 'training', id: tr.id },
    cashFlow: 'operating',
    cashFlowLine: 'Salaries paid',
    lines: [
      { account: '6700', debit: cost, credit: 0 },
      { account: '1000', debit: 0, credit: cost },
    ],
    idempotencyKey: `training:${tr.id}`,
  });
  company.trainings.push(tr);
  return tr;
}

/** monthly workforce dynamics; runs before payroll */
export function stepWorkforce(world: WorldState, company: Company, rng: Rng): void {
  // fill requisitions
  for (const r of company.requisitions) {
    if (r.status !== 'open' || r.fillTick > world.tick) continue;
    const team = company.teams.find((t) => t.id === r.teamId);
    if (!team) continue;
    const fee = r.costPerHire * r.count;
    const canPay = cashBalance(company) >= fee;
    if (!canPay) {
      r.fillTick = world.tick + 1;
      notify(world, { companyId: company.id, severity: 'medium', title: `Hiring for ${team.role} postponed`, body: `Recruitment fees of ${formatRs(fee)} could not be paid; offers pushed to ${tickLabel(world, r.fillTick)}.`, kind: 'workforce', link: { module: 'workforce' } });
      continue;
    }
    postEntry(company, world.counters, {
      tick: world.tick,
      memo: `Recruitment fees: ${r.count} × ${team.role}`,
      source: { type: 'requisition', id: r.id },
      cashFlow: 'operating',
      cashFlowLine: 'Salaries paid',
      lines: [
        { account: '6700', debit: fee, credit: 0 },
        { account: '1000', debit: 0, credit: fee },
      ],
      idempotencyKey: `hire:${r.id}`,
    });
    team.headcount += r.count;
    team.ramping.push({ count: r.count, monthsRemaining: 2 });
    r.status = 'filled';
    notify(world, { companyId: company.id, severity: 'low', title: `${r.count} ${team.role} joined`, body: 'New hires work at half productivity for two months.', kind: 'workforce', link: { module: 'workforce' } });
  }
  for (const team of company.teams) {
    // ramp-up
    for (const r of team.ramping) r.monthsRemaining -= 1;
    team.ramping = team.ramping.filter((r) => r.monthsRemaining > 0);
    // training completion
    for (const tr of company.trainings) {
      if (tr.teamId === team.id && tr.status === 'active' && tr.endTick <= world.tick) {
        team.skill = Math.min(95, +(team.skill + tr.skillGain * (team.skill > 80 ? 0.5 : 1)).toFixed(1));
        team.morale = Math.min(100, team.morale + 4);
        tr.status = 'completed';
      }
    }
    // morale drifts toward a pay- and workload-driven target
    const market = marketSalary(world, team);
    const payGap = team.salary / market - 1;
    const target = 65 + Math.max(-30, Math.min(20, payGap * 120)) - (company.overtime && team.department === 'production' ? 8 : 0) - (company.lifecycle === 'distressed' ? 10 : 0);
    team.morale = +Math.max(0, Math.min(100, team.morale + 0.3 * (target - team.morale))).toFixed(1);
    // attrition
    if (team.headcount > 0) {
      const rate = 0.012 + Math.max(0, -payGap) * 0.25 + (Math.max(0, 60 - team.morale) / 100) * 0.06;
      const leavers = Math.min(team.headcount, Math.floor(team.headcount * rate + rng.next()));
      if (leavers > 0) {
        team.headcount -= leavers;
        // leavers are experienced staff: slight skill drain
        team.skill = +Math.max(20, team.skill - leavers / Math.max(10, team.headcount) * 2).toFixed(1);
      }
      team.lastLeavers = leavers;
    }
  }
}

export function headcount(company: Company): number {
  return company.teams.reduce((a, t) => a + t.headcount, 0);
}
