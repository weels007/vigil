import { useMemo, useState } from 'react';

import { EmptyState, ErrorState, Loader } from '../components/States';
import { VaultCard } from '../components/VaultCard';
import { fetchVaults } from '../lib/contract';
import { formatNumber } from '../lib/format';
import { HAS_CONTRACT } from '../lib/genlayer';
import { useAsync } from '../lib/useAsync';

const FILTERS = ['ALL', 'ACTIVE', 'TRIGGERED', 'REFUNDED', 'CANCELLED'] as const;

export function Explorer() {
  const [filter, setFilter] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const page = useAsync(
    async () => (HAS_CONTRACT ? fetchVaults(0, 50) : { total: 0, vaults: [] }),
    [],
  );

  const vaults = page.data?.vaults ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return vaults.filter((vault) => {
      if (filter !== 'ALL' && vault.state !== filter) return false;
      if (!needle) return true;
      return (
        vault.title.toLowerCase().includes(needle) ||
        vault.condition.toLowerCase().includes(needle) ||
        vault.url.toLowerCase().includes(needle) ||
        vault.creator.toLowerCase().includes(needle) ||
        vault.beneficiary.toLowerCase().includes(needle) ||
        String(vault.id) === needle
      );
    });
  }, [vaults, filter, query]);

  return (
    <div className="page">
      <header className="explorer-head">
        <div>
          <p className="eyebrow">The register</p>
          <h1 className="page-title">Every vigil on the ledger</h1>
          <p className="muted">
            {formatNumber(page.data?.total ?? 0)} vaults opened · showing the newest{' '}
            {vaults.length > 0 ? vaults.length : 0}
          </p>
        </div>
        <a className="btn btn-primary btn-small" href="#/create">
          Open a vault
        </a>
      </header>

      <div className="toolbar">
        <div className="chip-row" role="group" aria-label="Filter by state">
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              className={`chip ${filter === value ? 'is-active' : ''}`}
              onClick={() => setFilter(value)}
            >
              {value === 'ALL' ? 'All' : value.toLowerCase()}
            </button>
          ))}
        </div>
        <label className="search">
          <span className="sr-only">Search vaults</span>
          <input
            type="search"
            value={query}
            placeholder="Search a title, a URL, an address…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {page.loading ? (
        <Loader />
      ) : page.error ? (
        <ErrorState message={page.error} onRetry={page.reload} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={vaults.length === 0 ? 'No vaults yet' : 'Nothing matches that filter'}
          body={
            vaults.length === 0
              ? 'This deployment has no vaults. Write the first condition and lock the first deposit.'
              : 'Try a different state, or clear the search field.'
          }
          action={
            vaults.length === 0 ? (
              <a className="btn btn-primary btn-small" href="#/create">
                Open a vault
              </a>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => {
                  setFilter('ALL');
                  setQuery('');
                }}
              >
                Clear filters
              </button>
            )
          }
        />
      ) : (
        <div className="vault-grid">
          {filtered.map((vault) => (
            <VaultCard key={vault.id} vault={vault} />
          ))}
        </div>
      )}
    </div>
  );
}
