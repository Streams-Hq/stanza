'use client';

import { AlertTriangle, Loader2, LogOut, Wallet } from 'lucide-react';
import { formatAddress, useFreighter } from '@/hooks/useFreighter';

export default function WalletButton() {
  const { isInstalled, isConnected, address, isLoading, error, connect, disconnect } =
    useFreighter();

  if (isLoading) {
    return (
      <span className="flex items-center gap-2 rounded-xl border border-stellar-border bg-stellar-card px-3 py-2 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Wallet
      </span>
    );
  }

  if (!isInstalled) {
    return (
      <a
        href="https://www.freighter.app"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-400/20"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Install Freighter
      </a>
    );
  }

  if (!isConnected) {
    return (
      <button
        type="button"
        onClick={() => void connect()}
        className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-3.5 py-2 text-xs font-bold text-stellar-dark shadow-md shadow-cyan-500/20 transition-opacity hover:opacity-90"
      >
        <Wallet className="h-3.5 w-3.5" />
        Connect wallet
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 font-mono text-xs text-emerald-200"
        title={address ?? ''}
      >
        {formatAddress(address)}
      </span>
      <button
        type="button"
        onClick={disconnect}
        title="Disconnect"
        className="rounded-xl border border-stellar-border p-2 text-slate-400 hover:text-white"
      >
        <LogOut className="h-3.5 w-3.5" />
      </button>
      {error && <span className="hidden text-[10px] text-rose-300 lg:inline">{error}</span>}
    </div>
  );
}
