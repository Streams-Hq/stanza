import { Plan, SubStatus, Subscription } from '@stanza/sdk';
import { CONFIG } from './config';

export interface PlanRecord {
  id: number;
  merchant: string;
  token: string;
  amount: string;
  period: number;
  trial_period: number;
  max_cycles: number;
  active: number;
  created_at: number;
  updated_at: number;
}

export interface SubscriptionRecord {
  id: number;
  plan_id: number;
  subscriber: string;
  started_at: number;
  next_charge_at: number;
  cycles_charged: number;
  total_paid: string;
  status: string;
}

export interface Stats {
  plans: number;
  subscriptions: number;
  activeSubscriptions: number;
  merchants: number;
  volume: string;
}

export interface EventRecord {
  id: number;
  sub_id: number;
  event_type: string;
  ledger: number;
  ledger_closed_at: string | null;
  data: string;
  tx_hash: string | null;
}

export interface ChargeRecord {
  id: number;
  sub_id: number;
  plan_id: number;
  amount: string;
  cycles_charged: number;
  ledger: number;
  ledger_closed_at: string | null;
  tx_hash: string | null;
}

export const planFromRecord = (record: PlanRecord): Plan => ({
  id: BigInt(record.id),
  merchant: record.merchant,
  token: record.token,
  amount: BigInt(record.amount),
  period: BigInt(record.period),
  trialPeriod: BigInt(record.trial_period),
  maxCycles: record.max_cycles,
  active: Boolean(record.active),
});

export const subscriptionFromRecord = (record: SubscriptionRecord): Subscription => ({
  id: BigInt(record.id),
  planId: BigInt(record.plan_id),
  subscriber: record.subscriber,
  startedAt: BigInt(record.started_at),
  nextChargeAt: BigInt(record.next_charge_at),
  cyclesCharged: record.cycles_charged,
  totalPaid: BigInt(record.total_paid),
  status: record.status as SubStatus,
});

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${CONFIG.indexerUrl}${path}`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export const api = {
  stats: () => getJson<Stats>('/api/stats'),
  plans: () => getJson<{ plans: PlanRecord[] }>('/api/plans?limit=100'),
  plansByMerchant: (address: string) =>
    getJson<{ plans: PlanRecord[] }>(`/api/plans/merchant/${address}`),
  plan: (id: string) => getJson<{ plan: PlanRecord }>(`/api/plans/${id}`),
  subscriptionsByPlan: (id: string) =>
    getJson<{ subscriptions: SubscriptionRecord[] }>(
      `/api/plans/${id}/subscriptions`,
    ),
  subscriptionsBySubscriber: (address: string) =>
    getJson<{ subscriptions: SubscriptionRecord[] }>(
      `/api/subscriptions/subscriber/${address}`,
    ),
  subscription: (id: string) =>
    getJson<{ subscription: SubscriptionRecord }>(`/api/subscriptions/${id}`),
  due: () =>
    getJson<{ dueAt: number; subscriptions: SubscriptionRecord[] }>(
      '/api/subscriptions/due?limit=50',
    ),
  events: (id: string) =>
    getJson<{ events: EventRecord[] }>(`/api/events/${id}`),
  charges: (id: string) =>
    getJson<{ charges: ChargeRecord[] }>(`/api/subscriptions/${id}/charges`),
};

export const shortAddress = (address: string): string =>
  address.length > 12 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address;
