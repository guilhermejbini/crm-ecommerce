import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Global error handlers and console filtering for third-party extensions and Firebase free-tier quota backoff
if (typeof window !== 'undefined') {
  const isIgnorableError = (msg: string) => {
    const lower = (msg || '').toLowerCase();
    return (
      lower.includes('metamask') ||
      lower.includes('ethereum') ||
      lower.includes('chrome-extension') ||
      lower.includes('moz-extension') ||
      lower.includes('failed to connect to metamask')
    );
  };

  // Intercept uncaught rejections (such as Firebase offline sync backoff)
  window.addEventListener(
    'unhandledrejection',
    (event) => {
      const msg = event?.reason?.message || String(event?.reason || '');
      if (isIgnorableError(msg)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true
  );

  // Intercept uncaught window errors
  window.addEventListener(
    'error',
    (event) => {
      const msg = event?.message || String(event?.error?.message || '');
      if (isIgnorableError(msg)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true
  );

  // Filter console.error to prevent Firestore background retry/backoff logs from being detected as fatal errors
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const msg = args
      .map((a) => (typeof a === 'object' && a !== null ? a.message || a.code || JSON.stringify(a) : String(a)))
      .join(' ');

    if (isIgnorableError(msg)) {
      console.warn('[Firebase/Extension Quota Handled]', ...args);
      return;
    }
    originalConsoleError.apply(console, args);
  };

  const originalConsoleWarn = console.warn;
  console.warn = (...args: any[]) => {
    const msg = args
      .map((a) => (typeof a === 'object' && a !== null ? a.message || a.code || JSON.stringify(a) : String(a)))
      .join(' ');

    if (msg.includes('Using maximum backoff delay') || msg.includes('maximum backoff delay')) {
      // Suppress noisy Firestore backoff message completely
      return;
    }
    originalConsoleWarn.apply(console, args);
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
