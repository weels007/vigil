import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Vigil could not find its root element.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
