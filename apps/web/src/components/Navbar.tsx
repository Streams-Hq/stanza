'use client';

import Link from 'next/link';
import { BookOpen, Github, LayoutDashboard, PlusCircle, Repeat } from 'lucide-react';
import WalletButton from './WalletButton';

const links = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/plans/new', label: 'New plan', icon: PlusCircle },
  { href: 'https://stanza-labs.github.io/stanza/', label: 'Docs', icon: BookOpen },
  { href: 'https://github.com/stanza-labs/stanza', label: 'GitHub', icon: Github },
];

export default function Navbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-stellar-border/60 bg-stellar-dark/80 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-emerald-400 text-stellar-dark shadow-lg shadow-cyan-500/20">
            <Repeat className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <span className="text-lg font-black tracking-tight text-white">Stanza</span>
          <span className="hidden rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300 sm:inline">
            testnet
          </span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              target={href.startsWith('http') ? '_blank' : undefined}
              rel={href.startsWith('http') ? 'noreferrer' : undefined}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 transition-colors hover:bg-stellar-hover hover:text-white"
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          ))}
        </div>

        <WalletButton />
      </nav>
    </header>
  );
}
