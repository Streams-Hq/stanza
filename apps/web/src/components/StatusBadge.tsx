import clsx from 'clsx';
import { SubStatus } from '@stanza/sdk';

const styles: Record<SubStatus, string> = {
  active: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  paused: 'border-amber-400/40 bg-amber-400/10 text-amber-200',
  canceled: 'border-rose-400/40 bg-rose-400/10 text-rose-300',
  completed: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
};

export default function StatusBadge({ status }: { status: SubStatus }) {
  return (
    <span
      className={clsx(
        'rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
        styles[status],
      )}
    >
      {status}
    </span>
  );
}
