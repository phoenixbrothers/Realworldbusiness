import type { Money } from './types';

/**
 * Decimal-safe money helpers. Amounts are integer minor units (paise).
 * Multiplication by a rate always rounds half away from zero to an integer,
 * and allocation helpers guarantee the parts sum exactly to the whole.
 */

export function assertMoney(n: number, label = 'amount'): Money {
  if (!Number.isSafeInteger(n)) throw new Error(`${label} must be an integer number of paise, got ${n}`);
  return n;
}

export function rupees(r: number): Money {
  return Math.round(r * 100);
}

export function mul(amount: Money, factor: number): Money {
  const v = amount * factor;
  return v < 0 ? -Math.round(-v) : Math.round(v);
}

/** amount * numerator / denominator with a single rounding step */
export function prorate(amount: Money, numerator: number, denominator: number): Money {
  if (denominator === 0) return 0;
  if (numerator === denominator) return amount;
  return mul(amount, numerator / denominator);
}

/** split an amount by weights; the parts always sum to `amount` exactly */
export function allocate(amount: Money, weights: number[]): Money[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || weights.length === 0) return weights.map(() => 0);
  const parts = weights.map((w) => Math.floor((amount * w) / total));
  let remainder = amount - parts.reduce((a, b) => a + b, 0);
  // hand remaining paise to the largest weights first (deterministic)
  const order = weights.map((w, i) => [w, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  let k = 0;
  while (remainder > 0) {
    parts[order[k % order.length][1]] += 1;
    remainder -= 1;
    k += 1;
  }
  return parts;
}

export function sum(values: Money[]): Money {
  return values.reduce((a, b) => a + b, 0);
}

/** monthly interest for an annual rate in basis points */
export function monthlyInterest(principal: Money, annualRateBps: number): Money {
  return mul(principal, annualRateBps / 10000 / 12);
}

/** level payment for an amortizing loan */
export function annuityPayment(principal: Money, annualRateBps: number, months: number): Money {
  const r = annualRateBps / 10000 / 12;
  if (months <= 0) return principal;
  if (r === 0) return Math.ceil(principal / months);
  return Math.round((principal * r) / (1 - Math.pow(1 + r, -months)));
}

export function formatINR(paise: Money, opts: { compact?: boolean } = {}): string {
  const r = paise / 100;
  const sign = r < 0 ? '-' : '';
  const a = Math.abs(r);
  if (opts.compact) {
    if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
    if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
    if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)} K`;
    return `${sign}₹${a.toFixed(0)}`;
  }
  return `${sign}₹${a.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
