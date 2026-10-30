import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';
import { CONFIG } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Stanza — recurring subscriptions on Stellar',
  description:
    'Non-custodial recurring payments on Stellar Soroban. Subscribers keep their funds until each cycle is charged; merchants get predictable billing without custody.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-stellar-dark text-slate-100 antialiased selection:bg-cyan-500/20 selection:text-cyan-300">
        <div className="relative flex min-h-screen flex-col">
          <div className="pointer-events-none fixed inset-0 z-0 bg-brand-glow opacity-80" />
          <Navbar />
          <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
            {children}
          </main>
          <footer className="relative z-10 border-t border-stellar-border/50 py-6 text-xs text-slate-500">
            <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 sm:flex-row">
              <p>Stanza · recurring subscriptions settled on Stellar Soroban</p>
              <div className="flex items-center gap-4">
                <a
                  href={`${CONFIG.explorerBase}/contract/${CONFIG.contractId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="transition-colors hover:text-stellar-cyan"
                >
                  Contract
                </a>
                <a
                  href="https://github.com/Streams-Hq/stanza"
                  target="_blank"
                  rel="noreferrer"
                  className="transition-colors hover:text-stellar-cyan"
                >
                  Source
                </a>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
