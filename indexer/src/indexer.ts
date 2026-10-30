import { rpc, scValToNative } from '@stellar/stellar-sdk';
import { parseStanzaEvent } from '@stanza/sdk';
import dotenv from 'dotenv';
import {
  getLastLedger,
  recordCharge,
  recordEvent,
  setLastLedger,
  setPlanActive,
  upsertPlan,
  upsertSubscription,
  getSubscriptionById,
  getPlanById,
} from './db.js';

dotenv.config();

export interface IndexerConfig {
  rpcUrl: string;
  contractId: string;
  pollIntervalMs?: number;
}

/**
 * Follows the Stanza contract's events and keeps the SQLite read model in sync.
 * The chain is always authoritative; this service is a cache that makes the
 * dashboard and the keeper view fast.
 */
export class StanzaIndexer {
  private server: rpc.Server;
  private contractId: string;
  private pollIntervalMs: number;
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(config?: Partial<IndexerConfig>) {
    const rpcUrl =
      config?.rpcUrl ||
      process.env.SOROBAN_RPC_URL ||
      'https://soroban-testnet.stellar.org';
    this.contractId = config?.contractId || process.env.STANZA_CONTRACT_ID || '';
    this.pollIntervalMs = config?.pollIntervalMs ?? 3000;
    this.server = new rpc.Server(rpcUrl, {
      allowHttp: rpcUrl.startsWith('http://'),
    });
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(
      `[Indexer] Watching ${this.contractId || '(waiting for STANZA_CONTRACT_ID)'}`,
    );

    let cursor = getLastLedger();
    if (cursor === 0) {
      try {
        const latest = await this.server.getLatestLedger();
        cursor = Math.max(1, latest.sequence - 100);
        setLastLedger(cursor);
      } catch {
        cursor = 1;
      }
    }
    console.log(`[Indexer] Starting at ledger ${cursor}`);

    this.poll();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[Indexer] Stopped');
  }

  private schedule(delay: number): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(() => void this.poll(), delay);
  }

  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    try {
      if (!this.contractId) {
        this.contractId = process.env.STANZA_CONTRACT_ID || '';
        return this.schedule(this.pollIntervalMs);
      }

      const cursor = getLastLedger();
      const response = await this.server.getEvents({
        startLedger: cursor,
        filters: [{ type: 'contract', contractIds: [this.contractId] }],
        limit: 100,
      });

      let maxLedger = cursor;
      for (const event of response.events) {
        try {
          this.processEvent(event);
          maxLedger = Math.max(maxLedger, event.ledger);
        } catch (err) {
          console.error(`[Indexer] Failed to process ${event.id}:`, err);
        }
      }

      if (response.events.length > 0) {
        setLastLedger(maxLedger + 1);
      } else {
        const latest = await this.server.getLatestLedger().catch(() => null);
        if (latest && latest.sequence > cursor + 100) {
          setLastLedger(latest.sequence - 10);
        }
      }
    } catch (err) {
      console.error('[Indexer] Poll error:', err);
    }

    this.schedule(this.pollIntervalMs);
  }

  private processEvent(event: rpc.Api.EventResponse): void {
    const topics = event.topic.map((t) => scValToNative(t));
    const name = String(topics[0] ?? '');
    const value = scValToNative(event.value);
    const parsed = parseStanzaEvent(name, value);
    if (!parsed) return;

    const now = Math.floor(Date.now() / 1000);

    switch (parsed.kind) {
      case 'plan_created': {
        const plan = parsed.data;
        upsertPlan({
          id: Number(plan.planId),
          merchant: plan.merchant,
          token: plan.token,
          amount: plan.amount.toString(),
          period: Number(plan.period),
          trial_period: Number(plan.trialPeriod),
          max_cycles: plan.maxCycles,
          active: 1,
          created_at: now,
        });
        console.log(`[Indexer] Plan #${plan.planId} created`);
        break;
      }
      case 'subscribed': {
        const sub = parsed.data;
        upsertSubscription({
          id: Number(sub.subId),
          plan_id: Number(sub.planId),
          subscriber: sub.subscriber,
          started_at: now,
          next_charge_at: Number(sub.nextChargeAt),
          cycles_charged: 0,
          total_paid: '0',
          status: 'active',
          created_at: now,
        });
        recordEvent(
          Number(sub.subId),
          'subscribed',
          event.ledger,
          parsed.data,
          event.ledgerClosedAt,
          event.txHash,
        );
        console.log(`[Indexer] Subscription #${sub.subId} created`);
        break;
      }
      case 'charged': {
        const charge = parsed.data;
        const subId = Number(charge.subId);
        const existing = getSubscriptionById(subId);
        const plan = getPlanById(Number(charge.planId));
        const completed =
          plan !== undefined &&
          plan.max_cycles !== 0 &&
          charge.cyclesCharged >= plan.max_cycles;

        upsertSubscription({
          id: subId,
          plan_id: Number(charge.planId),
          subscriber: charge.subscriber,
          started_at: existing?.started_at ?? now,
          next_charge_at: Number(charge.nextChargeAt),
          cycles_charged: charge.cyclesCharged,
          total_paid: charge.totalPaid.toString(),
          status: completed ? 'completed' : existing?.status ?? 'active',
          created_at: existing?.created_at ?? now,
        });
        recordCharge(
          subId,
          Number(charge.planId),
          charge.amount.toString(),
          charge.cyclesCharged,
          event.ledger,
          event.ledgerClosedAt,
          event.txHash,
        );
        recordEvent(
          subId,
          'charged',
          event.ledger,
          parsed.data,
          event.ledgerClosedAt,
          event.txHash,
        );
        console.log(
          `[Indexer] Charged #${subId} cycle ${charge.cyclesCharged} (${charge.amount})`,
        );
        break;
      }
      case 'subscription_updated': {
        const update = parsed.data;
        const subId = Number(update.subId);
        const existing = getSubscriptionById(subId);
        if (!existing) break;
        upsertSubscription({
          ...existing,
          next_charge_at: Number(update.nextChargeAt),
          status: update.status,
        });
        recordEvent(
          subId,
          update.status,
          event.ledger,
          parsed.data,
          event.ledgerClosedAt,
          event.txHash,
        );
        console.log(`[Indexer] Subscription #${subId} → ${update.status}`);
        break;
      }
      case 'plan_status_changed': {
        const change = parsed.data;
        setPlanActive(Number(change.planId), change.active);
        console.log(
          `[Indexer] Plan #${change.planId} ${change.active ? 'enabled' : 'retired'}`,
        );
        break;
      }
    }
  }
}
