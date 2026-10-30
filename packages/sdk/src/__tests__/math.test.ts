import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingProgress,
  committedValue,
  cyclesDue,
  formatCountdown,
  formatPeriod,
  formatUnits,
  isDue,
  parseUnits,
} from '../math.js';
import { Plan, Subscription } from '../types.js';

const PERIOD = 2_592_000n; // 30 days

const plan: Plan = {
  id: 0n,
  merchant: 'GMERCHANT000000000000000000000000000000000000000000000000',
  token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  amount: 5_0000000n, // 5 XLM
  period: PERIOD,
  trialPeriod: 0n,
  maxCycles: 0,
  active: true,
};

const sub: Subscription = {
  id: 0n,
  planId: 0n,
  subscriber: 'GSUBSCRIBER00000000000000000000000000000000000000000000000',
  startedAt: 1_000n,
  nextChargeAt: 1_000n,
  cyclesCharged: 0,
  totalPaid: 0n,
  status: 'active',
};

describe('cycle math', () => {
  it('is not due before the first cycle starts', () => {
    assert.equal(cyclesDue(plan, sub, 999n), 0);
    assert.equal(isDue(plan, sub, 999n), false);
  });

  it('is due exactly at next_charge_at', () => {
    assert.equal(cyclesDue(plan, sub, 1_000n), 1);
    assert.equal(isDue(plan, sub, 1_000n), true);
  });

  it('counts a backlog, including the current cycle', () => {
    assert.equal(cyclesDue(plan, sub, 1_000n + PERIOD * 2n), 3);
    assert.equal(cyclesDue(plan, sub, 1_000n + PERIOD * 2n + 1n), 3);
  });

  it('never exceeds the plan cycle cap', () => {
    const capped = { ...plan, maxCycles: 2 };
    assert.equal(cyclesDue(capped, sub, 1_000n + PERIOD * 10n), 2);
  });

  it('stops once the cap is reached', () => {
    const capped = { ...plan, maxCycles: 2 };
    const done = { ...sub, cyclesCharged: 2 };
    assert.equal(cyclesDue(capped, done, 1_000n + PERIOD * 10n), 0);
  });

  it('is never due for a paused, canceled, completed or retired subscription', () => {
    const now = 1_000n + PERIOD;
    assert.equal(cyclesDue(plan, { ...sub, status: 'paused' }, now), 0);
    assert.equal(cyclesDue(plan, { ...sub, status: 'canceled' }, now), 0);
    assert.equal(cyclesDue(plan, { ...sub, status: 'completed' }, now), 0);
    assert.equal(cyclesDue({ ...plan, active: false }, sub, now), 0);
  });

  it('reports progress, countdown and remaining cycles', () => {
    const half = billingProgress(
      plan,
      { ...sub, nextChargeAt: 1_000n + PERIOD },
      1_000n + PERIOD / 2n,
    );
    assert.equal(half.dueCycles, 0);
    assert.equal(half.cycleProgress, 0.5);
    assert.equal(half.secondsUntilNext, Number(PERIOD / 2n));
    assert.equal(half.cyclesRemaining, null);

    const capped = billingProgress(
      { ...plan, maxCycles: 12 },
      { ...sub, cyclesCharged: 3 },
      1_000n,
    );
    assert.equal(capped.cyclesRemaining, 9);
    assert.equal(capped.dueCycles, 1);
    assert.equal(capped.cycleProgress, 1);
    assert.equal(capped.secondsUntilNext, 0);
  });
});

describe('formatting', () => {
  it('round-trips base units without precision loss', () => {
    assert.equal(formatUnits(1234567890n, 7), '123.4567890');
    assert.equal(parseUnits('123.4567890', 7), 1234567890n);
    assert.equal(formatUnits(0n, 7), '0.0000000');
    assert.equal(parseUnits('0', 7), 0n);
    assert.equal(parseUnits('-1.5', 7), -15000000n);
  });

  it('labels billing periods', () => {
    assert.equal(formatPeriod(86_400n), '1 day');
    assert.equal(formatPeriod(604_800n), '7 days');
    assert.equal(formatPeriod(PERIOD), '30 days');
    assert.equal(formatPeriod(3_600n), '1 hour');
    assert.equal(formatPeriod(900n), '15 minutes');
    assert.equal(formatPeriod(45n), '45 seconds');
  });

  it('formats countdowns', () => {
    assert.equal(formatCountdown(0), 'due now');
    assert.equal(formatCountdown(90_061), '1d 1h 1m');
    assert.equal(formatCountdown(45), '45s');
  });

  it('computes committed value only for capped plans', () => {
    assert.equal(committedValue(plan), null);
    assert.equal(committedValue({ ...plan, maxCycles: 12 }), 60_0000000n);
  });
});
