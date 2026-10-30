#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

const START: u64 = 1_700_000_000;
const PERIOD: u64 = 30 * 24 * 60 * 60; // 30 days
const PRICE: i128 = 5_0000000; // 5 XLM in stroops

fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(START);

    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let subscriber = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(admin);
    let token = sac.address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &1_000_0000000i128);

    let contract = env.register(StanzaContract, ());
    (env, contract, token, merchant, subscriber)
}

fn approve(env: &Env, token: &Address, from: &Address, spender: &Address, amount: i128) {
    TokenClient::new(env, token).approve(
        from,
        spender,
        &amount,
        &(env.ledger().sequence() + 100_000),
    );
}

fn new_plan(
    env: &Env,
    contract: &Address,
    merchant: &Address,
    token: &Address,
    max_cycles: u32,
) -> u64 {
    StanzaContractClient::new(env, contract).create_plan(
        merchant,
        token,
        &PRICE,
        &PERIOD,
        &0u64,
        &max_cycles,
    )
}

#[test]
fn creates_plan_with_expected_fields() {
    let (env, contract, token, merchant, _) = setup();
    let client = StanzaContractClient::new(&env, &contract);

    let plan_id = client.create_plan(&merchant, &token, &PRICE, &PERIOD, &86_400u64, &12u32);
    assert_eq!(plan_id, 0);
    assert_eq!(client.plan_count(), 1);

    let plan = client.get_plan(&plan_id);
    assert_eq!(plan.merchant, merchant);
    assert_eq!(plan.token, token);
    assert_eq!(plan.amount, PRICE);
    assert_eq!(plan.period, PERIOD);
    assert_eq!(plan.trial_period, 86_400);
    assert_eq!(plan.max_cycles, 12);
    assert!(plan.active);
}

#[test]
fn rejects_invalid_plan_parameters() {
    let (env, contract, token, merchant, _) = setup();
    let client = StanzaContractClient::new(&env, &contract);

    let err = client
        .try_create_plan(&merchant, &token, &0i128, &PERIOD, &0u64, &0u32)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidAmount);

    let err = client
        .try_create_plan(&merchant, &token, &PRICE, &0u64, &0u64, &0u32)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidPeriod);
}

#[test]
fn subscription_starts_and_is_due_immediately_without_trial() {
    let (env, contract, token, merchant, subscriber) = setup();
    let client = StanzaContractClient::new(&env, &contract);
    let plan_id = new_plan(&env, &contract, &merchant, &token, 0);

    let sub_id = client.subscribe(&subscriber, &plan_id);
    assert_eq!(sub_id, 0);
    assert_eq!(client.subscription_count(), 1);

    let sub = client.get_subscription(&sub_id);
    assert_eq!(sub.subscriber, subscriber);
    assert_eq!(sub.plan_id, plan_id);
    assert_eq!(sub.started_at, START);
    assert_eq!(sub.next_charge_at, START);
    assert_eq!(sub.cycles_charged, 0);
    assert_eq!(sub.total_paid, 0);
    assert_eq!(sub.status, SubStatus::Active);
    assert!(client.is_due(&sub_id));
    assert_eq!(client.cycles_due(&sub_id), 1);
}

#[test]
fn trial_period_delays_the_first_charge() {
    let (env, contract, token, merchant, subscriber) = setup();
    let client = StanzaContractClient::new(&env, &contract);
    let plan_id = client.create_plan(&merchant, &token, &PRICE, &PERIOD, &604_800u64, &0u32);

    let sub_id = client.subscribe(&subscriber, &plan_id);
    assert_eq!(
        client.get_subscription(&sub_id).next_charge_at,
        START + 604_800
    );
    assert!(!client.is_due(&sub_id));
    assert_eq!(
        client.try_charge(&sub_id).unwrap_err().unwrap(),
        Error::NotDue
    );
}

#[test]
fn charge_moves_exactly_one_cycle_to_the_merchant() {
    let (env, contract, token, merchant, subscriber) = setup();
    let client = StanzaContractClient::new(&env, &contract);
    let plan_id = new_plan(&env, &contract, &merchant, &token, 0);
    let sub_id = client.subscribe(&subscriber, &plan_id);

    approve(&env, &token, &subscriber, &contract, PRICE * 3);
    client.charge(&sub_id);

    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&merchant), PRICE);
    assert_eq!(token_client.balance(&subscriber), 1_000_0000000i128 - PRICE);

    let sub = client.get_subscription(&sub_id);
    assert_eq!(sub.cycles_charged, 1);
    assert_eq!(sub.total_paid, PRICE);
    assert_eq!(sub.next_charge_at, START + PERIOD);
    assert_eq!(sub.status, SubStatus::Active);
    assert!(!client.is_due(&sub_id));
}

#[test]
fn charge_is_rejected_before_the_next_cycle() {
    let (env, contract, token, merchant, subscriber) = setup();
    let client = StanzaContractClient::new(&env, &contract);
    let plan_id = new_plan(&env, &contract, &merchant, &token, 0);
    let sub_id = client.subscribe(&subscriber, &plan_id);

    approve(&env, &token, &subscriber, &contract, PRICE * 3);
    client.charge(&sub_id);

    env.ledger().set_timestamp(START + PERIOD - 1);
    assert_eq!(
        client.try_charge(&sub_id).unwrap_err().unwrap(),
        Error::NotDue
    );
}

#[test]
fn keeper_can_drain_a_backlog_one_cycle_at_a_time() {
    let (env, contract, token, merchant, subscriber) = setup();
    let client = StanzaContractClient::new(&env, &contract);
    let plan_id = new_plan(&env, &contract, &merchant, &token, 0);
    let sub_id = client.subscribe(&subscriber, &plan_id);

    approve(&env, &token, &subscriber, &contract, PRICE * 10);

    // Three periods elapse without a charge.
    env.ledger().set_timestamp(START + PERIOD * 3);
    assert_eq!(client.cycles_due(&sub_id), 4);

    for _ in 0..4 {
        client.charge(&sub_id);
    }

    let sub = client.get_subscription(&sub_id);
    assert_eq!(sub.cycles_charged, 4);
    assert_eq!(sub.total_paid, PRICE * 4);
    assert_eq!(sub.next_charge_at, START + PERIOD * 4);
    assert_eq!(TokenClient::new(&env, &token).balance(&merchant), PRICE * 4);
}

#[test]
fn max_cycles_completes_the_subscription() {
    let (env, contract, token, merchant, subscriber) = setup();
    let client = StanzaContractClient::new(&env, &contract);
    let plan_id = new_plan(&env, &contract, &merchant, &token, 2);
    let sub_id = client.subscribe(&subscriber, &plan_id);

    approve(&env, &token, &subscriber, &contract, PRICE * 5);

    client.charge(&sub_id);
    env.ledger().set_timestamp(START + PERIOD);
    client.charge(&sub_id);

    let sub = client.get_subscription(&sub_id);
    assert_eq!(sub.status, SubStatus::Completed);
    assert_eq!(sub.cycles_charged, 2);
    assert!(!client.is_due(&sub_id));
    assert_eq!(client.cycles_due(&sub_id), 0);

    env.ledger().set_timestamp(START + PERIOD * 2);
    assert_eq!(
        client.try_charge(&sub_id).unwrap_err().unwrap(),
        Error::SubNotActive
    );
    assert_eq!(TokenClient::new(&env, &token).balance(&merchant), PRICE * 2);
}

#[test]
fn pause_stops_billing_and_resume_restarts_the_cycle() {
    let (env, contract, token, merchant, subscriber) = setup();
    let client = StanzaContractClient::new(&env, &contract);
    let plan_id = new_plan(&env, &contract, &merchant, &token, 0);
    let sub_id = client.subscribe(&subscriber, &plan_id);

    approve(&env, &token, &subscriber, &contract, PRICE * 5);
    client.pause(&sub_id);

    let sub = client.get_subscription(&sub_id);
    assert_eq!(sub.status, SubStatus::Paused);
    assert!(!client.is_due(&sub_id));

    env.ledger().set_timestamp(START + PERIOD * 2);
    assert_eq!(
        client.try_charge(&sub_id).unwrap_err().unwrap(),
        Error::SubNotActive
    );

    client.resume(&sub_id);
    let sub = client.get_subscription(&sub_id);
    assert_eq!(sub.status, SubStatus::Active);
    assert_eq!(sub.next_charge_at, START + PERIOD * 3);
    assert_eq!(
        client.try_charge(&sub_id).unwrap_err().unwrap(),
        Error::NotDue
    );

    env.ledger().set_timestamp(START + PERIOD * 3);
    client.charge(&sub_id);
    assert_eq!(client.get_subscription(&sub_id).cycles_charged, 1);
}

#[test]
fn cancel_is_permanent_and_stops_billing() {
    let (env, contract, token, merchant, subscriber) = setup();
    let client = StanzaContractClient::new(&env, &contract);
    let plan_id = new_plan(&env, &contract, &merchant, &token, 0);
    let sub_id = client.subscribe(&subscriber, &plan_id);

    approve(&env, &token, &subscriber, &contract, PRICE * 5);
    client.cancel(&sub_id);

    assert_eq!(client.get_subscription(&sub_id).status, SubStatus::Canceled);
    assert_eq!(
        client.try_charge(&sub_id).unwrap_err().unwrap(),
        Error::SubNotActive
    );
    assert_eq!(
        client.try_cancel(&sub_id).unwrap_err().unwrap(),
        Error::SubNotActive
    );

    // Nothing was ever held by the contract, so there is nothing to refund.
    assert_eq!(TokenClient::new(&env, &token).balance(&contract), 0i128);
}

#[test]
fn retiring_a_plan_blocks_new_subscriptions_and_charges() {
    let (env, contract, token, merchant, subscriber) = setup();
    let client = StanzaContractClient::new(&env, &contract);
    let plan_id = new_plan(&env, &contract, &merchant, &token, 0);
    let sub_id = client.subscribe(&subscriber, &plan_id);
    approve(&env, &token, &subscriber, &contract, PRICE * 5);

    client.set_plan_active(&plan_id, &false);
    assert!(!client.get_plan(&plan_id).active);

    let other = Address::generate(&env);
    assert_eq!(
        client.try_subscribe(&other, &plan_id).unwrap_err().unwrap(),
        Error::PlanInactive
    );
    assert_eq!(
        client.try_charge(&sub_id).unwrap_err().unwrap(),
        Error::PlanInactive
    );

    client.set_plan_active(&plan_id, &true);
    client.charge(&sub_id);
    assert_eq!(client.get_subscription(&sub_id).cycles_charged, 1);
}

#[test]
fn indexes_plans_and_subscriptions_by_party() {
    let (env, contract, token, merchant, subscriber) = setup();
    let client = StanzaContractClient::new(&env, &contract);

    let first = new_plan(&env, &contract, &merchant, &token, 0);
    let second = new_plan(&env, &contract, &merchant, &token, 0);

    let sub_a = client.subscribe(&subscriber, &first);
    let sub_b = client.subscribe(&subscriber, &second);

    assert_eq!(
        client.plans_of(&merchant),
        Vec::from_array(&env, [first, second])
    );
    assert_eq!(
        client.subs_of(&subscriber),
        Vec::from_array(&env, [sub_a, sub_b])
    );
    assert_eq!(client.subs_of_plan(&second), Vec::from_array(&env, [sub_b]));

    let stranger = Address::generate(&env);
    assert_eq!(client.plans_of(&stranger).len(), 0);
    assert_eq!(client.subs_of(&stranger).len(), 0);
}

#[test]
fn unknown_ids_return_not_found() {
    let (env, contract, _, _, subscriber) = setup();
    let client = StanzaContractClient::new(&env, &contract);

    assert_eq!(
        client.try_get_plan(&42u64).unwrap_err().unwrap(),
        Error::PlanNotFound
    );
    assert_eq!(
        client.try_get_subscription(&42u64).unwrap_err().unwrap(),
        Error::SubNotFound
    );
    assert_eq!(
        client
            .try_subscribe(&subscriber, &42u64)
            .unwrap_err()
            .unwrap(),
        Error::PlanNotFound
    );
}

#[test]
#[should_panic]
fn charge_panics_when_the_allowance_is_missing() {
    let (env, contract, token, merchant, subscriber) = setup();
    let client = StanzaContractClient::new(&env, &contract);
    let plan_id = new_plan(&env, &contract, &merchant, &token, 0);
    let sub_id = client.subscribe(&subscriber, &plan_id);

    // No approve() call: the token contract must reject the pull.
    client.charge(&sub_id);
}

#[test]
fn token_balance_of_contract_is_always_zero() {
    let (env, contract, token, merchant, subscriber) = setup();
    let client = StanzaContractClient::new(&env, &contract);
    let plan_id = new_plan(&env, &contract, &merchant, &token, 0);
    let sub_id = client.subscribe(&subscriber, &plan_id);
    approve(&env, &token, &subscriber, &contract, PRICE * 5);

    client.charge(&sub_id);
    env.ledger().set_timestamp(START + PERIOD);
    client.charge(&sub_id);

    assert_eq!(TokenClient::new(&env, &token).balance(&contract), 0i128);
}
