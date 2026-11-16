import { Layout } from './components/Layout';
import { EmptyState } from './components/States';
import { ActionsProvider } from './lib/actions';
import { useHashRoute, type Route } from './lib/router';
import { WalletProvider } from './lib/wallet';
import { Activity } from './pages/Activity';
import { CreateVault } from './pages/CreateVault';
import { Explorer } from './pages/Explorer';
import { Landing } from './pages/Landing';
import { VaultDetail } from './pages/VaultDetail';

function NotFound() {
  return (
    <div className="page">
      <EmptyState
        title="This page is not in the ledger"
        body="The route does not exist. The vaults, the form and the ledger are one tap away."
        action={
          <a className="btn btn-primary btn-small" href="#/vaults">
            Back to the vaults
          </a>
        }
      />
    </div>
  );
}

function renderPage(route: Route) {
  const [first, second] = route.parts;

  if (!first) return <Landing />;

  if (first === 'vaults') {
    if (!second) return <Explorer />;
    const id = Number(second);
    if (!Number.isInteger(id) || id < 0) return <NotFound />;
    return <VaultDetail id={id} />;
  }

  if (first === 'create' && !second) return <CreateVault />;
  if (first === 'activity' && !second) return <Activity />;

  return <NotFound />;
}

function Routed() {
  const route = useHashRoute();
  return <Layout route={route}>{renderPage(route)}</Layout>;
}

export function App() {
  return (
    <WalletProvider>
      <ActionsProvider>
        <Routed />
      </ActionsProvider>
    </WalletProvider>
  );
}
