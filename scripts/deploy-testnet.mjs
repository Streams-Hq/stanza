#!/usr/bin/env node
/**
 * Builds nothing — it deploys the compiled Stanza contract to Stellar testnet.
 *
 *   1. pnpm contract:build
 *   2. STELLAR_SECRET=S... pnpm deploy:testnet
 *
 * Without STELLAR_SECRET a throwaway testnet keypair is generated and funded
 * with Friendbot; the secret is printed once so you can keep using the deployer.
 * Deployment details are written to deployments/testnet.json.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  Account,
  Address,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';

const RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const PASSPHRASE =
  process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
const FRIENDBOT = process.env.FRIENDBOT_URL || 'https://friendbot.stellar.org';
const WASM_PATH =
  process.env.WASM_PATH ||
  'contracts/stanza/target/wasm32v1-none/release/stanza_subscriptions.wasm';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (!existsSync(WASM_PATH)) {
    throw new Error(
      `Missing ${WASM_PATH}. Run \`pnpm contract:build\` first (requires the wasm32v1-none target).`,
    );
  }

  const server = new rpc.Server(RPC_URL, {
    allowHttp: RPC_URL.startsWith('http://'),
  });

  let keypair;
  if (process.env.STELLAR_SECRET) {
    keypair = Keypair.fromSecret(process.env.STELLAR_SECRET);
  } else {
    keypair = Keypair.random();
    console.log(`Generated testnet deployer ${keypair.publicKey()}`);
    console.log(`Secret (store it if you want to reuse this account): ${keypair.secret()}`);
  }

  const publicKey = keypair.publicKey();

  let account;
  try {
    account = await server.getAccount(publicKey);
  } catch {
    console.log(`Funding ${publicKey} with Friendbot…`);
    const response = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(publicKey)}`);
    if (!response.ok) throw new Error(`Friendbot failed: ${response.status}`);
    await sleep(3000);
    account = await server.getAccount(publicKey);
  }

  const wasm = readFileSync(WASM_PATH);
  console.log(`Uploading ${WASM_PATH} (${(wasm.length / 1024).toFixed(1)} KiB)…`);

  const upload = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.uploadContractWasm({ wasm }))
    .setTimeout(180)
    .build();

  const uploadResult = await signAndSubmit(server, upload, keypair);
  const wasmHash = Buffer.from(scValToNative(uploadResult.returnValue)).toString('hex');
  console.log(`Wasm hash: ${wasmHash}`);

  account = await server.getAccount(publicKey);
  const salt = randomBytes(32);
  const create = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      Operation.createCustomContract({
        address: publicKey,
        wasmHash: Buffer.from(wasmHash, 'hex'),
        salt,
      }),
    )
    .setTimeout(180)
    .build();

  const createResult = await signAndSubmit(server, create, keypair);
  const contractId = Address.fromScVal(createResult.returnValue).toString();

  const deployment = {
    network: PASSPHRASE === Networks.TESTNET ? 'testnet' : PASSPHRASE,
    contractId,
    wasmHash,
    deployer: publicKey,
    rpcUrl: RPC_URL,
    deployedAt: new Date().toISOString(),
    wasm: WASM_PATH,
  };

  mkdirSync('deployments', { recursive: true });
  writeFileSync('deployments/testnet.json', `${JSON.stringify(deployment, null, 2)}\n`);

  console.log('\nContract deployed.');
  console.log(`STANZA_CONTRACT_ID=${contractId}`);
  console.log(`NEXT_PUBLIC_STANZA_CONTRACT_ID=${contractId}`);
  console.log(`\nWrote deployments/testnet.json`);
  console.log(
    `Explorer: https://stellar.expert/explorer/testnet/contract/${contractId}`,
  );
}

async function signAndSubmit(server, transaction, signer) {
  const prepared = await server.prepareTransaction(transaction);
  prepared.sign(signer);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    throw new Error(
      `Submission failed: ${JSON.stringify(sent.errorResult ?? sent.status)}`,
    );
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(2000);
    const result = await server.getTransaction(sent.hash);
    if (result.status === 'SUCCESS') return result;
    if (result.status === 'FAILED') {
      throw new Error(`Transaction failed on-chain: ${sent.hash}`);
    }
  }
  throw new Error(`Timed out waiting for ${sent.hash}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
