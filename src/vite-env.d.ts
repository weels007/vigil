/// <reference types="vite/client" />

import type { EthereumProvider } from './lib/genlayer';

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export {};
