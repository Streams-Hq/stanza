import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseStanzaEvent } from '../events.js';

describe('event decoding', () => {
  it('decodes plan_new', () => {
    const event = parseStanzaEvent('plan_new', {
      plan_id: 3n,
      merchant: 'GMERCHANT',
      token: 'CTOKEN',
      amount: 5_0000000n,
      period: 2_592_000n,
      trial_period: 604_800n,
      max_cycles: 12,
    });

    assert.deepEqual(event, {
      kind: 'plan_created',
      data: {
        planId: 3n,
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: 5_0000000n,
        period: 2_592_000n,
        trialPeriod: 604_800n,
        maxCycles: 12,
      },
    });
  });

  it('decodes charged with camelCase and string amounts', () => {
    const event = parseStanzaEvent('charged', {
      subId: 7,
      planId: 3,
      subscriber: 'GSUB',
      merchant: 'GMERCHANT',
      amount: '50000000',
      cyclesCharged: 2,
      nextChargeAt: '2593000',
      totalPaid: '100000000',
    });

    assert.equal(event?.kind, 'charged');
    if (event?.kind !== 'charged') return;
    assert.equal(event.data.subId, 7n);
    assert.equal(event.data.amount, 50_000_000n);
    assert.equal(event.data.totalPaid, 100_000_000n);
    assert.equal(event.data.nextChargeAt, 2_593_000n);
  });

  it('maps pause, resume and cancel to subscription_updated', () => {
    for (const topic of ['paused', 'resumed', 'canceled']) {
      const event = parseStanzaEvent(topic, {
        sub_id: 1n,
        plan_id: 2n,
        subscriber: 'GSUB',
        status: topic === 'paused' ? 1 : 2,
        next_charge_at: 99n,
      });
      assert.equal(event?.kind, 'subscription_updated');
      if (event?.kind !== 'subscription_updated') continue;
      assert.equal(event.data.status, topic === 'paused' ? 'paused' : 'canceled');
      assert.equal(event.data.nextChargeAt, 99n);
    }
  });

  it('decodes plan_act', () => {
    const event = parseStanzaEvent('plan_act', {
      plan_id: 1n,
      merchant: 'GM',
      active: false,
    });
    assert.deepEqual(event, {
      kind: 'plan_status_changed',
      data: { planId: 1n, merchant: 'GM', active: false },
    });
  });

  it('ignores unknown topics and empty values', () => {
    assert.equal(parseStanzaEvent('transfer', { amount: 1n }), null);
    assert.equal(parseStanzaEvent('plan_new', null), null);
  });
});
