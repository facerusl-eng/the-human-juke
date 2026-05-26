
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppDataProvider } from './state/AppDataContext'

console.log('[HJ-DEBUG] main.tsx loaded');

const rootEl = document.getElementById('root');
if (!rootEl) {
  console.error('[HJ-DEBUG] No root element found!');
} else {
  console.log('[HJ-DEBUG] Root element found, rendering app...');
  createRoot(rootEl).render(
    <StrictMode>
      <AppDataProvider>
        <App />
      </AppDataProvider>
    </StrictMode>,
  );
}
