/**
 * Domain types for the Stanza subscriptions contract.
 *
 * Amounts are always integer base units (`bigint`), never floats.
 */

export interface Plan {
  id: bigint;
  merchant: string;
  token: string;
  /** Price per cycle, in token base units. */
  amount: bigint;
  /** Cycle length in seconds. */
  period: bigint;
  /** Seconds billed at zero cost before the first charge. */
  trialPeriod: bigint;
  /** Hard cap on paid cycles. `0` means unlimited. */
  maxCycles: number;
  active: boolean;
}

export type SubStatus = 'active' | 'paused' | 'canceled' | 'completed';

export interface Subscription {
  id: bigint;
  planId: bigint;
  subscriber: string;
  startedAt: bigint;
  nextChargeAt: bigint;
  cyclesCharged: number;
  totalPaid: bigint;
  status: SubStatus;
}

export interface ClientConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
}

export interface CreatePlanParams {
  merchant: string;
  token: string;
  amount: bigint;
  period: bigint;
  trialPeriod?: bigint;
  maxCycles?: number;
}

export interface SubscribeParams {
  subscriber: string;
  planId: bigint;
}

export interface ChargeParams {
  subscriptionId: bigint;
}

export interface SubscriptionActionParams {
  subscriptionId: bigint;
  /** Address that must sign the action (the subscriber). */
  subscriber: string;
}

export interface SetPlanActiveParams {
  planId: bigint;
  merchant: string;
  active: boolean;
}

export interface ApproveAllowanceParams {
  token: string;
  /** Token owner granting the allowance (the subscriber). */
  owner: string;
  /** Spender granted the allowance (the Stanza contract). */
  spender: string;
  amount: bigint;
  /** Ledger sequence after which the allowance expires. */
  expirationLedger: number;
}

export interface PlanCreatedEvent {
  planId: bigint;
  merchant: string;
  token: string;
  amount: bigint;
  period: bigint;
  trialPeriod: bigint;
  maxCycles: number;
}

export interface SubscribedEvent {
  subId: bigint;
  planId: bigint;
  subscriber: string;
  nextChargeAt: bigint;
}

export interface ChargedEvent {
  subId: bigint;
  planId: bigint;
  subscriber: string;
  merchant: string;
  amount: bigint;
  cyclesCharged: number;
  nextChargeAt: bigint;
  totalPaid: bigint;
}

export interface SubscriptionStatusChangedEvent {
  subId: bigint;
  planId: bigint;
  subscriber: string;
  status: SubStatus;
  nextChargeAt: bigint;
}

export interface PlanStatusChangedEvent {
  planId: bigint;
  merchant: string;
  active: boolean;
}

export type StanzaEvent =
  | { kind: 'plan_created'; data: PlanCreatedEvent }
  | { kind: 'subscribed'; data: SubscribedEvent }
  | { kind: 'charged'; data: ChargedEvent }
  | { kind: 'subscription_updated'; data: SubscriptionStatusChangedEvent }
  | { kind: 'plan_status_changed'; data: PlanStatusChangedEvent };

/** Event name on-chain → the kind the SDK exposes. */
export const EVENT_TOPIC_TO_KIND: Record<string, StanzaEvent['kind']> = {
  plan_new: 'plan_created',
  sub_new: 'subscribed',
  charged: 'charged',
  paused: 'subscription_updated',
  resumed: 'subscription_updated',
  canceled: 'subscription_updated',
  plan_act: 'plan_status_changed',
};
