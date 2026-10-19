/** INR formatting with Indian digit grouping; amounts are integer paise. */
export function inr(paise: number | null | undefined, opts: { compact?: boolean; sign?: boolean } = {}): string {
  if (paise === null || paise === undefined || Number.isNaN(paise)) return '—';
  const r = paise / 100;
  const a = Math.abs(r);
  const sign = r < 0 ? '−' : opts.sign && r > 0 ? '+' : '';
  if (opts.compact) {
    if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
    if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
    if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)} K`;
  }
  return `${sign}₹${a.toLocaleString('en-IN', { maximumFractionDigits: a < 100 ? 2 : 0 })}`;
}
export const num = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: digits }));
export const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(digits)}%`);
export const toPaise = (rupees: string | number) => Math.round(Number(rupees) * 100);
export const toRupees = (paise: number) => +(paise / 100).toFixed(2);
export function deltaClass(v: number | null | undefined, invert = false) {
  if (v === null || v === undefined || v === 0) return 'faint';
  return (v > 0) !== invert ? 'pos' : 'neg';
}
export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
