import { useState } from 'react';

import { EmptyState, ErrorState, Loader, Notice } from '../components/States';
import { useActions } from '../lib/actions';
import { fetchCredit, fetchTotals, fetchVaults, withdrawAction } from '../lib/contract';
import { translateError } from '../lib/errors';
import { formatDateTime, formatGen, formatNumber, shortAddress, toWei } from '../lib/format';
import { HAS_CONTRACT, waitForOutcome } from '../lib/genlayer';
import { useAsync } from '../lib/useAsync';
import { useWallet } from '../lib/wallet';

interface LedgerEvent {
  key: string;
  at: number;
  vaultId: number;
  title: string;
  kind: string;
  detail: string;
  tone: string;
}

function outcomeTone(outcome: string): string {
  if (outcome === 'MET') return 'unlocked';
  if (outcome === 'INJECTION') return 'warn';
  if (outcome === 'UNVERIFIABLE') return 'muted';
  return 'ink';
}

function resolutionDetail(state: string): string {
  if (state === 'TRIGGERED') return 'condition met — credited to the beneficiary';
  if (state === 'CANCELLED') return 'cancelled by the creator';
  if (state === 'REFUNDED') return 'deadline passed — refunded to the creator';
  return state.toLowerCase();
}

export function Activity() {
  const wallet = useWallet();
  const { run, isPending } = useActions();
  const page = useAsync(
    async () => (HAS_CONTRACT ? fetchVaults(0, 50) : { total: 0, vaults: [] }),
    [],
  );
  const totals = useAsync(async () => (HAS_CONTRACT ? fetchTotals() : null), []);
  const credit = useAsync(
    async () => (wallet.address ? fetchCredit(wallet.address) : 0n),
    [wallet.address],
  );
  const [notice, setNotice] = useState<{ tone: 'info' | 'warn' | 'error' | 'success'; text: string } | null>(
    null,
  );

  const vaults = page.data?.vaults ?? [];
  const events: LedgerEvent[] = [];
  for (const vault of vaults) {
    if (vault.createdAt > 0) {
      events.push({
        key: `${vault.id}-created`,
        at: vault.createdAt,
        vaultId: vault.id,
        title: vault.title,
        kind: 'opened',
        detail: `${formatGen(toWei(vault.amount))} GEN locked`,
        tone: 'ink',
      });
    }
    if (vault.lastCheckAt > 0) {
      events.push({
        key: `${vault.id}-check-${vault.checks}`,
        at: vault.lastCheckAt,
        vaultId: vault.id,
        title: vault.title,
        kind: 'checked',
        detail: `${vault.lastOutcome || 'no decision'}${vault.lastReason ? ` — ${vault.lastReason}` : ''}`,
        tone: outcomeTone(vault.lastOutcome),
      });
    }
    if (vault.resolvedAt > 0) {
      events.push({
        key: `${vault.id}-resolved`,
        at: vault.resolvedAt,
        vaultId: vault.id,
        title: vault.title,
        kind: vault.state.toLowerCase(),
        detail: resolutionDetail(vault.state),
        tone: vault.state === 'TRIGGERED' ? 'unlocked' : vault.state === 'REFUNDED' ? 'muted' : 'warn',
      });
    }
  }
  events.sort((left, right) => right.at - left.at);

  const creditValue = credit.data ?? 0n;

  const withdraw = async () => {
    if (!wallet.address) {
      setNotice({ tone: 'warn', text: 'Connect a wallet to withdraw.' });
      return;
    }
    const address = wallet.address;
    setNotice(null);
    try {
      await run('withdraw', async () => {
        const hash = await withdrawAction(address);
        await waitForOutcome(hash);
      });
      setNotice({ tone: 'success', text: 'Your credit has been sent to your wallet.' });
      credit.reload();
      totals.reload();
    } catch (error) {
      setNotice({ tone: 'error', text: translateError(error) });
    }
  };

  return (
    <div className="page">
      <header className="explorer-head">
        <div>
          <p className="eyebrow">The keeper's ledger</p>
          <h1 className="page-title">Activity</h1>
          <p className="muted">Every opening, read and resolution this contract can prove.</p>
        </div>
      </header>

      <div className="ledger-grid">
        <section className="panel">
          <h2 className="panel-title">Contract totals</h2>
          {totals.loading && !totals.data ? (
            <Loader label="Counting the ledger…" />
          ) : totals.error ? (
            <ErrorState message={totals.error} onRetry={totals.reload} />
          ) : (
            <dl className="log-table">
              <div>
                <dt>Vaults</dt>
                <dd className="mono">{formatNumber(totals.data?.vaultCount ?? 0)}</dd>
              </div>
              <div>
                <dt>Currently locked</dt>
                <dd className="mono">{formatGen(toWei(totals.data?.totalLocked ?? '0'))} GEN</dd>
              </div>
              <div>
                <dt>Unlocked</dt>
                <dd className="mono">{formatGen(toWei(totals.data?.totalSettled ?? '0'))} GEN</dd>
              </div>
              <div>
                <dt>Cancelled</dt>
                <dd className="mono">{formatGen(toWei(totals.data?.totalCancelled ?? '0'))} GEN</dd>
              </div>
              <div>
                <dt>Refunded</dt>
                <dd className="mono">{formatGen(toWei(totals.data?.totalRefunded ?? '0'))} GEN</dd>
              </div>
              <div>
                <dt>Checks</dt>
                <dd className="mono">{formatNumber(totals.data?.totalChecks ?? 0)}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="panel credit-panel">
          <h2 className="panel-title">Pull payments</h2>
          {wallet.address ? (
            <>
              <p className="credit-value mono">{formatGen(creditValue)} GEN</p>
              <p className="hint mono">{shortAddress(wallet.address)}</p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={creditValue === 0n || isPending('withdraw')}
                onClick={() => void withdraw()}
              >
                {isPending('withdraw') ? 'Withdrawing…' : 'Withdraw credit'}
              </button>
            </>
          ) : (
            <>
              <p className="hint">Connect a wallet to see what it can pull from Vigil.</p>
              <button type="button" className="btn btn-ghost" onClick={() => void wallet.connect()}>
                {wallet.connecting ? 'Connecting…' : 'Connect a wallet'}
              </button>
            </>
          )}
          {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
        </section>
      </div>

      <section className="panel activity-panel">
        <h2 className="panel-title">Recent events</h2>
        {page.loading && !page.data ? (
          <Loader />
        ) : page.error ? (
          <ErrorState message={page.error} onRetry={page.reload} />
        ) : events.length === 0 ? (
          <EmptyState
            title="Nothing has happened yet"
            body="When a vault is opened or read, it leaves a line here."
            action={
              <a className="btn btn-primary btn-small" href="#/create">
                Open a vault
              </a>
            }
          />
        ) : (
          <ol className="activity-list">
            {events.slice(0, 60).map((event) => (
              <li key={event.key} className={`activity-row tone-${event.tone}`}>
                <span className="activity-time mono">{formatDateTime(event.at)}</span>
                <span className="activity-kind">{event.kind}</span>
                <span className="activity-body">
                  <a href={`#/vaults/${event.vaultId}`}>
                    №{String(event.vaultId).padStart(3, '0')} {event.title}
                  </a>
                  <span className="muted">{event.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
