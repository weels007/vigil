import type { ReactNode } from 'react';

import { CONTRACT_ADDRESS, HAS_CONTRACT, STUDIONET_EXPLORER, explorerAddress } from '../lib/genlayer';
import { shortAddress } from '../lib/format';
import type { Route } from '../lib/router';
import { useWallet } from '../lib/wallet';
import { Logo } from './Logo';

function navClass(active: boolean): string {
  return active ? 'nav-link is-active' : 'nav-link';
}

export function Layout({ route, children }: { route: Route; children: ReactNode }) {
  const wallet = useWallet();
  const section = route.parts[0] ?? '';

  return (
    <div className="app">
      <div className="sky" aria-hidden="true" />
      <header className="masthead">
        <div className="shell masthead-inner">
          <a className="brand" href="#/">
            <span className="brand-mark">
              <Logo size={32} />
            </span>
            <span className="brand-text">
              <span className="brand-word">Vigil</span>
              <span className="brand-tag">conditional vaults</span>
            </span>
          </a>

          <nav className="nav" aria-label="Primary">
            <a className={navClass(section === 'vaults')} href="#/vaults">
              Vaults
            </a>
            <a className={navClass(section === 'create')} href="#/create">
              Open a vault
            </a>
            <a className={navClass(section === 'activity')} href="#/activity">
              Ledger
            </a>
          </nav>

          <div className="wallet-area">
            {wallet.address ? (
              <>
                {!wallet.onStudionet ? (
                  <button type="button" className="btn btn-warn btn-small" onClick={() => void wallet.switchNetwork()}>
                    Switch to Studionet
                  </button>
                ) : null}
                <span className="wallet-chip" title={wallet.address}>
                  <span className="wallet-dot" aria-hidden="true" />
                  {shortAddress(wallet.address)}
                </span>
                <button type="button" className="link-btn" onClick={wallet.disconnect}>
                  Sign out
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={wallet.connecting}
                onClick={() => void wallet.connect()}
              >
                {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
              </button>
            )}
          </div>
        </div>
        {wallet.error ? (
          <div className="shell">
            <div className="notice notice-error notice-inline" role="alert">
              <span>{wallet.error}</span>
              <button type="button" className="link-btn" onClick={wallet.clearError}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
      </header>

      <main className="shell main">{children}</main>

      <footer className="footer">
        <div className="shell footer-inner">
          <div className="footer-mark">
            <Logo size={22} />
            <span>Vigil keeps the night watch over conditional money.</span>
          </div>
          <div className="footer-links">
            <a href={STUDIONET_EXPLORER} target="_blank" rel="noreferrer">
              Studionet explorer
            </a>
            {HAS_CONTRACT ? (
              <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="mono">
                contract {shortAddress(CONTRACT_ADDRESS)}
              </a>
            ) : (
              <span className="mono muted">contract not recorded</span>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
