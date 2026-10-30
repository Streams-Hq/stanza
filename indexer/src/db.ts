import DatabaseConstructor, { Database } from 'better-sqlite3';
import path from 'node:path';

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
  created_at: number;
  updated_at: number;
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
  created_at: number;
}

export interface EventRecord {
  id: number;
  sub_id: number;
  event_type: string;
  ledger: number;
  ledger_closed_at: string | null;
  data: string;
  tx_hash: string | null;
  created_at: number;
}

let dbInstance: Database | null = null;

export function initDatabase(dbPath?: string): Database {
  if (dbInstance) return dbInstance;

  const targetPath =
    dbPath || process.env.DB_PATH || path.join(process.cwd(), 'stanza.sqlite');
  const db = new DatabaseConstructor(targetPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY,
      merchant TEXT NOT NULL,
      token TEXT NOT NULL,
      amount TEXT NOT NULL,
      period INTEGER NOT NULL,
      trial_period INTEGER NOT NULL DEFAULT 0,
      max_cycles INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plans_merchant ON plans(merchant);
    CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(active);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY,
      plan_id INTEGER NOT NULL,
      subscriber TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      next_charge_at INTEGER NOT NULL,
      cycles_charged INTEGER NOT NULL DEFAULT 0,
      total_paid TEXT NOT NULL DEFAULT '0',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subs_subscriber ON subscriptions(subscriber);
    CREATE INDEX IF NOT EXISTS idx_subs_plan ON subscriptions(plan_id);
    CREATE INDEX IF NOT EXISTS idx_subs_next_charge ON subscriptions(next_charge_at);
    CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions(status);

    CREATE TABLE IF NOT EXISTS charges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sub_id INTEGER NOT NULL,
      plan_id INTEGER NOT NULL,
      amount TEXT NOT NULL,
      cycles_charged INTEGER NOT NULL,
      ledger INTEGER NOT NULL,
      ledger_closed_at TEXT,
      tx_hash TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_charges_sub ON charges(sub_id);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sub_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      ledger INTEGER NOT NULL,
      ledger_closed_at TEXT,
      data TEXT NOT NULL,
      tx_hash TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_sub ON events(sub_id);
    CREATE INDEX IF NOT EXISTS idx_events_ledger ON events(ledger);
  `);

  dbInstance = db;
  return db;
}

export function getDatabase(): Database {
  return dbInstance ?? initDatabase();
}

export function getLastLedger(): number {
  const db = getDatabase();
  const row = db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get('last_ledger') as { value: string } | undefined;

  if (!row) {
    const start = process.env.START_LEDGER ? parseInt(process.env.START_LEDGER, 10) : 0;
    return Number.isNaN(start) ? 0 : start;
  }
  return parseInt(row.value, 10);
}

export function setLastLedger(ledger: number): void {
  getDatabase()
    .prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run('last_ledger', ledger.toString());
}

export function upsertPlan(plan: Omit<PlanRecord, 'updated_at'>): void {
  const now = Math.floor(Date.now() / 1000);
  getDatabase()
    .prepare(
      `INSERT INTO plans (
        id, merchant, token, amount, period, trial_period, max_cycles, active, created_at, updated_at
      ) VALUES (
        @id, @merchant, @token, @amount, @period, @trial_period, @max_cycles, @active, @created_at, @updated_at
      ) ON CONFLICT(id) DO UPDATE SET
        amount = excluded.amount,
        period = excluded.period,
        trial_period = excluded.trial_period,
        max_cycles = excluded.max_cycles,
        active = excluded.active,
        updated_at = excluded.updated_at`,
    )
    .run({ ...plan, updated_at: now });
}

export function setPlanActive(planId: number, active: boolean): void {
  getDatabase()
    .prepare('UPDATE plans SET active = ?, updated_at = ? WHERE id = ?')
    .run(active ? 1 : 0, Math.floor(Date.now() / 1000), planId);
}

export function upsertSubscription(
  sub: Omit<SubscriptionRecord, 'updated_at'>,
): void {
  const now = Math.floor(Date.now() / 1000);
  getDatabase()
    .prepare(
      `INSERT INTO subscriptions (
        id, plan_id, subscriber, started_at, next_charge_at, cycles_charged,
        total_paid, status, created_at, updated_at
      ) VALUES (
        @id, @plan_id, @subscriber, @started_at, @next_charge_at, @cycles_charged,
        @total_paid, @status, @created_at, @updated_at
      ) ON CONFLICT(id) DO UPDATE SET
        next_charge_at = excluded.next_charge_at,
        cycles_charged = excluded.cycles_charged,
        total_paid = excluded.total_paid,
        status = excluded.status,
        updated_at = excluded.updated_at`,
    )
    .run({ ...sub, updated_at: now });
}

export function recordCharge(
  subId: number,
  planId: number,
  amount: string,
  cyclesCharged: number,
  ledger: number,
  ledgerClosedAt?: string,
  txHash?: string,
): void {
  const now = Math.floor(Date.now() / 1000);
  getDatabase()
    .prepare(
      `INSERT INTO charges (sub_id, plan_id, amount, cycles_charged, ledger, ledger_closed_at, tx_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(subId, planId, amount, cyclesCharged, ledger, ledgerClosedAt ?? null, txHash ?? null, now);
}

/** Event bodies contain i128/u64 values; serialize bigints as decimal strings. */
function serializeEventData(data: unknown): string {
  return JSON.stringify(data, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

export function recordEvent(
  subId: number,
  eventType: string,
  ledger: number,
  data: unknown,
  ledgerClosedAt?: string,
  txHash?: string,
): void {
  getDatabase()
    .prepare(
      `INSERT INTO events (sub_id, event_type, ledger, ledger_closed_at, data, tx_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      subId,
      eventType,
      ledger,
      ledgerClosedAt ?? null,
      serializeEventData(data),
      txHash ?? null,
      Math.floor(Date.now() / 1000),
    );
}

export function getPlanById(id: number): PlanRecord | undefined {
  return getDatabase().prepare('SELECT * FROM plans WHERE id = ?').get(id) as
    | PlanRecord
    | undefined;
}

export function getPlansByMerchant(merchant: string): PlanRecord[] {
  return getDatabase()
    .prepare('SELECT * FROM plans WHERE merchant = ? ORDER BY id DESC')
    .all(merchant) as PlanRecord[];
}

export function getAllPlans(limit = 50, offset = 0): PlanRecord[] {
  return getDatabase()
    .prepare('SELECT * FROM plans ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as PlanRecord[];
}

export function getSubscriptionById(id: number): SubscriptionRecord | undefined {
  return getDatabase().prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as
    | SubscriptionRecord
    | undefined;
}

export function getSubscriptionsBySubscriber(subscriber: string): SubscriptionRecord[] {
  return getDatabase()
    .prepare('SELECT * FROM subscriptions WHERE subscriber = ? ORDER BY id DESC')
    .all(subscriber) as SubscriptionRecord[];
}

export function getSubscriptionsByPlan(planId: number): SubscriptionRecord[] {
  return getDatabase()
    .prepare('SELECT * FROM subscriptions WHERE plan_id = ? ORDER BY id DESC')
    .all(planId) as SubscriptionRecord[];
}

export function getAllSubscriptions(
  limit = 50,
  offset = 0,
  status?: string,
): SubscriptionRecord[] {
  const db = getDatabase();
  if (status) {
    return db
      .prepare(
        'SELECT * FROM subscriptions WHERE status = ? ORDER BY id DESC LIMIT ? OFFSET ?',
      )
      .all(status, limit, offset) as SubscriptionRecord[];
  }
  return db
    .prepare('SELECT * FROM subscriptions ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as SubscriptionRecord[];
}

/** Subscriptions a keeper could charge right now. */
export function getDueSubscriptions(now: number, limit = 100): SubscriptionRecord[] {
  return getDatabase()
    .prepare(
      `SELECT s.* FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.status = 'active'
         AND p.active = 1
         AND s.next_charge_at <= ?
         AND (p.max_cycles = 0 OR s.cycles_charged < p.max_cycles)
       ORDER BY s.next_charge_at ASC
       LIMIT ?`,
    )
    .all(now, limit) as SubscriptionRecord[];
}

export function getEventsBySubId(subId: number): EventRecord[] {
  return getDatabase()
    .prepare('SELECT * FROM events WHERE sub_id = ? ORDER BY ledger ASC, id ASC')
    .all(subId) as EventRecord[];
}

export function getChargesBySubId(subId: number): ChargeRecord[] {
  return getDatabase()
    .prepare('SELECT * FROM charges WHERE sub_id = ? ORDER BY ledger ASC, id ASC')
    .all(subId) as ChargeRecord[];
}

export function getStats(): {
  plans: number;
  subscriptions: number;
  activeSubscriptions: number;
  merchants: number;
  volume: string;
} {
  const db = getDatabase();
  const plans = db.prepare('SELECT COUNT(*) AS n FROM plans').get() as { n: number };
  const subs = db.prepare('SELECT COUNT(*) AS n FROM subscriptions').get() as {
    n: number;
  };
  const active = db
    .prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'active'")
    .get() as { n: number };
  const merchants = db
    .prepare('SELECT COUNT(DISTINCT merchant) AS n FROM plans')
    .get() as { n: number };
  // Sum with bigint so large volumes never lose precision through a float.
  const paidRows = db.prepare('SELECT total_paid FROM subscriptions').all() as {
    total_paid: string;
  }[];
  let volume = 0n;
  for (const row of paidRows) {
    volume += BigInt(row.total_paid || '0');
  }

  return {
    plans: plans.n,
    subscriptions: subs.n,
    activeSubscriptions: active.n,
    merchants: merchants.n,
    volume: volume.toString(),
  };
}
