import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { translateError } from './errors';
import { connectWallet, ensureStudionet, getProvider } from './genlayer';

interface WalletApi {
  address: `0x${string}` | null;
  chainId: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  disconnect: () => void;
  clearError: () => void;
  onStudionet: boolean;
}

const WalletContext = createContext<WalletApi | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshChain = useCallback(async () => {
    const provider = getProvider();
    if (!provider) return;
    try {
      const current = await provider.request({ method: 'eth_chainId' });
      setChainId(typeof current === 'string' ? current.toLowerCase() : null);
    } catch {
      setChainId(null);
    }
  }, []);

  useEffect(() => {
    const provider = getProvider();
    if (!provider) return;
    let alive = true;

    provider
      .request({ method: 'eth_accounts' })
      .then((accounts) => {
        if (!alive) return;
        if (Array.isArray(accounts) && accounts.length > 0) {
          setAddress(accounts[0] as `0x${string}`);
          return refreshChain();
        }
        return undefined;
      })
      .catch(() => undefined);

    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0];
      if (Array.isArray(accounts) && accounts.length > 0) {
        setAddress(accounts[0] as `0x${string}`);
      } else {
        setAddress(null);
      }
    };
    const onChain = (...args: unknown[]) => {
      const next = args[0];
      setChainId(typeof next === 'string' ? next.toLowerCase() : null);
    };

    provider.on?.('accountsChanged', onAccounts);
    provider.on?.('chainChanged', onChain);
    return () => {
      alive = false;
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
    };
  }, [refreshChain]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const account = await connectWallet();
      setAddress(account);
      await refreshChain();
    } catch (err) {
      setError(translateError(err));
    } finally {
      setConnecting(false);
    }
  }, [refreshChain]);

  const switchNetwork = useCallback(async () => {
    const provider = getProvider();
    if (!provider) {
      setError('No browser wallet was found.');
      return;
    }
    try {
      await ensureStudionet(provider);
      await refreshChain();
    } catch (err) {
      setError(translateError(err));
    }
  }, [refreshChain]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const onStudionet = chainId === null || chainId === '0xf22f';

  const value = useMemo<WalletApi>(
    () => ({
      address,
      chainId,
      connecting,
      error,
      connect,
      switchNetwork,
      disconnect,
      clearError,
      onStudionet,
    }),
    [address, chainId, connecting, error, connect, switchNetwork, disconnect, clearError, onStudionet],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletApi {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet must be used inside WalletProvider');
  return context;
}
