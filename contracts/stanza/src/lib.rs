#![no_std]

//! Stanza — non-custodial recurring subscriptions on Stellar.
//!
//! A merchant publishes a [`Plan`] (token, price per cycle, cycle length, trial,
//! optional cycle cap). A subscriber approves a SEP-41 allowance to this
//! contract and calls `subscribe`, which creates a [`Subscription`] record.
//! After that, **anyone** can call `charge` once a cycle is due: the contract
//! pulls exactly one cycle's price from the subscriber with `transfer_from`.
//!
//! Funds never sit in the contract. The subscriber's money stays in their own
//! wallet between charges, so cancelling is unilateral and immediate.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Vec,
};

/// Ledgers are ~5s. Rent is pre-paid so a live subscription is never archived.
const DAY_IN_LEDGERS: u32 = 17_280;
const TTL_THRESHOLD: u32 = DAY_IN_LEDGERS * 30;
const TTL_EXTEND: u32 = DAY_IN_LEDGERS * 120;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum SubStatus {
    Active = 0,
    Paused = 1,
    Canceled = 2,
    Completed = 3,
}

/// A merchant's reusable billing template.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Plan {
    pub id: u64,
    pub merchant: Address,
    /// SEP-41 token contract (a SAC or any Soroban token).
    pub token: Address,
    /// Amount pulled per cycle, in the token's base unit.
    pub amount: i128,
    /// Cycle length in seconds.
    pub period: u64,
    /// Seconds billed at zero cost before the first charge.
    pub trial_period: u64,
    /// Hard cap on paid cycles. `0` means no cap.
    pub max_cycles: u32,
    /// Merchants can retire a plan; existing subscriptions then stop billing.
    pub active: bool,
}

/// One subscriber's enrolment in a plan.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Subscription {
    pub id: u64,
    pub plan_id: u64,
    pub subscriber: Address,
    pub started_at: u64,
    /// Timestamp of the next billable cycle.
    pub next_charge_at: u64,
    pub cycles_charged: u32,
    pub total_paid: i128,
    pub status: SubStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlanCreated {
    pub plan_id: u64,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    pub period: u64,
    pub trial_period: u64,
    pub max_cycles: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Subscribed {
    pub sub_id: u64,
    pub plan_id: u64,
    pub subscriber: Address,
    pub next_charge_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Charged {
    pub sub_id: u64,
    pub plan_id: u64,
    pub subscriber: Address,
    pub merchant: Address,
    pub amount: i128,
    pub cycles_charged: u32,
    pub next_charge_at: u64,
    pub total_paid: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionStatusChanged {
    pub sub_id: u64,
    pub plan_id: u64,
    pub subscriber: Address,
    pub status: SubStatus,
    pub next_charge_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlanStatusChanged {
    pub plan_id: u64,
    pub merchant: Address,
    pub active: bool,
}

#[contracttype]
pub enum DataKey {
    Plan(u64),
    Sub(u64),
    NextPlanId,
    NextSubId,
    MerchantPlans(Address),
    SubscriberSubs(Address),
    PlanSubs(u64),
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    PlanNotFound = 1,
    SubNotFound = 2,
    InvalidAmount = 3,
    InvalidPeriod = 4,
    PlanInactive = 5,
    SubNotActive = 6,
    NotDue = 7,
    CycleLimitReached = 8,
    MathOverflow = 9,
    NotSubscriber = 10,
}

#[contract]
pub struct StanzaContract;

impl StanzaContract {
    fn load_plan(env: &Env, plan_id: u64) -> Result<Plan, Error> {
        let key = DataKey::Plan(plan_id);
        let plan: Plan = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::PlanNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
        Ok(plan)
    }

    fn store_plan(env: &Env, plan: &Plan) {
        let key = DataKey::Plan(plan.id);
        env.storage().persistent().set(&key, plan);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
    }

    fn load_sub(env: &Env, sub_id: u64) -> Result<Subscription, Error> {
        let key = DataKey::Sub(sub_id);
        let sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::SubNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
        Ok(sub)
    }

    fn store_sub(env: &Env, sub: &Subscription) {
        let key = DataKey::Sub(sub.id);
        env.storage().persistent().set(&key, sub);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
    }

    fn next_plan_id(env: &Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextPlanId)
            .unwrap_or(0)
    }

    fn next_sub_id(env: &Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextSubId)
            .unwrap_or(0)
    }

    fn push_index(env: &Env, key: DataKey, id: u64) {
        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        ids.push_back(id);
        env.storage().persistent().set(&key, &ids);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
    }

    fn read_index(env: &Env, key: DataKey) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env))
    }
}

// `Events::publish` is stable and widely used by indexers; the `#[contractevent]`
// alternative would change the topic layout our indexer depends on.
#[allow(deprecated)]
#[contractimpl]
impl StanzaContract {
    /// Publish a plan. `amount` is charged per `period` seconds; `max_cycles`
    /// of `0` means the plan bills until cancelled.
    pub fn create_plan(
        env: Env,
        merchant: Address,
        token: Address,
        amount: i128,
        period: u64,
        trial_period: u64,
        max_cycles: u32,
    ) -> Result<u64, Error> {
        merchant.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if period == 0 {
            return Err(Error::InvalidPeriod);
        }

        let plan_id = Self::next_plan_id(&env);

        let plan = Plan {
            id: plan_id,
            merchant: merchant.clone(),
            token: token.clone(),
            amount,
            period,
            trial_period,
            max_cycles,
            active: true,
        };
        Self::store_plan(&env, &plan);
        env.storage()
            .instance()
            .set(&DataKey::NextPlanId, &(plan_id + 1));
        Self::push_index(&env, DataKey::MerchantPlans(merchant.clone()), plan_id);

        env.events().publish(
            (symbol_short!("plan_new"), plan_id),
            PlanCreated {
                plan_id,
                merchant,
                token,
                amount,
                period,
                trial_period,
                max_cycles,
            },
        );

        Ok(plan_id)
    }

    /// Retire or re-enable a plan. Only the merchant can do this, and retiring a
    /// plan never alters money already moved — it only stops future charges.
    pub fn set_plan_active(env: Env, plan_id: u64, active: bool) -> Result<(), Error> {
        let mut plan = Self::load_plan(&env, plan_id)?;
        plan.merchant.require_auth();

        plan.active = active;
        Self::store_plan(&env, &plan);

        env.events().publish(
            (symbol_short!("plan_act"), plan_id),
            PlanStatusChanged {
                plan_id,
                merchant: plan.merchant,
                active,
            },
        );

        Ok(())
    }

    /// Enrol the caller in a plan. The caller must have already approved this
    /// contract as a spender on the plan's token for at least one cycle.
    pub fn subscribe(env: Env, subscriber: Address, plan_id: u64) -> Result<u64, Error> {
        subscriber.require_auth();

        let plan = Self::load_plan(&env, plan_id)?;
        if !plan.active {
            return Err(Error::PlanInactive);
        }

        let now = env.ledger().timestamp();
        let next_charge_at = now
            .checked_add(plan.trial_period)
            .ok_or(Error::MathOverflow)?;

        let sub_id = Self::next_sub_id(&env);
        let sub = Subscription {
            id: sub_id,
            plan_id,
            subscriber: subscriber.clone(),
            started_at: now,
            next_charge_at,
            cycles_charged: 0,
            total_paid: 0,
            status: SubStatus::Active,
        };

        Self::store_sub(&env, &sub);
        env.storage()
            .instance()
            .set(&DataKey::NextSubId, &(sub_id + 1));
        Self::push_index(&env, DataKey::SubscriberSubs(subscriber.clone()), sub_id);
        Self::push_index(&env, DataKey::PlanSubs(plan_id), sub_id);

        env.events().publish(
            (symbol_short!("sub_new"), sub_id),
            Subscribed {
                sub_id,
                plan_id,
                subscriber,
                next_charge_at,
            },
        );

        Ok(sub_id)
    }

    /// Bill exactly one due cycle. Permissionless: a merchant, the subscriber,
    /// or an unrelated keeper can all call it. The contract is only ever the
    /// spender of the allowance the subscriber granted it.
    pub fn charge(env: Env, sub_id: u64) -> Result<(), Error> {
        let mut sub = Self::load_sub(&env, sub_id)?;
        let plan = Self::load_plan(&env, sub.plan_id)?;

        if sub.status != SubStatus::Active {
            return Err(Error::SubNotActive);
        }
        if !plan.active {
            return Err(Error::PlanInactive);
        }
        if plan.max_cycles != 0 && sub.cycles_charged >= plan.max_cycles {
            return Err(Error::CycleLimitReached);
        }

        let now = env.ledger().timestamp();
        if now < sub.next_charge_at {
            return Err(Error::NotDue);
        }

        // Effects are written before the token interaction.
        sub.cycles_charged = sub
            .cycles_charged
            .checked_add(1)
            .ok_or(Error::MathOverflow)?;
        sub.total_paid = sub
            .total_paid
            .checked_add(plan.amount)
            .ok_or(Error::MathOverflow)?;
        sub.next_charge_at = sub
            .next_charge_at
            .checked_add(plan.period)
            .ok_or(Error::MathOverflow)?;

        if plan.max_cycles != 0 && sub.cycles_charged >= plan.max_cycles {
            sub.status = SubStatus::Completed;
        }

        Self::store_sub(&env, &sub);

        token::Client::new(&env, &plan.token).transfer_from(
            &env.current_contract_address(),
            &sub.subscriber,
            &plan.merchant,
            &plan.amount,
        );

        env.events().publish(
            (symbol_short!("charged"), sub_id),
            Charged {
                sub_id,
                plan_id: sub.plan_id,
                subscriber: sub.subscriber.clone(),
                merchant: plan.merchant,
                amount: plan.amount,
                cycles_charged: sub.cycles_charged,
                next_charge_at: sub.next_charge_at,
                total_paid: sub.total_paid,
            },
        );

        Ok(())
    }

    /// Subscriber-initiated pause. No further cycles are billable until resume.
    pub fn pause(env: Env, sub_id: u64) -> Result<(), Error> {
        let mut sub = Self::load_sub(&env, sub_id)?;
        sub.subscriber.require_auth();

        if sub.status != SubStatus::Active {
            return Err(Error::SubNotActive);
        }

        sub.status = SubStatus::Paused;
        Self::store_sub(&env, &sub);

        env.events().publish(
            (symbol_short!("paused"), sub_id),
            SubscriptionStatusChanged {
                sub_id,
                plan_id: sub.plan_id,
                subscriber: sub.subscriber,
                status: sub.status,
                next_charge_at: sub.next_charge_at,
            },
        );

        Ok(())
    }

    /// Subscriber-initiated resume. The next cycle starts one full period from
    /// now, so time spent paused is never billed.
    pub fn resume(env: Env, sub_id: u64) -> Result<(), Error> {
        let mut sub = Self::load_sub(&env, sub_id)?;
        sub.subscriber.require_auth();

        if sub.status != SubStatus::Paused {
            return Err(Error::SubNotActive);
        }

        let now = env.ledger().timestamp();
        let plan = Self::load_plan(&env, sub.plan_id)?;

        sub.status = SubStatus::Active;
        sub.next_charge_at = now.checked_add(plan.period).ok_or(Error::MathOverflow)?;
        Self::store_sub(&env, &sub);

        env.events().publish(
            (symbol_short!("resumed"), sub_id),
            SubscriptionStatusChanged {
                sub_id,
                plan_id: sub.plan_id,
                subscriber: sub.subscriber,
                status: sub.status,
                next_charge_at: sub.next_charge_at,
            },
        );

        Ok(())
    }

    /// Cancel a subscription permanently. Nothing is owed or refunded: the
    /// subscriber's funds were never held by the contract.
    pub fn cancel(env: Env, sub_id: u64) -> Result<(), Error> {
        let mut sub = Self::load_sub(&env, sub_id)?;
        sub.subscriber.require_auth();

        if sub.status == SubStatus::Canceled {
            return Err(Error::SubNotActive);
        }

        sub.status = SubStatus::Canceled;
        Self::store_sub(&env, &sub);

        env.events().publish(
            (symbol_short!("canceled"), sub_id),
            SubscriptionStatusChanged {
                sub_id,
                plan_id: sub.plan_id,
                subscriber: sub.subscriber,
                status: sub.status,
                next_charge_at: sub.next_charge_at,
            },
        );

        Ok(())
    }

    pub fn get_plan(env: Env, plan_id: u64) -> Result<Plan, Error> {
        Self::load_plan(&env, plan_id)
    }

    pub fn get_subscription(env: Env, sub_id: u64) -> Result<Subscription, Error> {
        Self::load_sub(&env, sub_id)
    }

    /// True when a charge would succeed right now.
    pub fn is_due(env: Env, sub_id: u64) -> Result<bool, Error> {
        let sub = Self::load_sub(&env, sub_id)?;
        let plan = Self::load_plan(&env, sub.plan_id)?;

        let billable = sub.status == SubStatus::Active
            && plan.active
            && (plan.max_cycles == 0 || sub.cycles_charged < plan.max_cycles);

        Ok(billable && env.ledger().timestamp() >= sub.next_charge_at)
    }

    /// How many cycles are billable right now (backlog included), capped by the
    /// plan's `max_cycles`. A keeper loop uses this to drain a backlog.
    pub fn cycles_due(env: Env, sub_id: u64) -> Result<u32, Error> {
        let sub = Self::load_sub(&env, sub_id)?;
        let plan = Self::load_plan(&env, sub.plan_id)?;

        if sub.status != SubStatus::Active || !plan.active {
            return Ok(0);
        }
        if plan.max_cycles != 0 && sub.cycles_charged >= plan.max_cycles {
            return Ok(0);
        }

        let now = env.ledger().timestamp();
        if now < sub.next_charge_at {
            return Ok(0);
        }

        let elapsed = now - sub.next_charge_at;
        let mut due = elapsed / plan.period + 1;

        if plan.max_cycles != 0 {
            let remaining = (plan.max_cycles - sub.cycles_charged) as u64;
            if due > remaining {
                due = remaining;
            }
        }
        if due > u32::MAX as u64 {
            due = u32::MAX as u64;
        }

        Ok(due as u32)
    }

    pub fn plan_count(env: Env) -> u64 {
        Self::next_plan_id(&env)
    }

    pub fn subscription_count(env: Env) -> u64 {
        Self::next_sub_id(&env)
    }

    pub fn plans_of(env: Env, merchant: Address) -> Vec<u64> {
        Self::read_index(&env, DataKey::MerchantPlans(merchant))
    }

    pub fn subs_of(env: Env, subscriber: Address) -> Vec<u64> {
        Self::read_index(&env, DataKey::SubscriberSubs(subscriber))
    }

    pub fn subs_of_plan(env: Env, plan_id: u64) -> Vec<u64> {
        Self::read_index(&env, DataKey::PlanSubs(plan_id))
    }
}

#[cfg(test)]
mod test;
