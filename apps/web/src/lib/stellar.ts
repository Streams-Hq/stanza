import { StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { StanzaClient } from '@stanza/sdk';
import { CONFIG } from './config';

let clientInstance: StanzaClient | null = null;

export function getStanzaClient(): StanzaClient {
  if (!clientInstance) {
    clientInstance = new StanzaClient({
      rpcUrl: CONFIG.rpcUrl,
      networkPassphrase: CONFIG.networkPassphrase,
      contractId: CONFIG.contractId,
    });
  }
  return clientInstance;
}

export function isValidStellarAddress(address: string): boolean {
  return Boolean(address) && StrKey.isValidEd25519PublicKey(address);
}

export function isValidContractAddress(address: string): boolean {
  return Boolean(address) && StrKey.isValidContract(address);
}

/** Polls Soroban RPC until the submitted transaction is final. */
export async function submitSignedTransaction(
  signedTxXdr: string,
): Promise<{ hash: string; status: string }> {
  const client = getStanzaClient();
  const tx = TransactionBuilder.fromXDR(signedTxXdr, CONFIG.networkPassphrase);
  const send = await client.server.sendTransaction(tx);

  if (send.status === 'ERROR') {
    throw new Error(
      `Submission failed: ${'errorResult' in send ? JSON.stringify(send.errorResult) : send.status}`,
    );
  }

  for (let attempt = 0; attempt < 15; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const result = await client.server.getTransaction(send.hash);

    if (result.status === 'SUCCESS') {
      return { hash: send.hash, status: 'SUCCESS' };
    }
    if (result.status === 'FAILED') {
      throw new Error(`Transaction failed on-chain (${send.hash})`);
    }
  }

  throw new Error(`Timed out waiting for ${send.hash}`);
}

export const explorerTx = (hash: string): string =>
  `${CONFIG.explorerBase}/tx/${hash}`;

export const explorerContract = (id: string): string =>
  `${CONFIG.explorerBase}/contract/${id}`;
