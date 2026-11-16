import type { Vault } from '../lib/contract';
import { formatDate, formatGen, shortAddress, toWei } from '../lib/format';
import { StateBadge } from './StateBadge';

export function VaultCard({ vault }: { vault: Vault }) {
  return (
    <a className="vault-card" href={`#/vaults/${vault.id}`}>
      <div className="vault-card-top">
        <span className="eyebrow">Vault № {String(vault.id).padStart(3, '0')}</span>
        <StateBadge state={vault.state} />
      </div>
      <h3 className="vault-title">{vault.title}</h3>
      <p className="vault-condition">{vault.condition}</p>
      <dl className="vault-ledger">
        <div>
          <dt>Locked</dt>
          <dd className="mono">{formatGen(toWei(vault.amount))} GEN</dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd className="mono">{formatDate(vault.deadline)}</dd>
        </div>
      </dl>
      <div className="vault-foot">
        <span className="mono muted">
          {vault.checks} / {vault.maxChecks} checks
        </span>
        <span className="mono muted">by {shortAddress(vault.creator)}</span>
        <span className="vault-arrow" aria-hidden="true">
          →
        </span>
      </div>
    </a>
  );
}
