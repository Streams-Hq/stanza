export const CONFIG = {
  networkPassphrase:
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ||
    'Test SDF Network ; September 2015',
  rpcUrl:
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
  contractId: process.env.NEXT_PUBLIC_STANZA_CONTRACT_ID || '',
  indexerUrl: process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:3001',
  defaultToken:
    process.env.NEXT_PUBLIC_DEFAULT_TOKEN_ADDRESS ||
    'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  decimals: Number(process.env.NEXT_PUBLIC_TOKEN_DECIMALS || '7'),
  explorerBase:
    process.env.NEXT_PUBLIC_EXPLORER_BASE ||
    'https://stellar.expert/explorer/testnet',
} as const;

/** Number of cycles the subscriber pre-approves when subscribing. */
export const APPROVAL_CYCLES = 3;

/** Ledger lifetime of an allowance: ~30 days of 5-second ledgers. */
export const ALLOWANCE_LEDGER_WINDOW = 17_280 * 30;
