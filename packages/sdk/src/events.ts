import {
  ChargedEvent,
  PlanCreatedEvent,
  PlanStatusChangedEvent,
  StanzaEvent,
  SubscribedEvent,
  SubscriptionStatusChangedEvent,
} from './types.js';
import { toSubStatus } from './xdr.js';

type NativeRecord = Record<string, unknown> | Map<string, unknown>;

function pick(source: NativeRecord, snake: string, camel: string): unknown {
  if (source instanceof Map) {
    return source.has(snake) ? source.get(snake) : source.get(camel);
  }
  const rec = source as Record<string, unknown>;
  return rec[snake] ?? rec[camel];
}

function big(source: NativeRecord, snake: string, camel: string, fallback = 0n): bigint {
  const v = pick(source, snake, camel);
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string') return BigInt(v);
  return BigInt(String(v));
}

function str(source: NativeRecord, snake: string, camel: string): string {
  const v = pick(source, snake, camel);
  return v === undefined || v === null ? '' : String(v);
}

function num(source: NativeRecord, snake: string, camel: string, fallback = 0): number {
  const v = pick(source, snake, camel);
  return v === undefined || v === null ? fallback : Number(v);
}

function bool(source: NativeRecord, snake: string, camel: string): boolean {
  const v = pick(source, snake, camel);
  return v === true || v === 1 || v === 1n || v === 'true';
}

/**
 * Turns one decoded contract event into a typed Stanza event.
 *
 * `topicName` is the first event topic as a string (`plan_new`, `charged`, …)
 * and `value` is the event body already converted with `scValToNative`.
 * Returns `null` for unrelated events so callers can filter safely.
 */
export function parseStanzaEvent(
  topicName: string,
  value: unknown,
): StanzaEvent | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as NativeRecord;

  switch (topicName) {
    case 'plan_new':
      return {
        kind: 'plan_created',
        data: {
          planId: big(data, 'plan_id', 'planId'),
          merchant: str(data, 'merchant', 'merchant'),
          token: str(data, 'token', 'token'),
          amount: big(data, 'amount', 'amount'),
          period: big(data, 'period', 'period'),
          trialPeriod: big(data, 'trial_period', 'trialPeriod'),
          maxCycles: num(data, 'max_cycles', 'maxCycles'),
        } satisfies PlanCreatedEvent,
      };
    case 'sub_new':
      return {
        kind: 'subscribed',
        data: {
          subId: big(data, 'sub_id', 'subId'),
          planId: big(data, 'plan_id', 'planId'),
          subscriber: str(data, 'subscriber', 'subscriber'),
          nextChargeAt: big(data, 'next_charge_at', 'nextChargeAt'),
        } satisfies SubscribedEvent,
      };
    case 'charged':
      return {
        kind: 'charged',
        data: {
          subId: big(data, 'sub_id', 'subId'),
          planId: big(data, 'plan_id', 'planId'),
          subscriber: str(data, 'subscriber', 'subscriber'),
          merchant: str(data, 'merchant', 'merchant'),
          amount: big(data, 'amount', 'amount'),
          cyclesCharged: num(data, 'cycles_charged', 'cyclesCharged'),
          nextChargeAt: big(data, 'next_charge_at', 'nextChargeAt'),
          totalPaid: big(data, 'total_paid', 'totalPaid'),
        } satisfies ChargedEvent,
      };
    case 'paused':
    case 'resumed':
    case 'canceled':
      return {
        kind: 'subscription_updated',
        data: {
          subId: big(data, 'sub_id', 'subId'),
          planId: big(data, 'plan_id', 'planId'),
          subscriber: str(data, 'subscriber', 'subscriber'),
          status: toSubStatus(pick(data, 'status', 'status')),
          nextChargeAt: big(data, 'next_charge_at', 'nextChargeAt'),
        } satisfies SubscriptionStatusChangedEvent,
      };
    case 'plan_act':
      return {
        kind: 'plan_status_changed',
        data: {
          planId: big(data, 'plan_id', 'planId'),
          merchant: str(data, 'merchant', 'merchant'),
          active: bool(data, 'active', 'active'),
        } satisfies PlanStatusChangedEvent,
      };
    default:
      return null;
  }
}
