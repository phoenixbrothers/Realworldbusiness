/**
 * Brand and campaigns. Awareness decays 3% per month and grows with spend
 * through a saturating response (diminishing returns). Spend is expensed
 * monthly; campaigns pause when cash is short (never uses the overdraft).
 */
import type { Campaign, Company, WorldState } from './types';
import { DomainError } from './types';
import { cashBalance, nextId, postEntry } from './ledger';
import { rupees } from './money';
import { formatRs } from './finance';
import { notify } from './world';

export const CHANNELS = {
  digital: { label: 'Digital & social', efficiency: 1.0, minBudget: rupees(200000), note: 'Efficient at low budgets; fast decay.' },
  tv: { label: 'TV & OTT', efficiency: 1.35, minBudget: rupees(2500000), note: 'High reach; needs scale.' },
  retail_promo: { label: 'Retail promotion', efficiency: 0.7, minBudget: rupees(300000), note: 'Lower awareness, but lifts in-store conversion for the promoted product.' },
  trade_show: { label: 'Trade shows & export fairs', efficiency: 0.5, minBudget: rupees(500000), note: 'Small awareness gain; raises export demand.' },
} as const;

export const SPEND_SCALE = { electronics: rupees(4000000), ev: rupees(3000000), food: rupees(1500000) };

export function createCampaign(world: WorldState, company: Company, input: { name: string; channel: Campaign['channel']; productId: string | null; monthlyBudget: number; months: number }): { campaign: Campaign; warnings: string[] } {
  const ch = CHANNELS[input.channel];
  if (!ch) throw new DomainError('Unknown channel', 'VALIDATION');
  const name = input.name.trim();
  if (name.length < 3 || name.length > 60) throw new DomainError('Campaign name must be 3–60 characters', 'VALIDATION');
  if (!Number.isSafeInteger(input.monthlyBudget) || input.monthlyBudget < ch.minBudget) throw new DomainError(`${ch.label} needs at least ${formatRs(ch.minBudget)} per month`, 'VALIDATION');
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 12) throw new DomainError('Duration must be 1–12 months', 'VALIDATION');
  if (input.productId && !company.products.some((p) => p.id === input.productId && p.status === 'active')) throw new DomainError('Promoted product is not active', 'VALIDATION');
  const warnings: string[] = [];
  const committed = company.campaigns.filter((c) => c.status === 'active' || c.status === 'scheduled').reduce((a, c) => a + c.monthlyBudget, 0);
  if (company.budget.marketing > 0 && committed + input.monthlyBudget > company.budget.marketing) warnings.push(`Monthly campaign spend ${formatRs(committed + input.monthlyBudget)} exceeds the marketing budget of ${formatRs(company.budget.marketing)}.`);
  const campaign: Campaign = { id: nextId(world.counters, 'CP'), name, channel: input.channel, productId: input.productId, monthlyBudget: input.monthlyBudget, startTick: world.tick, endTick: world.tick + input.months - 1, spent: 0, status: 'scheduled', reach: 0 };
  company.campaigns.push(campaign);
  return { campaign, warnings };
}

export function cancelCampaign(company: Company, campaignId: string) {
  const c = company.campaigns.find((x) => x.id === campaignId);
  if (!c) throw new DomainError('Campaign not found', 'NOT_FOUND');
  if (c.status === 'completed' || c.status === 'cancelled') throw new DomainError('Campaign has already ended', 'INVALID_STATE');
  c.status = 'cancelled';
}

/** awareness points from a month of spend on a channel (saturating) */
export function awarenessGain(company: Company, channel: Campaign['channel'], spend: number): number {
  const k = SPEND_SCALE[company.industry];
  return 12 * CHANNELS[channel].efficiency * (1 - Math.exp(-spend / k));
}

export function stepMarketing(world: WorldState, company: Company): { spend: number; promoted: Set<string>; tradeShow: boolean } {
  let spend = 0;
  let gain = 0;
  const promoted = new Set<string>();
  let tradeShow = false;
  for (const c of company.campaigns) {
    if (c.status === 'cancelled' || c.status === 'completed') continue;
    if (c.startTick > world.tick) continue;
    if (c.endTick < world.tick) {
      c.status = 'completed';
      continue;
    }
    if (c.monthlyBudget > cashBalance(company)) {
      notify(world, { companyId: company.id, severity: 'medium', title: `${c.name} skipped this month`, body: 'Insufficient cash for campaign spend.', kind: 'market', link: { module: 'marketing', id: c.id } });
      continue;
    }
    postEntry(company, world.counters, {
      tick: world.tick,
      memo: `Campaign spend: ${c.name} (${CHANNELS[c.channel].label})`,
      source: { type: 'campaign', id: c.id },
      cashFlow: 'operating',
      cashFlowLine: 'Marketing paid',
      lines: [
        { account: '6100', debit: c.monthlyBudget, credit: 0 },
        { account: '1000', debit: 0, credit: c.monthlyBudget },
      ],
      idempotencyKey: `campaign:${c.id}:${world.tick}`,
    });
    c.status = 'active';
    c.spent += c.monthlyBudget;
    const g = awarenessGain(company, c.channel, c.monthlyBudget);
    c.reach = +(c.reach + g).toFixed(2);
    gain += g;
    spend += c.monthlyBudget;
    if (c.channel === 'retail_promo' && c.productId) promoted.add(c.productId);
    if (c.channel === 'trade_show') tradeShow = true;
    if (c.endTick === world.tick) {
      c.status = 'completed';
      notify(world, { companyId: company.id, severity: 'low', title: `${c.name} completed`, body: `Spent ${formatRs(c.spent)}; contributed ~${c.reach.toFixed(1)} awareness points before decay.`, kind: 'market', link: { module: 'marketing', id: c.id } });
    }
  }
  // decay, then saturating gain towards 100
  company.brandAwareness = +Math.max(0, Math.min(100, company.brandAwareness * 0.97 + gain * (1 - company.brandAwareness / 100))).toFixed(2);
  return { spend, promoted, tradeShow };
}
