import { Plan, SubStatus, Subscription } from './types.js';

const asBigInt = (value: bigint | number): bigint =>
  typeof value === 'bigint' ? value : BigInt(Math.floor(value));

export interface BillingProgress {
  /** Cycles billable right now, including any backlog. */
  dueCycles: number;
  /** Fraction of the current cycle that has elapsed, 0..1. */
  cycleProgress: number;
  /** Seconds until the next cycle is billable, 0 when already due. */
  secondsUntilNext: number;
  /** Cycles left before the plan's `max_cycles` cap, or `null` when uncapped. */
  cyclesRemaining: number | null;
}

/**
 * Mirrors `cycles_due` on-chain: 0 when the subscription cannot be billed
 * (paused, canceled, completed, retired plan), otherwise the number of billable
 * cycles including any backlog.
 */
export function cyclesDue(
  plan: Pick<Plan, 'active' | 'maxCycles' | 'period'>,
  sub: Pick<Subscription, 'status' | 'cyclesCharged' | 'nextChargeAt'>,
  now: bigint | number,
): number {
  if (sub.status !== 'active' || !plan.active) return 0;
  if (plan.maxCycles !== 0 && sub.cyclesCharged >= plan.maxCycles) return 0;

  const period = asBigInt(plan.period);
  const current = asBigInt(now);
  const next = asBigInt(sub.nextChargeAt);
  if (period <= 0n || current < next) return 0;

  let due = Number((current - next) / period) + 1;
  if (plan.maxCycles !== 0) {
    due = Math.min(due, plan.maxCycles - sub.cyclesCharged);
  }
  return Math.max(0, due);
}

/** True when `charge` would succeed right now. */
export function isDue(
  plan: Pick<Plan, 'active' | 'maxCycles' | 'period'>,
  sub: Pick<Subscription, 'status' | 'cyclesCharged' | 'nextChargeAt'>,
  now: bigint | number,
): boolean {
  return cyclesDue(plan, sub, now) > 0;
}

/** Everything the billing UI needs for one subscription at a point in time. */
export function billingProgress(
  plan: Pick<Plan, 'active' | 'maxCycles' | 'period'>,
  sub: Pick<Subscription, 'status' | 'cyclesCharged' | 'nextChargeAt'>,
  now: bigint | number,
): BillingProgress {
  const period = asBigInt(plan.period);
  const current = asBigInt(now);
  const next = asBigInt(sub.nextChargeAt);
  const due = cyclesDue(plan, sub, now);

  let cycleProgress = 0;
  if (period > 0n) {
    if (current >= next) {
      cycleProgress = 1;
    } else {
      const cycleStart = next - period;
      if (current > cycleStart) {
        cycleProgress = Number(current - cycleStart) / Number(period);
      }
    }
  }

  const secondsUntilNext = current >= next ? 0 : Number(next - current);
  const cyclesRemaining =
    plan.maxCycles === 0 ? null : Math.max(0, plan.maxCycles - sub.cyclesCharged);

  return {
    dueCycles: due,
    cycleProgress: Math.min(1, Math.max(0, cycleProgress)),
    secondsUntilNext,
    cyclesRemaining,
  };
}

/** Formats a raw integer amount into a fixed-decimal string. */
export function formatUnits(amount: bigint | string | number, decimals = 7): string {
  const raw = BigInt(amount);
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;

  const factor = 10n ** BigInt(decimals);
  const integerPart = abs / factor;
  const fractionalPart = abs % factor;

  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  return `${negative ? '-' : ''}${integerPart}.${fractionalStr}`;
}

/** Parses a decimal string such as `"12.5"` into raw base units. */
export function parseUnits(formatted: string, decimals = 7): bigint {
  const trimmed = formatted.trim();
  if (!trimmed) return 0n;

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [intPart = '0', fracPart = ''] = unsigned.split('.');
  if (intPart !== '' && !/^\d+$/.test(intPart)) {
    throw new Error(`Invalid amount: ${formatted}`);
  }
  if (fracPart !== '' && !/^\d+$/.test(fracPart)) {
    throw new Error(`Invalid amount: ${formatted}`);
  }

  const factor = 10n ** BigInt(decimals);
  const paddedFrac = fracPart.padEnd(decimals, '0').slice(0, decimals);
  const value = BigInt(intPart || '0') * factor + BigInt(paddedFrac || '0');
  return negative ? -value : value;
}

/** Human label for a billing cycle length in seconds. */
export function formatPeriod(seconds: bigint | number): string {
  const s = Number(seconds);
  if (s <= 0) return '—';
  if (s % 86400 === 0) {
    const days = s / 86400;
    return days === 1 ? '1 day' : `${days} days`;
  }
  if (s % 3600 === 0) {
    const hours = s / 3600;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  if (s % 60 === 0) {
    const minutes = s / 60;
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }
  return `${s} seconds`;
}

/** `YYYY-MM-DD`-free, locale-stable countdown label, e.g. `2d 4h`. */
export function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'due now';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 && parts.length === 0) parts.push(`${seconds}s`);
  return parts.length > 0 ? parts.join(' ') : 'due now';
}

/** Total value a subscription will move over its lifetime, when capped. */
export function committedValue(
  plan: Pick<Plan, 'amount' | 'maxCycles'>,
): bigint | null {
  if (plan.maxCycles === 0) return null;
  return BigInt(plan.amount) * BigInt(plan.maxCycles);
}

export const STATUS_LABELS: Record<SubStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  canceled: 'Canceled',
  completed: 'Completed',
};
