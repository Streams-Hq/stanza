import {
  Account,
  Contract,
  Transaction,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import {
  ApproveAllowanceParams,
  ChargeParams,
  ClientConfig,
  CreatePlanParams,
  Plan,
  SetPlanActiveParams,
  StanzaEvent,
  SubscribeParams,
  Subscription,
  SubscriptionActionParams,
} from './types.js';
import {
  addressToScVal,
  boolToScVal,
  i128ToScVal,
  parsePlanScVal,
  parseSubscriptionScVal,
  u32ToScVal,
  u64ToScVal,
} from './xdr.js';
import { parseStanzaEvent } from './events.js';

/** Read-only simulations do not need a funded source account. */
const DUMMY_SOURCE = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

/** Contract error codes, kept in sync with `contracts/stanza/src/lib.rs`. */
export const CONTRACT_ERRORS: Record<number, string> = {
  1: 'Plan not found',
  2: 'Subscription not found',
  3: 'Amount must be greater than zero',
  4: 'Cycle length must be greater than zero',
  5: 'Plan is retired',
  6: 'Subscription is not active',
  7: 'Nothing is due yet',
  8: 'Cycle limit reached',
  9: 'Arithmetic overflow',
  10: 'You are not the subscriber',
};

export class StanzaError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = 'StanzaError';
    this.code = code;
  }
}

function errorFromSimulation(sim: { error?: unknown }): StanzaError {
  const text = typeof sim.error === 'string' ? sim.error : JSON.stringify(sim.error ?? {});
  const match = /#(\d+)/.exec(text);
  if (match) {
    const code = Number(match[1]);
    return new StanzaError(CONTRACT_ERRORS[code] ?? `Contract error ${code}`, code);
  }
  return new StanzaError(`Simulation failed: ${text}`);
}

export interface DecodedContractEvent {
  kind: StanzaEvent['kind'];
  data: StanzaEvent['data'];
  ledger: number;
  txHash: string;
  ledgerClosedAt: string;
  topic: string;
}

export class StanzaClient {
  public readonly server: rpc.Server;
  public readonly contract: Contract;
  public readonly config: ClientConfig;

  constructor(config: ClientConfig) {
    this.config = config;
    this.server = new rpc.Server(config.rpcUrl, {
      allowHttp: config.rpcUrl.startsWith('http://'),
    });
    this.contract = new Contract(config.contractId);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  private async simulate(method: string, ...args: xdr.ScVal[]): Promise<xdr.ScVal> {
    const account = new Account(DUMMY_SOURCE, '0');
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(300)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim)) {
      throw errorFromSimulation(sim as { error?: unknown });
    }
    if (!sim.result?.retval) {
      throw new StanzaError(`${method} returned an empty value`);
    }
    return sim.result.retval;
  }

  async getPlan(planId: bigint): Promise<Plan> {
    return parsePlanScVal(await this.simulate('get_plan', u64ToScVal(planId)));
  }

  async getSubscription(subscriptionId: bigint): Promise<Subscription> {
    return parseSubscriptionScVal(
      await this.simulate('get_subscription', u64ToScVal(subscriptionId)),
    );
  }

  async planCount(): Promise<bigint> {
    return BigInt(scValToNative(await this.simulate('plan_count')));
  }

  async subscriptionCount(): Promise<bigint> {
    return BigInt(scValToNative(await this.simulate('subscription_count')));
  }

  async plansOf(merchant: string): Promise<bigint[]> {
    const ids = scValToNative(await this.simulate('plans_of', addressToScVal(merchant)));
    return (ids as unknown[]).map((id) => BigInt(id as number));
  }

  async subsOf(subscriber: string): Promise<bigint[]> {
    const ids = scValToNative(await this.simulate('subs_of', addressToScVal(subscriber)));
    return (ids as unknown[]).map((id) => BigInt(id as number));
  }

  async subsOfPlan(planId: bigint): Promise<bigint[]> {
    const ids = scValToNative(await this.simulate('subs_of_plan', u64ToScVal(planId)));
    return (ids as unknown[]).map((id) => BigInt(id as number));
  }

  async isDue(subscriptionId: bigint): Promise<boolean> {
    return Boolean(scValToNative(await this.simulate('is_due', u64ToScVal(subscriptionId))));
  }

  async cyclesDue(subscriptionId: bigint): Promise<number> {
    return Number(scValToNative(await this.simulate('cycles_due', u64ToScVal(subscriptionId))));
  }

  /** Reads a SEP-41 allowance the subscriber granted to the Stanza contract. */
  async allowance(token: string, owner: string, spender: string): Promise<bigint> {
    const tokenContract = new Contract(token);
    const account = new Account(DUMMY_SOURCE, '0');
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        tokenContract.call(
          'allowance',
          addressToScVal(owner),
          addressToScVal(spender),
        ),
      )
      .setTimeout(300)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) {
      throw errorFromSimulation(sim as { error?: unknown });
    }
    return BigInt(scValToNative(sim.result.retval));
  }

  /**
   * Contract events for this Stanza instance, decoded into SDK types.
   * Pass the last seen ledger id + 1 to page forward.
   */
  async getEvents(startLedger: number, limit = 100): Promise<DecodedContractEvent[]> {
    const response = await this.server.getEvents({
      startLedger,
      filters: [{ type: 'contract', contractIds: [this.config.contractId] }],
      limit,
    });

    const decoded: DecodedContractEvent[] = [];
    for (const event of response.events) {
      try {
        const topics = event.topic.map((t) => scValToNative(t));
        const value = scValToNative(event.value);
        const topic = String(topics[0] ?? '');
        const parsed = parseStanzaEvent(topic, value);
        if (!parsed) continue;
        decoded.push({
          kind: parsed.kind,
          data: parsed.data,
          ledger: event.ledger,
          txHash: event.txHash,
          ledgerClosedAt: event.ledgerClosedAt,
          topic,
        });
      } catch {
        // Ignore events we cannot decode rather than failing the whole page.
      }
    }
    return decoded;
  }

  // ---------------------------------------------------------------------------
  // Writes — each returns an unsigned, prepared transaction for the wallet.
  // ---------------------------------------------------------------------------

  private async build(
    source: string,
    method: string,
    ...args: xdr.ScVal[]
  ): Promise<Transaction> {
    const account = await this.server.getAccount(source);
    const tx = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(300)
      .build();

    return (await this.server.prepareTransaction(tx)) as Transaction;
  }

  createPlanTx(params: CreatePlanParams): Promise<Transaction> {
    return this.build(
      params.merchant,
      'create_plan',
      addressToScVal(params.merchant),
      addressToScVal(params.token),
      i128ToScVal(params.amount),
      u64ToScVal(params.period),
      u64ToScVal(params.trialPeriod ?? 0n),
      u32ToScVal(params.maxCycles ?? 0),
    );
  }

  setPlanActiveTx(params: SetPlanActiveParams): Promise<Transaction> {
    return this.build(
      params.merchant,
      'set_plan_active',
      u64ToScVal(params.planId),
      boolToScVal(params.active),
    );
  }

  subscribeTx(params: SubscribeParams): Promise<Transaction> {
    return this.build(
      params.subscriber,
      'subscribe',
      addressToScVal(params.subscriber),
      u64ToScVal(params.planId),
    );
  }

  chargeTx(params: ChargeParams, source: string): Promise<Transaction> {
    return this.build(source, 'charge', u64ToScVal(params.subscriptionId));
  }

  pauseTx(params: SubscriptionActionParams): Promise<Transaction> {
    return this.build(params.subscriber, 'pause', u64ToScVal(params.subscriptionId));
  }

  resumeTx(params: SubscriptionActionParams): Promise<Transaction> {
    return this.build(params.subscriber, 'resume', u64ToScVal(params.subscriptionId));
  }

  cancelTx(params: SubscriptionActionParams): Promise<Transaction> {
    return this.build(params.subscriber, 'cancel', u64ToScVal(params.subscriptionId));
  }

  /**
   * SEP-41 `approve`. The subscriber must run this before `subscribeTx`; the
   * Stanza contract then becomes the spender and can only ever pull the price
   * of one cycle per charge.
   */
  async approveAllowanceTx(params: ApproveAllowanceParams): Promise<Transaction> {
    const token = new Contract(params.token);
    const account = await this.server.getAccount(params.owner);

    const tx = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        token.call(
          'approve',
          addressToScVal(params.owner),
          addressToScVal(params.spender),
          i128ToScVal(params.amount),
          u32ToScVal(params.expirationLedger),
        ),
      )
      .setTimeout(300)
      .build();

    return (await this.server.prepareTransaction(tx)) as Transaction;
  }
}
