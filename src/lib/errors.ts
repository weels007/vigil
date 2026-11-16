function rawMessage(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    if (typeof current === 'string') {
      parts.push(current);
      break;
    }
    if (current instanceof Error) {
      parts.push(current.message);
    }
    const record = current as { shortMessage?: unknown; details?: unknown; cause?: unknown };
    if (typeof record.shortMessage === 'string') parts.push(record.shortMessage);
    if (typeof record.details === 'string') parts.push(record.details);
    current = record.cause;
  }
  return parts.filter(Boolean).join(' | ');
}

const TRANSLATIONS: Array<[string, string]> = [
  ['user rejected', 'The wallet cancelled the transaction.'],
  ['user denied', 'The wallet cancelled the transaction.'],
  ['rejected the request', 'The wallet cancelled the transaction.'],
  ['user disapproved', 'The wallet cancelled the transaction.'],
  ['insufficient funds', 'This wallet does not have enough GEN for the deposit plus the network fee.'],
  ['exceeds balance', 'This wallet does not have enough GEN for the deposit plus the network fee.'],
  ['chain id', 'Your wallet is on another network. Switch to GenLayer Studionet and try again.'],
  ['wrong chain', 'Your wallet is on another network. Switch to GenLayer Studionet and try again.'],
  ['vault is not active', 'This vault is no longer active.'],
  ['vault not found', 'That vault does not exist.'],
  ['check cooldown', 'This vault was checked less than an hour ago. The keeper needs time between reads.'],
  ['check limit', 'This vault has reached its limit of checks. It can still be refunded after the deadline.'],
  ['nothing to withdraw', 'There is nothing to withdraw for this address.'],
  ['deadline has not passed', 'The deadline has not passed yet. The creator can still cancel instead.'],
  ['only the creator', 'Only the creator can cancel this vault.'],
  ['beneficiary must differ', 'The beneficiary must be a different address from the creator.'],
  ['deposit must be greater', 'The deposit must be greater than zero.'],
  ['condition is longer', 'Keep the condition under 500 characters.'],
  ['condition is required', 'Write the condition the keeper should verify.'],
  ['title is longer', 'Keep the title under 80 characters.'],
  ['title is required', 'Give the vault a short title.'],
  ['url must', 'The URL must be a public http:// or https:// address with a host.'],
  ['deadline must be in the future', 'Pick a deadline in the future.'],
  ['address', 'That address is not a valid 20-byte GenLayer address.'],
  ['not deployed', 'Vigil is not deployed yet. The contract address has not been recorded.'],
  ['nondet_disagree', 'Validators could not agree on the page evidence. Nothing was settled.'],
  ['validators', 'Validators could not agree on the page evidence. Nothing was settled.'],
  ['timed out', 'The network did not answer in time. The transaction may still be decided; check the vault again.'],
  ['timeout', 'The network did not answer in time. The transaction may still be decided; check the vault again.'],
  ['rate limit', 'The network is busy. Wait a moment and try again.'],
  ['failed to fetch', 'The GenLayer RPC could not be reached. Check the connection and try again.'],
];

export function translateError(error: unknown): string {
  const message = rawMessage(error);
  if (!message) return 'Something went wrong. Try again.';
  const lowered = message.toLowerCase();
  for (const [needle, translated] of TRANSLATIONS) {
    if (lowered.includes(needle)) return translated;
  }
  if (message.length > 240) return `${message.slice(0, 237)}...`;
  return message;
}
