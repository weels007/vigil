import { EmptyState, ErrorState, Loader, Notice } from '../components/States';
import { VaultCard } from '../components/VaultCard';
import { fetchTotals, fetchVaults } from '../lib/contract';
import { formatGen, formatNumber, toWei } from '../lib/format';
import { HAS_CONTRACT } from '../lib/genlayer';
import { useAsync } from '../lib/useAsync';

export function Landing() {
  const totals = useAsync(async () => (HAS_CONTRACT ? fetchTotals() : null), []);
  const recent = useAsync(
    async () => (HAS_CONTRACT ? fetchVaults(0, 6) : { total: 0, vaults: [] }),
    [],
  );

  const stats = totals.data;

  return (
    <div className="page">
      <section className="hero">
        <p className="eyebrow">A GenLayer intelligent contract · Studionet</p>
        <h1 className="display">
          Money that waits
          <br />
          for the world to
          <span className="accent"> agree.</span>
        </h1>
        <p className="lede">
          Lock GEN behind a condition written in plain English. A public page is the evidence, an
          LLM reads it, and GenLayer validators must independently agree before a single coin moves.
          If the page is unclear, the vault stays shut.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="#/create">
            Open a vault
          </a>
          <a className="btn btn-ghost" href="#/vaults">
            Browse the vaults
          </a>
        </div>
        {!HAS_CONTRACT ? (
          <Notice tone="warn">
            The contract address has not been recorded yet. The app can be browsed, but reads and
            writes need a deployed Vigil.
          </Notice>
        ) : null}
      </section>

      <section className="stats" aria-label="Contract totals">
        <div className="stat">
          <span className="stat-label">Vaults opened</span>
          <span className="stat-value mono">{stats ? formatNumber(stats.vaultCount) : '—'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">GEN locked</span>
          <span className="stat-value mono">{stats ? formatGen(toWei(stats.totalLocked)) : '—'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">GEN unlocked</span>
          <span className="stat-value mono">{stats ? formatGen(toWei(stats.totalSettled)) : '—'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Checks performed</span>
          <span className="stat-value mono">{stats ? formatNumber(stats.totalChecks) : '—'}</span>
        </div>
      </section>

      <section className="how">
        <div className="section-head">
          <h2>The night watch, in three movements</h2>
          <p className="muted">No oracle. No keeper with a key. Only evidence and agreement.</p>
        </div>
        <ol className="how-list">
          <li className="how-step">
            <span className="step-num mono">I</span>
            <h3>Write the condition</h3>
            <p>
              One public URL, one plain-English sentence, one beneficiary, one deadline. The
              contract caps every field and refuses to open without a real deposit.
            </p>
          </li>
          <li className="how-step">
            <span className="step-num mono">II</span>
            <h3>Let the keeper read</h3>
            <p>
              Anyone can ask for a check. The contract fetches the page itself, fences the evidence,
              and asks an LLM for a structured decision — never for a private key.
            </p>
          </li>
          <li className="how-step">
            <span className="step-num mono">III</span>
            <h3>Wait for agreement</h3>
            <p>
              Validators re-run the task and must match on the decision, the injection flag and a
              coarse confidence bucket. Only then does deterministic code credit the beneficiary.
            </p>
          </li>
        </ol>
      </section>

      <section className="recent">
        <div className="section-head">
          <h2>Recently opened</h2>
          <a className="link-btn" href="#/vaults">
            All vaults →
          </a>
        </div>
        {recent.loading ? (
          <Loader />
        ) : recent.error ? (
          <ErrorState message={recent.error} onRetry={recent.reload} />
        ) : (recent.data?.vaults.length ?? 0) === 0 ? (
          <EmptyState
            title="The ledger is still blank"
            body="No vault has been opened on this deployment yet. The first one can be yours."
            action={
              <a className="btn btn-primary btn-small" href="#/create">
                Open the first vault
              </a>
            }
          />
        ) : (
          <div className="vault-grid">
            {recent.data?.vaults.map((vault) => (
              <VaultCard key={vault.id} vault={vault} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
