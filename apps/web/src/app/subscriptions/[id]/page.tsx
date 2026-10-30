'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  ExternalLink,
  History,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import {
  Plan,
  Subscription,
  billingProgress,
  formatCountdown,
  formatPeriod,
  formatUnits,
} from '@stanza/sdk';
import {
  ChargeRecord,
  EventRecord,
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

export default function SubscriptionDetailPage() {
  const params = useParams();
  const subId = params?.id as string;

  const { isConnected, address, connect, signTx } = useFreighter();

  const [sub, setSub] = useState<Subscription | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [charges, setCharges] = useState<ChargeRecord[]>([]);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = getStanzaClient();

      let loadedSub: Subscription | null = null;
      const cached = await api.subscription(subId);
      if (cached?.subscription) loadedSub = subscriptionFromRecord(cached.subscription);
      if (!loadedSub) loadedSub = await client.getSubscription(BigInt(subId));
      setSub(loadedSub);

      let loadedPlan: Plan | null = null;
      const cachedPlan = await api.plan(loadedSub.planId.toString());
      if (cachedPlan?.plan) loadedPlan = planFromRecord(cachedPlan.plan);
      if (!loadedPlan) loadedPlan = await client.getPlan(loadedSub.planId);
      setPlan(loadedPlan);

      if (address) {
        try {
          setAllowance(
            await client.allowance(loadedPlan.token, address, CONFIG.contractId),
          );
        } catch {
          setAllowance(0n);
        }
      }

      const cachedEvents = await api.events(subId);
      setEvents(cachedEvents?.events ?? []);
      const cachedCharges = await api.charges(subId);
      setCharges(cachedCharges?.charges ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this subscription');
    } finally {
      setLoading(false);
    }
  }, [subId, address]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const progress = useMemo(
    () =>
      plan && sub
        ? billingProgress(plan, sub, now)
        : { dueCycles: 0, cycleProgress: 0, secondsUntilNext: 0, cyclesRemaining: null },
    [plan, sub, now],
  );

  const runAction = async (
    label: string,
    build: () => Promise<{ toXDR(): string }>,
    successMessage: string,
  ) => {
    if (!isConnected || !address) {
      await connect();
      return;
    }
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const tx = await build();
      const signed = await signTx(tx.toXDR());
      const result = await submitSignedTransaction(signed);
      setNotice(`${successMessage} · ${result.hash.slice(0, 8)}…`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-stellar-cyan" />
        <p className="text-xs text-slate-400">Reading subscription #{subId}…</p>
      </div>
    );
  }

  if (!sub || !plan) {
    return (
      <div className="glass-panel mx-auto max-w-lg rounded-3xl p-8 text-center">
        <h1 className="text-lg font-bold text-white">Subscription not found</h1>
        <p className="mt-2 text-xs text-slate-400">
          {error ?? `Subscription #${subId} is not readable on this network.`}
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

  const isSubscriber = address === sub.subscriber;
  const isMerchant = address === plan.merchant;
  const client = getStanzaClient();
  const approvedCycles = plan.amount > 0n ? allowance / plan.amount : 0n;
  const lifetime = plan.maxCycles === 0 ? null : plan.amount * BigInt(plan.maxCycles);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
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

      <section className="glass-panel relative overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Subscription #{sub.id.toString()} · plan #{plan.id.toString()}
            </span>
            <h1 className="mt-1 flex items-baseline gap-3 text-3xl font-black text-white">
              <span className="font-mono">{formatUnits(plan.amount, CONFIG.decimals)}</span>
              <span className="text-sm font-semibold text-stellar-cyan">
                every {formatPeriod(plan.period)}
              </span>
            </h1>
            <p className="mt-2 text-xs text-slate-400">
              {shortAddress(sub.subscriber)} → {shortAddress(plan.merchant)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={sub.status} />
            {isSubscriber && (
              <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold text-cyan-200">
                you
              </span>
            )}
            {isMerchant && (
              <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
                merchant
              </span>
            )}
          </div>
        </div>

        <div className="relative z-10 mt-6 space-y-2">
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>
              {progress.dueCycles > 0
                ? `${progress.dueCycles} cycle${progress.dueCycles > 1 ? 's' : ''} due now`
                : `Next charge in ${formatCountdown(progress.secondsUntilNext)}`}
            </span>
            <span>{sub.cyclesCharged} cycles settled</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-stellar-border/70">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all"
              style={{ width: `${Math.round(progress.cycleProgress * 100)}%` }}
            />
          </div>
        </div>

        <div className="relative z-10 mt-6 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Stat label="Paid to date" value={formatUnits(sub.totalPaid, CONFIG.decimals)} />
          <Stat
            label="Next charge"
            value={new Date(Number(sub.nextChargeAt) * 1000).toLocaleDateString()}
          />
          <Stat
            label="Remaining"
            value={
              progress.cyclesRemaining === null
                ? 'Open-ended'
                : `${progress.cyclesRemaining} cycles`
            }
          />
          <Stat
            label="Lifetime cap"
            value={lifetime === null ? 'None' : formatUnits(lifetime, CONFIG.decimals)}
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

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="glass-panel space-y-4 rounded-3xl p-6">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <CalendarClock className="h-4 w-4 text-stellar-cyan" /> Billing
          </h2>
          <div className="space-y-2 rounded-2xl border border-stellar-border bg-stellar-dark/50 p-4 text-[11px]">
            <Row label="Started" value={new Date(Number(sub.startedAt) * 1000).toLocaleString()} />
            <Row
              label="Next billable"
              value={new Date(Number(sub.nextChargeAt) * 1000).toLocaleString()}
            />
            <Row label="Cycles charged" value={String(sub.cyclesCharged)} />
            <Row label="Allowance left" value={`${formatUnits(allowance, CONFIG.decimals)} (${approvedCycles.toString()} cycles)`} />
            <Row
              label="First cycle"
              value={Number(plan.trialPeriod) ? `after ${formatPeriod(plan.trialPeriod)} trial` : 'on subscribe'}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                void runAction(
                  'charge',
                  () => client.chargeTx({ subscriptionId: sub.id }, address ?? sub.subscriber),
                  'Cycle settled',
                )
              }
              disabled={progress.dueCycles === 0 || busy !== null}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[11px] font-bold ${
                progress.dueCycles > 0
                  ? 'bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25'
                  : 'cursor-not-allowed border border-stellar-border text-slate-500'
              }`}
            >
              {busy === 'charge' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              {progress.dueCycles > 0 ? 'Charge now' : 'Nothing due'}
            </button>

            {isSubscriber && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    void runAction(
                      sub.status === 'paused' ? 'resume' : 'pause',
                      () =>
                        sub.status === 'paused'
                          ? client.resumeTx({ subscriptionId: sub.id, subscriber: sub.subscriber })
                          : client.pauseTx({ subscriptionId: sub.id, subscriber: sub.subscriber }),
                      sub.status === 'paused' ? 'Resumed' : 'Paused',
                    )
                  }
                  disabled={busy !== null || (sub.status !== 'active' && sub.status !== 'paused')}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-stellar-border bg-stellar-hover px-3 py-2.5 text-[11px] font-bold text-slate-200 disabled:opacity-40"
                >
                  {busy === 'pause' || busy === 'resume' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : sub.status === 'paused' ? (
                    <Play className="h-3.5 w-3.5" />
                  ) : (
                    <Pause className="h-3.5 w-3.5" />
                  )}
                  {sub.status === 'paused' ? 'Resume' : 'Pause'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void runAction(
                      'cancel',
                      () => client.cancelTx({ subscriptionId: sub.id, subscriber: sub.subscriber }),
                      'Subscription canceled',
                    )
                  }
                  disabled={busy !== null || sub.status === 'canceled'}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-[11px] font-bold text-rose-300 disabled:opacity-40"
                >
                  {busy === 'cancel' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CircleSlash className="h-3.5 w-3.5" />
                  )}
                  Cancel
                </button>
              </>
            )}
          </div>
        </section>

        <section className="glass-panel space-y-4 rounded-3xl p-6">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <ShieldCheck className="h-4 w-4 text-stellar-cyan" /> Allowance
          </h2>
          <p className="text-xs text-slate-400">
            The contract can only pull one cycle per charge, up to the allowance you
            approved. Funds stay in your wallet until a charge happens.
          </p>
          <div className="rounded-2xl border border-stellar-border bg-stellar-dark/50 p-4 text-[11px]">
            <Row label="Approved" value={formatUnits(allowance, CONFIG.decimals)} />
            <Row label="Cycles covered" value={approvedCycles.toString()} />
            <Row label="Price per cycle" value={formatUnits(plan.amount, CONFIG.decimals)} />
          </div>
          {isSubscriber ? (
            <button
              type="button"
              onClick={() =>
                void runAction(
                  'approve',
                  async () => {
                    const latest = await client.server.getLatestLedger();
                    return client.approveAllowanceTx({
                      token: plan.token,
                      owner: sub.subscriber,
                      spender: CONFIG.contractId,
                      amount: plan.amount * BigInt(APPROVAL_CYCLES),
                      expirationLedger: latest.sequence + ALLOWANCE_LEDGER_WINDOW,
                    });
                  },
                  'Allowance updated',
                )
              }
              disabled={busy !== null || sub.status !== 'active'}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 py-3 text-xs font-bold text-stellar-dark disabled:opacity-40"
            >
              {busy === 'approve' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              Approve {APPROVAL_CYCLES} more cycles
            </button>
          ) : (
            <p className="text-[11px] text-slate-500">
              Only the subscriber can change the allowance.
            </p>
          )}
        </section>
      </div>

      <section className="glass-panel space-y-4 rounded-3xl p-6">
        <h2 className="flex items-center gap-2 text-sm font-bold text-white">
          <History className="h-4 w-4 text-stellar-cyan" /> Settlement history
        </h2>
        {charges.length === 0 && events.length === 0 ? (
          <p className="text-xs text-slate-500">
            No charges yet. Each settlement emits a `charged` event with the amount,
            cycle number, and next due timestamp.
          </p>
        ) : (
          <ul className="space-y-2 text-[11px]">
            {charges.map((charge) => (
              <li
                key={`charge-${charge.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stellar-border bg-stellar-dark/50 p-3"
              >
                <span className="font-semibold text-emerald-300">
                  Cycle {charge.cycles_charged} · {formatUnits(BigInt(charge.amount), CONFIG.decimals)}
                </span>
                <span className="text-slate-500">
                  ledger {charge.ledger}
                  {charge.tx_hash && (
                    <a
                      href={explorerTx(charge.tx_hash)}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 inline-flex items-center gap-1 text-stellar-cyan hover:underline"
                    >
                      tx <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </span>
              </li>
            ))}
            {charges.length === 0 &&
              events.map((event) => (
                <li
                  key={`event-${event.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stellar-border bg-stellar-dark/50 p-3"
                >
                  <span className="font-semibold text-slate-200">{event.event_type}</span>
                  <span className="text-slate-500">ledger {event.ledger}</span>
                </li>
              ))}
          </ul>
        )}
      </section>

      <p className="text-center text-[11px] text-slate-500">
        Every number on this page is derived from contract state; the indexer only
        caches the event history.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-stellar-border bg-stellar-dark/50 p-3">
      <span className="block text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="mt-0.5 block truncate font-mono text-sm font-semibold text-slate-200">
        {value}
      </span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className="truncate font-mono text-slate-200">{value}</span>
    </div>
  );
}
