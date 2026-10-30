'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Coins,
  ExternalLink,
  Info,
  Layers,
  Loader2,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { formatPeriod, formatUnits, parseUnits } from '@stanza/sdk';
import { useFreighter } from '@/hooks/useFreighter';
import { CONFIG } from '@/lib/config';
import {
  explorerTx,
  getStanzaClient,
  isValidContractAddress,
  isValidStellarAddress,
  submitSignedTransaction,
} from '@/lib/stellar';

const PERIOD_PRESETS = [
  { label: '7 days', seconds: 7 * 86_400 },
  { label: '30 days', seconds: 30 * 86_400 },
  { label: '90 days', seconds: 90 * 86_400 },
  { label: '1 year', seconds: 365 * 86_400 },
];

const TRIAL_PRESETS = [
  { label: 'None', seconds: 0 },
  { label: '7 days', seconds: 7 * 86_400 },
  { label: '14 days', seconds: 14 * 86_400 },
  { label: '30 days', seconds: 30 * 86_400 },
];

const CYCLE_PRESETS = [
  { label: 'Open-ended', cycles: 0 },
  { label: '12 cycles', cycles: 12 },
  { label: '24 cycles', cycles: 24 },
];

export default function CreatePlanPage() {
  const router = useRouter();
  const { isConnected, address, connect, signTx } = useFreighter();

  const [amount, setAmount] = useState('');
  const [token, setToken] = useState(CONFIG.defaultToken);
  const [customToken, setCustomToken] = useState(false);
  const [period, setPeriod] = useState(PERIOD_PRESETS[1].seconds);
  const [trial, setTrial] = useState(0);
  const [maxCycles, setMaxCycles] = useState(0);

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ planId: bigint; hash: string } | null>(null);

  const parsedAmount = useMemo(() => {
    try {
      return amount ? parseUnits(amount, CONFIG.decimals) : 0n;
    } catch {
      return 0n;
    }
  }, [amount]);

  const tokenValid = isValidContractAddress(token);
  const amountValid = parsedAmount > 0n;
  const canSubmit = tokenValid && amountValid && period > 0 && !busy;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!isConnected || !address) {
      await connect();
      return;
    }
    if (!tokenValid) {
      setError('Enter a valid SEP-41 token contract address (C…)');
      return;
    }
    if (!amountValid) {
      setError('Price per cycle must be greater than zero');
      return;
    }

    setBusy(true);
    try {
      const client = getStanzaClient();
      setStep('Building the plan transaction…');
      const tx = await client.createPlanTx({
        merchant: address,
        token,
        amount: parsedAmount,
        period: BigInt(period),
        trialPeriod: BigInt(trial),
        maxCycles,
      });

      setStep('Waiting for your signature…');
      const signed = await signTx(tx.toXDR());

      setStep('Submitting to Stellar testnet…');
      const result = await submitSignedTransaction(signed);
      const count = await client.planCount();
      const planId = count > 0n ? count - 1n : 0n;

      setSuccess({ planId, hash: result.hash });
      setStep('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the plan');
    } finally {
      setBusy(false);
    }
  };

  if (success) {
    return (
      <div className="glass-panel mx-auto max-w-xl rounded-3xl p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold text-white">Plan #{success.planId.toString()} is live</h1>
        <p className="mt-2 text-xs text-slate-400">
          Share the link with subscribers. They approve a capped allowance, then the
          contract can charge one cycle at a time.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => router.push(`/plans/${success.planId}`)}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-4 py-2.5 text-xs font-bold text-stellar-dark"
          >
            Open plan <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <a
            href={explorerTx(success.hash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-stellar-border px-4 py-2.5 text-xs font-semibold text-slate-200"
          >
            View transaction <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
          Publish a <span className="text-gradient-cyan">plan</span>
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          A plan is a reusable billing template stored on Soroban. You only pay the
          network fee; Stanza takes no cut.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-6">
        <section className="glass-panel space-y-5 rounded-3xl p-6 sm:p-7">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <Coins className="h-4 w-4 text-stellar-cyan" /> Price and asset
          </h2>

          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Asset</span>
            <div className="flex rounded-xl border border-stellar-border bg-stellar-hover p-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  setCustomToken(false);
                  setToken(CONFIG.defaultToken);
                }}
                className={`rounded-lg px-3 py-1 font-semibold ${
                  !customToken
                    ? 'bg-stellar-cyan font-bold text-stellar-dark'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                XLM (SAC)
              </button>
              <button
                type="button"
                onClick={() => {
                  setCustomToken(true);
                  setToken('');
                }}
                className={`rounded-lg px-3 py-1 font-semibold ${
                  customToken
                    ? 'bg-stellar-cyan font-bold text-stellar-dark'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Custom SEP-41
              </button>
            </div>
          </div>

          {customToken && (
            <div className="space-y-1.5">
              <label htmlFor="token" className="text-xs text-slate-400">
                Token contract (C…)
              </label>
              <input
                id="token"
                value={token}
                onChange={(e) => setToken(e.target.value.trim())}
                placeholder="C…"
                className="w-full rounded-2xl border border-stellar-border bg-stellar-dark/90 px-4 py-3 font-mono text-xs text-white placeholder-slate-500 focus:border-stellar-cyan focus:outline-none"
              />
              {token && !tokenValid && (
                <p className="text-[11px] text-rose-300">Not a valid contract address</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="amount" className="text-xs text-slate-400">
              Price per cycle
            </label>
            <div className="relative">
              <input
                id="amount"
                inputMode="decimal"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                className="w-full rounded-2xl border border-stellar-border bg-stellar-dark/90 px-4 py-3.5 pr-24 font-mono text-lg font-semibold text-white placeholder-slate-500 focus:border-stellar-cyan focus:outline-none"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-stellar-cyan">
                {customToken ? 'TOKEN' : 'XLM'}
              </span>
            </div>
            {parsedAmount > 0n && (
              <p className="text-[11px] text-slate-500">
                {formatUnits(parsedAmount, CONFIG.decimals)} per cycle ·{' '}
                {maxCycles > 0
                  ? `${formatUnits(parsedAmount * BigInt(maxCycles), CONFIG.decimals)} committed`
                  : 'no cap on total billing'}
              </p>
            )}
          </div>
        </section>

        <section className="glass-panel space-y-5 rounded-3xl p-6 sm:p-7">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <CalendarClock className="h-4 w-4 text-stellar-cyan" /> Cycle length
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PERIOD_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setPeriod(preset.seconds)}
                className={`rounded-xl border py-2.5 text-xs font-semibold transition-colors ${
                  period === preset.seconds
                    ? 'border-stellar-cyan bg-stellar-cyan/15 text-stellar-cyan'
                    : 'border-stellar-border bg-stellar-hover/40 text-slate-400 hover:text-white'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">
            A cycle is charged every {formatPeriod(period)}. Charges pull from a
            SEP-41 allowance; nothing is prepaid to Stanza.
          </p>
        </section>

        <section className="glass-panel space-y-5 rounded-3xl p-6 sm:p-7">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <Sparkles className="h-4 w-4 text-stellar-cyan" /> Trial and commitment
          </h2>

          <div className="space-y-2">
            <span className="text-xs text-slate-400">Free trial before the first charge</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TRIAL_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setTrial(preset.seconds)}
                  className={`rounded-xl border py-2 text-xs font-semibold ${
                    trial === preset.seconds
                      ? 'border-stellar-cyan bg-stellar-cyan/15 text-stellar-cyan'
                      : 'border-stellar-border bg-stellar-hover/40 text-slate-400 hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs text-slate-400">Cycle cap</span>
            <div className="grid grid-cols-3 gap-2">
              {CYCLE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setMaxCycles(preset.cycles)}
                  className={`rounded-xl border py-2 text-xs font-semibold ${
                    maxCycles === preset.cycles
                      ? 'border-stellar-cyan bg-stellar-cyan/15 text-stellar-cyan'
                      : 'border-stellar-border bg-stellar-hover/40 text-slate-400 hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              A cap lets subscribers budget: after {maxCycles || '∞'} charges the
              contract marks the subscription completed.
            </p>
          </div>
        </section>

        <div className="flex items-start gap-2 rounded-2xl border border-stellar-border bg-stellar-card/60 p-4 text-[11px] text-slate-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-stellar-cyan" />
          Plan parameters are immutable once published. Retire the plan to stop new
          charges, then publish a new one if the price changes.
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-300">
            {error}
          </div>
        )}

        {!isConnected ? (
          <button
            type="button"
            onClick={() => void connect()}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-500/40 bg-gradient-to-r from-cyan-500/20 to-emerald-500/20 py-4 text-sm font-bold text-cyan-200"
          >
            <Wallet className="h-4 w-4" /> Connect Freighter to publish
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSubmit}
            className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold transition-opacity ${
              canSubmit
                ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-stellar-dark shadow-xl shadow-cyan-500/20 hover:opacity-95'
                : 'cursor-not-allowed border border-stellar-border bg-stellar-hover text-slate-500'
            }`}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {step || 'Working…'}
              </>
            ) : (
              <>
                <Layers className="h-4 w-4" /> Publish plan
              </>
            )}
          </button>
        )}

        {isStellarAddressHint(address) && (
          <p className="text-center text-[11px] text-slate-500">
            Merchant: <span className="font-mono">{address}</span>
          </p>
        )}
      </form>
    </div>
  );
}

function isStellarAddressHint(address: string | null): boolean {
  return Boolean(address && isValidStellarAddress(address));
}
