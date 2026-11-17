import { useState } from 'react';

import { Countdown, useNow } from '../components/Countdown';
import { StateBadge } from '../components/StateBadge';
import { EmptyState, ErrorState, Loader, Notice } from '../components/States';
import { useActions } from '../lib/actions';
import {
  cancelVaultAction,
  checkVaultAction,
  fetchCredit,
  fetchVault,
  refundVaultAction,
  withdrawAction,
} from '../lib/contract';
import { translateError } from '../lib/errors';
import { countdown, formatDate, formatDateTime, formatGen, shortAddress, toWei } from '../lib/format';
import { explorerAddress, waitForOutcome } from '../lib/genlayer';
import { useAsync } from '../lib/useAsync';
import { useWallet } from '../lib/wallet';

type Tone = 'info' | 'warn' | 'error' | 'success';

interface UiNotice {
  tone: Tone;
  text: string;
}

export function VaultDetail({ id }: { id: number }) {
  const wallet = useWallet();
  const { run, isPending } = useActions();
  const vault = useAsync(() => fetchVault(id), [id]);
  const credit = useAsync(
    async () => (wallet.address ? fetchCredit(wallet.address) : 0n),
    [wallet.address],
  );
  const now = useNow();
  const [notice, setNotice] = useState<UiNotice | null>(null);

  const act = async (
    key: string,
    label: string,
    task: (address: `0x${string}`) => Promise<`0x${string}`>,
    success: string,
  ) => {
    if (!wallet.address) {
      setNotice({ tone: 'warn', text: 'Connect a wallet before acting on this vault.' });
      return;
    }
    const address = wallet.address;
    setNotice(null);
    try {
      await run(key, async () => {
        const hash = await task(address);
        setNotice({
          tone: 'info',
          text: `${label}: transaction submitted. Waiting for consensus — an LLM check can take a few minutes.`,
        });
        await waitForOutcome(hash);
      });
      setNotice({ tone: 'success', text: success });
      vault.reload();
      credit.reload();
    } catch (error) {
      setNotice({ tone: 'error', text: translateError(error) });
    }
  };

  if (vault.loading && !vault.data) {
    return (
      <div className="page">
        <Loader label="Opening the vault…" />
      </div>
    );
  }

  if (vault.error) {
    return (
      <div className="page">
        <ErrorState message={vault.error} onRetry={vault.reload} />
      </div>
    );
  }

  if (!vault.data) {
    return (
      <div className="page">
        <EmptyState
          title="No such vault"
          body="This id is not in the register. It may never have been opened, or the contract address changed."
          action={
            <a className="btn btn-ghost btn-small" href="#/vaults">
              Back to the vaults
            </a>
          }
        />
      </div>
    );
  }

  const v = vault.data;
  const isCreator = wallet.address !== null && v.creator.toLowerCase() === wallet.address.toLowerCase();
  const canRefund = v.state === 'ACTIVE' && now >= v.deadline;
  const canCancel = v.state === 'ACTIVE' && isCreator;
  const canCheck = v.state === 'ACTIVE' && v.checks < v.maxChecks && now < v.deadline;
  const cooldownActive = canCheck && v.checks > 0 && now < v.checkableAt;
  const creditValue = credit.data ?? 0n;
  const anyPending =
    isPending('check') || isPending('cancel') || isPending('refund') || isPending('withdraw');

  return (
    <div className="page">
      <a className="back" href="#/vaults">
        ← Every vault
      </a>

      <header className="detail-head">
        <div>
          <p className="eyebrow">Vault № {String(v.id).padStart(3, '0')}</p>
          <h1 className="detail-title">{v.title}</h1>
          <div className="detail-meta">
            <StateBadge state={v.state} />
            <span className="muted">opened {formatDate(v.createdAt)}</span>
          </div>
        </div>
        <div className="detail-amount">
          <span className="label">Locked</span>
          <strong className="mono">{formatGen(toWei(v.amount))} GEN</strong>
          <a
            className="mono muted"
            href={explorerAddress(v.beneficiary)}
            target="_blank"
            rel="noreferrer"
          >
            for {shortAddress(v.beneficiary)}
          </a>
        </div>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel">
            <h2 className="panel-title">The condition</h2>
            <blockquote className="condition-quote">{v.condition}</blockquote>
            <div className="evidence">
              <span className="label">Evidence</span>
              <a href={v.url} target="_blank" rel="noreferrer" className="evidence-link">
                {v.url} ↗
              </a>
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-title">Deadline</h2>
            <div className="deadline-row">
              <Countdown deadline={v.deadline} className="countdown-large" />
              <span className="muted mono">{formatDateTime(v.deadline)}</span>
            </div>
            <p className="muted">
              Until the deadline passes, the creator can still cancel. After it, anyone may send the
              funds home.
            </p>
          </section>

          <section className="panel">
            <h2 className="panel-title">Check log</h2>
            <dl className="log-table">
              <div>
                <dt>Attempts</dt>
                <dd className="mono">
                  {v.checks} of {v.maxChecks}
                </dd>
              </div>
              <div>
                <dt>Last read</dt>
                <dd className="mono">{v.lastCheckAt ? formatDateTime(v.lastCheckAt) : 'never'}</dd>
              </div>
              <div>
                <dt>Last outcome</dt>
                <dd className="mono">{v.lastOutcome || '—'}</dd>
              </div>
              <div>
                <dt>Next read allowed</dt>
                <dd className="mono">
                  {v.checks >= v.maxChecks
                    ? '—'
                    : v.checks === 0
                      ? 'now'
                      : formatDateTime(v.checkableAt)}
                </dd>
              </div>
              <div>
                <dt>Resolved</dt>
                <dd className="mono">{v.resolvedAt ? formatDateTime(v.resolvedAt) : 'not yet'}</dd>
              </div>
            </dl>
            {v.lastReason ? <p className="decision-reason">“{v.lastReason}”</p> : null}
            {v.lastInjection ? (
              <Notice tone="warn">
                Manipulation attempt detected on the evidence page. A flagged check can never settle
                this vault.
              </Notice>
            ) : null}
          </section>
        </div>

        <aside className="detail-side">
          <section className="panel">
            <h2 className="panel-title">Actions</h2>
            {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

            <div className="action-stack">
              {canCheck ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={anyPending || !wallet.address || cooldownActive}
                  onClick={() =>
                    void act(
                      'check',
                      'Reading the page',
                      (address) => checkVaultAction(address, v.id),
                      'The check is decided. The log below is the record.',
                    )
                  }
                >
                  {isPending('check')
                    ? 'The keeper is reading…'
                    : cooldownActive
                      ? `Allowed in ${countdown(v.checkableAt, now).text}`
                      : 'Check now'}
                </button>
              ) : null}

              {canCancel ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={anyPending}
                  onClick={() => {
                    if (!window.confirm('Cancel this vault and return the deposit to the creator?')) {
                      return;
                    }
                    void act(
                      'cancel',
                      'Cancelling',
                      (address) => cancelVaultAction(address, v.id),
                      'The vault is cancelled. The deposit is credited to the creator.',
                    );
                  }}
                >
                  {isPending('cancel') ? 'Cancelling…' : 'Cancel vault'}
                </button>
              ) : null}

              {canRefund ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={anyPending}
                  onClick={() =>
                    void act(
                      'refund',
                      'Refunding',
                      (address) => refundVaultAction(address, v.id),
                      'The deadline has passed. The deposit is credited to the creator.',
                    )
                  }
                >
                  {isPending('refund') ? 'Refunding…' : 'Refund to creator'}
                </button>
              ) : null}

              {creditValue > 0n ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={anyPending}
                  onClick={() =>
                    void act(
                      'withdraw',
                      'Withdrawing',
                      (address) => withdrawAction(address),
                      'Your credit has been sent to your wallet.',
                    )
                  }
                >
                  {isPending('withdraw')
                    ? 'Withdrawing…'
                    : `Withdraw ${formatGen(creditValue)} GEN`}
                </button>
              ) : null}

              {!wallet.address ? (
                <button type="button" className="btn btn-ghost" onClick={() => void wallet.connect()}>
                  {wallet.connecting ? 'Connecting…' : 'Connect a wallet'}
                </button>
              ) : null}
            </div>

            <p className="hint">
              Checks are paid out of the transaction fee, not the vault. A check can be called by
              anyone, once per hour, up to {v.maxChecks} times, and only before the deadline.
            </p>
          </section>

          <section className="panel">
            <h2 className="panel-title">Parties</h2>
            <dl className="party-table">
              <div>
                <dt>Creator</dt>
                <dd>
                  <a className="mono" href={explorerAddress(v.creator)} target="_blank" rel="noreferrer">
                    {shortAddress(v.creator)}
                  </a>
                </dd>
              </div>
              <div>
                <dt>Beneficiary</dt>
                <dd>
                  <a
                    className="mono"
                    href={explorerAddress(v.beneficiary)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(v.beneficiary)}
                  </a>
                </dd>
              </div>
            </dl>
          </section>

          <section className="panel credit-panel">
            <h2 className="panel-title">Your credit</h2>
            <p className="credit-value mono">{formatGen(creditValue)} GEN</p>
            <p className="hint">
              Vigil never pushes funds. Settlement and refunds credit an address, and the address
              pulls with withdraw().
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
