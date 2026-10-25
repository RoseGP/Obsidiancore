/**
 * Decimal-safe money primitives.
 *
 * Rules
 * - User input arrives as decimal *strings* ("1250.5", "2.25"). We never run
 *   floating-point arithmetic on money.
 * - Amounts are converted to integer minor units (cents, pence, yen) as BigInt.
 * - Quantities are scaled to thousandths (3 dp), tax and discount percentages
 *   to thousandths of a percent (3 dp).
 * - Every rounding step uses ROUND_HALF_UP (away from zero at .5), applied
 *   once per documented step (see docs/invoicing/CALCULATIONS.md).
 */

export type CurrencyCode =
  | 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | 'JPY' | 'NGN' | 'INR' | 'CHF' | 'ZAR';

export interface CurrencyInfo {
  code: CurrencyCode;
  name: string;
  /** Number of minor-unit digits (USD 2, JPY 0). */
  decimals: number;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', name: 'US dollar', decimals: 2 },
  { code: 'EUR', name: 'Euro', decimals: 2 },
  { code: 'GBP', name: 'British pound', decimals: 2 },
  { code: 'CAD', name: 'Canadian dollar', decimals: 2 },
  { code: 'AUD', name: 'Australian dollar', decimals: 2 },
  { code: 'CHF', name: 'Swiss franc', decimals: 2 },
  { code: 'JPY', name: 'Japanese yen', decimals: 0 },
  { code: 'INR', name: 'Indian rupee', decimals: 2 },
  { code: 'NGN', name: 'Nigerian naira', decimals: 2 },
  { code: 'ZAR', name: 'South African rand', decimals: 2 },
];

export function currencyInfo(code: string): CurrencyInfo {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}

export const QTY_SCALE = 3; // thousandths
export const RATE_SCALE = 3; // thousandths of a percent

const DECIMAL_RE = /^\s*(-)?(\d*)(?:\.(\d*))?\s*$/;

/**
 * Parses a decimal string into a scaled BigInt.
 * Returns null when the string is not a plain decimal or has more fractional
 * digits than `scale` allows (we refuse to silently truncate user input).
 */
export function parseScaled(input: string | number | null | undefined, scale: number): bigint | null {
  if (input === null || input === undefined) return null;
  const str = typeof input === 'number' ? numberToPlainString(input) : input;
  const m = DECIMAL_RE.exec(str);
  if (!m) return null;
  const [, neg, intPart = '', fracPart = ''] = m;
  if (intPart === '' && fracPart === '') return null;
  if (fracPart.length > scale) return null;
  const digits = (intPart || '0') + fracPart.padEnd(scale, '0');
  const value = BigInt(digits);
  return neg ? -value : value;
}

/** Number of fractional digits written in a decimal string ("2.50" -> 2). */
export function fractionDigits(input: string): number {
  const m = DECIMAL_RE.exec(input);
  return m && m[3] ? m[3].length : 0;
}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) return 'NaN';
  // toFixed avoids exponent notation for typical values; trims trailing zeros.
  return n.toFixed(6).replace(/\.?0+$/, '');
}

/** Integer division of a by b, rounding half away from zero. */
export function divRoundHalfUp(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error('Division by zero');
  const negative = (a < 0n) !== (b < 0n);
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const q = (absA * 2n + absB) / (absB * 2n);
  return negative ? -q : q;
}

/** Converts a major-unit decimal string ("12.50") into minor units (1250n). */
export function toMinor(input: string | number | null | undefined, currency: string): bigint | null {
  return parseScaled(input, currencyInfo(currency).decimals);
}

/** Converts minor units to a canonical decimal string ("1250" -> "12.50"). */
export function minorToDecimalString(minor: bigint, currency: string): string {
  const d = currencyInfo(currency).decimals;
  const negative = minor < 0n;
  const abs = (negative ? -minor : minor).toString().padStart(d + 1, '0');
  const intPart = d === 0 ? abs : abs.slice(0, -d);
  const frac = d === 0 ? '' : '.' + abs.slice(-d);
  return (negative ? '-' : '') + intPart + frac;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

/** Locale-formatted currency string for display. */
export function formatMoney(minor: bigint, currency: string, locale = 'en-US'): string {
  const info = currencyInfo(currency);
  const key = `${locale}|${info.code}`;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: info.code,
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals,
    });
    formatterCache.set(key, fmt);
  }
  // The decimal string has exactly `decimals` digits, so Number() is exact
  // enough for display; no arithmetic happens on the float.
  return fmt.format(Number(minorToDecimalString(minor, currency)));
}

/** Compact display ($12.4k) for chart axes only. */
export function formatMoneyCompact(minor: bigint, currency: string, locale = 'en-US'): string {
  const info = currencyInfo(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: info.code,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(minorToDecimalString(minor, currency)));
}

/** Formats a scaled percentage (milli-percent) back to a short string ("8.875"). */
export function formatRate(rateScaled: bigint): string {
  const s = rateScaled.toString().padStart(RATE_SCALE + 1, '0');
  const intPart = s.slice(0, -RATE_SCALE);
  const frac = s.slice(-RATE_SCALE).replace(/0+$/, '');
  return frac ? `${intPart}.${frac}` : intPart;
}

export function sumMinor(values: bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n);
}

/**
 * Splits `total` across `weights` so the parts sum exactly to `total`
 * (largest-remainder method; ties go to the earliest index).
 */
export function allocate(total: bigint, weights: bigint[]): bigint[] {
  const weightSum = sumMinor(weights);
  if (weights.length === 0) return [];
  if (weightSum === 0n) return weights.map(() => 0n);
  const raw = weights.map((w) => {
    const product = total * w;
    return { floor: product / weightSum, rem: product % weightSum };
  });
  let remainder = total - sumMinor(raw.map((r) => r.floor));
  const order = raw
    .map((r, i) => ({ i, rem: r.rem }))
    .sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  const result = raw.map((r) => r.floor);
  for (let k = 0; remainder > 0n && k < order.length; k++, remainder--) {
    result[order[k].i] += 1n;
  }
  return result;
}
