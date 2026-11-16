import { readContract, sendWrite } from './genlayer';

export type VaultState = 'ACTIVE' | 'TRIGGERED' | 'CANCELLED' | 'REFUNDED';

export interface Vault {
  id: number;
  creator: string;
  beneficiary: string;
  title: string;
  condition: string;
  url: string;
  deadline: number;
  amount: string;
  state: VaultState | string;
  checks: number;
  checksLeft: number;
  maxChecks: number;
  cooldown: number;
  createdAt: number;
  lastCheckAt: number;
  lastOutcome: string;
  lastReason: string;
  lastMet: boolean;
  lastInjection: boolean;
  resolvedAt: number;
  checkableAt: number;
}

export interface Totals {
  owner: string;
  vaultCount: number;
  totalLocked: string;
  totalSettled: string;
  totalRefunded: string;
  totalCancelled: string;
  totalWithdrawn: string;
  totalChecks: number;
  balance: string;
}

export interface VaultPage {
  total: number;
  vaults: Vault[];
}

export interface CreateVaultInput {
  beneficiary: string;
  title: string;
  condition: string;
  url: string;
  deadline: number;
  value: bigint;
}

const EMPTY_TOTALS: Totals = {
  owner: '',
  vaultCount: 0,
  totalLocked: '0',
  totalSettled: '0',
  totalRefunded: '0',
  totalCancelled: '0',
  totalWithdrawn: '0',
  totalChecks: 0,
  balance: '0',
};

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function toBool(value: unknown): boolean {
  return value === true;
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function normalizeVault(raw: Record<string, unknown>): Vault {
  return {
    id: toNumber(raw.id),
    creator: toText(raw.creator),
    beneficiary: toText(raw.beneficiary),
    title: toText(raw.title, 'Untitled vault'),
    condition: toText(raw.condition),
    url: toText(raw.url),
    deadline: toNumber(raw.deadline),
    amount: toText(raw.amount, '0'),
    state: toText(raw.state, 'ACTIVE'),
    checks: toNumber(raw.checks),
    checksLeft: toNumber(raw.checks_left),
    maxChecks: toNumber(raw.max_checks, 12),
    cooldown: toNumber(raw.cooldown, 3600),
    createdAt: toNumber(raw.created_at),
    lastCheckAt: toNumber(raw.last_check_at),
    lastOutcome: toText(raw.last_outcome),
    lastReason: toText(raw.last_reason),
    lastMet: toBool(raw.last_met),
    lastInjection: toBool(raw.last_injection),
    resolvedAt: toNumber(raw.resolved_at),
    checkableAt: toNumber(raw.checkable_at),
  };
}

export async function fetchVault(id: number): Promise<Vault | null> {
  const raw = await readContract<string>('get_vault_json', [id]);
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  return normalizeVault(parsed);
}

export async function fetchVaults(offset = 0, limit = 50): Promise<VaultPage> {
  const raw = await readContract<string>('get_vaults_json', [offset, limit]);
  const parsed = parseJsonObject(raw);
  if (!parsed) return { total: 0, vaults: [] };
  const list = Array.isArray(parsed.vaults) ? parsed.vaults : [];
  return {
    total: toNumber(parsed.total, list.length),
    vaults: list.map((item) => normalizeVault(item as Record<string, unknown>)),
  };
}

export async function fetchVaultCount(): Promise<number> {
  const raw = await readContract<unknown>('get_vault_count');
  return toNumber(raw);
}

export async function fetchTotals(): Promise<Totals> {
  const raw = await readContract<string>('get_totals');
  const parsed = parseJsonObject(raw);
  if (!parsed) return { ...EMPTY_TOTALS };
  return {
    owner: toText(parsed.owner),
    vaultCount: toNumber(parsed.vault_count),
    totalLocked: toText(parsed.total_locked, '0'),
    totalSettled: toText(parsed.total_settled, '0'),
    totalRefunded: toText(parsed.total_refunded, '0'),
    totalCancelled: toText(parsed.total_cancelled, '0'),
    totalWithdrawn: toText(parsed.total_withdrawn, '0'),
    totalChecks: toNumber(parsed.total_checks),
    balance: toText(parsed.balance, '0'),
  };
}

export async function fetchCredit(address: string): Promise<bigint> {
  const raw = await readContract<unknown>('get_credit_of', [address]);
  if (typeof raw === 'bigint') return raw;
  try {
    return BigInt(String(raw));
  } catch {
    return 0n;
  }
}

export function createVaultAction(address: `0x${string}`, input: CreateVaultInput) {
  return sendWrite(
    address,
    'create_vault',
    [input.beneficiary, input.title, input.condition, input.url, input.deadline],
    input.value,
  );
}

export function checkVaultAction(address: `0x${string}`, id: number) {
  return sendWrite(address, 'check_vault', [id]);
}

export function cancelVaultAction(address: `0x${string}`, id: number) {
  return sendWrite(address, 'cancel_vault', [id]);
}

export function refundVaultAction(address: `0x${string}`, id: number) {
  return sendWrite(address, 'refund_vault', [id]);
}

export function withdrawAction(address: `0x${string}`) {
  return sendWrite(address, 'withdraw', []);
}
