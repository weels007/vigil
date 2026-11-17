import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';

/**
 * The Vigil contract on GenLayer Studionet.
 *
 * This is hard-set on purpose: the address is part of the deployed product,
 * never an environment variable. The Studionet workflow rewrites this line
 * after a successful deployment.
 */
export const CONTRACT_ADDRESS = '0x72c10e377f8aA2B8a25FDb94Fd36Ae41D13e3b17';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
// Widen the literal before comparing: once an address is recorded, the two
// literal types no longer overlap and TypeScript rejects the comparison.
export const HAS_CONTRACT = (CONTRACT_ADDRESS as string) !== ZERO_ADDRESS;

export const STUDIONET_CHAIN_ID = 61999;
export const STUDIONET_CHAIN_ID_HEX = '0xf22f';
export const STUDIONET_RPC = 'https://studio.genlayer.com/api';
export const STUDIONET_EXPLORER = 'https://explorer-studio.genlayer.com';

export const STUDIONET_CHAIN_PARAMS = {
  chainId: STUDIONET_CHAIN_ID_HEX,
  chainName: 'GenLayer Studionet',
  nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
  rpcUrls: [STUDIONET_RPC],
  blockExplorerUrls: [STUDIONET_EXPLORER],
};

export interface EthereumProvider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

interface ReadArgs {
  address: string;
  functionName: string;
  args: unknown[];
  transactionHashVariant: TransactionHashVariant;
}

interface WriteArgs {
  address: string;
  functionName: string;
  args: unknown[];
  value?: bigint;
}

interface WaitArgs {
  hash: `0x${string}`;
  status?: string;
  interval?: number;
  retries?: number;
}

export interface TxReceipt {
  statusName?: string;
  txExecutionResultName?: string;
  txDataDecoded?: { contractAddress?: string } | null;
  data?: Record<string, unknown> | null;
  [key: string]: unknown;
}

interface GenClient {
  readContract(args: ReadArgs): Promise<unknown>;
  writeContract(args: WriteArgs): Promise<`0x${string}`>;
  waitForTransactionReceipt(args: WaitArgs): Promise<TxReceipt>;
}

const factory = createClient as unknown as (config: Record<string, unknown>) => GenClient;

export const readClient = factory({ chain: studionet });

export function getProvider(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  return window.ethereum ?? null;
}

export function explorerAddress(address: string): string {
  return `${STUDIONET_EXPLORER}/address/${address}`;
}

export function explorerTx(hash: string): string {
  return `${STUDIONET_EXPLORER}/tx/${hash}`;
}

export async function ensureStudionet(provider: EthereumProvider): Promise<void> {
  const current = await provider.request({ method: 'eth_chainId' });
  if (typeof current === 'string' && current.toLowerCase() === STUDIONET_CHAIN_ID_HEX) return;
  if (typeof current === 'number' && current === STUDIONET_CHAIN_ID) return;
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: STUDIONET_CHAIN_ID_HEX }],
    });
  } catch (error) {
    const code = (error as { code?: number } | null)?.code;
    if (code === 4902 || code === -32603) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [STUDIONET_CHAIN_PARAMS],
      });
      return;
    }
    throw new Error('Switch your wallet to GenLayer Studionet (chain 61999) and try again.');
  }
}

export async function connectWallet(): Promise<`0x${string}`> {
  const provider = getProvider();
  if (!provider) {
    throw new Error('No browser wallet was found. Open Vigil in a wallet browser or install one.');
  }
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('The wallet returned no account.');
  }
  await ensureStudionet(provider);
  return accounts[0] as `0x${string}`;
}

export async function readContract<T>(functionName: string, args: unknown[] = []): Promise<T> {
  if (!HAS_CONTRACT) {
    throw new Error('Vigil is not deployed yet. The contract address has not been recorded.');
  }
  const value = await readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    transactionHashVariant: TransactionHashVariant.LATEST_NONFINAL,
  });
  return value as unknown as T;
}

function createWriteClient(address: `0x${string}`): GenClient {
  const provider = getProvider();
  if (!provider) {
    throw new Error('No browser wallet was found. Open Vigil in a wallet browser or install one.');
  }
  return factory({ chain: studionet, account: address, provider });
}

export async function sendWrite(
  address: `0x${string}`,
  functionName: string,
  args: unknown[],
  value: bigint = 0n,
): Promise<`0x${string}`> {
  if (!HAS_CONTRACT) {
    throw new Error('Vigil is not deployed yet. The contract address has not been recorded.');
  }
  const client = createWriteClient(address);
  return client.writeContract({ address: CONTRACT_ADDRESS, functionName, args, value });
}

export async function waitForOutcome(hash: `0x${string}`): Promise<TxReceipt> {
  const receipt = await readClient.waitForTransactionReceipt({
    hash,
    status: 'ACCEPTED',
    interval: 3000,
    retries: 200,
  });
  if (receipt.txExecutionResultName && receipt.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
    if (receipt.txExecutionResultName === 'NONDET_DISAGREE') {
      throw new Error('Validators could not agree on the page evidence. Nothing was settled.');
    }
    if (receipt.txExecutionResultName === 'TIMEOUT') {
      throw new Error('The network timed out before the transaction was decided.');
    }
    throw new Error('The contract rejected this transaction. Read the vault state and try again.');
  }
  return receipt;
}
