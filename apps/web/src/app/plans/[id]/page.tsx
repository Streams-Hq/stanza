'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Coins,
  ExternalLink,
  Loader2,
  Power,
  RefreshCw,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';
import {
  Plan,
  Subscription,
  billingProgress,
  formatPeriod,
  formatUnits,
} from '@stanza/sdk';
import {
  api,
  planFromRecord,
  shortAddress,
  subscriptionFromRecord,
} from '@/lib/api';
import { APPROVAL_CYCLES, ALLOWANCE_LEDGER_WINDOW, CONFIG } from '@/lib/config';
import {
  explorerTx,
  getStanzaClient,
  submitSignedTransaction,
} from '@/lib/stellar';
import { useFreighter } from '@/hooks/useFreighter';
import StatusBadge from '@/components/StatusBadge';

export default function PlanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const planId = params?.id as string;

  const { isConnected, address, connect, signTx } = useFreighter();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = getStanzaClient();

      let loadedPlan: Plan | null = null;
      const cachedPlan = await api.plan(planId);
      if (cachedPlan?.plan) loadedPlan = planFromRecord(cachedPlan.plan);
      if (!loadedPlan) loadedPlan = await client.getPlan(BigInt(planId));
      setPlan(loadedPlan);

      let loadedSubs: Subscription[] = [];
      const cachedSubs = await api.subscriptionsByPlan(planId);
      if (cachedSubs?.subscriptions.length) {
        loadedSubs = cachedSubs.subscriptions.map(subscriptionFromRecord);
      } else {
        const ids = await client.subsOfPlan(BigInt(planId));
        for (const id of ids) {
          try {
            loadedSubs.push(await client.getSubscription(id));
          } catch {
            // skip unreadable ids
          }
        }
      }
      setSubs(loadedSubs);

      if (address) {
        try {
          setAllowance(
            await client.allowance(loadedPlan.token, address, CONFIG.contractId),
          );
        } catch {
          setAllowance(0n);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this plan');
    } finally {
      setLoading(false);
    }
  }, [planId, address]);

  useEffect(() => {
    void load();
  }, [load]);

  const subscribe = async () => {
    if (!plan) return;
    if (!isConnected || !address) {
      await connect();
      return;
    }

    setBusy('subscribe');
    setNotice(null);
    setError(null);
    try {
      const client = getStanzaClient();
      const latest = await client.server.getLatestLedger();

      // Step 1: grant a capped allowance to the Stanza contract.
      const approveTx = await client.approveAllowanceTx({
        token: plan.token,
        owner: address,
        spender: CONFIG.contractId,
        amount: plan.amount * BigInt(APPROVAL_CYCLES),
        expirationLedger: latest.sequence + ALLOWANCE_LEDGER_WINDOW,
      });
      const signedApprove = await signTx(approveTx.toXDR());
      await submitSignedTransaction(signedApprove);

      // Step 2: enrol. The contract records the schedule; no funds move yet.
      const subscribeTx = await client.subscribeTx({
        subscriber: address,
        planId: plan.id,
      });
      const signedSubscribe = await signTx(subscribeTx.toXDR());
      await submitSignedTransaction(signedSubscribe);

      const ids = await client.subsOf(address);
      const newSub = ids[ids.length - 1];
      if (newSub !== undefined) {
        router.push(`/subscriptions/${newSub.toString()}`);
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Subscribe failed');
    } finally {
      setBusy(null);
    }
  };

  const togglePlan = async () => {
    if (!plan || !address) return;
    setBusy('plan');
    setError(null);
    try {
      const client = getStanzaClient();
      const tx = await client.setPlanActiveTx({
        planId: plan.id,
        merchant: address,
        active: !plan.active,
      });
      const signed = await signTx(tx.toXDR());
      await submitSignedTransaction(signed);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the plan');
    } finally {
      setBusy(null);
    }
  };

  const charge = async (sub: Subscription) => {
    if (!address) {
      await connect();
      return;
    }
    setBusy(`charge-${sub.id.toString()}`);
    setError(null);
    setNotice(null);
    try {
      const client = getStanzaClient();
      const tx = await client.chargeTx({ subscriptionId: sub.id }, address);
      const signed = await signTx(tx.toXDR());
      const result = await submitSignedTransaction(signed);
      setNotice(`Cycle settled · ${result.hash.slice(0, 8)}…`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Charge failed');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-stellar-cyan" />
        <p className="text-xs text-slate-400">Reading plan #{planId} from Soroban…</p>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="glass-panel mx-auto max-w-lg rounded-3xl p-8 text-center">
        <h1 className="text-lg font-bold text-white">Plan not found</h1>
        <p className="mt-2 text-xs text-slate-400">
          {error ?? `Plan #${planId} is not readable on this network.`}
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-xl border border-stellar-border px-4 py-2 text-xs font-semibold text-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
        </Link>
      </div>
    );
  }

  const isMerchant = address === plan.merchant;
  const approvedCycles = plan.amount > 0n ? allowance / plan.amount : 0n;
  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1.5 rounded-xl border border-stellar-border bg-stellar-card px-3 py-1.5 text-xs text-slate-300"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <section className="glass-panel rounded-3xl p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Plan #{plan.id.toString()}
            </span>
            <h1 className="mt-1 flex items-baseline gap-3 text-3xl font-black text-white sm:text-4xl">
              <span className="font-mono">
                {formatUnits(plan.amount, CONFIG.decimals)}
              </span>
              <span className="text-base font-semibold text-stellar-cyan">
                / {formatPeriod(plan.period)}
              </span>
            </h1>
            <p className="mt-2 flex items-center gap-2 text-xs text-slate-400">
              <Coins className="h-3.5 w-3.5" /> Merchant{' '}
              <span className="font-mono text-slate-200">
                {shortAddress(plan.merchant)}
              </span>
              {isMerchant && (
                <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold text-cyan-200">
                  you
                </span>
              )}
            </p>
          </div>
          <span
            className={
              plan.active
                ? 'rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold uppercase text-emerald-300'
                : 'rounded-full border border-slate-500/40 bg-slate-500/10 px-3 py-1 text-[11px] font-bold uppercase text-slate-400'
            }
          >
            {plan.active ? 'Accepting subscribers' : 'Retired'}
          </span>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Stat label="Trial" value={Number(plan.trialPeriod) ? formatPeriod(plan.trialPeriod) : 'None'} />
          <Stat
            label="Cycle cap"
            value={plan.maxCycles === 0 ? 'Open-ended' : `${plan.maxCycles} cycles`}
          />
          <Stat label="Subscribers" value={String(subs.length)} />
          <Stat
            label="Token"
            value={plan.token === CONFIG.defaultToken ? 'XLM (SAC)' : shortAddress(plan.token)}
          />
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-xs text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> {notice}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="glass-panel space-y-4 rounded-3xl p-6 sm:p-7">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-white">
              <Users className="h-4 w-4 text-stellar-cyan" /> Subscribers
            </h2>
            <span className="text-[11px] text-slate-500">
              the contract clock decides what is due
            </span>
          </div>

          {subs.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-stellar-border p-6 text-center text-xs text-slate-500">
              No subscriptions yet. Share this page to get the first one.
            </p>
          ) : (
            <ul className="space-y-2">
              {subs.map((sub) => {
                const progress = billingProgress(plan, sub, now);
                const isBusy = busy === `charge-${sub.id.toString()}`;
                return (
                  <li
                    key={sub.id.toString()}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stellar-border bg-stellar-dark/50 p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/subscriptions/${sub.id.toString()}`}
                          className="font-mono text-xs text-slate-200 hover:text-stellar-cyan"
                        >
                          #{sub.id.toString()} · {shortAddress(sub.subscriber)}
                        </Link>
                        <StatusBadge status={sub.status} />
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {sub.cyclesCharged} cycles ·{' '}
                        {formatUnits(sub.totalPaid, CONFIG.decimals)} settled
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void charge(sub)}
                      disabled={progress.dueCycles === 0 || isBusy}
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold ${
                        progress.dueCycles > 0
                          ? 'bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25'
                          : 'cursor-not-allowed border border-stellar-border text-slate-500'
                      }`}
                    >
                      {isBusy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Zap className="h-3 w-3" />
                      )}
                      {progress.dueCycles > 0
                        ? `Charge ${progress.dueCycles} due`
                        : 'Not due'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="space-y-6">
          <section className="glass-panel space-y-4 rounded-3xl p-6">
            <h2 className="flex items-center gap-2 text-sm font-bold text-white">
              <ShieldCheck className="h-4 w-4 text-stellar-cyan" /> Subscribe
            </h2>
            <p className="text-xs text-slate-400">
              You approve {APPROVAL_CYCLES} cycles of allowance to the Stanza
              contract. It can only pull one cycle per charge, and you can cancel
              or revoke at any time.
            </p>

            <div className="space-y-2 rounded-2xl border border-stellar-border bg-stellar-dark/50 p-3 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-400">Cycle price</span>
                <span className="font-mono text-slate-200">
                  {formatUnits(plan.amount, CONFIG.decimals)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Allowance</span>
                <span className="font-mono text-slate-200">
                  {formatUnits(allowance, CONFIG.decimals)} ({approvedCycles.toString()} cycles)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">First charge</span>
                <span className="font-mono text-slate-200">
                  {Number(plan.trialPeriod) > 0
                    ? `after ${formatPeriod(plan.trialPeriod)} trial`
                    : 'immediately'}
                </span>
              </div>
            </div>

            {isMerchant ? (
              <button
                type="button"
                onClick={() => void togglePlan()}
                disabled={busy === 'plan'}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-stellar-border bg-stellar-hover py-3 text-xs font-bold text-slate-200 disabled:opacity-50"
              >
                {busy === 'plan' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Power className="h-4 w-4" />
                )}
                {plan.active ? 'Retire this plan' : 'Re-enable this plan'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void subscribe()}
                disabled={!plan.active || busy === 'subscribe'}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-emerald-400 py-3 text-xs font-bold text-stellar-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'subscribe' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                {plan.active ? 'Approve & subscribe' : 'Plan retired'}
              </button>
            )}

            {!isConnected && (
              <p className="text-center text-[11px] text-slate-500">
                Connect Freighter to continue.
              </p>
            )}
          </section>

          <section className="glass-panel space-y-2 rounded-3xl p-6 text-[11px] text-slate-400">
            <h3 className="text-xs font-bold text-white">Verify independently</h3>
            <a
              href={`${CONFIG.explorerBase}/contract/${CONFIG.contractId}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 hover:text-stellar-cyan"
            >
              Contract on Stellar.Expert <ExternalLink className="h-3 w-3" />
            </a>
            <p>
              Plan state is stored in the contract&apos;s persistent storage, not in a
              database. Retiring a plan never edits existing subscriptions.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-stellar-border bg-stellar-dark/50 p-3">
      <span className="block text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="mt-0.5 block truncate font-semibold text-slate-200">{value}</span>
    </div>
  );
}
