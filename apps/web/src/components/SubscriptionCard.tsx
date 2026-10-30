import Link from 'next/link';
import { ArrowUpRight, CalendarClock, Coins } from 'lucide-react';
import {
  Plan,
  Subscription,
  formatCountdown,
  formatUnits,
  billingProgress,
} from '@stanza/sdk';
import StatusBadge from './StatusBadge';
import { shortAddress } from '@/lib/api';
import { CONFIG } from '@/lib/config';

export default function SubscriptionCard({
  subscription,
  plan,
  perspective,
}: {
  subscription: Subscription;
  plan?: Plan;
  perspective: 'subscriber' | 'merchant';
}) {
  const now = Math.floor(Date.now() / 1000);
  const progress = plan
    ? billingProgress(plan, subscription, now)
    : { dueCycles: 0, cycleProgress: 0, secondsUntilNext: 0, cyclesRemaining: null };

  return (
    <Link
      href={`/subscriptions/${subscription.id}`}
      className="glass-panel glass-panel-hover group block rounded-3xl p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Subscription #{subscription.id.toString()}
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-black text-white">
              {plan ? formatUnits(plan.amount, CONFIG.decimals) : '—'}
            </span>
            <span className="text-xs text-slate-400">
              {plan ? `per ${formatCycle(plan)}` : ''}
            </span>
          </div>
        </div>
        <StatusBadge status={subscription.status} />
      </div>

      <div className="mt-4 space-y-2 text-xs text-slate-400">
        <div className="flex items-center justify-between">
          <span>Plan</span>
          <span className="font-mono text-slate-200">#{subscription.planId.toString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>{perspective === 'subscriber' ? 'Merchant' : 'Subscriber'}</span>
          <span className="font-mono text-slate-200">
            {shortAddress(
              perspective === 'subscriber' ? plan?.merchant ?? '—' : subscription.subscriber,
            )}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Charged</span>
          <span className="font-mono text-slate-200">
            {subscription.cyclesCharged} cycles ·{' '}
            {formatUnits(subscription.totalPaid, CONFIG.decimals)}
          </span>
        </div>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-stellar-border/70">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400"
          style={{ width: `${Math.round(progress.cycleProgress * 100)}%` }}
        />
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1.5 text-slate-400">
          <CalendarClock className="h-3 w-3" />
          {progress.dueCycles > 0
            ? `${progress.dueCycles} cycle${progress.dueCycles > 1 ? 's' : ''} due`
            : `Next in ${formatCountdown(progress.secondsUntilNext)}`}
        </span>
        <span className="flex items-center gap-1 font-semibold text-stellar-cyan">
          <Coins className="h-3 w-3" />
          Manage
          <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

function formatCycle(plan: Plan): string {
  const seconds = Number(plan.period);
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${seconds}s`;
}
