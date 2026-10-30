import Link from 'next/link';
import { ArrowUpRight, Coins, Repeat } from 'lucide-react';
import { Plan, formatPeriod, formatUnits } from '@stanza/sdk';
import { shortAddress } from '@/lib/api';
import { CONFIG } from '@/lib/config';

export default function PlanCard({ plan }: { plan: Plan }) {
  return (
    <Link
      href={`/plans/${plan.id}`}
      className="glass-panel glass-panel-hover group flex flex-col justify-between rounded-3xl p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Plan #{plan.id.toString()}
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-black text-white">
              {formatUnits(plan.amount, CONFIG.decimals)}
            </span>
            <span className="text-xs font-semibold text-stellar-cyan">
              / {formatPeriod(plan.period)}
            </span>
          </div>
        </div>
        <span
          className={
            plan.active
              ? 'rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300'
              : 'rounded-full border border-slate-500/40 bg-slate-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-400'
          }
        >
          {plan.active ? 'Live' : 'Retired'}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-stellar-border/70 bg-stellar-dark/50 p-2.5">
          <span className="block text-[10px] uppercase tracking-wide text-slate-500">
            Trial
          </span>
          <span className="font-semibold text-slate-200">
            {Number(plan.trialPeriod) > 0 ? formatPeriod(plan.trialPeriod) : 'None'}
          </span>
        </div>
        <div className="rounded-xl border border-stellar-border/70 bg-stellar-dark/50 p-2.5">
          <span className="block text-[10px] uppercase tracking-wide text-slate-500">
            Commitment
          </span>
          <span className="font-semibold text-slate-200">
            {plan.maxCycles === 0 ? 'Open-ended' : `${plan.maxCycles} cycles`}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-stellar-border/60 pt-3 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5 font-mono">
          <Coins className="h-3 w-3" />
          {shortAddress(plan.merchant)}
        </span>
        <span className="flex items-center gap-1 font-semibold text-stellar-cyan">
          <Repeat className="h-3 w-3" />
          Subscribe
          <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
