import {
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { Plan, SubStatus, Subscription } from './types.js';

/** Converts a Stellar account / contract address (`G...` or `C...`) to an Address ScVal. */
export function addressToScVal(address: string): xdr.ScVal {
  return new Address(address).toScVal();
}

/** Converts an integer to a `u64` ScVal. */
export function u64ToScVal(value: bigint | number): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: 'u64' });
}

/** Converts an integer to a `u32` ScVal. */
export function u32ToScVal(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: 'u32' });
}

/** Converts an integer to an `i128` ScVal. */
export function i128ToScVal(value: bigint | string | number): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: 'i128' });
}

/** Converts a boolean to a `bool` ScVal. */
export function boolToScVal(value: boolean): xdr.ScVal {
  return nativeToScVal(Boolean(value), { type: 'bool' });
}

type NativeRecord = Record<string, unknown> | Map<string, unknown>;

function readProp(source: NativeRecord, snake: string, camel: string): unknown {
  if (source instanceof Map) {
    return source.has(snake) ? source.get(snake) : source.get(camel);
  }
  const rec = source as Record<string, unknown>;
  return rec[snake] ?? rec[camel];
}

function toBigInt(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value.length > 0 && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  throw new Error(`Invalid or missing integer field: ${field}`);
}

function toStringValue(value: unknown, field: string): string {
  if (typeof value === 'string') return value;
  if (value && typeof (value as { toString?: () => string }).toString === 'function') {
    return (value as { toString: () => string }).toString();
  }
  throw new Error(`Invalid or missing address field: ${field}`);
}

/** Marshals the contract's unit enum (u32 on the wire, or a variant name). */
export function toSubStatus(value: unknown): SubStatus {
  if (typeof value === 'number' || typeof value === 'bigint') {
    const raw = Number(value);
    if (raw === 0) return 'active';
    if (raw === 1) return 'paused';
    if (raw === 2) return 'canceled';
    if (raw === 3) return 'completed';
  }
  const name = String(value).toLowerCase();
  if (name === 'active' || name === '0') return 'active';
  if (name === 'paused' || name === '1') return 'paused';
  if (name === 'canceled' || name === 'cancelled' || name === '2') return 'canceled';
  if (name === 'completed' || name === '3') return 'completed';
  throw new Error(`Unknown subscription status: ${String(value)}`);
}

function unwrap(val: xdr.ScVal | unknown): NativeRecord {
  const native = val instanceof xdr.ScVal ? scValToNative(val as xdr.ScVal) : val;
  if (!native || typeof native !== 'object') {
    throw new Error('Invalid contract return value');
  }
  return native as NativeRecord;
}

/** Parses `get_plan` / `PlanCreated` into a typed Plan. */
export function parsePlanScVal(val: xdr.ScVal | unknown): Plan {
  const native = unwrap(val);
  return {
    id: toBigInt(readProp(native, 'id', 'id'), 'id'),
    merchant: toStringValue(readProp(native, 'merchant', 'merchant'), 'merchant'),
    token: toStringValue(readProp(native, 'token', 'token'), 'token'),
    amount: toBigInt(readProp(native, 'amount', 'amount'), 'amount'),
    period: toBigInt(readProp(native, 'period', 'period'), 'period'),
    trialPeriod: toBigInt(readProp(native, 'trial_period', 'trialPeriod'), 'trialPeriod'),
    maxCycles: Number(readProp(native, 'max_cycles', 'maxCycles') ?? 0),
    active: Boolean(readProp(native, 'active', 'active')),
  };
}

/** Parses `get_subscription` into a typed Subscription. */
export function parseSubscriptionScVal(val: xdr.ScVal | unknown): Subscription {
  const native = unwrap(val);
  return {
    id: toBigInt(readProp(native, 'id', 'id'), 'id'),
    planId: toBigInt(readProp(native, 'plan_id', 'planId'), 'planId'),
    subscriber: toStringValue(readProp(native, 'subscriber', 'subscriber'), 'subscriber'),
    startedAt: toBigInt(readProp(native, 'started_at', 'startedAt'), 'startedAt'),
    nextChargeAt: toBigInt(readProp(native, 'next_charge_at', 'nextChargeAt'), 'nextChargeAt'),
    cyclesCharged: Number(readProp(native, 'cycles_charged', 'cyclesCharged') ?? 0),
    totalPaid: toBigInt(readProp(native, 'total_paid', 'totalPaid'), 'totalPaid'),
    status: toSubStatus(readProp(native, 'status', 'status')),
  };
}
