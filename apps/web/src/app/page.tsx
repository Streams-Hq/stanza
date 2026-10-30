'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  CalendarClock,
  Layers,
  Loader2,
  PlusCircle,
  RefreshCw,
  Store,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import { Plan, Subscription, formatUnits } from '@stanza/sdk';
import {
  Stats,
  api,
  planFromRecord,
  shortAddress,
  subscriptionFromRecord,
} from '@/lib/api';
import { getStanzaClient } from '@/lib/stellar';
import { useFreighter } from '@/hooks/useFreighter';
import { CONFIG } from '@/lib/config';
import PlanCard from '@/components/PlanCard';
import SubscriptionCard from '@/components/SubscriptionCard';

type Tab = 'plans' | 'subscriptions' | 'explore' | 'keeper';

const TABS: { id: Tab; label: string; icon: typeof Layers }[] = [
  { id: 'plans', label: 'My plans', icon: Store },
  { id: 'subscriptions', label: 'My subscriptions', icon: CalendarClock },
  { id: 'explore', label: 'Explore', icon: Layers },
  { id: 'keeper', label: 'Keeper queue', icon: Zap },
];

async function loadPlansById(ids: bigint[]): Promise<Plan[]> {
  const client = getStanzaClient();
  const plans: Plan[] = [];
  for (const id of ids) {
    try {
      plans.push(await client.getPlan(id));
    } catch {
      // Skip ids that are not readable on this network.
    }
  }
  return plans;
}

async function loadSubsById(ids: bigint[]): Promise<Subscription[]> {
  const client = getStanzaClient();
  const subs: Subscription[] = [];
  for (const id of ids) {
    try {
      subs.push(await client.getSubscription(id));
    } catch {
      // Skip unreadable ids.
    }
  }
  return subs;
}

export default function DashboardPage() {
  const { isConnected, address, connect } = useFreighter();

  const [tab, setTab] = useState<Tab>('plans');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [planLookup, setPlanLookup] = useState<Record<string, Plan>>({});
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requiresWallet = tab === 'plans' || tab === 'subscriptions' || tab === 'keeper';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const lookup: Record<string, Plan> = {};

    try {
      const client = getStanzaClient();

      if (tab === 'explore') {
        const cached = await api.plans();
        let items = cached?.plans.map(planFromRecord) ?? [];
        if (items.length === 0) {
          const count = await client.planCount();
          const ids: bigint[] = [];
          for (let id = count - 1n; id >= 0n && ids.length < 24; id -= 1n) ids.push(id);
          items = await loadPlansById(ids);
        }
        setPlans(items);
        setSubs([]);
        items.forEach((p) => {
          lookup[p.id.toString()] = p;
        });
      } else if (tab === 'plans') {
        if (!address) {
          setPlans([]);
          setSubs([]);
          setLoading(false);
          return;
        }
        const cached = await api.plansByMerchant(address);
        let items = cached?.plans.map(planFromRecord) ?? [];
        if (items.length === 0) {
          items = await loadPlansById(await client.plansOf(address));
        }
        setPlans(items);
        setSubs([]);
      } else if (tab === 'subscriptions') {
        if (!address) {
          setPlans([]);
          setSubs([]);
          setLoading(false);
          return;
        }
        const cached = await api.subscriptionsBySubscriber(address);
        let items = cached?.subscriptions.map(subscriptionFromRecord) ?? [];
        if (items.length === 0) {
          items = await loadSubsById(await client.subsOf(address));
        }
        setSubs(items);
        setPlans([]);
        for (const sub of items) {
          try {
            lookup[sub.planId.toString()] = await client.getPlan(sub.planId);
          } catch {
            // Plan may have been created on another network.
          }
        }
      } else {
        const cached = await api.due();
        const items = cached?.subscriptions.map(subscriptionFromRecord) ?? [];
        setSubs(items);
        setPlans([]);
        for (const sub of items) {
          try {
            lookup[sub.planId.toString()] = await client.getPlan(sub.planId);
          } catch {
            // ignore
          }
        }
      }

      setPlanLookup(lookup);
      setStats(await api.stats());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load on-chain data');
      setPlans([]);
      setSubs([]);
    } finally {
      setLoading(false);
    }
  }, [tab, address]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPlans = stats?.plans ?? plans.length;
  const totalSubs = stats?.subscriptions ?? subs.length;
  const volume = stats ? formatUnits(BigInt(stats.volume), CONFIG.decimals) : '—';

  return (
    <div className="space-y-8">
      <section className="glass-panel relative overflow-hidden rounded-3xl p-6 sm:p-10">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="relative z-10 flex flex-col justify-between gap-6 md:flex-row md:items-center">
          <div className="max-w-2xl space-y-3">
            <span className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-stellar-cyan">
              <Activity className="h-3.5 w-3.5" />
              Recurring billing, settled on Soroban
            </span>
            <h1 className="text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl">
              Subscriptions that never{' '}
              <span className="text-gradient-cyan">take custody</span> of your money
            </h1>
            <p className="max-w-xl text-sm text-slate-400">
              Merchants publish a plan once. Subscribers approve a capped allowance,
              and anyone can settle a cycle when it comes due. Funds move straight
              from the subscriber&apos;s wallet to the merchant — the contract never
              holds a balance.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href="/plans/new"
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-5 py-3 text-sm font-bold text-stellar-dark shadow-xl shadow-cyan-500/20 transition-opacity hover:opacity-95"
              >
                <PlusCircle className="h-4 w-4" />
                Create a plan
              </Link>
              <button
                type="button"
                onClick={() => {
                  if (!isConnected) void connect();
                  setTab('explore');
                }}
                className="inline-flex items-center gap-2 rounded-2xl border border-stellar-border bg-stellar-card/70 px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-stellar-cyan/50"
              >
                Browse plans
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid w-full max-w-sm grid-cols-2 gap-3">
            {[
              { label: 'Plans', value: String(totalPlans) },
              { label: 'Subscriptions', value: String(totalSubs) },
              { label: 'Merchants', value: String(stats?.merchants ?? '—') },
              { label: 'Settled', value: `${volume}` },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-stellar-border bg-stellar-dark/60 p-4"
              >
                <span className="block text-[11px] text-slate-400">{item.label}</span>
                <span className="font-mono text-xl font-black text-white">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-1 rounded-2xl border border-stellar-border bg-stellar-card p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                tab === id
                  ? 'bg-stellar-hover text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center justify-center gap-2 self-start rounded-xl border border-stellar-border bg-stellar-card px-3 py-2 text-xs text-slate-300 hover:bg-stellar-hover disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {requiresWallet && !isConnected && (
        <div className="flex flex-col items-center justify-between gap-4 rounded-3xl border border-cyan-500/30 bg-cyan-500/5 p-6 sm:flex-row">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-cyan-500/10 p-2 text-stellar-cyan">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Connect your wallet</h3>
              <p className="text-xs text-slate-400">
                Your plans and subscriptions are read straight from the chain by
                address.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void connect()}
            className="rounded-xl border border-cyan-500/40 bg-cyan-500/20 px-4 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/30"
          >
            Connect Freighter
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-60 flex-col items-center justify-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-stellar-cyan" />
          <p className="text-xs text-slate-400">Reading the contract…</p>
        </div>
      ) : tab === 'keeper' ? (
        subs.length === 0 ? (
          <EmptyState
            icon={Zap}
            title="Nothing to settle"
            body="No subscription is due right now. The keeper queue is derived from the contract clock, not a scheduler."
          />
        ) : (
          <>
            <p className="text-xs text-slate-400">
              These subscriptions are due. Anyone can charge one; the contract only
              pulls the approved cycle price.
            </p>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {subs.map((sub) => (
                <SubscriptionCard
                  key={sub.id.toString()}
                  subscription={sub}
                  plan={planLookup[sub.planId.toString()]}
                  perspective="merchant"
                />
              ))}
            </div>
          </>
        )
      ) : (tab === 'plans' || tab === 'explore') && plans.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard key={plan.id.toString()} plan={plan} />
          ))}
        </div>
      ) : tab === 'subscriptions' && subs.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {subs.map((sub) => (
            <SubscriptionCard
              key={sub.id.toString()}
              subscription={sub}
              plan={planLookup[sub.planId.toString()]}
              perspective="subscriber"
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={tab === 'subscriptions' ? CalendarClock : tab === 'plans' ? Store : Layers}
          title={
            tab === 'subscriptions'
              ? 'No subscriptions yet'
              : tab === 'plans'
                ? 'No plans yet'
                : 'No plans on this network'
          }
          body={
            tab === 'subscriptions'
              ? 'Browse plans and subscribe with a capped SEP-41 allowance. You can pause or cancel at any time.'
              : tab === 'plans'
                ? 'Publish your first plan. Merchants only pay network fees; there is no protocol fee.'
                : 'Nothing has been published to this Stanza contract yet.'
          }
          action={
            tab === 'subscriptions' ? (
              <button
                type="button"
                onClick={() => setTab('explore')}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-4 py-2.5 text-xs font-bold text-stellar-dark"
              >
                <Layers className="h-4 w-4" /> Browse plans
              </button>
            ) : (
              <Link
                href="/plans/new"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-4 py-2.5 text-xs font-bold text-stellar-dark"
              >
                <PlusCircle className="h-4 w-4" /> Create a plan
              </Link>
            )
          }
        />
      )}

      <p className="text-center text-[11px] text-slate-500">
        Contract{' '}
        <span className="font-mono text-slate-400">
          {CONFIG.contractId ? shortAddress(CONFIG.contractId) : 'not configured'}
        </span>{' '}
        · reads fall back to direct Soroban RPC queries when the indexer is offline.
      </p>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Users;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="glass-panel mx-auto max-w-lg rounded-3xl p-10 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-stellar-hover text-slate-400">
        <Icon className="h-6 w-6" />
      </div>
      <h2 className="text-base font-bold text-white">{title}</h2>
      <p className="mt-1 text-xs text-slate-400">{body}</p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
